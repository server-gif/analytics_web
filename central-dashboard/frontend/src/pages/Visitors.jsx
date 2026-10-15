import React, { useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../lib/useApi.js";
import { useFilters } from "../components/Layout.jsx";
import DataTable from "../components/DataTable.jsx";
import PageHeader from "../components/PageHeader.jsx";
import { ErrorState, Empty } from "../components/StateViews.jsx";
import { PageSkeleton } from "../components/Skeleton.jsx";
import { fmtNumber, fmtDate } from "../lib/format.js";

function fmtSec(s) {
  if (s == null) return "—";
  const n = Math.round(s);
  return n < 60 ? `${n}s` : `${Math.floor(n / 60)}m ${n % 60}s`;
}

// Individual visitor journeys (custom-tracked via Analytics Engine). Anonymous
// visitor IDs only; each visitor's events are grouped into their sessions.
export default function Visitors() {
  const f = useFilters();
  const deps = [f.account, f.project, f.domain, f.preset, f.from, f.to];
  const params = { account: f.account, project: f.project, domain: f.domain, preset: f.preset, from: f.from, to: f.to };

  const [sel, setSel] = useState(null);
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

  return (
    <>
      <PageHeader
        title="Visitors"
        badge="custom tracked"
        items={[
          "One row per anonymous visitor (a browser/device), custom-tracked by analytics.js via Workers Analytics Engine. No personal data or names are stored.",
          "Sessions = grouped visits (new one after 30 min idle); Page views = page_view events; Last seen = most recent activity (IST).",
          "Click a visitor to expand their full journey, grouped session by session. Scope follows the filter bar (Account, Project, Domain).",
          "Rolling 30-day window.",
        ]}
      />
      <p className="foot" style={{ marginTop: "-8px", marginBottom: 18 }}>
        Anonymous visitor IDs (browser/device), grouped into sessions. No personal data. Rolling 30-day window.
      </p>

      {rows == null ? (
        <Empty text="Visitor data unavailable right now (Analytics Engine query failed or not verified yet)." />
      ) : (
        <DataTable
          rows={rows}
          rowKey={(r) => r.visitorId}
          onRowClick={(r) => setSel(r.visitorId)}
          isSelected={(r) => r.visitorId === sel}
          emptyText="No tracked visitors yet. Install analytics.js and complete Phase 0/1."
          columns={[
            { key: "visitorId", label: "Visitor", hint: "Anonymous browser/device ID (first characters shown).", render: (r) => <code>{String(r.visitorId).slice(0, 10)}</code> },
            { key: "country", label: "Country", render: (r) => r.country || "—" },
            { key: "domain", label: "Domain", render: (r) => r.domain || "—" },
            { key: "sessions", label: "Sessions", align: "right", hint: "Number of separate visits in the window.", render: (r) => fmtNumber(r.sessions) },
            { key: "pageViews", label: "Page views", align: "right", render: (r) => fmtNumber(r.pageViews) },
            { key: "lastSeen", label: "Last seen", hint: "Most recent activity time (IST).", render: (r) => fmtDate(r.lastSeen) },
          ]}
        />
      )}

      {sel && (
        <div className="card" style={{ marginTop: 20 }}>
          <h3>
            Visitor journey <span className="sub"><code>{String(sel).slice(0, 14)}</code></span>
            <button className="chip more" style={{ marginLeft: 12 }} onClick={() => setSel(null)}>close</button>
          </h3>
          {detail.loading ? <p className="state loading">Loading…</p> : detail.error ? <ErrorState message={detail.error} /> : (
            !detail.data?.available ? <Empty text="Visitor detail unavailable (query failed or not verified yet)." /> :
            !groups.length ? <Empty text="No events for this visitor." /> : groups.map((g, i) => (
              <div key={g.sessionId} style={{ marginTop: i ? 16 : 0 }}>
                <h4 style={{ margin: "6px 0" }}>
                  Session {i + 1} <span className="sub"><code>{String(g.sessionId).slice(0, 10)}</code></span>
                </h4>
                <DataTable
                  rows={g.rows}
                  columns={[
                    { key: "timestamp", label: "Time", render: (e) => fmtDate(e.timestamp) },
                    { key: "event", label: "Event", render: (e) => <span className="badge">{e.event}</span> },
                    { key: "path", label: "Path", render: (e) => e.path || "—" },
                    { key: "duration", label: "Active time", align: "right", render: (e) => (e.duration ? fmtSec(e.duration) : "—") },
                  ]}
                />
              </div>
            ))
          )}
        </div>
      )}
    </>
  );
}
