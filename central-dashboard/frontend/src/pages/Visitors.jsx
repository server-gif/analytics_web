import React, { useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../lib/useApi.js";
import { useFilters } from "../components/Layout.jsx";
import DataTable from "../components/DataTable.jsx";
import PageHeader from "../components/PageHeader.jsx";
import { ErrorState, Empty } from "../components/StateViews.jsx";
import { PageSkeleton } from "../components/Skeleton.jsx";
import { UserCell, TravelPath, deviceLabel } from "../components/JourneyBits.jsx";
import { fmtNumber, fmtDate } from "../lib/format.js";

function fmtSec(s) {
  if (s == null) return "—";
  const n = Math.round(s);
  if (n < 60) return `${n}s`;
  if (n < 3600) return `${Math.floor(n / 60)}m ${n % 60}s`;
  return `${Math.floor(n / 3600)}h ${Math.floor((n % 3600) / 60)}m`;
}

// USER-WISE view: one row per unique visitor (anonymous browser/device), with
// what they used, how much they read, and an expandable "which pages did they
// travel" path per visit. Data is custom-tracked by analytics.js via Workers
// Analytics Engine - no personal data or names are stored.
export default function Visitors() {
  const f = useFilters();
  const deps = [f.account, f.project, f.domain, f.preset, f.from, f.to];
  const params = { account: f.account, project: f.project, domain: f.domain, preset: f.preset, from: f.from, to: f.to };

  const [sel, setSel] = useState(null);
  const [showRaw, setShowRaw] = useState({}); // per-session toggle for the raw event table
  const list = useApi(() => api.visitors(params), deps);
  const detail = useApi(
    () => (sel ? api.visitorDetail({ ...params, id: sel }) : Promise.resolve(null)),
    [sel, ...deps],
    { live: !!sel }
  );

  if (list.loading) return <PageSkeleton variant="table" cols={6} rows={8} />;
  if (list.error) return <ErrorState message={list.error} />;
  const rows = list.data?.rows;

  // group the selected visitor's ordered events into sessions (first-seen order)
  const groups = [];
  const byId = new Map();
  for (const e of detail.data?.rows || []) {
    if (!byId.has(e.sessionId)) {
      const g = { sessionId: e.sessionId, rows: [] };
      byId.set(e.sessionId, g);
      groups.push(g);
    }
    byId.get(e.sessionId).rows.push(e);
  }
  // per-session summary numbers (pages + active time) for the group headers
  const groupSummary = groups.map((g) => {
    const pages = g.rows.filter((e) => e.event === "page_view").length;
    const seconds = g.rows.reduce((s, e) => s + (e.event === "page_duration" ? e.duration || 0 : 0), 0);
    return { pages, seconds: seconds || null };
  });

  return (
    <>
      <PageHeader
        title="Visitors"
        badge="custom tracked"
        items={[
          "USER-WISE data: one row per unique visitor. A 'unique user' here = one anonymous browser/device ID (stored by analytics.js in that browser's localStorage). The SAME person on two devices/Two browsers = two unique visitors - this is honest anonymous counting, not identity tracking.",
          "Device column (Chrome · Windows · Desktop …) is parsed server-side from the browser's User-Agent at event time. Rows tracked BEFORE the updated snippet was installed show '—' until that visitor generates a new event.",
          "Sessions = grouped visits (a new one starts after 30 min idle); Page views = page_view events; Total active = sum of visible-tab time on pages (background time excluded); Last seen = most recent activity (IST).",
          "Sorted by NEWEST activity first (Last seen): when a user generates a new event during Live refresh, they jump to the top of the list.",
          "Click a visitor to expand their journeys: each visit shows the EXACT page-to-page travel path - order of pages + active time on each - answering 'which pages did this user travel and how'.",
          "Scope follows the filter bar (Account, Project, Domain). Rolling 30-day window. No personal data or names are stored anywhere.",
        ]}
      />
      <p className="foot" style={{ marginTop: "-8px", marginBottom: 18 }}>
        One row per <strong>unique visitor</strong> (anonymous browser/device). Click a row to see the pages they travelled, visit by visit. Rolling 30-day window.
      </p>

      {rows == null ? (
        <Empty text="Visitor data unavailable right now (Analytics Engine query failed or not verified yet)." />
      ) : (
        <DataTable
          rows={rows}
          rowKey={(r) => r.visitorId}
          onRowClick={(r) => setSel(r.visitorId === sel ? null : r.visitorId)}
          isSelected={(r) => r.visitorId === sel}
          emptyText="No tracked visitors yet. Install the updated analytics.js and complete Phase 0/1."
          columns={[
            {
              key: "visitorId", label: "User", hint: "Anonymous browser/device ID - the dashboard's 'unique user' unit. Hover to see the full ID.",
              render: (r) => <UserCell id={String(r.visitorId).slice(0, 8)} full={r.visitorId} />,
            },
            { key: "country", label: "Country", render: (r) => r.country || "—" },
            {
              key: "device", label: "Device / browser", hint: "Browser · OS (+ device type when not Desktop), parsed server-side from the visitor's User-Agent. '—' = tracked before this field existed.",
              render: (r) => deviceLabel(r) || "—",
            },
            { key: "domain", label: "Domain", render: (r) => r.domain || "—" },
            { key: "sessions", label: "Visits", align: "right", hint: "Number of separate visits (sessions) in the window.", render: (r) => fmtNumber(r.sessions) },
            { key: "pageViews", label: "Page views", align: "right", hint: "Total pages this user viewed across all visits.", render: (r) => fmtNumber(r.pageViews) },
            { key: "seconds", label: "Total active", align: "right", hint: "Sum of visible (tab-focused) time across all pages. Background/idle time is excluded.", render: (r) => fmtSec(r.seconds) },
            { key: "lastSeen", label: "Last seen", hint: "Most recent activity time (IST).", render: (r) => fmtDate(r.lastSeen) },
          ]}
        />
      )}

      {sel && (
        <div className="card" style={{ marginTop: 20 }}>
          <h3>
            User journey <span className="sub"><UserCell id={String(sel).slice(0, 8)} full={sel} /></span>
            <button className="chip more" style={{ marginLeft: 12 }} onClick={() => setSel(null)}>close</button>
          </h3>
          {detail.loading ? <p className="state loading">Loading…</p> : detail.error ? <ErrorState message={detail.error} /> : (
            !detail.data?.available ? <Empty text="Visitor detail unavailable (query failed or not verified yet)." /> :
            !groups.length ? <Empty text="No events for this visitor." /> : (
              <p className="foot" style={{ marginTop: 0 }}>
                {groups.length} visit{groups.length > 1 ? "s" : ""} · travel path per visit (page order + active time on each page):
              </p>
            )
          )}
          {groups.map((g, i) => {
            const rawOn = !!showRaw[g.sessionId];
            const sum = groupSummary[i];
            return (
              <div key={g.sessionId} style={{ marginTop: i ? 16 : 0 }}>
                <h4 style={{ margin: "6px 0" }}>
                  Visit {i + 1}
                  <span className="sub" style={{ marginLeft: 8 }}>
                    <code>{String(g.sessionId).slice(0, 10)}</code>
                    {" · "}{sum.pages} page{sum.pages === 1 ? "" : "s"}
                    {sum.seconds != null ? ` · ${fmtSec(sum.seconds)} active` : ""}
                  </span>
                  <button
                    className="chip more" style={{ marginLeft: 10 }}
                    onClick={() => setShowRaw((m) => ({ ...m, [g.sessionId]: !rawOn }))}
                    title="Show every raw tracked event (page views, durations, heartbeats) instead of only the travel path"
                  >
                    {rawOn ? "hide raw events" : "show raw events"}
                  </button>
                </h4>
                {detail.loading || detail.error ? null : rawOn ? (
                  <DataTable
                    rows={g.rows}
                    pageSize={0}
                    columns={[
                      { key: "timestamp", label: "Time", render: (e) => fmtDate(e.timestamp) },
                      { key: "event", label: "Event", hint: "page_view = opened a page; page_duration = active time on it; navigation = in-page route change; session_activity = 30s 'still here' heartbeat.", render: (e) => <span className="badge">{e.event}</span> },
                      { key: "path", label: "Path", render: (e) => e.path || "—" },
                      { key: "duration", label: "Active time", align: "right", render: (e) => (e.duration ? fmtSec(e.duration) : "—") },
                    ]}
                  />
                ) : (
                  <TravelPath rows={g.rows} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
