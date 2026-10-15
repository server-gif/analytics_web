import React from "react";
import { api } from "../api/client.js";
import { useApi } from "../lib/useApi.js";
import { useFilters } from "../components/Layout.jsx";
import DataTable from "../components/DataTable.jsx";
import PageHeader from "../components/PageHeader.jsx";
import { ErrorState, Empty } from "../components/StateViews.jsx";
import { PageSkeleton } from "../components/Skeleton.jsx";
import { fmtNumber } from "../lib/format.js";

function fmtSec(s) {
  if (s == null) return "—";
  const n = Math.round(s);
  return n < 60 ? `${n}s` : `${Math.floor(n / 60)}m ${n % 60}s`;
}

// Most-visited paths, from custom-tracked page_view / page_duration events.
export default function VisitedPages() {
  const f = useFilters();
  const deps = [f.account, f.project, f.domain, f.preset, f.from, f.to, f.visitor, f.session, f.path, f.event];
  const params = { account: f.account, project: f.project, domain: f.domain, preset: f.preset, from: f.from, to: f.to, visitor: f.visitor, session: f.session, path: f.path, event: f.event };
  const { data, loading, error } = useApi(() => api.journeyPages(params), deps);

  if (loading) return <PageSkeleton variant="table" cols={4} rows={9} />;
  if (error) return <ErrorState message={error} />;

  const rows = data?.rows;
  return (
    <>
      <PageHeader
        title="Visited Pages"
        badge="custom tracked"
        items={[
          "Most-visited paths from custom-tracked page_view events (Workers Analytics Engine), not Cloudflare request counts.",
          "Views = page_view events; Visitors = distinct visitor IDs that saw the path; Avg active = mean visible time on the page.",
          "Avg time counts only ACTIVE (tab-visible) time - background/idle time is excluded. Scope follows the filter bar; times in IST. Rolling 30-day window.",
        ]}
      />
      <p className="foot" style={{ marginTop: "-8px", marginBottom: 18 }}>
        Avg time counts only ACTIVE (tab-visible) time. Rolling 30-day window.
      </p>
      {rows == null ? (
        <Empty text="Page data unavailable right now (Analytics Engine query failed or not verified yet)." />
      ) : !rows.length ? (
        <Empty text="No tracked page views yet. Install analytics.js and complete Phase 0/1." />
      ) : (
        <DataTable
          columns={[
            { key: "path", label: "Path" },
            { key: "views", label: "Views", align: "right", hint: "Number of page_view events for this path.", render: (r) => fmtNumber(r.views) },
            { key: "visitors", label: "Visitors", align: "right", hint: "Distinct visitor IDs that viewed this path.", render: (r) => fmtNumber(r.visitors) },
            { key: "avgSeconds", label: "Avg active", align: "right", hint: "Mean visible (tab-focused) time per view.", render: (r) => fmtSec(r.avgSeconds) },
          ]}
          rows={rows}
        />
      )}
    </>
  );
}
