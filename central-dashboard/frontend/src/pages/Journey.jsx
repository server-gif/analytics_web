import React from "react";
import { api } from "../api/client.js";
import { useApi } from "../lib/useApi.js";
import { useFilters } from "../components/Layout.jsx";
import StatCard from "../components/StatCard.jsx";
import DataTable from "../components/DataTable.jsx";
import PageHeader from "../components/PageHeader.jsx";
import { ErrorState, Empty } from "../components/StateViews.jsx";
import { PageSkeleton } from "../components/Skeleton.jsx";

function fmtSec(s) {
  if (s == null) return "Not available";
  const n = Math.round(s);
  if (n < 60) return `${n}s`;
  return `${Math.floor(n / 60)}m ${n % 60}s`;
}

// Custom-tracked (Analytics Engine) overview. Kept clearly separate from
// Cloudflare-native request/bandwidth numbers - these are real visitor actions.
export default function Journey() {
  const f = useFilters();
  const deps = [f.account, f.project, f.domain, f.preset, f.from, f.to, f.visitor, f.session, f.path];
  const params = { account: f.account, project: f.project, domain: f.domain, preset: f.preset, from: f.from, to: f.to, visitor: f.visitor, session: f.session, path: f.path };

  const ov = useApi(() => api.journey(params), deps);
  const ee = useApi(() => api.entryExit(params), deps);

  if (ov.loading) return <PageSkeleton variant="dashboard" />;
  if (ov.error) return <ErrorState message={ov.error} />;
  const d = ov.data || {};

  return (
    <>
      <PageHeader
        title="User Journey"
        badge="custom tracked"
        items={[
          "Measured by the analytics.js script via Workers Analytics Engine - real visitor actions, NOT Cloudflare request counts.",
          "Unique Visitors = distinct anonymous browser/device IDs; Sessions = grouped visits (a new one starts after 30 min idle); Page Views = page_view events.",
          "Avg Active Time/Page counts only time the tab was visible; Pages/Session = page views ÷ sessions; Bounce Rate = single-page sessions.",
          "Scope follows the filter bar (Account, Project, Domain). All times shown in India Standard Time (IST).",
          "Rolling 30-day window - tracked events older than that are outside the query range.",
        ]}
      />
      <p className="foot" style={{ marginTop: "-8px", marginBottom: 18 }}>
        Visitors, sessions &amp; time measured by the <code>analytics.js</code> script via Workers Analytics Engine.
        These are real user actions - not the same as Cloudflare request counts. <strong>Rolling 30-day window.</strong>
      </p>

      {d.available === false ? (
        <Empty text="No tracked events yet. Install analytics.js on a site and complete Phase 0/1 verification, then data appears here." />
      ) : (
        <div className="stats">
          <StatCard metric={{ available: d.uniqueVisitors != null, label: "Unique Visitors", value: d.uniqueVisitors }} hint="Distinct anonymous visitor IDs that viewed a page in the window." />
          <StatCard metric={{ available: d.sessions != null, label: "Sessions", value: d.sessions }} hint="Grouped visits. A new session starts after 30 minutes of inactivity." />
          <StatCard metric={{ available: d.pageViews != null, label: "Page Views", value: d.pageViews }} hint="Total page_view events recorded." />
          <StatCard metric={{ available: d.avgTimeOnPage != null, label: "Avg Active Time / Page" }} valueLabel={fmtSec(d.avgTimeOnPage)} hint="Average visible (tab-focused) time per page. Idle/hidden time is excluded." />
          <StatCard metric={{ available: d.pagesPerSession != null, label: "Pages / Session" }} valueLabel={d.pagesPerSession != null ? d.pagesPerSession.toFixed(2) : "Not available"} hint="Page views divided by sessions." />
          <StatCard metric={{ available: d.bounceRate != null, label: "Bounce Rate" }} valueLabel={d.bounceRate != null ? `${d.bounceRate.toFixed(0)}%` : "Not available"} hint="Share of sessions that viewed only one page." />
        </div>
      )}

      <div className="twocol">
        <div className="card">
          <h3>Entry pages <span className="sub">first page of a session</span></h3>
          {ee.loading ? <p className="state loading">Loading…</p> : ee.error ? <ErrorState message={ee.error} /> : (
            <DataTable
              columns={[
                { key: "path", label: "Path" },
                { key: "count", label: "Sessions", align: "right" },
              ]}
              rows={ee.data?.entry || []}
            />
          )}
        </div>
        <div className="card">
          <h3>Exit pages <span className="sub">last page of a session</span></h3>
          {ee.loading ? <p className="state loading">Loading…</p> : ee.error ? <ErrorState message={ee.error} /> : (
            <DataTable
              columns={[
                { key: "path", label: "Path" },
                { key: "count", label: "Sessions", align: "right" },
              ]}
              rows={ee.data?.exit || []}
            />
          )}
        </div>
      </div>
    </>
  );
}
