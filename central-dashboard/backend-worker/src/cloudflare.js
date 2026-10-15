/**
 * Cloudflare REST API calls for RESOURCE DISCOVERY (not analytics numbers).
 * Maps real Cloudflare resources into the dashboard's "Project / Domain" view.
 *
 * Cloudflare has no first-class "project"; we map:
 *   - Zone  (a domain + its DNS)        -> a project + its domain (1:1, reliable)
 *   - Worker script                     -> a project (domains best-effort via routes)
 *   - Pages project                     -> a project (its *.pages.dev subdomain + custom domains best-effort)
 *
 * Mapping is BEST-EFFORT: je confirmed link nathi mate te "unmapped/worker-only"
 * bucket ma rakhiye, force 1:1 ke fabricated association nathi karva.
 */

const API = "https://api.cloudflare.com/client/v4";

function headers(env) {
  return {
    Authorization: `Bearer ${env.CF_API_TOKEN}`,
    "Content-Type": "application/json",
  };
}

async function getJson(env, path) {
  const res = await fetch(`${API}${path}`, { headers: headers(env) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    const errs = (json.errors || []).map((e) => e.message).join("; ");
    throw new Error(`Cloudflare API ${path} -> ${res.status} ${errs}`);
  }
  return json.result;
}

/** Account info */
export async function getAccount(env) {
  const acc = await getJson(env, `/accounts/${env.CF_ACCOUNT_ID}`);
  return { id: acc.id, name: acc.name, type: acc.type };
}

/** All accounts the token can access (multi-account discovery) */
export async function listAccounts(env) {
  const accs = await getJson(env, `/accounts`);
  return (accs || []).map((a) => ({ id: a.id, name: a.name, type: a.type }));
}

/** Zones. accountId omitted -> token-wide (all zones the token can read).
 *  NOTE: /zones?account_id= is NOT reliably filtered by Cloudflare, so we fetch
 *  token-wide once and attribute each zone by its OWN zone.account.id. */
export async function listZones(env, accountId) {
  const filter = accountId ? `account_id=${accountId}&` : "";
  const zones = await getJson(env, `/zones?${filter}per_page=100`);
  return (zones || []).map((z) => ({
    zoneId: z.id,
    domain: z.name,
    status: z.status,
    accountTag: z.account && z.account.id, // REAL owning account id
  }));
}

/** Worker scripts (name) in an account */
export async function listWorkers(env, accountId = env.CF_ACCOUNT_ID) {
  const scripts = await getJson(env, `/accounts/${accountId}/workers/scripts`);
  return (scripts || []).map((s) => ({
    // LIVE-verified: `id` = script NAME (e.g. "vidshare"); `tag` = a hex id.
    workerName: s.id || s.script || s.tag || s.name,
    createdOn: s.created_on,
    modifiedOn: s.modified_on,
  }));
}

/** Zone routes -> worker-to-domain mapping thi sake (best-effort) */
export async function listRoutesForZone(env, zoneId) {
  try {
    const routes = await getJson(env, `/zones/${zoneId}/filters`); // placeholder-safe
    return routes || [];
  } catch {
    return [];
  }
}

/** Pages projects (name + subdomain + custom domains) in an account */
export async function listPages(env, accountId = env.CF_ACCOUNT_ID) {
  const projects = await getJson(env, `/accounts/${accountId}/pages/projects`);
  return (projects || []).map((p) => {
    // Cloudflare-provided *.pages.dev has no analytics -> EXCLUDE it from the
    // project's domain set + counts (only real custom domains are associated).
    // Keep `subdomain` separately just for the Pages list "production domain".
    const doms = [...new Set((p.domains || []).filter((d) => d && !/\.pages\.dev$/i.test(d)))];
    return {
      pagesName: p.name,
      subdomain: p.subdomain,
      domains: doms,
      productionBranch: p.production_branch,
      canonicalUrl: p.canonical_deployment && p.canonical_deployment.url,
      createdOn: p.created_on,
    };
  });
}

/**
 * Build the unified "projects" + "domains" lists from discovered resources.
 * DEDUP RULE (only what Cloudflare really has, no double rows):
 *   - A Zone is the authoritative traffic source for its domain.
 *   - A Pages project whose custom domain IS a zone -> MERGED into that zone
 *     project (annotated `pages`), NOT a separate row (else it shows twice).
 *   - A Pages project only on *.pages.dev (no owned zone) -> own row, traffic N/A.
 *   - Workers -> own rows (compute, no zone overlap).
 * Domains list is de-duplicated by hostname.
 */
export async function buildInventory(env) {
  // discover across EVERY account the token can read (not just the pinned one)
  let accounts = [];
  try { accounts = await listAccounts(env); } catch { accounts = []; }
  if (!accounts.length) accounts = [{ id: env.CF_ACCOUNT_ID, name: "Account" }];
  const acctNameById = Object.fromEntries(accounts.map((a) => [a.id, a.name]));

  // Zones: fetch ONCE token-wide. /zones?account_id= is NOT reliably filtered by
  // Cloudflare (both accounts return the same list), so we attribute each zone by
  // its OWN zone.account.id -> correct per-account ownership, no mix-up.
  // Workers/Pages endpoints ARE account-scoped, so fetch them per account.
  const [rawZones, ...perAcctWP] = await Promise.all([
    listZones(env).catch(() => []),
    ...accounts.map((a) => Promise.all([
      listWorkers(env, a.id).catch(() => []),
      listPages(env, a.id).catch(() => []),
    ])),
  ]);

  const zoneMap = new Map();
  for (const z of rawZones) {
    if (zoneMap.has(z.zoneId)) continue;
    const ownerId = z.accountTag || null;
    zoneMap.set(z.zoneId, { ...z, accountId: ownerId, account: acctNameById[ownerId] || null });
  }
  const zones = [...zoneMap.values()];

  const workerMap = new Map();
  const pageMap = new Map();
  accounts.forEach((a, i) => {
    const [workers, pages] = perAcctWP[i];
    for (const w of workers) if (!workerMap.has(w.workerName)) workerMap.set(w.workerName, { ...w, account: a.name, accountId: a.id });
    for (const p of pages) if (!pageMap.has(p.pagesName)) pageMap.set(p.pagesName, { ...p, account: a.name, accountId: a.id });
  });
  const workers = [...workerMap.values()];
  const pages = [...pageMap.values()];

  const zoneDomainSet = new Set(zones.map((z) => z.domain));
  const projects = [];
  const domains = [];
  const seenDomain = new Set();
  const addDomain = (d) => { if (d && !seenDomain.has(d)) { seenDomain.add(d); domains.push(d); } };

  // 1) Zones first (authoritative)
  for (const z of zones) {
    projects.push({ type: "zone", name: z.domain, zoneId: z.zoneId, account: z.account, accountId: z.accountId, domains: [z.domain] });
    addDomain({ domain: z.domain, type: "zone", zoneId: z.zoneId, account: z.account, accountId: z.accountId, linked: true });
  }

  // 2) Pages: merge into a zone when they share a custom domain; else standalone
  for (const p of pages) {
    const doms = p.domains || []; // *.pages.dev already excluded in listPages
    const zoneMatch = doms.find((d) => zoneDomainSet.has(d));
    if (zoneMatch) {
      const zp = projects.find((pr) => pr.type === "zone" && pr.name === zoneMatch);
      if (zp) { zp.pages = p.pagesName; }
      continue; // no duplicate project/traffic
    }
    projects.push({ type: "pages", name: p.pagesName, zoneId: null, account: p.account, accountId: p.accountId, domains: [...doms], linked: doms.length > 0 });
    for (const d of doms) addDomain({ domain: d, type: "pages", account: p.account, accountId: p.accountId, linked: true });
  }

  // 3) Workers (compute-only; domains unknown unless routed)
  for (const w of workers) {
    projects.push({ type: "worker", name: w.workerName, zoneId: null, account: w.account, accountId: w.accountId, domains: [], linked: false });
  }

  return { projects, domains, zones, workers, pages };
}
