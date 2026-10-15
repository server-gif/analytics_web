import React from "react";
import { fmtMetric } from "../lib/format.js";
import { InfoTip } from "./PageHeader.jsx";

// metric = {available,label,value,kind,hint} (backend ane mathi) - available nathi
// to "Not available" dekhay, fake number nathi. hint = inline info tooltip.
export default function StatCard({ metric, valueLabel, hint }) {
  const text = valueLabel != null ? valueLabel : fmtMetric(metric);
  const na = metric && metric.available === false;
  const tip = hint || metric?.hint;
  return (
    <div className={"statcard" + (na ? " na" : "")}>
      <div className="stat-num">{text}</div>
      <div className="stat-label">
        {metric?.label || valueLabel}
        {tip ? <InfoTip text={tip} /> : null}
      </div>
      {metric?.note && <div className="stat-note">{metric.note}</div>}
    </div>
  );
}
