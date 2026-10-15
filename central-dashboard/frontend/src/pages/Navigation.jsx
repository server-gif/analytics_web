import React from "react";
import { api } from "../api/client.js";
import { useApi } from "../lib/useApi.js";
import { useFilters } from "../components/Layout.jsx";
import DataTable from "../components/DataTable.jsx";
import PageHeader from "../components/PageHeader.jsx";
import { ErrorState, Empty } from "../components/StateViews.jsx";
import { PageSkeleton } from "../components/Skeleton.jsx";
import { fmtNumber } from "../lib/format.js";

// Page -> page transitions, from custom-tracked navigation events.
export default function Navigation() {
  const f = useFilters();
  const deps = [f.account, f.project, f.domain, f.preset, f.from, f.to, f.visitor, f.session, f.path, f.event];
  const params = { account: f.account, project: f.project, domain: f.domain, preset: f.preset, from: f.from, to: f.to, visitor: f.visitor, session: f.session, path: f.path, event: f.event };
  const { data, loading, error } = useApi(() => api.navigation(params), deps);

  if (loading) return <PageSkeleton variant="table" cols={3} rows={9} />;
  if (error) return <ErrorState message={error} />;

  const rows = data?.rows;
  return (
    <>
      <PageHeader
        title="Navigation Flow"
        badge="custom tracked"
        items={[
          "Page-to-page transitions derived from page-view referrers: the page a visitor came FROM -> the page they landed ON. Works for both traditional multi-page sites and SPAs.",
          "From = previous page; To = current page; Transitions = how often that step happened in the window. Same-page reloads are excluded.",
          "Scope follows the filter bar (Account, Project, Domain). Rolling 30-day window.",
        ]}
      />
      <p className="foot" style={{ marginTop: "-8px", marginBottom: 18 }}>
        Rolling 30-day window. Click-through counts between pages within a visit.
      </p>
      {rows == null ? (
        <Empty text="Navigation data unavailable right now (Analytics Engine query failed or not verified yet)." />
      ) : !rows.length ? (
        <Empty text="No page-to-page transitions yet - a visitor needs at least two page views in one visit." />
      ) : (
        <DataTable
          columns={[
            { key: "referrer", label: "From (previous page)" },
            { key: "path", label: "To (page)" },
            { key: "transitions", label: "Transitions", align: "right", hint: "How many times users went From -> To in the window.", render: (r) => fmtNumber(r.transitions) },
          ]}
          rows={rows}
        />
      )}
      <p className="foot">Derived from page-view referrers (previous page → current page), so it works for multi-page and single-page sites.</p>
    </>
  );
}
