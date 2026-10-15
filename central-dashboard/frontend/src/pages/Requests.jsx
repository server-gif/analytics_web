import React from "react";
import { api } from "../api/client.js";
import { useApi } from "../lib/useApi.js";
import { useFilters } from "../components/Layout.jsx";
import TrafficChart from "../components/TrafficChart.jsx";
import PageHeader from "../components/PageHeader.jsx";
import { ErrorState } from "../components/StateViews.jsx";
import { PageSkeleton } from "../components/Skeleton.jsx";

// Requests page: time-series of REQUEST count (not bandwidth, not users).
export default function Requests() {
  const f = useFilters();
  const params = { account: f.account, project: f.project, domain: f.domain, preset: f.preset, from: f.from, to: f.to };
  const { data, loading, error } = useApi(() => api.traffic(params), [f.account, f.project, f.domain, f.preset, f.from, f.to]);
  if (loading) return <PageSkeleton variant="chart" />;
  if (error) return <ErrorState message={error} />;

  const series = (data?.series || []).map((s) => ({ t: s.t, requests: s.requests }));
  return (
    <>
      <PageHeader
        title="Requests over time"
        sub="count only"
        items={[
          "Cloudflare-native HTTP REQUEST count over time for the current filter selection.",
          "This is a count of requests only - it is not bandwidth (see Bandwidth page) and not unique users.",
          "Ranges wider than 3 days are automatically bucketed daily (Cloudflare hourly data caps at 3 days).",
        ]}
      />
      <div className="card">
        <RequestsOnlyChart series={series} />
      </div>
    </>
  );
}

import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { fmtNumber, fmtDate } from "../lib/format.js";
import ChartTooltip from "../components/ChartTooltip.jsx";
function RequestsOnlyChart({ series }) {
  if (!series.length) return <p className="foot">No request data.</p>;
  return (
    <div style={{ width: "100%", height: 320 }}>
      <ResponsiveContainer>
        <AreaChart data={series} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <defs>
            <linearGradient id="req" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#b9a4f7" stopOpacity={0.5} />
              <stop offset="100%" stopColor="#b9a4f7" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#241d38" />
          <XAxis dataKey="t" tickFormatter={fmtDate} stroke="#8d87a6" minTickGap={40} />
          <YAxis stroke="#b9a4f7" tickFormatter={(v) => fmtNumber(v)} />
          <Tooltip cursor={{ stroke: "#4a3f6b", strokeWidth: 1 }} content={<ChartTooltip valueFormatter={(v) => [fmtNumber(v), "Requests"]} />} />
          <Area type="monotone" dataKey="requests" stroke="#b9a4f7" fill="url(#req)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
