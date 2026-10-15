import React from "react";
import { fmtNumber, fmtBytes } from "../lib/format.js";
import { flagEmoji, countryName } from "../lib/countries.js";
import { Empty } from "./StateViews.jsx";

/**
 * Countries rendered as a name list (not raw codes): each row shows the flag
 * emoji + full country name, a proportional share-of-requests bar, and the
 * request count with its % and bandwidth. Uses the country code only to derive
 * the flag/name; unknown codes fall back to the code itself (never invented).
 */
export default function CountryList({ rows = [] }) {
  if (!rows.length) return <Empty text="No country data for this selection." />;
  const total = rows.reduce((s, r) => s + (r.requests || 0), 0);
  const max = rows.reduce((m, r) => Math.max(m, r.requests || 0), 0) || 1;
  return (
    <ul className="countrylist">
      {rows.map((r) => {
        const req = r.requests || 0;
        const pct = total ? (req / total) * 100 : 0;
        const barW = (req / max) * 100; // relative to the top country
        return (
          <li key={r.country}>
            <span className="cl-flag" aria-hidden="true">{flagEmoji(r.country)}</span>
            <span className="cl-main">
              <span className="cl-name">
                {countryName(r.country)} <em>{r.country}</em>
              </span>
              <span className="cl-bar">
                <span style={{ width: `${barW}%` }} />
              </span>
            </span>
            <span className="cl-nums">
              <span className="cl-req">{fmtNumber(req)}</span>
              <span className="cl-sub">{pct.toFixed(1)}%{r.bandwidthBytes != null ? ` · ${fmtBytes(r.bandwidthBytes)}` : ""}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
