/**
 * Cloudflare GraphQL Analytics API.
 * Endpoint: POST /client/v4/graphql  (Bearer CF_API_TOKEN)
 *
 * PHASE 0 VERIFIED (live introspection on this account):
 *   zone dataset `httpRequests1dGroups`:
 *     - sum { requests, bytes, countryMap{clientCountryName requests bytes},
 *             responseStatusMap{edgeResponseStatus requests}, ... }
 *     - dimensions { date }
 *   zone dataset `httpRequests1hGroups` : dimensions { date, datetime }, same sum.
 *   Bandwidth measure = `bytes` (NOT edgeResponseBytes). Daily dim = `date`.
 *
 * IMPORTANT (live-verified): `zones(filter:{zoneTag:...})` accepts ONLY a single
 * zoneTag STRING. An array (inline or via a [String!] variable) is rejected with
 * "zoneTag: not a string", and unfiltered `viewer { zones }` returns EMPTY. So to
 * aggregate MULTIPLE zones (an account, or ALL), we query each zone separately and
 * merge the results in code (perZone + flatMap below).
 * If a query errors/empties, run() returns null -> caller renders "Not available".
 */

const GQL = "https://api.cloudflare.com/client/v4/graphql";

/** run raw GraphQL; returns data|null (never throws on GraphQL errors) */
async function run(env, query) {
  const res = await fetch(GQL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.CF_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const json = await res.json().catch(() => ({ errors: [{ message: "bad JSON" }] }));
  if (json.errors && json.errors.length) {
    console.error("[graphql] errors:", json.errors.map((e) => e.message).join("; "));
  }
  return json.data || null;
}

// single-zone node (zoneTag MUST be a quoted string)
const zoneNode = (tag) => `zones(filter:{zoneTag:"${String(tag).replace(/[^a-zA-Z0-9]/g, "")}"})`;

// Query one zone per tag (parallel), return the zone nodes. Empty tags -> [].
async function perZone(env, zoneTags, inner) {
  const tags = zoneTags && zoneTags.length ? zoneTags : [];
  const nodes = await Promise.all(
    tags.map(async (tag) => {
      const data = await run(env, `{ viewer { ${zoneNode(tag)} { ${inner} } } }`);
      return data?.viewer?.zones?.[0] || null;
    })
  );
  return nodes.filter(Boolean);
}

// YYYY-MM-DD (UTC) from an ISO string
const ymd = (iso) => new Date(iso).toISOString().slice(0, 10);
// exclusive upper date (until-day + 1) so date_lt includes the whole `until` day
function ymdNext(iso) {
  const d = new Date(ymd(iso) + "T00:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
const inDate = (since, until) => `filter:{date_geq:"${ymd(since)}",date_lt:"${ymdNext(until)}"}`;
// 1h groups use datetime (Timestamp, full ISO) bounds
const inDatetime = (since, until) =>
  `filter:{datetime_geq:"${since}",datetime_leq:"${until}"}`;

// ADAPTIVE dataset (verified): supports clientRequestHTTPHost + clientCountryName
// + edgeResponseStatus dimensions, count=#requests, sum{edgeResponseBytes}=bandwidth.
// Live limit: adaptive max range is ~4w2d, so host-scoped queries clamp to 27d.
function inAdaptive(since, until, host) {
  const maxMs = 27 * 86400000;
  const s = new Date(Math.max(new Date(since).getTime(), new Date(until).getTime() - maxMs)).toISOString();
  const hf = host ? `,clientRequestHTTPHost:"${String(host).replace(/[^\w.\-:*]/g, "")}"` : "";
  return `filter:{datetime_geq:"${s}",datetime_leq:"${until}"${hf}}`;
}

/** Distinct hostnames (apex + subdomains) a zone served, ports stripped. */
export async function fetchZoneHosts(env, zoneId) {
  const until = new Date().toISOString();
  const inner = `httpRequestsAdaptiveGroups(limit:1000, ${inAdaptive(new Date(Date.now() - 27 * 86400000).toISOString(), until)}) {
    dimensions { clientRequestHTTPHost }
  }`;
  const nodes = await perZone(env, [zoneId], inner);
  const set = new Set();
  for (const n of nodes) {
    for (const g of n.httpRequestsAdaptiveGroups || []) {
      const h = (g.dimensions?.clientRequestHTTPHost || "").replace(/:\d+$/, "").toLowerCase();
      if (h) set.add(h);
    }
  }
  return [...set].sort();
}

/** Totals across the range. host set -> adaptive+host filter; else daily rows summed. */
export async function fetchOverview(env, zoneTags, since, until, host) {
  if (host) {
    const inner = `httpRequestsAdaptiveGroups(limit:2000, ${inAdaptive(since, until, host)}) { count sum { edgeResponseBytes } }`;
    const rows = (await perZone(env, zoneTags, inner)).flatMap((n) => n.httpRequestsAdaptiveGroups || []);
    if (!rows.length) return null;
    let requests = 0, bytes = 0;
    for (const r of rows) { requests += r.count || 0; bytes += r.sum?.edgeResponseBytes || 0; }
    return { requests, bandwidthBytes: bytes };
  }
  const inner = `httpRequests1dGroups(limit:1000, ${inDate(since, until)}) { sum { requests bytes } }`;
  const rows = (await perZone(env, zoneTags, inner)).flatMap((n) => n.httpRequests1dGroups || []);
  if (!rows.length) return null;
  let requests = 0, bytes = 0, any = false;
  for (const r of rows) {
    const s = r.sum || {};
    if (s.requests != null) { requests += s.requests; any = true; }
    if (s.bytes != null) { bytes += s.bytes; any = true; }
  }
  if (!any) return null;
  return { requests, bandwidthBytes: bytes };
}

/** Countries. host set -> adaptive grouped by clientCountryName; else 1d countryMap. */
export async function fetchCountries(env, zoneTags, since, until, host) {
  const byCountry = new Map();
  const bump = (k, req, bw) => {
    const cur = byCountry.get(k) || { country: k, requests: 0, bandwidthBytes: 0 };
    cur.requests += req; cur.bandwidthBytes += bw; byCountry.set(k, cur);
  };
  if (host) {
    const inner = `httpRequestsAdaptiveGroups(limit:3000, ${inAdaptive(since, until, host)}) { count sum { edgeResponseBytes } dimensions { clientCountryName } }`;
    const rows = (await perZone(env, zoneTags, inner)).flatMap((n) => n.httpRequestsAdaptiveGroups || []);
    for (const r of rows) bump(r.dimensions?.clientCountryName || "Unknown", r.count || 0, r.sum?.edgeResponseBytes || 0);
    return [...byCountry.values()].sort((a, b) => b.requests - a.requests);
  }
  const inner = `httpRequests1dGroups(limit:1000, ${inDate(since, until)}) { sum { countryMap { clientCountryName requests bytes } } }`;
  const rows = (await perZone(env, zoneTags, inner)).flatMap((n) => n.httpRequests1dGroups || []);
  for (const r of rows) for (const c of r.sum?.countryMap || []) bump(c.clientCountryName || "Unknown", c.requests || 0, c.bytes || 0);
  return [...byCountry.values()].sort((a, b) => b.requests - a.requests);
}

/** Errors (4xx/5xx). host set -> adaptive grouped by edgeResponseStatus; else 1d map. */
export async function fetchErrors(env, zoneTags, since, until, host) {
  const byStatus = new Map();
  const bump = (code, req) => {
    if (!Number.isFinite(code) || code < 400) return;
    byStatus.set(code, (byStatus.get(code) || 0) + req);
  };
  if (host) {
    const inner = `httpRequestsAdaptiveGroups(limit:3000, ${inAdaptive(since, until, host)}) { count dimensions { edgeResponseStatus } }`;
    const rows = (await perZone(env, zoneTags, inner)).flatMap((n) => n.httpRequestsAdaptiveGroups || []);
    for (const r of rows) bump(Number(r.dimensions?.edgeResponseStatus), r.count || 0);
  } else {
    const inner = `httpRequests1dGroups(limit:1000, ${inDate(since, until)}) { sum { responseStatusMap { edgeResponseStatus requests } } }`;
    const rows = (await perZone(env, zoneTags, inner)).flatMap((n) => n.httpRequests1dGroups || []);
    for (const r of rows) for (const s of r.sum?.responseStatusMap || []) bump(Number(s.edgeResponseStatus), s.requests || 0);
  }
  return [...byStatus.entries()]
    .map(([status, requests]) => ({ status, requests }))
    .sort((a, b) => b.requests - a.requests);
}

/** Time series. Multi-zone rows are merged by timestamp -> one point per bucket. */
function mergeByT(rows) {
  const m = new Map();
  for (const r of rows) {
    if (r.t == null) continue;
    const cur = m.get(r.t) || { t: r.t, requests: 0, bandwidthBytes: 0 };
    cur.requests += r.requests || 0;
    cur.bandwidthBytes += r.bandwidthBytes || 0;
    m.set(r.t, cur);
  }
  return [...m.values()].sort((a, b) => String(a.t).localeCompare(String(b.t)));
}

/** Time series. host -> adaptive(datetimeHour); else daily 1d / hourly 1h groups. */
export async function fetchTrafficSeries(env, zoneTags, since, until, granularity, host) {
  let rows = [];
  if (host) {
    const inner = `httpRequestsAdaptiveGroups(limit:3000, ${inAdaptive(since, until, host)}) { count sum { edgeResponseBytes } dimensions { datetimeHour } }`;
    const groups = (await perZone(env, zoneTags, inner)).flatMap((n) => n.httpRequestsAdaptiveGroups || []);
    rows = groups.map((x) => ({ t: x.dimensions?.datetimeHour ?? null, requests: x.count ?? null, bandwidthBytes: x.sum?.edgeResponseBytes ?? null }));
  } else if (granularity === "hourly") {
    const inner = `httpRequests1hGroups(limit:1000, ${inDatetime(since, until)}) { sum { requests bytes } dimensions { datetime } }`;
    const groups = (await perZone(env, zoneTags, inner)).flatMap((n) => n.httpRequests1hGroups || []);
    rows = groups.map((x) => ({ t: x.dimensions?.datetime ?? null, requests: x.sum?.requests ?? null, bandwidthBytes: x.sum?.bytes ?? null }));
  } else {
    const inner = `httpRequests1dGroups(limit:1000, ${inDate(since, until)}) { sum { requests bytes } dimensions { date } }`;
    const groups = (await perZone(env, zoneTags, inner)).flatMap((n) => n.httpRequests1dGroups || []);
    rows = groups.map((x) => ({ t: x.dimensions?.date ?? null, requests: x.sum?.requests ?? null, bandwidthBytes: x.sum?.bytes ?? null }));
  }
  return mergeByT(rows);
}

// PHASE 0 VERIFIED (live): worker invocation analytics dataset is
// `workersOverviewRequestsAdaptiveGroups` under viewer.accounts.
// dimensions { scriptName, status }, count = #requests, sum { cpuTimeUs }.
// requests per script = sum(count) (valid). The `status` dimension here is a small
// internal code (live values observed: 1, 7) - NOT an HTTP status - so we do NOT
// derive an error count from it (that would fabricate a misleading 0). Workers
// errors are reported as null -> the UI shows "Not available".
const WORKERS = `query($accountTag:String!,$since:Timestamp!,$until:Timestamp!){
  viewer { accounts(filter:{accountTag:$accountTag}) {
    workersOverviewRequestsAdaptiveGroups(limit:500, filter:{datetime_geq:$since, datetime_leq:$until}) {
      count
      sum { cpuTimeUs }
      dimensions { scriptName }
    }
  } }
}`;

/** Workers analytics (pinned account; the dataset requires an accountTag filter). */
export async function fetchWorkers(env, since, until) {
  const res = await fetch(GQL, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: WORKERS, variables: { accountTag: env.CF_ACCOUNT_ID, since, until } }),
  });
  const json = await res.json().catch(() => ({ errors: [{ message: "bad JSON" }] }));
  if (json.errors?.length) console.error("[graphql.workers] errors:", json.errors.map((e) => e.message).join("; "));
  const groups = json.data?.viewer?.accounts?.[0]?.workersOverviewRequestsAdaptiveGroups || [];
  const byScript = new Map();
  for (const g of groups) {
    const name = g.dimensions?.scriptName ?? "unknown";
    const cnt = g.count || 0;
    const cur = byScript.get(name) || { worker: name, requests: 0, errors: null, cpuTimeMs: 0 };
    cur.requests += cnt; // sum of count = requests (verified measure)
    cur.cpuTimeMs += (g.sum?.cpuTimeUs || 0) / 1000;
    // errors intentionally left null: not derivable from this dataset honestly.
    byScript.set(name, cur);
  }
  return [...byScript.values()].sort((a, b) => b.requests - a.requests);
}
