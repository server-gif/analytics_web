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

// Session list + drill-down timeline (custom-tracked via Analytics Engine).
export default function Sessions() {
  const f = useFilters();
  const deps = [f.account, f.project, f.domain, f.preset, f.from, f.to, f.visitor, f.session, f.path, f.event];
  const params = { account: f.account, project: f.project, domain: f.domain, preset: f.preset, from: f.from, to: f.to, visitor: f.visitor, session: f.session, path: f.path, event: f.event };

  const [sel, setSel] = useState(null);
  const list = useApi(() => api.sessions(params), deps);
  const detail = useApi(
    () => (sel ? api.sessionDetail({ ...params, id: sel }) : Promise.resolve(null)),
    [sel, ...deps],
    { live: !!sel }
  );

  if (list.loading) return <PageSkeleton variant="table" cols={6} rows={8} />;
  if (list.error) return <ErrorState message={list.error} />;
  const rows = list.data?.rows;

  return (
    <>
      <PageHeader
        title="Sessions"
        badge="custom tracked"
        items={[
          "Each row is one visit, custom-tracked by analytics.js via Workers Analytics Engine (not Cloudflare request counts).",
          "Started/Ended come from activity plus a 30-minute inactivity timeout - Cloudflare has no exact 'exit' event, so the end is the last activity.",
          "Pages = page_view count; Duration = sum of active (tab-visible) time, not wall-clock.",
          "Click a session to open its event timeline. Scope follows the filter bar (Account, Project, Domain). Times shown in IST.",
          "Rolling 30-day window.",
        ]}
      />
      <p className="foot" style={{ marginTop: "-8px", marginBottom: 18 }}>Session start/end derived from activity + the 30-min inactivity timeout (not a client exit event). Rolling 30-day window. Click a row for the timeline.</p>
      {rows == null ? (
        <Empty text="Session data unavailable right now (Analytics Engine query failed or not verified yet)." />
      ) : (
        <DataTable
          rows={rows}
          rowKey={(r) => r.sessionId}
          onRowClick={(r) => setSel(r.sessionId)}
          isSelected={(r) => r.sessionId === sel}
          emptyText="No tracked sessions yet. Install analytics.js and complete Phase 0/1."
          columns={[
            { key: "startedAt", label: "Started", hint: "First activity of the session (IST).", render: (r) => fmtDate(r.startedAt) },
            { key: "country", label: "Country", render: (r) => r.country || "—" },
            { key: "domain", label: "Domain", render: (r) => r.domain || "—" },
            { key: "pageViews", label: "Pages", align: "right", hint: "Number of page_view events in the session.", render: (r) => fmtNumber(r.pageViews) },
            { key: "seconds", label: "Duration", align: "right", hint: "Total active (tab-visible) time; not wall-clock.", render: (r) => fmtSec(r.seconds) },
            { key: "sessionId", label: "Session", render: (r) => <code>{String(r.sessionId).slice(0, 8)}</code> },
          ]}
        />
      )}

      {sel && (
        <div className="card" style={{ marginTop: 20 }}>
          <h3>
            Session timeline <span className="sub"><code>{String(sel).slice(0, 12)}</code></span>
            <button className="chip more" style={{ marginLeft: 12 }} onClick={() => setSel(null)}>close</button>
          </h3>
          {detail.loading ? <p className="state loading">Loading…</p> : detail.error ? <ErrorState message={detail.error} /> : (
            !detail.data?.available ? <Empty text="Session detail unavailable (query failed or not verified yet)." /> : (
              <DataTable
                rows={detail.data.rows || []}
                emptyText="No events for this session."
                columns={[
                  { key: "timestamp", label: "Time", render: (e) => fmtDate(e.timestamp) },
                  { key: "event", label: "Event", render: (e) => <span className="badge">{e.event}</span> },
                  { key: "path", label: "Path", render: (e) => e.path || "—" },
                  { key: "duration", label: "Active time", align: "right", render: (e) => (e.duration ? fmtSec(e.duration) : "—") },
                ]}
              />
            )
          )}
        </div>
      )}
    </>
  );
}
