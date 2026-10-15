import React from "react";
import { fmtDate } from "../lib/format.js";

/**
 * Dark-themed recharts tooltip. The default <Tooltip> renders a white card that
 * clashes with the dashboard and shows the date label in near-invisible light
 * text. This renders the same info in a themed box: readable title, one row per
 * series with a color swatch, name and right-aligned value.
 *
 * Props passed by recharts: active, payload, label.
 * Optional: labelFormatter(label) -> string, valueFormatter(value, name, item)
 * -> [displayValue, displayName].
 */
export default function ChartTooltip({ active, payload, label, labelFormatter, valueFormatter }) {
  if (!active || !payload || !payload.length) return null;
  const title = labelFormatter ? labelFormatter(label) : fmtDate(label);
  return (
    <div className="chart-tip">
      <div className="chart-tip-title">{title}</div>
      {payload.map((p, i) => {
        const [val, name] = valueFormatter
          ? valueFormatter(p.value, p.name, p)
          : [p.value, p.name];
        return (
          <div className="chart-tip-row" key={p.dataKey || i}>
            <span className="chart-tip-key">
              <span className="chart-tip-swatch" style={{ background: p.color || p.stroke || "var(--accent)" }} />
              {name}
            </span>
            <span className="chart-tip-val">{val}</span>
          </div>
        );
      })}
    </div>
  );
}
