import React, { useMemo, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../lib/useApi.js";
import { useFilters } from "../components/Layout.jsx";
import DataTable from "../components/DataTable.jsx";
import StatCard from "../components/StatCard.jsx";
import PageHeader from "../components/PageHeader.jsx";
import { ErrorState, Empty } from "../components/StateViews.jsx";
import { PageSkeleton } from "../components/Skeleton.jsx";
import { UserCell, TravelPath, deviceLabel, buildUserView, fmtDuration } from "../components/JourneyBits.jsx";
import { fmtNumber, fmtDate } from "../lib/format.js";

// USERS section: one row per UNIQUE user; click a user to open their FULL
// profile - the projects/domains they touched, the time they spent on EACH
// page, every page they visited, and their page-to-page path per visit.
// All data is custom-tracked (analytics.js -> Workers Analytics Engine):
// anonymous browser/device IDs, no personal data.
export default function Users() {
  const f = useFilters();
  const deps = [f.account, f.project, f.domain, f.preset, f.from, f.to];
  const params = { account: f.account, project: f.project, domain: f.domain, preset: f.preset, from: f.from, to: f.to };

  const [sel, setSel] = useState(null); // selected visitorId
  const [query, setQuery] = useState("");

  const list = useApi(() => api.visitors(params), deps);
  // The profile is fetched UNFILTERED (all projects/domains, last 30 days) so
  // "all details" are complete regardless of the filter bar that found the user.
  const detail = useApi(
    () => (sel ? api.visitorDetail({ id: sel, preset: "30d" }) : Promise.resolve(null)),
    [sel],
    { live: !!sel }
  );

  const rows = list.data?.rows;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!rows) return rows;
    if (!q) return rows;
    return rows.filter((r) =>
      [r.visitorId, r.country, r.domain, r.browser, r.os, r.device]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(q))
    );
  }, [rows, query]);

  const selRow = useMemo(() => (rows || []).find((r) => r.visitorId === sel) || null, [rows, sel]);
  const view = useMemo(() => (detail.data?.available ? buildUserView(detail.data.rows) : null), [detail.data]);

  // ---------- LIST (unique users) ----------
  if (!sel) {
    if (list.loading) return <PageSkeleton variant="table" cols={7} rows={9} />;
    if (list.error) return <ErrorState message={list.error} />;
    return (
      <>
        <PageHeader
          title="Users"
          badge="custom tracked"
          items={[
            "One row per UNIQUE user. A unique user = one anonymous browser/device ID that analytics.js stores in that browser's localStorage. The same person on two devices/browsers counts as two users (no identity tracking, no names, no cookies).",
            "Click any user to open their full profile: which projects & domains they visited, how much ACTIVE time they spent on each page, every page they saw, and their page-to-page travel path for each visit.",
            "Device / browser is parsed server-side from the visitor's User-Agent; rows tracked before that field existed show '—'. Total active = visible-tab time only (background/idle excluded).",
            "The list follows the filter bar (Account, Project, Domain, Date). Each profile, once opened, shows the user's complete 30-day history across ALL projects.",
            "Sorted by NEWEST activity first (Last seen): a user who just did something jumps to the top, and the order re-applies on every Live refresh.",
          ]}
        />
        <div className="usersearch">
          <input
            type="search"
            placeholder="Search by user ID, country, domain or device…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search users"
          />
          {query && <button type="button" className="chip more" onClick={() => setQuery("")}>clear</button>}
        </div>
        {rows == null ? (
          <Empty text="User data unavailable right now (Analytics Engine query failed or not verified yet)." />
        ) : (
          <DataTable
            rows={filtered}
            rowKey={(r) => r.visitorId}
            onRowClick={(r) => setSel(r.visitorId)}
            emptyText={query ? "No users match your search." : "No tracked users yet. Install analytics.js and complete Phase 0/1."}
            columns={[
              { key: "visitorId", label: "User", hint: "Anonymous browser/device ID = one unique user. Hover for the full ID; click the row to open their profile.", render: (r) => <UserCell id={String(r.visitorId).slice(0, 8)} full={r.visitorId} /> },
              { key: "country", label: "Country", render: (r) => r.country || "—" },
              { key: "device", label: "Device / browser", hint: "Browser · OS (+ device when not Desktop), parsed server-side from the User-Agent. '—' = tracked before this field existed.", render: (r) => deviceLabel(r) || "—" },
              { key: "domain", label: "Domain", render: (r) => r.domain || "—" },
              { key: "sessions", label: "Visits", align: "right", hint: "Separate visits in the window (a new one starts after 30 min idle).", render: (r) => fmtNumber(r.sessions) },
              { key: "pageViews", label: "Page views", align: "right", hint: "Total pages this user viewed.", render: (r) => fmtNumber(r.pageViews) },
              { key: "seconds", label: "Total active", align: "right", hint: "Sum of visible time across all their pages.", render: (r) => fmtDuration(r.seconds) },
              { key: "lastSeen", label: "Last seen", hint: "Most recent activity (IST).", render: (r) => fmtDate(r.lastSeen) },
              { key: "_open", label: "", align: "right", render: () => <span className="chip more">view profile ›</span> },
            ]}
          />
        )}
      </>
    );
  }

  // ---------- PROFILE (all details for one user) ----------
  const back = (
    <button type="button" className="backbtn" onClick={() => setSel(null)} title="Back to the user list">
      ‹ All users
    </button>
  );

  if (detail.loading && !view) {
    return (<>{back}<PageSkeleton variant="dashboard" /></>);
  }
  if (detail.error) return (<>{back}<ErrorState message={detail.error} /></>);
  if (!view) return (<>{back}<Empty text="No events found for this user in the last 30 days." /></>);

  const { kpis, pages, projects, visits } = view;
  const maxPageSeconds = Math.max(1, ...pages.map((p) => p.seconds || 0));
  const dev = selRow ? deviceLabel(selRow) : null;
  const countries = (selRow?.country ? [selRow.country] : kpis.countries).filter(Boolean);

  return (
    <>
      {back}
      <div className="profile-head card">
        <div className="profile-id">
          <UserCell id={String(sel).slice(0, 10)} full={sel} />
          <span className="profile-badge badge">unique user</span>
        </div>
        <div className="profile-meta">
          <span><b>Device / browser:</b> {dev || "— (tracked before UA field existed)"}</span>
          <span><b>Country:</b> {countries.join(", ") || "—"}</span>
          <span><b>Domains:</b> {kpis.domains.length ? kpis.domains.join(", ") : "—"}</span>
          <span><b>Projects:</b> {kpis.projects.length ? kpis.projects.join(", ") : "—"}</span>
          {selRow && <span><b>First seen:</b> {fmtDate(selRow.firstSeen)}</span>}
          {selRow && <span><b>Last seen:</b> {fmtDate(selRow.lastSeen)}</span>}
        </div>
        <p className="foot" style={{ marginTop: 8, marginBottom: 0 }}>
          Complete profile across ALL projects, rolling last 30 days. Times in IST. Active time counts only visible-tab seconds.
        </p>
      </div>

      <div className="stats">
        <StatCard metric={{ available: kpis.visits != null, label: "Visits", value: kpis.visits }} hint="Number of separate sessions (visits) this user made." />
        <StatCard metric={{ available: kpis.pageViews != null, label: "Page views", value: kpis.pageViews }} hint="Total pages opened across all visits." />
        <StatCard metric={{ available: kpis.pagesVisited != null, label: "Unique pages", value: kpis.pagesVisited }} hint="Distinct page paths this user saw." />
        <StatCard metric={{ available: kpis.totalSeconds != null, label: "Total active time" }} valueLabel={fmtDuration(kpis.totalSeconds)} hint="Sum of visible time on all pages (background/idle excluded)." />
        <StatCard metric={{ available: projects.length > 0, label: "Projects touched", value: projects.length }} hint="How many tracked projects this user visited." />
      </div>

      {/* Which page, how much time + which pages visited */}
      <div className="card">
        <h3>Pages visited <span className="sub">time spent on each page (longest first)</span></h3>
        {pages.length ? (
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Page (path)</th>
                  <th>Project / domain</th>
                  <th style={{ textAlign: "right" }}>Views</th>
                  <th style={{ textAlign: "right" }}>Active time</th>
                  <th className="timecol">Share of their time</th>
                </tr>
              </thead>
              <tbody>
                {pages.map((p) => (
                  <tr key={p.path}>
                    <td><code className="ppath">{p.path || "/"}</code></td>
                    <td className="pmeta">
                      {p.projects.length ? p.projects.join(", ") : "—"}
                      {p.domains.length ? <span className="pdom"> · {p.domains.join(", ")}</span> : null}
                    </td>
                    <td style={{ textAlign: "right" }}>{fmtNumber(p.views)}</td>
                    <td style={{ textAlign: "right" }}>{fmtDuration(p.seconds)}</td>
                    <td className="timecol">
                      {p.seconds != null ? (
                        <span className="timebar" title={`${Math.round((p.seconds / maxPageSeconds) * 100)}% of their busiest page`}>
                          <span className="timebar-fill" style={{ width: `${Math.max(2, (p.seconds / maxPageSeconds) * 100)}%` }} />
                        </span>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty text="No page views recorded for this user." />}
      </div>

      {/* Per-project breakdown */}
      {projects.length > 1 && (
        <div className="card">
          <h3>By project <span className="sub">where this user spent their time</span></h3>
          <DataTable
            rows={projects}
            rowKey={(r) => r.project}
            pageSize={0}
            columns={[
              { key: "project", label: "Project" },
              { key: "domains", label: "Domains", render: (r) => r.domains.join(", ") || "—" },
              { key: "pages", label: "Pages", align: "right", render: (r) => fmtNumber(r.pages) },
              { key: "views", label: "Page views", align: "right", render: (r) => fmtNumber(r.views) },
              { key: "seconds", label: "Active time", align: "right", render: (r) => fmtDuration(r.seconds) },
            ]}
          />
        </div>
      )}

      {/* Every visit, with the page-to-page travel path */}
      <div className="card">
        <h3>Visit-by-visit <span className="sub">{visits.length} visit{visits.length === 1 ? "" : "s"} · newest first · the exact path each time</span></h3>
        {visits.map((v, i) => (
          <VisitCard key={v.sessionId || i} visit={v} index={visits.length - i} />
        ))}
      </div>
    </>
  );
}

function VisitCard({ visit, index }) {
  const [raw, setRaw] = useState(false);
  return (
    <div className="visitcard">
      <h4 className="visithead">
        <span className="visitno">Visit {index}</span>
        <span className="sub">
          {fmtDate(visit.startedAt)}
          {" · "}{visit.pages} page{visit.pages === 1 ? "" : "s"}
          {visit.seconds != null ? ` · ${fmtDuration(visit.seconds)} active` : ""}
          {visit.domains.length ? ` · ${visit.domains.join(", ")}` : ""}
        </span>
        <button className="chip more" onClick={() => setRaw((x) => !x)} title="Toggle the readable path vs every raw tracked event">
          {raw ? "show path" : "show raw events"}
        </button>
      </h4>
      {raw ? (
        <DataTable
          rows={visit.rows}
          pageSize={0}
          columns={[
            { key: "timestamp", label: "Time", render: (e) => fmtDate(e.timestamp) },
            { key: "event", label: "Event", hint: "page_view = opened a page; page_duration = active time on it; navigation = in-page route change; session_activity = 30s 'still here' heartbeat.", render: (e) => <span className="badge">{e.event}</span> },
            { key: "path", label: "Path", render: (e) => e.path || "—" },
            { key: "project", label: "Project", render: (e) => e.project || "—" },
            { key: "duration", label: "Active time", align: "right", render: (e) => (e.duration ? fmtDuration(e.duration) : "—") },
          ]}
        />
      ) : (
        <TravelPath rows={visit.rows} max={60} />
      )}
    </div>
  );
}
