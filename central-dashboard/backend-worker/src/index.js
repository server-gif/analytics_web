/**
 * Central Cloudflare Analytics API (backend Worker).
 * Browser -> this Worker -> Cloudflare API/GraphQL. CF token/Account ID SUDHU
 * etha secrets ma che, frontend ma khabhi nathi aavta.
 *
 * Endpoints (GET, JSON):
 *   /api/account  /api/zones  /api/workers  /api/pages  /api/projects  /api/domains
 *   /api/analytics/overview  /api/analytics/traffic  /api/analytics/countries
 *   /api/analytics/errors    /api/analytics/workers
 * Query params for analytics: project= | domain= | from= | to= | preset= | granularity=
 *
 * NO D1 / NO R2 / NO database. The dashboard UI is served publicly and shows an
 * in-app login page; every /api route is guarded by HTTP Basic (DASHBOARD_PASSWORD
 * secret) except the public POST /api/track ingest.
 */

import { checkBasicAuth } from "./auth.js";
import { getAccount, buildInventory, listZones, listAccounts } from "./cloudflare.js";
import {
  fetchOverview,
  fetchCountries,
  fetchErrors,
  fetchTrafficSeries,
  fetchWorkers,
  fetchZoneHosts,
} from "./graphql.js";
import { getOrCompute } from "./cache.js";
import { notAvailable } from "./metrics.js";
import {
  EVENTS,
  writeEvent,
  journeyOverview,
  topPages,
  entryExitPages,
  listSessions,
  sessionDetail,
  navigationFlow,
  listVisitors,
  visitorJourney,
  trackedDomains,
} from "./analytics-engine.js";

const DAY = 86400000;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "");

    // CORS for local dev (Vite proxy) - prod same-origin hoy to e require nathi
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, content-type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    // ---- Public tracking ingest (visitors) - NO auth, runs before the Basic Auth gate ----
    if (path === "/api/track") {
      if (request.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405, cors);
      return handleTrack(request, env, cors);
    }

    // ---- Public tracking snippet - must load in any visitor's browser, so it is
    // served BEFORE the Basic Auth gate (a <script src> GET, no login prompt).
    // Sites embed: <script src="https://<this-worker>/analytics.js" defer></script>
    if (path === "/analytics.js" || path === "/tracking/analytics.js") {
      return env.ASSETS.fetch(request);
    }

    // ---- Dashboard UI (React SPA + assets) is served PUBLICLY, BEFORE the API
    // auth gate. The SPA shows its own login page and calls /api/* with an
    // `Authorization: Basic` header. No secrets ship in the bundle (the CF token
    // stays server-side), so exposing the shell is safe; every DATA route below
    // still requires Basic Auth. run_worker_first=true lets us gate here, and
    // not_found_handling=single-page-application serves index.html for deep
    // client routes (e.g. /journey).
    if (!path.startsWith("/api")) {
      return env.ASSETS.fetch(request);
    }

    try {
      // ---- Auth: HTTP Basic guards every /api read/admin route ----
      // (/api/track is handled ABOVE as public ingest and never reaches here.)
      // REQUIRE_ACCESS is the flag name; local dev reads DASHBOARD_PASSWORD from
      // .dev.vars (test with: curl -u admin:<pw> ...).
      if (env.REQUIRE_ACCESS === "true") {
        const denied = checkBasicAuth(request, env, cors);
        if (denied) return denied;
      }

      if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) {
        return json({ success: false, error: "Backend misconfigured: CF_API_TOKEN / CF_ACCOUNT_ID secret missing" }, 500, cors);
      }

      if (request.method !== "GET") return json({ success: false, error: "Method not allowed" }, 405, cors);

      const handler = ROUTES[path];
      if (!handler) return json({ success: false, error: "Not found", path }, 404, cors);

      const data = await handler(request, url, env, ctx);
      return json(envelope(data), 200, cors);
    } catch (err) {
      // prompt: clear client message, secure backend log (no token)
      console.error("[api] error on", path, ":", err.message);
      return json({ success: false, error: "Unable to load Cloudflare analytics." }, 502, cors);
    }
  },
};

// ---- routes ----
const ROUTES = {
  "/api/account": (req, url, env) => cached(url, env, () => getAccount(env)),

  "/api/accounts": (req, url, env) => cached(url, env, async () => ({ accounts: await listAccounts(env) })),

  "/api/zones": (req, url, env) => cached(url, env, async () => ({ zones: (await buildInventory(env)).zones })),

  "/api/workers": (req, url, env) => cached(url, env, async () => ({ workers: (await buildInventory(env)).workers })),

  "/api/pages": (req, url, env) => cached(url, env, async () => ({ pages: (await buildInventory(env)).pages })),

  "/api/projects": (req, url, env) => cached(url, env, () => buildProjectsWithHosts(url, env), "projects").then((r) => ({ projects: r.projects })),

  "/api/domains": (req, url, env) => cached(url, env, () => buildProjectsWithHosts(url, env), "domains").then((r) => ({ domains: r.domains })),

  "/api/analytics/overview": handleOverview,
  "/api/analytics/projects": handleProjectsAnalytics,
  "/api/analytics/traffic": handleTraffic,
  "/api/analytics/countries": handleCountries,
  "/api/analytics/errors": handleErrors,
  "/api/analytics/workers": handleWorkers,

  // User Journey (custom-tracked via Analytics Engine) - clearly separate from
  // Cloudflare-native numbers, Access-protected like the rest.
  "/api/analytics/journey": handleJourney,
  "/api/analytics/pages": handlePages,
  "/api/analytics/entry-exit": handleEntryExit,
  "/api/analytics/sessions": handleSessions,
  "/api/analytics/navigation": handleNavigation,
  "/api/analytics/visitors": handleVisitors,
  "/api/analytics/tracked-domains": handleTrackedDomains,
};

// resolve which zoneTags (+ optional host) to query based on project/domain filter
async function resolveZoneTags(url, env) {
  const inv = await buildInventory(env);
  const project = url.searchParams.get("project");
  const domain = url.searchParams.get("domain");
  const account = url.searchParams.get("account");
  let pool = inv.projects;
  if (account) pool = pool.filter((p) => p.account === account);
  if (project) pool = pool.filter((p) => p.name === project);
  const tags = [];
  const names = [];
  let host = null;

  // A selected domain that is a SUBDOMAIN (not any apex zone) scopes analytics
  // to that exact hostname via the adaptive dataset (host filter).
  if (domain) {
    const apexZone = inv.zones.find((z) => z.domain === domain);
    if (apexZone) {
      tags.push(apexZone.zoneId); names.push(apexZone.domain);
    } else {
      const d = domain.toLowerCase();
      const parent = inv.zones.find((z) => d === z.domain || d.endsWith("." + z.domain));
      if (parent) { tags.push(parent.zoneId); names.push(parent.domain); host = d; }
    }
    return { inv, tags: [...new Set(tags)], names: [...new Set(names)], host };
  }

  for (const p of pool) {
    for (const d of p.domains) {
      const zone = inv.zones.find((z) => z.domain === d);
      if (zone) { tags.push(zone.zoneId); names.push(zone.domain); }
    }
  }
  return { inv, tags: [...new Set(tags)], names: [...new Set(names)], host };
}

// Zone projects get their real hostnames (apex + subdomains) discovered from
// analytics so the UI can show "this project has N domains" and filter per host.
// Cached per zone (getOrCompute) so repeat /api/projects & /api/domains stay cheap.
async function buildProjectsWithHosts(url, env) {
  const inv = await buildInventory(env);
  const hostCache = new Map();
  const hostsFor = (zoneId) =>
    getOrCompute("hosts:" + zoneId, env, () => fetchZoneHosts(env, zoneId));

  const projects = [];
  for (const p of inv.projects) {
    if (p.type === "zone" && p.zoneId) {
      let hosts = hostCache.get(p.zoneId);
      if (!hosts) { hosts = await hostsFor(p.zoneId); hostCache.set(p.zoneId, hosts); }
      const domains = [...new Set([p.name, ...(hosts || [])])].sort();
      projects.push({ ...p, domains, domainCount: domains.length });
    } else {
      projects.push({ ...p, domainCount: (p.domains || []).length });
    }
  }
  // flat domain list = every discovered hostname, de-duplicated (zone wins)
  const domains = [];
  const seen = new Set();
  for (const p of projects) {
    for (const d of p.domains || []) {
      if (seen.has(d)) continue;
      seen.add(d);
      domains.push({ domain: d, project: p.name, type: p.type, account: p.account || null, accountId: p.accountId || null, zoneId: p.zoneId || null, linked: true });
    }
  }
  return { ...inv, projects, domains };
}

// Explain why an overview selection has no zone to measure (used when totals is
// null): a selected domain/project whose domains are not backed by any Cloudflare
// zone has no traffic data. Falls back to the generic N/A note otherwise.
function selectionNoZoneNote(inv, url) {
  const project = url.searchParams.get("project");
  const domain = url.searchParams.get("domain");
  const apexes = (inv.zones || []).map((z) => String(z.domain).toLowerCase());
  const backed = (d) => { const x = String(d).toLowerCase(); return apexes.some((a) => x === a || x.endsWith("." + a)); };
  if (domain && !backed(domain)) return "This domain isn't a Cloudflare zone, so Cloudflare reports no traffic for it.";
  if (project) {
    const p = (inv.projects || []).find((pr) => pr.name === project);
    if (p && !(p.domains || []).some((d) => backed(d))) return "This Pages project's custom domain isn't a Cloudflare zone, so Cloudflare reports no traffic for it.";
  }
  return "Not available from Cloudflare native analytics.";
}

async function handleOverview(req, url, env) {
  const { inv, tags, host } = await resolveZoneTags(url, env);
  const account = url.searchParams.get("account");
  const { since, until } = windowFrom(url);
  const totals = await cached(url, env, () => fetchOverview(env, tags, since, until, host), "overview");

  const rawErrors = tags.length ? await cached(url, env, () => fetchErrors(env, tags, since, until, host), "errors") : [];
  const errorList = Array.isArray(rawErrors) ? rawErrors : [];
  const errorRequests = errorList.reduce((s, e) => s + (e.requests || 0), 0);

  // account-wise counts (match the Projects page: exclude workers; scope to account)
  let projPool = inv.projects.filter((p) => p.type !== "worker");
  let domPool = inv.domains;
  if (account) {
    projPool = projPool.filter((p) => p.account === account);
    domPool = domPool.filter((d) => d.account === account);
  }

  return {
    totals: totals
      ? {
          requests: { available: totals.requests != null, label: "Total Requests", value: totals.requests },
          bandwidth: { available: totals.bandwidthBytes != null, label: "Bandwidth", value: totals.bandwidthBytes, kind: "bytes" },
        }
      : {
          requests: { available: false, label: "Total Requests", value: null, note: selectionNoZoneNote(inv, url) },
          bandwidth: { available: false, label: "Bandwidth", value: null, kind: "bytes", note: selectionNoZoneNote(inv, url) },
        },
    counts: {
      domains: domPool.length,
      projects: projPool.length,
    },
    errorRequests: { available: true, label: "Error Requests (4xx/5xx)", value: errorRequests },
    uniqueUsers: notAvailable("uniqueUsers"), // requests != users; strictly N/A
    window: { since, until },
  };
}

// Per-project analytics table that RESPECTS the filter bar (project/domain/date).
// Zone projects -> 1d totals (requests+bandwidth); worker projects -> workers AE.
// Selected project or a selected (sub)domain narrows the rows server-side.
async function handleProjectsAnalytics(req, url, env) {
  const project = url.searchParams.get("project");
  const domain = url.searchParams.get("domain");
  const account = url.searchParams.get("account");
  const { since, until } = windowFrom(url);
  const enriched = await buildProjectsWithHosts(url, env);

  const workerStats = {};
  try { for (const w of await fetchWorkers(env, since, until)) workerStats[w.worker] = w; } catch {}

  // Resolve a project's real Cloudflare traffic through ANY zone that backs one
  // of its domains. A domain may be the zone APEX (whole-zone totals via the
  // daily dataset) or a SUBDOMAIN of a zone (that host's totals via the adaptive
  // dataset, filtered by clientRequestHTTPHost). Whole-zone wins over its own
  // subdomains so we never double-count. No backing zone -> null ("Not available").
  const zoneIdByApex = new Map(enriched.zones.map((z) => [String(z.domain).toLowerCase(), z.zoneId]));
  const apexList = [...zoneIdByApex.keys()].sort((a, b) => b.length - a.length);
  function parentOf(domain) {
    const d = String(domain).toLowerCase();
    for (const apex of apexList) {
      if (d === apex) return { zoneId: zoneIdByApex.get(apex), host: null };
      if (d.endsWith("." + apex)) return { zoneId: zoneIdByApex.get(apex), host: d };
    }
    return null;
  }
  async function totalsForProject(p) {
    const wholeZones = new Set();
    const hostJobs = [];
    for (const d of p.domains || []) {
      const r = parentOf(d);
      if (!r) continue;
      if (r.host === null) wholeZones.add(r.zoneId);
      else hostJobs.push({ zoneId: r.zoneId, host: r.host });
    }
    const jobs = [...wholeZones].map((id) => fetchOverview(env, [id], since, until));
    const seenHost = new Set();
    for (const q of hostJobs) {
      if (wholeZones.has(q.zoneId) || seenHost.has(q.host)) continue; // apex already covers it
      seenHost.add(q.host);
      jobs.push(fetchOverview(env, [q.zoneId], since, until, q.host));
    }
    if (!jobs.length) return { requests: null, bandwidthBytes: null };
    const parts = await Promise.all(jobs);
    let req = 0, bw = 0, any = false;
    for (const t of parts) {
      if (t && t.requests != null) { req += t.requests; any = true; }
      if (t && t.bandwidthBytes != null) bw += t.bandwidthBytes;
    }
    return any ? { requests: req, bandwidthBytes: bw } : { requests: null, bandwidthBytes: null };
  }

  const filtered = enriched.projects.filter((p) => {
    if (p.type === "worker") return false; // Projects page = projects only (no workers)
    if (account && p.account !== account) return false;
    if (project && p.name !== project) return false;
    if (domain && !((p.domains || []).includes(domain) || p.name === domain)) return false;
    return true;
  });

  const rows = await Promise.all(filtered.map(async (p) => {
    const base = { project: p.name, type: p.type, account: p.account || null, pages: p.pages || null, domains: p.domains || [], domainCount: p.domainCount || (p.domains || []).length };
    if (p.type === "worker") {
      const w = workerStats[p.name];
      return { ...base, requests: w ? w.requests : null, bandwidthBytes: null, errors: w ? w.errors : null };
    }
    // zone + pages both resolve through any linked zone domain(s)
    const t = await totalsForProject(p);
    const row = { ...base, requests: t.requests, bandwidthBytes: t.bandwidthBytes };
    if (t.requests == null) {
      // explain WHY there is no number (never fabricate): a real zone with no
      // traffic vs. a Pages project whose custom domain is not a Cloudflare zone.
      const backedByZone = (p.domains || []).some((d) => parentOf(d));
      row.note = backedByZone
        ? "No traffic recorded for this zone in the selected period."
        : "Custom domain isn't a Cloudflare zone - Cloudflare reports traffic per zone, so none is available.";
    }
    return row;
  }));

  rows.sort((a, b) => (b.requests || 0) - (a.requests || 0));
  return { rows, window: { since, until } };
}

async function handleTraffic(req, url, env) {
  const { tags, host } = await resolveZoneTags(url, env);
  const { since, until } = windowFrom(url);
  const granularity = granularityFrom(url, since, until);
  const series = await cached(url, env, () => fetchTrafficSeries(env, tags, since, until, granularity, host));
  return { granularity, series };
}

async function handleCountries(req, url, env) {
  const { tags, host } = await resolveZoneTags(url, env);
  const { since, until } = windowFrom(url);
  const rows = await cached(url, env, () => fetchCountries(env, tags, since, until, host));
  return { rows, cities: notAvailable("cities") };
}

async function handleErrors(req, url, env) {
  const { tags, host } = await resolveZoneTags(url, env);
  const { since, until } = windowFrom(url);
  const rows = await cached(url, env, () => fetchErrors(env, tags, since, until, host));
  return { rows };
}

async function handleWorkers(req, url, env) {
  const { since, until } = windowFrom(url);
  const account = url.searchParams.get("account");
  const project = url.searchParams.get("project");
  let rows = await cached(url, env, () => fetchWorkers(env, since, until));
  // Workers analytics are queried from the pinned account (CF_ACCOUNT_ID). If an
  // explicit Account filter targets a DIFFERENT account, no workers apply -> empty.
  if (account) {
    const own = await cached(url, env, () => getAccount(env), "acct");
    if (own && own.name !== account) rows = [];
  }
  // a selected Project narrows to that worker (ignoring zone/pages projects)
  if (project) rows = (rows || []).filter((r) => r.worker === project);
  return { rows };
}

// ---- public tracking ingest (POST /api/track) ----
// Best-effort per-isolate rate limit (Workers are stateless; this is a soft cap).
const RATE_WINDOW_MS = 60000;
const RATE_MAX = 600; // events per IP per minute
const rateBuckets = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const b = rateBuckets.get(ip);
  if (!b || now > b.reset) {
    if (rateBuckets.size > 20000) for (const [k, v] of rateBuckets) if (now > v.reset) rateBuckets.delete(k);
    rateBuckets.set(ip, { n: 1, reset: now + RATE_WINDOW_MS });
    return false;
  }
  b.n += 1;
  return b.n > RATE_MAX;
}
function originAllowed(request, env) {
  const allow = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!allow.length) return true; // not configured -> allow (local dev only)
  const raw = request.headers.get("origin") || request.headers.get("referer") || "";
  if (!raw) return false;
  let host = raw;
  try { host = new URL(raw).origin; } catch {}
  return allow.some((a) => { let ao = a; try { ao = new URL(a).origin; } catch {} return ao === host; });
}
function tstr(v, max) { return typeof v === "string" ? v.slice(0, max) : ""; }
function tnum(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

async function handleTrack(request, env, cors) {
  if (!originAllowed(request, env)) return json({ success: false, error: "origin not allowed" }, 403, cors);
  const ip = (request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
  if (rateLimited(ip)) return json({ success: false, error: "rate limited" }, 429, cors);

  if (Number(request.headers.get("content-length") || 0) > 4096) return json({ success: false, error: "payload too large" }, 413, cors);
  let body;
  try {
    const text = await request.text();
    if (!text || text.length > 4096) return json({ success: false, error: "payload too large" }, 413, cors);
    body = JSON.parse(text);
  } catch { return json({ success: false, error: "invalid json" }, 400, cors); }
  if (!body || typeof body !== "object") return json({ success: false, error: "invalid payload" }, 400, cors);

  const event = tstr(body.e, 24);
  if (!EVENTS.includes(event)) return json({ success: false, error: "unknown event" }, 400, cors);
  const sessionId = tstr(body.s, 64);
  const visitorId = tstr(body.v, 64);
  if (!sessionId || !visitorId) return json({ success: false, error: "missing ids" }, 400, cors);
  // every event must carry a hostname (blob3) so the dashboard can scope it to a
  // project/account and separate journeys per domain; and a real client timestamp.
  const domain = tstr(body.d, 200);
  if (!domain) return json({ success: false, error: "missing domain" }, 400, cors);
  const rawTs = Number(body.ts);
  if (!Number.isFinite(rawTs) || rawTs <= 0) return json({ success: false, error: "invalid timestamp" }, 400, cors);

  const ok = writeEvent(env, {
    event,
    project: tstr(body.p, 120) || "default",
    domain,
    path: tstr(body.path, 500),
    referrer: tstr(body.ref, 500),
    country: (request.cf && request.cf.country) || "XX",
    visitorId,
    sessionId,
    duration: tnum(body.dur),
    clientTs: rawTs,
  });
  return ok ? new Response(null, { status: 204, headers: cors }) : json({ success: false, error: "write failed" }, 500, cors);
}

// ---- User Journey reads (Analytics Engine) ----
const JOURNEY_MAX_DAYS = 30; // dashboard window; AE may retain longer. Query cap, not a delete.
// Turn the filter bar into a set of tracked HOSTNAME apexes to scope the AE
// queries. A tracked event stores the visitor's exact hostname (blob3), so the
// backend resolves project/account -> zone apexes + Pages custom domains, across
// BOTH accounts. No project/account selected -> whole tracked dataset.
function resolveTrackedApexes(inv, { account, project }) {
  const apexes = new Set();
  for (const p of inv.projects) {
    if (project) { if (p.name !== project) continue; }
    else if (account) { if (p.account !== account) continue; }
    if (p.type === "worker") continue; // compute-only, no HTML pages to track
    if (p.type === "zone") apexes.add(p.name); // apex matches its subdomains via LIKE
    const doms = p.domains || [];
    if (doms.length) for (const d of doms) apexes.add(d);
    else apexes.add(p.name); // Pages without a linked custom domain
  }
  return [...apexes];
}

async function journeyOpts(url, env) {
  let { since, until } = windowFrom(url);
  // Show only the rolling 30-day window regardless of the requested preset/custom
  // range. This is a query-side cap (AE itself retains longer); we never claim the
  // data is physically deleted.
  const maxSince = new Date(new Date(until).getTime() - JOURNEY_MAX_DAYS * DAY).toISOString();
  if (new Date(since) < new Date(maxSince)) since = maxSince;

  const opts = { since, until };
  const account = url.searchParams.get("account");
  const project = url.searchParams.get("project");
  const domain = url.searchParams.get("domain");
  if (domain) opts.domain = domain;
  else if (project || account) {
    const inv = await buildInventory(env);
    opts.apexes = resolveTrackedApexes(inv, { account, project });
  }
  // drill-down / filter dimensions (all optional)
  const visitor = url.searchParams.get("visitor");
  const session = url.searchParams.get("session");
  const path = url.searchParams.get("path");
  const event = url.searchParams.get("event");
  if (visitor) opts.visitor = visitor;
  if (session) opts.session = session;
  if (path) opts.path = path;
  if (event) opts.event = event;
  return opts;
}
async function handleJourney(req, url, env) {
  const opts = await journeyOpts(url, env);
  return cached(url, env, () => journeyOverview(env, opts), "journey");
}
async function handlePages(req, url, env) {
  const opts = await journeyOpts(url, env);
  const rows = await cached(url, env, () => topPages(env, opts), "jpages");
  return { rows };
}
async function handleEntryExit(req, url, env) {
  const opts = await journeyOpts(url, env);
  return cached(url, env, () => entryExitPages(env, opts), "jentry");
}
async function handleSessions(req, url, env) {
  const opts = await journeyOpts(url, env);
  const id = url.searchParams.get("id");
  if (id) return sessionDetail(env, opts, id); // drill-down: no cache
  const rows = await cached(url, env, () => listSessions(env, opts), "jsessions");
  return { rows };
}
async function handleNavigation(req, url, env) {
  const opts = await journeyOpts(url, env);
  const rows = await cached(url, env, () => navigationFlow(env, opts), "jnav");
  return { rows };
}
async function handleVisitors(req, url, env) {
  const opts = await journeyOpts(url, env);
  const id = url.searchParams.get("id");
  if (id) return visitorJourney(env, opts, id); // individual journey: no cache
  const rows = await cached(url, env, () => listVisitors(env, opts), "jvisitors");
  return { rows };
}
async function handleTrackedDomains(req, url, env) {
  const opts = await journeyOpts(url, env);
  const rows = await cached(url, env, () => trackedDomains(env, opts), "jdomains");
  return { rows: rows || [] };
}

// ---- date window helpers ----
function windowFrom(url) {
  const preset = url.searchParams.get("preset") || "7d";
  const now = new Date();
  let since, until = now.toISOString();
  const dayStart = (d) => { const x = new Date(d); x.setUTCHours(0, 0, 0, 0); return x; };

  if (preset === "custom") {
    since = url.searchParams.get("from") || new Date(now - 7 * DAY).toISOString();
    until = url.searchParams.get("to") || until;
    return { since, until };
  }
  if (preset === "today") since = dayStart(now).toISOString();
  else if (preset === "yesterday") {
    const y = new Date(now - DAY); since = dayStart(y).toISOString();
    until = new Date(dayStart(y).getTime() + DAY).toISOString();
  } else if (preset === "30d") since = new Date(now - 30 * DAY).toISOString();
  else if (preset === "90d") since = new Date(now - 90 * DAY).toISOString();
  else since = new Date(now - 7 * DAY).toISOString(); // 7d
  return { since, until };
}

function granularityFrom(url, since, until) {
  const span = new Date(until) - new Date(since);
  // Cloudflare's hourly dataset (httpRequests1hGroups) rejects ranges wider than
  // 3 days (live-verified: "cannot request a time range wider than 3d"). Honor an
  // hourly request only within that cap; otherwise fall back to daily so the query
  // never errors out and silently shows an empty chart.
  if (span > 3 * DAY) return "daily";
  const g = url.searchParams.get("granularity");
  if (g === "hourly" || g === "daily") return g;
  return span <= DAY ? "hourly" : "daily";
}

// ---- misc ----
function cached(url, env, fn, ns = "") {
  return getOrCompute(url.pathname + url.search + "#" + ns, env, fn);
}
function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

// Predictable success envelope for dashboard APIs: adds success:true while keeping
// the payload's own top-level keys (rows/totals/...) so existing clients are intact.
function envelope(data) {
  if (data && typeof data === "object" && !Array.isArray(data)) return { success: true, ...data };
  return { success: true, data };
}
