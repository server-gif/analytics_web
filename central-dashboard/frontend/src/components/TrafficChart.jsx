import React from "react";
import {
  ResponsiveContainer, ComposedChart, Line, XAxis, YAxis, Tooltip,
  CartesianGrid, Legend,
} from "recharts";
import { fmtBytes, fmtNumber, fmtDate } from "../lib/format.js";
import { Empty } from "./StateViews.jsx";
import ChartTooltip from "./ChartTooltip.jsx";

// Requests ane Bandwidth hamesha veglla axis/series rite dekhay (accuracy rule).
export default function TrafficChart({ series = [] }) {
  if (!series.length) return <Empty text="No time-series data from Cloudflare." />;

  const data = series.map((s) => ({
    t: s.t,
    requests: s.requests,
    bandwidthMB: s.bandwidthBytes != null ? s.bandwidthBytes / (1024 * 1024) : null,
  }));

  return (
    <div style={{ width: "100%", height: 320 }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid stroke="#241d38" />
          <XAxis dataKey="t" tickFormatter={fmtDate} stroke="#8d87a6" minTickGap={40} />
          <YAxis yAxisId="left" stroke="#b9a4f7" tickFormatter={(v) => fmtNumber(v)} />
          <YAxis yAxisId="right" orientation="right" stroke="#38bdf8" tickFormatter={(v) => `${v} MB`} />
          <Tooltip
            cursor={{ stroke: "#4a3f6b", strokeWidth: 1 }}
            content={(
              <ChartTooltip
                valueFormatter={(value, name) =>
                  name === "Bandwidth (MB)"
                    ? [`${Number(value).toFixed(2)} MB`, name]
                    : [fmtNumber(value), name]
                }
              />
            )}
          />
          <Legend />
          <Line yAxisId="left" type="monotone" dataKey="requests" name="Requests" stroke="#b9a4f7" dot={false} strokeWidth={2} />
          <Line yAxisId="right" type="monotone" dataKey="bandwidthMB" name="Bandwidth (MB)" stroke="#38bdf8" dot={false} strokeWidth={2} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
