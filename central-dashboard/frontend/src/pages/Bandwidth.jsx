import React from "react";
import { api } from "../api/client.js";
import { useApi } from "../lib/useApi.js";
import { useFilters } from "../components/Layout.jsx";
import { ErrorState } from "../components/StateViews.jsx";
import { PageSkeleton } from "../components/Skeleton.jsx";
import PageHeader from "../components/PageHeader.jsx";
import { fmtNumber, fmtBytes, fmtDate } from "../lib/format.js";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import ChartTooltip from "../components/ChartTooltip.jsx";

// Bandwidth page: BYTES over time - clearly alag metric from requests.
export default function Bandwidth() {
  const f = useFilters();
  const params = { account: f.account, project: f.project, domain: f.domain, preset: f.preset, from: f.from, to: f.to };
  const { data, loading, error } = useApi(() => api.traffic(params), [f.account, f.project, f.domain, f.preset, f.from, f.to]);
  if (loading) return <PageSkeleton variant="chart" />;
  if (error) return <ErrorState message={error} />;

  const series = (data?.series || []).map((s) => ({
    t: s.t,
    mb: s.bandwidthBytes != null ? s.bandwidthBytes / (1024 * 1024) : null,
  }));

  return (
    <>
      <PageHeader
        title="Bandwidth over time"
        sub="bytes served (MB)"
        items={[
          "Cloudflare-native BYTES served over time (shown in MB) for the current filter selection.",
          "This is bandwidth, a different metric from request count (see Requests page).",
          "Ranges wider than 3 days are automatically bucketed daily.",
        ]}
      />
      <div className="card">
        {series.length ? (
          <div style={{ width: "100%", height: 320 }}>
            <ResponsiveContainer>
              <AreaChart data={series} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                <defs>
                  <linearGradient id="bw" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#38bdf8" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#241d38" />
                <XAxis dataKey="t" tickFormatter={fmtDate} stroke="#8d87a6" minTickGap={40} />
                <YAxis stroke="#38bdf8" tickFormatter={(v) => `${v} MB`} />
                <Tooltip cursor={{ stroke: "#4a3f6b", strokeWidth: 1 }} content={<ChartTooltip valueFormatter={(v) => [`${Number(v).toFixed(2)} MB`, "Bandwidth"]} />} />
                <Area type="monotone" dataKey="mb" stroke="#38bdf8" fill="url(#bw)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="foot">No bandwidth data from Cloudflare.</p>
        )}
      </div>
    </>
  );
}
