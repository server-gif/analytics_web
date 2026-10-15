# User Journey Analytics — Setup & Rollout Guide

This layer adds **visitor activity** tracking (page views, sessions, active time-on-page,
entry/exit, page→page navigation, individual visitor journeys) on top of the
Cloudflare-native dashboard. It is a **separate, clearly-labeled** data source —
custom-tracked numbers never mix with Cloudflare-native analytics.

- **Store:** Workers Analytics Engine dataset `user_journey` (auto-creates on first write).
- **Ingest:** site snippet → `POST /api/track` (public) → `writeEvent()` → AE.
- **Read:** dashboard → AE SQL API → Journey / Sessions / Visited Pages / Navigation / Visitors.
- **Rollout (the only method):** embed the manual [`tracking/analytics.js`](./tracking/analytics.js)
  `<script>` on each site you want to measure (one line per site — see §3 Step 2). There is
  deliberately **no edge auto-injector**: a Worker route cannot attach to a hostname already
  served by Pages or another Worker's custom domain, so the per-site embed is the reliable,
  no-harm path.

```
Visitor ──► [analytics.js snippet]  ──POST /api/track──►  backend Worker ──► AE dataset (user_journey)
Dashboard ───────────────────────── AE SQL read (30-day window) ─────► backend Worker ──► Journey pages
```

---

## 0. Data model & rules (read with §1)

**Event types (locked whitelist).** `/api/track` accepts only:

| Event | Meaning |
|---|---|
| `page_view` | a page was seen (carries the referrer / previous-page path) |
| `page_duration` | sent **once** when a page is finalized; `dur` = **active/visible** seconds |
| `navigation` | an in-app route change; `ref` = from-page, `path` = to-page |
| `session_activity` | 30s heartbeat **while the tab is visible** — keeps the session alive, marks last activity |

- **No `session_start` / `session_end`.** A session is `(visitorId, sessionId)`; it rolls over
  after **30 min idle**. Liveness/last-activity comes from `session_activity`. Sending
  `session_start`/`session_end` to `/api/track` now returns **400**.
- **IDs are anonymous.** `visitorId` in `localStorage`, `sessionId` in `sessionStorage`. No
  cookies, no PII; respects Do Not Track. Every event carries its `domain` (hostname) so the
  dashboard can scope journeys per domain / project / account. `visitorId` is **per-origin** —
  the same person is **not** unified across unrelated domains (no cross-domain identity in V1).
  `/api/track` rejects: invalid JSON, unknown events, missing `visitorId`/`sessionId`, **missing
  `domain`**, and **invalid/absent timestamp** (`ts`), plus oversized payloads (413).
- **Active time only.** The clock pauses on `visibilitychange`→hidden, `blur`; resumes on
  visible/`focus`. `page_duration` is emitted once per page (route change or `pagehide`).
- **Entry / exit / session duration are derived** server-side over `page_view` events.
  Ordering uses the **client event timestamp** (`double2`), *not* AE's ingestion time, because
  the client clock is the true order a visitor saw pages while AE ingestion time is
  non-deterministic for rapid/batched writes (`argMin`/`argMax` per session). No client
  exit event is required.
- **Dashboard window:** dashboard read APIs expose a **rolling 30-day window** (a read-side
  query clamp). Analytics Engine may retain data longer; we never state that data is
  physically deleted.
- **API envelope:** dashboard reads → `{"success":true, ...data}`; errors → `{"success":false,
  "error":"..."}`. `/api/track` is public + server-validated; read APIs are behind Access. The
  Access application policy **must bypass/exclude `POST /api/track`** (keeping every other
  path protected) so external sites can submit events — see [`README.md`](./README.md) §6.

### 0.1 Analytics Engine SQL limits — verified live (Phase 0)

We ran a real end-to-end POC (Browser → `/api/track` → AE → SQL → dashboard) against the
live `user_journey` dataset. Workers Analytics Engine SQL is a **restricted
ClickHouse subset**; the dashboard queries are written to the verified-supported subset only:

| Not supported (returns HTTP 422) | Use instead (verified working) |
|---|---|
| `parseDateTimeBestEffort()` | `toDateTime('YYYY-MM-DD HH:MM:SS')` for time bounds |
| `uniq()` / `uniqExact()` / `uniqExactIf()` | `count(DISTINCT blobN)` |
| `any(col)` | `argMax(col, timestamp)` for a representative value |
| `max()` / `min()` on **string** columns | `argMin`/`argMax(col, key)` |
| `ORDER BY` on a non-projected column (bare `timestamp`, `double2`) | project an alias (`timestamp AS ts`) then `ORDER BY ts` |

Confirmed working: `countIf/avgIf/sumIf`, `argMin/argMax`, `GROUP BY`/`HAVING`, `min/max(timestamp)`
(in aggregate context), `LIKE`, string equality, `now() - toIntervalDay(n)`, `ORDER BY` on a
projected alias, and nested subquery aggregation.

**Two honest operational caveats (not query-pattern failures):**
1. **Ingestion is asynchronous + eventually consistent.** A `204` means the event was
   **accepted for ingestion** — validated and submitted to Analytics Engine — **not** that it
   is immediately queryable; a written event typically becomes visible after ~60–120s. A
   deployed Worker submits events to Analytics Engine through the binding, but ingestion is
   asynchronous, so **delivery and queryability should not be treated as synchronous** (no
   at-least-once guarantee is claimed here). Under `wrangler dev --remote` the writer is
   fire-and-forget and a small fraction of events may be dropped. Dashboards must therefore
   treat very-recent counts as best-effort.
2. **No row-level delete.** AE data can only be excluded by time, not deleted. POC/test events
   use `*.example` hostnames so they never collide with real domains and age out of the 30-day
   read window on their own.

---

## 1. Authentication facts (corrected — read this first)

There is **no** Cloudflare token permission called **"Analytics Engine: Write"** or
**"Analytics Engine: Read"** — that permission group **does not exist**. Verified against
the official docs: <https://developers.cloudflare.com/analytics/analytics-engine/sql-api/>.

The correct model:

| Action | How it authenticates | Token scope needed |
|---|---|---|
| **Write** events (`writeDataPoint()`) | The Worker's `[[analytics_engine_datasets]]` **binding**, resolved at `wrangler deploy` time | **None** — it never uses `CF_API_TOKEN` |
| **Read** events (dashboard SQL queries) | `Authorization: Bearer CF_API_TOKEN` on `/accounts/{id}/analytics_engine/sql` | **Account ▸ Account Analytics ▸ Read** |

> Your token should already have **Account Analytics ▸ Read** (see the table in
> [`README.md`](./README.md) §2). **Do not** add any "write" scope — it isn't a thing.

---

## 2. Prerequisites

- Backend Worker secrets set: `CF_API_TOKEN` (Account Analytics Read), `CF_ACCOUNT_ID`,
  and the `DASHBOARD_PASSWORD` Basic Auth secret.
- AE binding + dataset already present in `backend-worker/wrangler.toml`:
  ```toml
  [[analytics_engine_datasets]]
  binding = "AE"
  dataset = "user_journey"
  ```

---

## 3. Rollout plan (in order)

Steps 0–2 are the whole rollout: deploy the backend, then embed `analytics.js` on each site.

### Step 0 — Local write→read round-trip (no production changes)
Run the backend with `--remote` so AE writes land in the real account and are queryable:
```bash
cd central-dashboard/backend-worker
npx --yes wrangler dev --remote --port 8787 --ip 127.0.0.1
```
In another terminal, send one test event. `ts` must be a **valid current Unix timestamp in
milliseconds**. Server-side validation is intentionally strict about *type*: `/api/track` rejects
a missing / non-numeric / non-positive `ts` with 400. A numeric-but-implausible value like `ts:1`
is accepted (204) but is stored dated 1970, so it falls **outside the dashboard's rolling 30-day
window** and will not appear — which is exactly why the test must use the current time:
```bash
# bash: current epoch milliseconds
TS=$(date +%s%3N)
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:8787/api/track \
  -H "content-type: application/json" \
  -d "{\"e\":\"page_view\",\"p\":\"escavello.com\",\"d\":\"escavello.com\",\"path\":\"/\",\"v\":\"v-test\",\"s\":\"s-test\",\"ts\":$TS}"
```
> PowerShell equivalent for `TS`: `[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()`
Expected: `204` (**accepted for ingestion** — not a guarantee it is queryable yet; AE ingestion
is async). Open the dashboard → **Journey** → the test visitor should become visible after
ingestion, typically within ~1–2 min.
If nothing shows, use the **troubleshooting order in §6** (do NOT assume a missing token scope).

### Step 1 — Deploy the backend, get its public URL
```bash
npx --yes wrangler secret put CF_ACCOUNT_ID
npx --yes wrangler secret put CF_API_TOKEN
npx --yes wrangler deploy
```
Note the URL, e.g. `https://central-analytics-api.<your-sub>.workers.dev`. This is the single
`/api/track` target for **all** sites (data from every account pools into one dataset).

### Step 2 — Embed `analytics.js` on each site
Add one tag per site you want to measure (e.g. before `</head>`). The snippet is **zero-config**:
it derives the `/api/track` endpoint from its own origin and uses the page hostname as the
project, so a single line is all that's needed:
```html
<script src="https://central-analytics-api.<your-sub>.workers.dev/analytics.js" defer></script>
```
Optionally override grouping with `data-project="..."` and the target with `data-endpoint="..."`.
The backend resolves the tracked hostname → its project/account, so the dashboard filters work.

---

### Step 3 — Verify the embed is collecting data
1. Open a tracked site → **View page source** → the `<script .../analytics.js>` tag is present.
2. In DevTools → Network, a `POST /api/track` returning **204** fires on navigation.
3. Browse a couple of pages, wait **~2–3 min** (AE ingestion is async), then open the dashboard →
   **Journey / Sessions / Visited Pages / Navigation / Visitors** to see real rows. Filter by
   Project (hostname) to confirm resolution; click a Visitor for their individual journey.

---

## 4. Pages and Worker-served sites — same embed, placed differently

There is no edge auto-injector (a Worker route can't attach to a hostname already served by
Pages or another Worker's custom domain). For every project you own, add the **same one-line
`<script>`** from Step 2 — only *where* you put it differs:

| Type | Where to add the tag |
|---|---|
| **Static / HTML** | Directly in the shared HTML head (or the template that renders every page). |
| **React / SPA** | In `index.html` (the app shell) — one place covers all routes. |
| **Worker-served pages** | In the server-rendered layout/template function (one insertion covers all dynamic pages). |
| **Pages projects** | In the project's HTML shell, or a Pages Functions `onRequest` that appends the tag to `text/html` responses. |

This is exactly how `xixvideohub.com` (a Worker) was instrumented: one `<script>` line added to
its shared `layout()` + static HTML heads. API / non-HTML / error responses are never touched —
the tag only runs inside real browser pages.

> Note: the dashboard groups by the tracked hostname (`location.hostname`), so a project's custom
> domain must be the hostname visitors actually load for its rows to match.

---

## 5. Content-Security-Policy (CSP) — only relevant if a site sends one

The snippet is an **external** `<script src="https://<worker>/analytics.js">`, not an inline
script, so a CSP that only blocks `unsafe-inline` does **not** stop it. It is blocked only when
the site's CSP restricts `script-src`/`connect-src` to specific origins. In that case allowlist
the Worker origin in **both**:

```
script-src  ... https://central-analytics-api.<your-sub>.workers.dev
connect-src ... https://central-analytics-api.<your-sub>.workers.dev
```

Probe a site's current header before assuming (a CSP can change anytime):
```bash
curl -sI https://<site>/ | grep -i content-security-policy || echo "(no CSP header)"
```
No CSP header (most of these sites) → nothing to do; the tag loads and posts freely.

---

## 6. Troubleshooting — "no data after the test curl" (correct order)

Do **not** conclude "the token is missing an Analytics Engine scope" — that scope doesn't exist.
Diagnose in this order:

1. **Check the curl response code.**
   - `204` = **accepted for ingestion** (validated + submitted to AE; ingestion is async, so
     it is not yet a guarantee the row is queryable) → allow ~1–2 min; if still missing, check
     the read side (continue to 2-4).
   - `400` = unknown event / missing `v`/`s` ids / missing `domain` / invalid `ts` / invalid JSON.
   - `403` = origin not in `ALLOWED_ORIGINS`. `413` = payload too large. `429` = rate limited.
   - `500` = **server/configuration error**. Inspect the Worker logs and verify the Analytics
     Engine binding, the dataset name, and other server-side config — do **not** assume every
     500 is a missing binding. Fix the actual reported error first.
2. **Confirm `CF_API_TOKEN` + `CF_ACCOUNT_ID`** are set with **no stray whitespace/newlines**
   (local `.dev.vars`, prod `wrangler secret put`). A malformed value makes reads return `null`
   → the UI shows "Not available".
3. **Confirm binding + dataset names match the code exactly.** `wrangler.toml` uses
   `binding = "AE"` and `dataset = "user_journey"`; `src/analytics-engine.js` must
   reference the same dataset. A mismatch means writes and reads hit different places silently.
4. **Confirm the dashboard SQL uses the same dataset name.** A typo yields empty results with
   no error ("Not available"), never a fake number.

> Local `wrangler dev` **without `--remote`** buffers AE writes inside miniflare — they are **not**
> queryable via the hosted SQL API. Use `wrangler dev --remote` (or a deploy) for the round-trip.

---

## 7. Data-accuracy note

Every AE read is guarded: a failed or unsupported query returns `null`, so the UI shows
"Not available" — the dashboard **never fabricates** journey numbers. `uniqueVisitors` /
`sessions` / `pageViews` here come from **our own tracked events**, and are kept separate from
Cloudflare-native request counts.
