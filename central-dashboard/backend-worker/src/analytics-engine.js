/**
 * Workers Analytics Engine access for User Journey / custom activity.
 *
 * Dataset: user_journey  (auto-created on first write)
 * Locked schema (Phase 0 verified field order -> freeze):
 *   blob1 event | blob2 project | blob3 domain | blob4 path | blob5 referrer
 *   blob6 country | blob7 visitorId | blob8 sessionId
 *   blob9 browser | blob10 os | blob11 device   (appended 2026-10: server-side
 *   UA parsing in /api/track; rows written before this simply have '' -> "—")
 *   double1 duration(sec) | double2 client_timestamp(ms) | double3 count(=1)
 *   indexes -> blob8 (sessionId) ONLY. AE caps this dataset at 1 index (fixed at
 *   creation); visitorId (blob7) is queried directly, not indexed.
 *
 * AUTH: writeDataPoint() below is authorized by the [[analytics_engine_datasets]]
 * binding at deploy time and NEVER uses CF_API_TOKEN. Cloudflare has no
 * "Analytics Engine Write/Read" token scope (it does not exist). Only runSql()
 * reads use CF_API_TOKEN, and it needs just Account > Account Analytics > Read.
 *
 * STRICT accuracy rule: read helpers NEVER invent numbers. A failed / unsupported
 * query returns null so the UI shows "Not available" (same policy as the native
 * Cloudflare analytics path).
 */

const DATASET = "user_journey";

// event types we accept (whitelist) - anything else is dropped at the endpoint.
// Spec model: page_view, page_duration, navigation, session_activity. There is NO
// client session_end/session_start source-of-truth; sessions roll over via the
// inactivity timeout and liveness comes from session_activity heartbeats.
export const EVENTS = ["page_view", "page_duration", "navigation", "session_activity"];

// ---- write ----
function blob(v) {
  return String(v == null ? "" : v).slice(0, 512); // AE blob cap is 5120B; keep sane
}

/**
 * Write one event. `ev` = {event, project, domain, path, referrer, country,
 * visitorId, sessionId, browser, os, device, duration, clientTs}. Returns true
 * if dispatched.
 */
export function writeEvent(env, ev) {
  if (!env.AE) {
    console.warn("[ae] AE binding missing - dropped:", ev && ev.event);
    return false;
  }
  const sessionId = blob(ev.sessionId);
  try {
    env.AE.writeDataPoint({
      blobs: [
        blob(ev.event), blob(ev.project), blob(ev.domain), blob(ev.path),
        blob(ev.referrer), blob(ev.country), blob(ev.visitorId), sessionId,
        blob(ev.browser), blob(ev.os), blob(ev.device),
      ],
      doubles: [Number(ev.duration) || 0, Number(ev.clientTs) || 0, 1],
      // The user_journey dataset was created with a SINGLE index (sessionId).
      // AE freezes a dataset's index count at first write and REJECTS any
      // datapoint with more ("Maximum of 1 indexes supported"), so visitorId is
      // NOT indexed here - visitor drill-down filters blob7 directly (still fast
      // enough at this scale). Adding a 2nd index would need a brand-new dataset.
      indexes: [sessionId || "none"],
    });
    return true;
  } catch (err) {
    console.error("[ae] writeDataPoint failed:", err.message);
    return false;
  }
}

// ---- read (SQL API) ----
function sqlStr(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}
// AE (Workers Analytics Engine) SQL is a RESTRICTED ClickHouse subset. Live-probed
// (Phase 0): it does NOT support parseDateTimeBestEffort(), uniq()/uniqExact()/
// uniqExactIf()/any(), nor max()/min() on strings, nor ORDER BY on a non-projected
// column. Use toDateTime('YYYY-MM-DD HH:MM:SS') for time bounds, count(DISTINCT col)
// for distinct counts, argMax(col, timestamp) for a representative string, and always
// ORDER BY a projected alias. The helpers below encode that verified dialect.
const p2 = (n) => String(n).padStart(2, "0");
function dt(iso) {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`;
}
// only let well-formed identifiers through as filter values (defense in depth)
function safeVal(s) {
  return typeof s === "string" && /^[A-Za-z0-9 .:_\-/]{1,200}$/.test(s) ? s : null;
}

// Normalize a page_view referrer to a path. On traditional multi-page sites the
// snippet stores the full previous URL (document.referrer) in blob5; on SPAs it
// stores the previous pathname. Reduce both to a comparable "/path" for the flow.
function toPath(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return "";
  if (s[0] === "/") return s;
  try {
    return new URL(s).pathname;
  } catch {
    return s;
  }
}

async function runSql(env, sql) {
  const api = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`;
  const res = await fetch(api, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, "content-type": "text/plain" },
    body: sql,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`AE SQL ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = await res.json().catch(() => ({}));
  return json.data || [];
}

// guard each query: failure -> null (UI shows Not available), never a fake 0.
// The device columns (blob9/10/11) only exist once a new-format row has been
// written; if a query errors on them, retry once WITHOUT those three selects so
// the dashboard keeps working against an old-shaped dataset (the other columns -
// double1/blob1 for `seconds` - have always existed, so they are never dropped).
async function q(env, sql) {
  try {
    return await runSql(env, sql);
  } catch (err) {
    if (/blob(9|10|11)/.test(sql)) {
      const legacy = sql.replace(/\s*argMax\(blob(?:9|10|11), timestamp\) AS (?:browser|os|device),/g, "");
      try {
        return await runSql(env, legacy);
      } catch (err2) {
        console.error("[ae] query failed (device-less retry):", err2.message);
        return null;
      }
    }
    console.error("[ae] query failed:", err.message);
    return null;
  }
}

// Host scoping for tracked data: a stored event keeps the visitor's exact
// hostname in blob3. `domain` targets one host; `apexes` targets a project /
// account by matching each apex domain OR any of its subdomains (LIKE '%.apex').
// apexes === undefined -> no host filter (all tracked data); apexes === [] -> none.
function where({ since, until, domain, apexes, visitor, session, path, event }) {
  const parts = [
    `timestamp >= toDateTime(${sqlStr(dt(since))})`,
    `timestamp <= toDateTime(${sqlStr(dt(until))})`,
  ];
  const d = safeVal(domain);
  if (d) {
    parts.push(`blob3 = ${sqlStr(d)}`);
  } else if (Array.isArray(apexes)) {
    const conds = apexes
      .map((a) => safeVal(a))
      .filter(Boolean)
      .map((a) => `(blob3 = ${sqlStr(a)} OR blob3 LIKE ${sqlStr("%." + a)})`);
    parts.push(conds.length ? `(${conds.join(" OR ")})` : "1 = 0");
  }
  // optional drill-down / filter dimensions
  const v = safeVal(visitor);
  if (v) parts.push(`blob7 = ${sqlStr(v)}`); // visitorId
  const sid = safeVal(session);
  if (sid) parts.push(`blob8 = ${sqlStr(sid)}`); // sessionId
  if (typeof path === "string" && path.length <= 500 && /^[\x20-\x7E]+$/.test(path) && !path.includes("\\")) {
    parts.push(`blob4 = ${sqlStr(path)}`); // page path
  }
  const ev = safeVal(event);
  if (ev && EVENTS.includes(ev)) parts.push(`blob1 = ${sqlStr(ev)}`); // event type
  return parts.join(" AND ");
}

/** KPI overview for the tracked activity in the window. */
export async function journeyOverview(env, opts) {
  const w = where(opts);
  // distinct counts via count(DISTINCT col) scoped to page_view rows; other
  // aggregates via the supported -If combinators. Three guarded queries.
  const [pv, uv, ss] = await Promise.all([
    q(env, `
      SELECT countIf(blob1 = 'page_view') AS pageViews,
             avgIf(double1, blob1 = 'page_duration') AS avgTimeOnPage
      FROM ${DATASET} WHERE ${w}
    `),
    q(env, `SELECT count(DISTINCT blob7) AS u FROM ${DATASET} WHERE ${w} AND blob1 = 'page_view'`),
    q(env, `SELECT count(DISTINCT blob8) AS s FROM ${DATASET} WHERE ${w} AND blob1 = 'page_view'`),
  ]);
  const ok = !!(pv && pv[0] && uv && uv[0] && ss && ss[0]);
  const base = ok
    ? {
        uniqueVisitors: num(uv[0].u),
        sessions: num(ss[0].s),
        pageViews: num(pv[0].pageViews),
        avgTimeOnPage: pv[0].avgTimeOnPage == null ? null : num(pv[0].avgTimeOnPage),
      }
    : null;

  // bounce rate needs per-session page counts (subquery); degrade to null if unsupported
  let bounceRate = null;
  const br = await q(env, `
    SELECT count() AS sessions, countIf(pv = 1) AS bounces FROM (
      SELECT blob8 AS sid, countIf(blob1 = 'page_view') AS pv
      FROM ${DATASET} WHERE ${w} GROUP BY sid HAVING pv > 0
    )
  `);
  if (br && br[0] && num(br[0].sessions) > 0) {
    bounceRate = (num(br[0].bounces) / num(br[0].sessions)) * 100;
  }

  const pagesPerSession =
    base && base.sessions > 0 && base.pageViews != null ? base.pageViews / base.sessions : null;

  return {
    available: !!base,
    uniqueVisitors: base ? base.uniqueVisitors : null,
    sessions: base ? base.sessions : null,
    pageViews: base ? base.pageViews : null,
    avgTimeOnPage: base ? base.avgTimeOnPage : null,
    pagesPerSession,
    bounceRate,
  };
}

/** Most-visited paths, newest activity first (a path that just got a view
 *  bubbles to the top and stays there as it accumulates views). */
export async function topPages(env, opts) {
  const rows = await q(env, `
    SELECT
      blob4 AS path,
      countIf(blob1 = 'page_view') AS views,
      count(DISTINCT blob7) AS visitors,
      avgIf(double1, blob1 = 'page_duration') AS avgSeconds,
      max(timestamp) AS lastSeen
    FROM ${DATASET} WHERE ${where(opts)}
    GROUP BY blob4 HAVING views > 0
    ORDER BY lastSeen DESC LIMIT 50
  `);
  if (!rows) return null;
  return rows.map((r) => ({
    path: r.path,
    views: num(r.views),
    visitors: num(r.visitors),
    avgSeconds: r.avgSeconds == null ? null : num(r.avgSeconds),
    lastSeen: r.lastSeen || null,
  }));
}

/** Entry pages (first page_view per session) and exit pages (last).
 *  Ordered by the CLIENT event time (double2), not AE ingestion time: within a
 *  session the client clock defines the true order a visitor saw pages, while the
 *  server ingestion timestamp is non-deterministic for rapid/batched writes.
 *  /api/track validates ts>0, so double2 is always a positive client epoch-ms. */
export async function entryExitPages(env, opts) {
  const w = where(opts);
  const mk = (agg) => q(env, `
    SELECT path, count() AS c FROM (
      SELECT blob8 AS sid, ${agg}(blob4, double2) AS path
      FROM ${DATASET} WHERE ${w} AND blob1 = 'page_view' GROUP BY sid
    ) GROUP BY path ORDER BY c DESC LIMIT 20
  `);
  const [entry, exit] = await Promise.all([mk("argMin"), mk("argMax")]);
  const shape = (r) => (r ? r.map((x) => ({ path: x.path, count: num(x.c) })) : null);
  return { entry: shape(entry), exit: shape(exit) };
}

/** Recent sessions list. */
export async function listSessions(env, opts) {
  const rows = await q(env, `
    SELECT
      blob8 AS sessionId,
      argMax(blob7, timestamp) AS visitorId,
      argMax(blob6, timestamp) AS country,
      argMax(blob3, timestamp) AS domain,
      argMax(blob9, timestamp) AS browser,
      argMax(blob10, timestamp) AS os,
      argMax(blob11, timestamp) AS device,
      min(timestamp) AS startedAt,
      max(timestamp) AS endedAt,
      countIf(blob1 = 'page_view') AS pageViews,
      sumIf(double1, blob1 = 'page_duration') AS seconds
    FROM ${DATASET} WHERE ${where(opts)} AND blob8 != ''
    GROUP BY sessionId ORDER BY endedAt DESC LIMIT 100
  `);
  // ORDER BY endedAt (last activity), NOT startedAt: an ongoing session that
  // keeps receiving events must stay/bubble to the top (newest activity first).
  if (!rows) return null;
  return rows.map((r) => ({
    sessionId: r.sessionId,
    visitorId: r.visitorId,
    country: r.country,
    domain: r.domain,
    browser: r.browser || null,
    os: r.os || null,
    device: r.device || null,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    pageViews: num(r.pageViews),
    seconds: r.seconds == null ? null : num(r.seconds),
  }));
}

/** Ordered event timeline for one session (drill-down). */
export async function sessionDetail(env, opts, sessionId) {
  const id = safeVal(sessionId);
  if (!id) return { available: false, rows: null };
  const w = where(opts);
  const rows = await q(env, `
    SELECT timestamp AS ts, blob1 AS event, blob4 AS path, blob3 AS domain,
           blob5 AS referrer, double1 AS duration, double2 AS clientTs
    FROM ${DATASET} WHERE ${w} AND blob8 = ${sqlStr(id)}
    ORDER BY clientTs ASC, ts ASC LIMIT 500
  `);
  if (!rows) return { available: false, rows: null, sessionId: id };
  return {
    available: true,
    sessionId: id,
    rows: rows.map((r) => ({
      timestamp: r.ts,
      event: r.event,
      path: r.path,
      domain: r.domain,
      referrer: r.referrer || "",
      duration: r.duration == null ? null : num(r.duration),
    })),
  };
}

/** Page -> page flow.
 *  Derived from page_view referrers (blob5 = the page the visitor came FROM,
 *  blob4 = the page they landed ON). This works for BOTH traditional multi-page
 *  sites (full loads -> document.referrer carries the previous URL) and SPAs
 *  (route changes -> the snippet sends the previous pathname). The dedicated
 *  'navigation' event only fires on client-side route changes, so relying on it
 *  left multi-page sites (e.g. xixvideohub.com) with an always-empty flow.
 *  Referrers are normalized to a path, self-transitions (same-page reloads) are
 *  dropped, and pairs are re-aggregated in JS. */
export async function navigationFlow(env, opts) {
  const rows = await q(env, `
    SELECT blob5 AS referrer, blob4 AS path, count() AS transitions, max(timestamp) AS lastSeen
    FROM ${DATASET} WHERE ${where(opts)} AND blob1 = 'page_view' AND blob5 != ''
    GROUP BY referrer, path ORDER BY lastSeen DESC LIMIT 300
  `);
  if (!rows) return null;
  const agg = new Map();
  for (const r of rows) {
    const from = toPath(r.referrer);
    const to = toPath(r.path);
    if (!from || !to || from === to) continue; // skip empty + same-page reloads
    const key = from + "\u0000" + to;
    const cur = agg.get(key) || { transitions: 0, lastSeen: null };
    cur.transitions += num(r.transitions);
    // keep the newest activity time for the pair. AE returns fixed-width
    // "YYYY-MM-DD HH:MM:SS" timestamp strings, so a plain string comparison is
    // chronological (no date parsing needed here, and it stays consistent with
    // topPages/listSessions/listVisitors which all return the raw AE string).
    const ls = r.lastSeen || null;
    if (ls && (!cur.lastSeen || String(ls) > String(cur.lastSeen))) cur.lastSeen = ls;
    agg.set(key, cur);
  }
  return [...agg.entries()]
    .map(([k, v]) => {
      const i = k.indexOf("\u0000");
      return { referrer: k.slice(0, i), path: k.slice(i + 1), transitions: v.transitions, lastSeen: v.lastSeen || null };
    })
    .sort((a, b) => String(b.lastSeen || "").localeCompare(String(a.lastSeen || "")))
    .slice(0, 50);
}

/** Visitors list (for the individual-journey view). One row per unique user:
 *  who they are (anonymous ID), what they used (browser/OS/device - from the
 *  server-side UA parsing added in /api/track), how much they visited
 *  (sessions / page views / total active time) and when (first/last seen). */
export async function listVisitors(env, opts) {
  const rows = await q(env, `
    SELECT
      blob7 AS visitorId,
      argMax(blob6, timestamp) AS country,
      argMax(blob3, timestamp) AS domain,
      argMax(blob9, timestamp) AS browser,
      argMax(blob10, timestamp) AS os,
      argMax(blob11, timestamp) AS device,
      count(DISTINCT blob8) AS sessions,
      countIf(blob1 = 'page_view') AS pageViews,
      sumIf(double1, blob1 = 'page_duration') AS seconds,
      min(timestamp) AS firstSeen,
      max(timestamp) AS lastSeen
    FROM ${DATASET} WHERE ${where(opts)} AND blob7 != ''
    GROUP BY visitorId ORDER BY lastSeen DESC LIMIT 200
  `);
  if (!rows) return null;
  return rows.map((r) => ({
    visitorId: r.visitorId,
    country: r.country,
    domain: r.domain,
    browser: r.browser || null,
    os: r.os || null,
    device: r.device || null,
    sessions: num(r.sessions),
    pageViews: num(r.pageViews),
    seconds: r.seconds == null ? null : num(r.seconds),
    firstSeen: r.firstSeen,
    lastSeen: r.lastSeen,
  }));
}

/** Distinct tracked hostnames (blob3) with a representative project + page-view
 *  count. Used to populate the Domain filter for tracked data, including hosts
 *  that are NOT a Cloudflare zone (Pages/external), so domain-wise filtering works
 *  on the User Journey pages. Honors the same account/project/domain scope opts. */
export async function trackedDomains(env, opts) {
  const rows = await q(env, `
    SELECT blob3 AS domain,
           argMax(blob2, timestamp) AS project,
           countIf(blob1 = 'page_view') AS pageViews,
           max(timestamp) AS lastSeen
    FROM ${DATASET} WHERE ${where(opts)} AND blob3 != ''
    GROUP BY domain ORDER BY pageViews DESC LIMIT 500
  `);
  if (!rows) return null;
  return rows
    .filter((r) => r.domain)
    .map((r) => ({
      domain: r.domain,
      project: r.project || null,
      pageViews: num(r.pageViews),
      lastSeen: r.lastSeen,
    }));
}

/** Ordered events for one visitor across all their sessions (grouped client-side).
 *  Powers the per-user profile: carries project (blob2) + country (blob6) so the
 *  UI can show which projects/domains this user touched and aggregate time per
 *  page. Uses only long-stable columns (blob1-8/double1-2), so it needs no
 *  device-column fallback. */
export async function visitorJourney(env, opts, visitorId) {
  const id = safeVal(visitorId);
  if (!id) return { available: false, rows: null };
  const rows = await q(env, `
    SELECT timestamp AS ts, blob8 AS sessionId, blob1 AS event, blob4 AS path,
           blob3 AS domain, blob2 AS project, blob6 AS country, blob5 AS referrer,
           double1 AS duration, double2 AS clientTs
    FROM ${DATASET} WHERE ${where(opts)} AND blob7 = ${sqlStr(id)}
    ORDER BY clientTs ASC, ts ASC LIMIT 3000
  `);
  if (!rows) return { available: false, rows: null, visitorId: id };
  return {
    available: true,
    visitorId: id,
    rows: rows.map((r) => ({
      timestamp: r.ts,
      sessionId: r.sessionId,
      event: r.event,
      path: r.path,
      domain: r.domain,
      project: r.project || "",
      country: r.country || "",
      referrer: r.referrer || "",
      duration: r.duration == null ? null : num(r.duration),
    })),
  };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
