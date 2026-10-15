import React from "react";
import { api } from "../api/client.js";
import { useApi } from "../lib/useApi.js";
import { useFilters } from "../components/Layout.jsx";
import StatCard from "../components/StatCard.jsx";
import TrafficChart from "../components/TrafficChart.jsx";
import CountryList from "../components/CountryList.jsx";
import PageHeader from "../components/PageHeader.jsx";
import { ErrorState, NotAvailable } from "../components/StateViews.jsx";
import { PageSkeleton, SkeletonTable, Sk } from "../components/Skeleton.jsx";
import { fmtBytes, fmtNumber } from "../lib/format.js";

export default function Dashboard() {
  const f = useFilters();
  const params = { account: f.account, project: f.project, domain: f.domain, preset: f.preset, from: f.from, to: f.to };

  const ov = useApi(() => api.overview(params), [f.account, f.project, f.domain, f.preset, f.from, f.to]);
  const tr = useApi(() => api.traffic(params), [f.account, f.project, f.domain, f.preset, f.from, f.to]);
  const co = useApi(() => api.countries(params), [f.account, f.project, f.domain, f.preset, f.from, f.to]);

  if (ov.loading) return <PageSkeleton variant="dashboard" />;
  if (ov.error) return <ErrorState message={ov.error} />;
  const d = ov.data;

  return (
    <>
      <PageHeader
        title="Central Cloudflare Analytics"
        items={[
          "Requests and Bandwidth are Cloudflare-native numbers for the current filter selection (Account / Project / Domain / date).",
          "Total Domains / Projects count what the selected account exposes; they do NOT change with the date range.",
          "Error Requests = HTTP 4xx+5xx across the selected zones. Unique Users is Not available - Cloudflare counts requests, not people.",
          "Traffic chart plots Requests (left axis) and Bandwidth (right axis, MB) over time. Times are shown in India Standard Time (IST).",
        ]}
      />

      <div className="stats">
        <StatCard metric={d.totals.requests} hint="Total HTTP requests Cloudflare served for the current selection." />
        <StatCard metric={d.totals.bandwidth} hint="Total response bytes served (Cloudflare-native)." />
        <StatCard metric={{ available: true, label: "Total Domains" }} valueLabel={fmtNumber(d.counts.domains)} hint="Domains (apex + discovered subdomains) available for the current account selection." />
        <StatCard metric={{ available: true, label: "Total Projects" }} valueLabel={fmtNumber(d.counts.projects)} hint="Zones + Pages projects available for the current account (Workers excluded)." />
        <StatCard metric={d.errorRequests} hint="HTTP 4xx + 5xx responses in the selected period." />
        <StatCard metric={d.uniqueUsers} hint="Cloudflare reports requests, not unique visitors - so this is intentionally Not available." />
      </div>

      <div className="card">
        <h3>Traffic over time <span className="sub">Requests (left axis) · Bandwidth (right axis, MB)</span></h3>
        {tr.loading ? <Sk h={260} r={10} style={{ marginTop: 14 }} /> : tr.error ? <ErrorState message={tr.error} /> : <TrafficChart series={tr.data?.series || []} />}
      </div>

      <div className="twocol">
        <div className="card">
          <h3>Countries <span className="sub">by requests</span></h3>
          {co.loading ? <SkeletonTable rows={6} cols={2} /> : co.error ? <ErrorState message={co.error} /> : (
            <CountryList rows={co.data?.rows || []} />
          )}
          <p className="foot">Cities: <NotAvailable note={co.data?.cities?.note} /></p>
        </div>

        <div className="card">
          <h3>Domains</h3>
          <p className="foot">
            Per-domain Requests/Bandwidth dekhva mate upaar aa domain select karo.
            (Dashboard aggregated numbers current selection na che.)
          </p>
          <p className="foot">Unique users Not available che - Cloudflare requests aape, users nahi.</p>
        </div>
      </div>
    </>
  );
}
