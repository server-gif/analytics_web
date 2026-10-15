# Central Cloudflare Analytics Dashboard (Version 1)

Ek **private admin dashboard** jo tamara badha Cloudflare projects/domains nu analytics
**sudhu Cloudflare-native free APIs mathi** dekhay.

- NO D1, NO R2, NO external database
- NO paid / third-party analytics (Google/Mixpanel/etc.)
- V1 = Cloudflare-native data only. A **User Journey** custom-tracking layer (Workers
  Analytics Engine) was added later as a **clearly separated** layer - see Section 10
  and [`USER-JOURNEY.md`](./USER-JOURNEY.md).
- Architecture: `Browser -> React frontend (Cloudflare Pages) -> backend Worker -> Cloudflare REST/GraphQL API`
- Auth: **HTTP Basic** (browser nu native login box) - darek read/admin route `DASHBOARD_PASSWORD`
  secret sathe protect che; **no Zero Trust account, no card, no seat limits**. Koi password code/git ma nathi.
- CF API token **sudhu Worker secrets ma** - frontend/HTML/localStorage/git ma KABHI nahi

> Note: aa ek **independent module** che. Tamari existing `../tracking-module/` ane
> `../dashboard-worker/` (Analytics Engine custom tracking) na vapraya - te alag system che.

---

## 1. Folder structure

```
central-dashboard/
  backend-worker/
    wrangler.toml
    src/
      index.js       # router + auth + /api/* handlers
      cloudflare.js  # REST resource discovery (zones/workers/pages) + mapping
      graphql.js     # GraphQL Analytics queries + executor (graceful N/A)
      cache.js       # Cache API + in-memory fallback (no DB)
      metrics.js     # metric catalog + "Not available" rules
  frontend/
    package.json
    vite.config.js   # dev proxy /api -> :8787
    index.html
    public/_redirects # SPA fallback for Cloudflare Pages
    src/
      main.jsx  App.jsx  styles.css
      api/client.js  lib/format.js  lib/useApi.js
      components/ Layout.jsx StatCard.jsx TrafficChart.jsx DataTable.jsx StateViews.jsx
      pages/ Dashboard Projects Domains Traffic Countries Requests Bandwidth Workers Pages Errors
```

---

## 2. Cloudflare API token permissions (minimum)

`dash.cloudflare.com -> My Profile -> API Tokens -> Create Custom Token`:

| Permission | Why |
|---|---|
| Zone > Zone > Read | list zones/domains |
| Zone > Zone Analytics > Read | zone GraphQL analytics (requests, bandwidth, countries, status) |
| Account > Account Analytics > Read | account-level + Workers analytics |
| Account > Workers Scripts > Read | list Workers |
| Account > Pages > Read | list Pages projects |

Account resource: tamaru account. Token ek vaar j dekhay - copy kari ne rakhjo.

> **Multi-account (verified):** discovery enums every account the token can read
> (`listAccounts`), so **both** Cloudflare accounts appear. Create the token with
> **Account Resources = Include → both accounts**. Zones are fetched token-wide and
> attributed by each zone's **own** `account.id`; Workers/Pages are fetched **per account**.
> Every project/domain row carries its `account` + `accountId`, so **Account A can never show
> Account B's domains** (zoneTags and apex hostnames are globally unique). Analytics are
> queried per unique `zoneTag`, which works across both accounts with the single token.
>
> **Known limit:** Workers *analytics numbers* are read from the pinned `CF_ACCOUNT_ID`
> account only. Both accounts' Workers are still **listed** (discovery), but a non-pinned
> account's Worker request/error counts show as "Not available". Zone/Pages analytics are
> unaffected (they resolve through each zone's unique `zoneTag`).

> **Analytics Engine auth (important):** writing User Journey events with
> `writeDataPoint()` is authorized by the Worker's `[[analytics_engine_datasets]]`
> **binding at deploy time** - it does **not** use `CF_API_TOKEN`. Cloudflare has **no
> "Analytics Engine: Write/Read" token scope** (that permission does not exist). The
> **Account > Account Analytics > Read** permission in the table above already covers the
> AE **SQL read** the dashboard runs. Do not add any "write" scope to the token.

---

## 3. PHASE 0 - Live schema/field verification

`metrics.js` ane `graphql.js` na dataset/field naam **LIVE verify** karya che (read-only
GraphQL queries tamara actual accounts par - eka fake/assumed field nahi). Je field male
chhe ne sudhu e j vapraya; je na male ke plan-gated che te auto **"Not available"** dekhay
faked number nahi).

> **Point-in-time probe:** these checks were run read-only against the live accounts on
> **2026-10-06** (see the Verified-against block below). Dataset availability and the range
> limits are Cloudflare-side and can change - **re-run before treating them as current**;
> nothing here is assumed or fabricated.

You can re-run the same checks anytime (curl - token shell ma, repo ma navi):

```bash
# 3a. introspection: available zone datasets
curl -s https://api.cloudflare.com/client/v4/graphql \
  -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"{ __type(name:\"Viewer\") { fields { name } } }"}'

# 3b. overview test (zoneTag = tamari zone id; filter empty rakhyo to badha zones)
curl -s https://api.cloudflare.com/client/v4/graphql \
  -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"query($s:Timestamp!,$u:Timestamp!){ viewer{ zones(filter:{zoneTag:\"ZONE_ID\"}){ httpRequestsAdaptiveGroups(limit:1, filter:{datetime_geq:$s, datetime_leq:$u}){ sum{ requests edgeResponseBytes } } } } }","variables":{"s":"2026-09-01T00:00:00Z","u":"2026-10-03T00:00:00Z"}}'
```

Confirm thayela naam `metrics.js`/`graphql.js` ma lock karya, ane aa **verified-against note**:

```
Verified-against: accounts Prime-2 (e0ddc38e82a27813016c92e9dcd51896) &
                  Server@primesoftechs.com (6d0f21fc8cb32e3ac757c8bb83289c74);
                  date 2026-10-06; 16 zones discovered.
Verified datasets/fields (returned live data):
  - zone httpRequests1dGroups  sum{requests, bytes}; countryMap{clientCountryName,requests,bytes};
    responseStatusMap{edgeResponseStatus,requests}
  - zone httpRequests1hGroups  sum{requests, bytes}  [LIMIT: range must be <= 3 days]
  - zone httpRequestsAdaptiveGroups  count; sum{edgeResponseBytes}; dims{clientRequestHTTPHost,
    clientCountryName, edgeResponseStatus, datetimeHour}  [host-scoped; range <= 27 days]
  - workers workersOverviewRequestsAdaptiveGroups  count; sum{cpuTimeUs}; dim{scriptName}
    (the `status` dim is a small internal code - NOT HTTP - so an error count is NOT derived)
Not available (never fabricated): Unique Users/Visitors, Cities, Device/Browser/OS.
```

**STRICT accuracy rule (prompt mathi):**
- `Requests` = count, `Bandwidth` = bytes. Eka ne byju/eka j label nathi apva.
- `Total Traffic` ke "requests" ne "users" nathi kahayta.
- Je metric Cloudflare free mathi na aave te **hamesha "Not available"**:
  **Unique Users/Visitors, Cities, Device/Browser/OS** (khali Phase 0 confirm thay to j available mark karva).
- Koi 0/estimate/derived/fake calculation **kABHI nathi**.

---

## 4. Backend: local dev + deploy

```bash
cd backend-worker
npx wrangler login
npx wrangler secret put CF_ACCOUNT_ID       # dash.cloudflare.com right-bar mathi
npx wrangler secret put CF_API_TOKEN        # Section 2 mathi
npx wrangler secret put DASHBOARD_PASSWORD  # Basic Auth password (prod)
# local dev mate aa secrets .dev.vars ma (git ma navi):
#   CF_ACCOUNT_ID=...  CF_API_TOKEN=...  DASHBOARD_PASSWORD=...
npx wrangler dev                            # http://localhost:8787
# test (Basic Auth localhost par lagu che - -u aapvo padshe; username koi pan):
curl -u admin:"$DASHBOARD_PASSWORD" "http://localhost:8787/api/account"
curl -u admin:"$DASHBOARD_PASSWORD" "http://localhost:8787/api/projects"
curl -u admin:"$DASHBOARD_PASSWORD" "http://localhost:8787/api/analytics/overview?preset=7d"
curl -X POST "http://localhost:8787/api/track" -H 'content-type: application/json' -d '{...}'   # public (no -u)

npx wrangler deploy                         # prod
```

Optional vars (`wrangler.toml`): `REQUIRE_ACCESS=true` (ab = "enforce Basic Auth"), `CACHE_TTL=120`.
Set `REQUIRE_ACCESS=false` only if you deliberately want the read APIs open (NOT recommended).

### Endpoints
`GET /api/account` · `/api/zones` · `/api/workers` · `/api/pages` · `/api/projects` · `/api/domains`
`GET /api/analytics/overview|traffic|countries|errors|workers`
Query: `?project=&domain=&preset=today|yesterday|7d|30d|90d|custom&from=&to=&granularity=hourly|daily`

### Caching (no DB)
`cache.js` Worker Cache API (`caches.default`) vapare `max-age=CACHE_TTL`; local dev
mathi in-memory memo fallback. Repeated API call thatho bachay.

### Error handling
Backend error aav to client ne `"Unable to load Cloudflare analytics."` (502) aave;
actual error `console.error` ma log thay (token KABHI response ma nathi aavto).

---

## 5. Frontend: build + serve (same-origin from the Worker)

The dashboard UI is served **as Workers static assets from the backend Worker** (see
`[assets]` in `backend-worker/wrangler.toml`), so the UI and the API share ONE origin. That
means HTTP Basic Auth (Section 6) guards the whole site and the SPA's relative `/api/*` calls
carry the logged-in session - no CORS, no cross-origin prompt problem.

```bash
cd frontend
npm install
npm run dev            # local dev only: http://localhost:5173, /api proxy -> :8787
npm run build          # -> dist/  (build with VITE_API_BASE="" so /api is relative)
cd ../backend-worker
npx wrangler deploy    # bundles ../frontend/dist as assets + the API into one Worker
```

- Frontend uses **relative** `/api/*` (no secret, no baked URL). Build with `VITE_API_BASE=""`.
- SPA deep routes (`/journey`, `/sessions`, ...) fall back to `index.html` via
  `not_found_handling = "single-page-application"` - the old Pages `public/_redirects` file is
  no longer needed (and would make the Worker asset deploy reject the build as a redirect loop).
- `run_worker_first = true` makes the Worker gate asset requests too (it serves them via
  `env.ASSETS.fetch`) so the UI itself is behind Basic Auth.
- **Optional custom domain:** add one in Cloudflare (Workers -> your Worker -> Triggers ->
  Custom domain) to move off `*.workers.dev`; nothing else changes (still same origin).

---

## 6. Auth (HTTP Basic) - protected dashboard/read APIs, PUBLIC track ingest

The dashboard and every read/admin API are protected by **HTTP Basic Auth** - no Cloudflare
Access / Zero Trust, no card details, no seat limits. `POST /api/track` stays **public** so
visitor browsers on tracked sites can send events without any login.

**How it works** (`src/auth.js`, runs before all routing except `/api/track`):
- The Worker reads the `Authorization` header and expects `Basic base64("<user>:" + DASHBOARD_PASSWORD)`.
- **Username is ignored** (any value, e.g. `admin`); only the **password** is checked against the
  `DASHBOARD_PASSWORD` secret.
- Missing / wrong / malformed credentials -> **401** with
  `WWW-Authenticate: Basic realm="Central Analytics Dashboard"`, so a same-origin dashboard load
  pops the browser's **native login box** (no custom login page, no frontend change).
- **Fail closed:** if `DASHBOARD_PASSWORD` is not set, protected routes return **503** - auth is
  never silently skipped.
- `/api/track` is handled **before** the gate and keeps its own `ALLOWED_ORIGINS` origin check +
  server-side validation + rate limit (all unchanged).

**Setup (replaces the old Zero Trust steps):**
1. Generate a strong password.
2. `npx wrangler secret put DASHBOARD_PASSWORD`   # prod; for local dev put it in `.dev.vars`
3. Open the dashboard URL -> the browser prompts: **username = any value (e.g. `admin`)** + **password**.

> **Serving tip (honest limitation):** the native Basic Auth prompt appears on a **document
> navigation**. The simplest way to guarantee it is **same-origin** - route the dashboard (`/`)
> and `/api/*` through this Worker on one custom domain, and Basic Auth guards everything except
> `POST /api/track`. If the dashboard is served from a **separate origin** (e.g. Cloudflare Pages)
> and calls the API via `fetch`, a cross-origin `fetch` does **not** auto-open the login box - it
> just receives the 401. In that case serve through the Worker, or have the caller pre-send
> credentials (an `Authorization` header).

Koi multi-user SaaS auth banavvanu nathi - ek admin, Basic Auth protected; track ingest public.

---

## 7. Kaun nu metrics Cloudflare mathi male / na male

| Metric | V1 source | Status |
|---|---|---|
| Total Requests | zone `httpRequestsAdaptiveGroups.sum.requests` | Available |
| Bandwidth / traffic bytes | `sum.edgeResponseBytes` | Available (bytes) |
| Countries (requests + bytes) | `ClientCountryName` dimension | Available |
| HTTP errors 4xx/5xx | `EdgeResponseStatus` dimension | Available |
| Traffic over time | `httpRequests1hGroups`(hourly) / `1dGroups`(daily) | Available (hourly capped at ≤3-day range) |
| Workers requests / CPU | `workersOverviewRequestsAdaptiveGroups` (count, cpuTimeUs) | Available (live-verified) |
| Workers errors | `status` dim is not an HTTP code | **Not available** (never derived from a non-HTTP code) |
| Domains / Projects / Pages lists | REST zones/workers/pages | Available |
| **Unique Users/Visitors** | Cloudflare requests aape, users nahi | **Not available** |
| **Cities** | plan/dataset-gated | **Not available** |
| **Device/Browser/OS** | aa dataset mathi nathi | **Not available** |
| Pages "traffic" | alag Pages dataset nathi | **Not available** (select linked domain) |

---

## 8. Additional Cloudflare projects add karva

Resource list **dynamic discover** thay che (`/api/projects`, `/api/domains`).
Navo domain/project Cloudflare account ma aave to te aapje aavi jashe (re-deploy ke
cache TTL pachhi). Je auto-discovery na thay (jem ke ek Worker je custom-domain nu
route data API mathi na male) te **"no linked domain"** bucket ma dekhay -
tena mate Cloudflare par zone/route banavo, ke future ma ek optional mapping var add
kari shakho (khali manual mapping - database chari).

---

## 9. Testing checklist

- [ ] Phase 0 curl queries chalavya ane `metrics.js`/`graphql.js` fields verify/lock karya.
- [ ] `/api/*` darek endpoint -> 200 JSON ke clean 502 error; response ma token nathi.
- [ ] GraphQL na-male field -> UI "Not available" (0/estimate nathi).
- [ ] Domain select -> suudhu teno data; ALL -> aggregated.
- [ ] Date presets (Today/Yesterday/7/30/90/Custom) -> correct since/until.
- [ ] `npm run build` pass; pages render; loading/empty/error states dekhay.
- [ ] Requests vs Bandwidth alag label/axis rite dekhay.
- [ ] Access lagavta pachhi anonymous request block thay.

---

## 10. User Journey Analytics (custom-tracked layer)

Aapda native dashboard upar ek **separate** layer je visitors ni actual activity
track kare: page views, sessions, **active (tab-visible) time-on-page**, entry/exit,
page→page navigation flow, ane individual visitor journeys.
Full rollout guide + code: **[`USER-JOURNEY.md`](./USER-JOURNEY.md)**.

- **Store:** Workers Analytics Engine dataset `user_journey` (binding `AE`).
  Writes go through `POST /api/track` -> `writeEvent()`; reads through the AE SQL API.
- **Central dataset ownership:** the **central backend Worker owns this dataset and is its
  single writer.** Every tracked domain/account POSTs to that one Worker's `/api/track`,
  which writes into that one `user_journey`. It is **not** a per-account copy -
  Account A and Account B do **not** each own a copy; all events pool into the central one.
  Each stored event preserves its source fields (actual schema): `event` (blob1),
  `project` (blob2), `domain` (blob3), `path` (blob4), `visitorId` (blob7),
  `sessionId` (blob8), and client `timestamp` (double2).
- **Account/project resolution:** the backend maps a tracked hostname to its project/account
  **at read time, using the discovered Cloudflare inventory**, scoped by the exact stored
  hostname (`blob3`). When a hostname resolves, journeys group under that project/account
  across both accounts. **Unresolved hostnames are never assigned to another account** - no
  guessing, no fabrication, no cross-account contamination. `accountId` is derived from the
  zone/project mapping, never trusted from the client.
- **Event model (locked):** `page_view`, `page_duration`, `navigation`, `session_activity`.
  There is **no** `session_start`/`session_end` source-of-truth - a session rolls over after
  30 min idle and a visible `session_activity` heartbeat keeps it alive. Entry/exit pages are
  **derived** server-side (first/last `page_view` per session); time-on-page counts only
  **active/visible** time (the clock pauses when the tab is hidden).
- **Dashboard window:** dashboard read APIs expose a **rolling 30-day window** (a read-side
  query clamp). Analytics Engine itself may retain data longer; we never claim the data is
  physically deleted after 30 days.
- **Deployables:** the **manual `tracking/analytics.js` embed** (one `<script>` per site,
  zero-config). There is **no edge auto-injector** — a Worker route cannot attach to a hostname
  already served by Pages or another Worker's custom domain, so per-site embed is the reliable,
  no-harm method (see [`USER-JOURNEY.md`](./USER-JOURNEY.md) §3–4).
- **API envelope:** dashboard reads return `{"success":true, ...data}`; errors return
  `{"success":false,"error":"..."}`. `/api/track` is **public** (validates server-side, keeps
  its `ALLOWED_ORIGINS` check) and is exempt from auth (README §6); the read APIs stay behind
  HTTP Basic Auth (`REQUIRE_ACCESS=true` + `DASHBOARD_PASSWORD`). CF token is never exposed to
  the browser.
- **Separation:** Journey/Sessions/Visited Pages/Navigation/Visitors pages are labeled
  "custom tracked" and never mix with Cloudflare-native numbers.

### Troubleshooting: "no data appears after the test curl" (correct order)

Do **not** jump to "the token is missing a scope" - that scope does not exist. Diagnose:

1. **Read the curl response itself.** `204` = **accepted for ingestion** (the event passed
   server-side validation and was submitted to Analytics Engine; it does **not** mean the row
   is already queryable - AE ingestion is asynchronous). `4xx/5xx` = diagnose directly
   (400 = bad/unknown event, missing ids, or invalid timestamp; 403 = origin not allowed;
   413 = payload too large; 429 = rate limited; **500 = server/configuration error** - inspect
   Worker logs and verify the Analytics Engine binding, dataset name, and other server config;
   do not assume every 500 is a missing binding).
2. **Confirm `CF_API_TOKEN` + `CF_ACCOUNT_ID`** are set with no stray whitespace/newline
   (local: `.dev.vars`; prod: `wrangler secret put`). A read returns null if these are off.
3. **Confirm the binding + dataset names match the code exactly:** `wrangler.toml` uses
   `binding = "AE"` / `dataset = "user_journey"`; the query code must reference the
   same. A mismatch = writes/reads silently hit different places.
4. **Confirm the dashboard SQL uses the same dataset name** (`user_journey`). A
   typo here yields empty results / "Not available" with no error.

> Note: in **local** `wrangler dev` (without `--remote`) AE writes are buffered in the
> miniflare instance and are **not** queryable via the hosted SQL API - use
> `wrangler dev --remote` for the write->read round-trip test.
