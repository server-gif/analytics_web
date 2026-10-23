import React from "react";

// Shared display helpers for the custom-tracked (User Journey) pages.

// Deterministic hue from an id string -> every user gets a stable color, so the
// same visitor looks the same everywhere (Visitors list, Sessions, timelines).
function hueOf(id) {
  let h = 0;
  const s = String(id || "");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

/**
 * UserCell - replaces a raw random UUID with a recognizable "user" chip:
 * colored avatar (first 2 chars of the ID) + short ID. `title` shows the full
 * anonymous ID on hover (it is the join key for drill-downs, so keep reachable).
 */
export function UserCell({ id, full }) {
  const s = String(id || "");
  const hue = hueOf(s);
  const initials = s.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase() || "??";
  return (
    <span className="usercell" title={full ? `Full anonymous ID: ${full}` : undefined}>
      <span
        className="avatar"
        style={{ background: `hsl(${hue} 60% 22%)`, color: `hsl(${hue} 80% 75%)`, borderColor: `hsl(${hue} 60% 40%)` }}
      >
        {initials}
      </span>
      <code>{s.slice(0, 8)}</code>
    </span>
  );
}

// Reduce a session/visitor event list to the ordered page path the user took:
// keep page_view rows only, drop the "from -> same page" self loops (reloads),
// and attach each page's active (visible) time from its page_duration event.
export function travelSteps(rows) {
  const events = rows || [];
  // active seconds per (sessionId, path) from page_duration events
  const active = new Map();
  for (const e of events) {
    if (e.event === "page_duration" && e.duration != null) {
      const k = (e.sessionId || "") + "|" + (e.path || "");
      active.set(k, (active.get(k) || 0) + e.duration);
    }
  }
  const steps = [];
  for (const e of events) {
    if (e.event !== "page_view") continue;
    const path = e.path || "/";
    const last = steps[steps.length - 1];
    // consecutive same page = reload -> merge instead of a fake "step"
    if (last && last.path === path) { last.reloads++; continue; }
    steps.push({ path, sessionId: e.sessionId || "", timestamp: e.timestamp, seconds: active.get((e.sessionId || "") + "|" + path) ?? null, reloads: 0 });
  }
  return steps;
}

function fmtStep(s) {
  if (s == null) return null;
  const n = Math.round(s);
  return n < 60 ? `${n}s` : n < 3600 ? `${Math.floor(n / 60)}m ${n % 60}s` : `${Math.floor(n / 3600)}h ${Math.floor((n % 3600) / 60)}m`;
}

/**
 * TravelPath - "page A (3m 12s) -> page B (45s) -> page C": the readable answer
 * to "which pages did this user travel through, in what order, spending how
 * much active time". Chips are clickable when onClick is provided (filter/jump).
 */
export function TravelPath({ rows, onClick, max = 25 }) {
  const steps = travelSteps(rows);
  if (!steps.length) return <span className="state empty">No page views recorded</span>;
  const shown = steps.slice(0, max);
  const more = steps.length - shown.length;
  return (
    <div className="travelpath">
      {shown.map((s, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="travel-arrow" aria-hidden>→</span>}
          <span
            className={"travel-step" + (onClick ? " click" : "")}
            title={[
              s.path,
              s.seconds != null ? `Active time: ${fmtStep(s.seconds)}` : "Active time: —",
              s.reloads ? `(+${s.reloads} reload${s.reloads > 1 ? "s" : ""} of this page)` : "",
            ].filter(Boolean).join(" · ")}
            onClick={onClick ? () => onClick(s.path) : undefined}
          >
            <span className="travel-no">{i + 1}</span>
            <span className="travel-path">{s.path || "/"}</span>
            {s.seconds != null && <span className="travel-time">{fmtStep(s.seconds)}</span>}
          </span>
        </React.Fragment>
      ))}
      {more > 0 && <span className="travel-step more">+{more} more pages</span>}
    </div>
  );
}

// "Chrome 120 · Windows 10 · Desktop"-style device summary from the stored
// browser/os/device fields. Old rows (before UA tracking) -> null -> "—".
export function deviceLabel({ browser, os, device }) {
  if (!browser && !os && !device) return null;
  return [browser, os, device && device !== "Desktop" ? device : null].filter(Boolean).join(" · ");
}

// Human duration for aggregate totals: 45s / 3m 20s / 2h 5m / 1d 3h.
export function fmtDuration(s) {
  if (s == null) return "—";
  const n = Math.round(s);
  if (n < 60) return `${n}s`;
  if (n < 3600) return `${Math.floor(n / 60)}m ${n % 60}s`;
  if (n < 86400) return `${Math.floor(n / 3600)}h ${Math.floor((n % 3600) / 60)}m`;
  return `${Math.floor(n / 86400)}d ${Math.floor((n % 86400) / 3600)}h`;
}

const isPV = (e) => e.event === "page_view";
const isDur = (e) => e.event === "page_duration";

/**
 * buildUserView(events) - turn ONE user's ordered events (from visitorDetail)
 * into everything the profile needs. Pure + defensive: never invents numbers.
 * Returns { kpis, pages[], projects[], visits[] }.
 *  - pages   : per path -> views + total active seconds + the projects/domains it
 *              appeared under (sorted by time spent, answering "which page, how
 *              long"). Active seconds come only from page_duration events.
 *  - projects: per tracked project -> pages seen + active time + its domains.
 *  - visits  : one per sessionId (ordered), with start/end, pages, active time,
 *              domain/project/country and its ordered event rows (for TravelPath).
 */
export function buildUserView(events) {
  const evs = Array.isArray(events) ? events : [];
  const uniq = (a) => [...new Set(a.filter(Boolean))];

  // ---- per page path ----
  const pmap = new Map();
  for (const e of evs) {
    const path = e.path || "/";
    if (!pmap.has(path)) pmap.set(path, { path, views: 0, seconds: 0, projects: new Set(), domains: new Set() });
    const rec = pmap.get(path);
    if (isPV(e)) rec.views++;
    if (isDur(e) && e.duration != null) rec.seconds += e.duration;
    if (e.project) rec.projects.add(e.project);
    if (e.domain) rec.domains.add(e.domain);
  }
  const pages = [...pmap.values()]
    .map((p) => ({ path: p.path, views: p.views, seconds: p.seconds || null, projects: [...p.projects], domains: [...p.domains] }))
    .filter((p) => p.views > 0 || p.seconds != null)
    .sort((a, b) => (b.seconds || 0) - (a.seconds || 0) || b.views - a.views);

  // ---- per project ----
  const jmap = new Map();
  for (const e of evs) {
    const proj = e.project || "(unlabelled)";
    if (!jmap.has(proj)) jmap.set(proj, { project: proj, views: 0, seconds: 0, paths: new Set(), domains: new Set() });
    const rec = jmap.get(proj);
    if (isPV(e)) { rec.views++; rec.paths.add(e.path || "/"); }
    if (isDur(e) && e.duration != null) rec.seconds += e.duration;
    if (e.domain) rec.domains.add(e.domain);
  }
  const projects = [...jmap.values()]
    .map((p) => ({ project: p.project, views: p.views, pages: p.paths.size, seconds: p.seconds || null, domains: [...p.domains] }))
    .sort((a, b) => (b.seconds || 0) - (a.seconds || 0) || b.views - a.views);

  // ---- per visit (session), preserving first-seen order ----
  const vmap = new Map();
  const order = [];
  for (const e of evs) {
    const sid = e.sessionId || "";
    if (!vmap.has(sid)) { vmap.set(sid, { sessionId: sid, rows: [], _min: null, _max: null, _domains: new Set(), _projects: new Set(), _countries: new Set() }); order.push(sid); }
    const v = vmap.get(sid);
    v.rows.push(e);
    const t = new Date(String(e.timestamp).includes("T") ? e.timestamp : String(e.timestamp).replace(" ", "T") + (/[+Z]/.test(e.timestamp) ? "" : "Z")).getTime();
    if (!Number.isNaN(t)) { if (v._min == null || t < v._min) v._min = t; if (v._max == null || t > v._max) v._max = t; }
    if (isPV(e)) { if (e.domain) v._domains.add(e.domain); if (e.project) v._projects.add(e.project); }
    if (e.country) v._countries.add(e.country);
  }
  const visits = order.map((sid) => {
    const v = vmap.get(sid);
    const pages = v.rows.filter(isPV).length;
    const seconds = v.rows.reduce((s, e) => s + (isDur(e) && e.duration != null ? e.duration : 0), 0);
    return {
      sessionId: sid,
      startedAt: v._min,
      endedAt: v._max,
      pages,
      seconds: seconds || null,
      domains: [...v._domains],
      projects: [...v._projects],
      countries: [...v._countries],
      rows: v.rows,
    };
  }).sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0) || (b.startedAt || 0) - (a.startedAt || 0));

  // ---- headline KPIs ----
  const totalSeconds = evs.reduce((s, e) => s + (isDur(e) && e.duration != null ? e.duration : 0), 0);
  const pv = evs.filter(isPV);
  const kpis = {
    visits: new Set(evs.map((e) => e.sessionId || "")).size,
    pageViews: pv.length,
    pagesVisited: new Set(pv.map((e) => e.path || "/")).size,
    totalSeconds: totalSeconds || null,
    projects: uniq(evs.map((e) => e.project)),
    domains: uniq(evs.map((e) => e.domain)),
    countries: uniq(evs.map((e) => e.country)),
  };
  return { kpis, pages, projects, visits };
}
