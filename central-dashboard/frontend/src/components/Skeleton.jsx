import React from "react";

/**
 * Skeleton loaders: shimmer placeholders that mirror the real layout
 * (stat cards / table / chart) so a slow Cloudflare fetch shows a
 * "loading data" state instead of a blank page.
 */

// base shimmer block
export function Sk({ w = "100%", h = 14, r = 7, style }) {
  return <span className="sk" style={{ width: w, height: h, borderRadius: r, display: "inline-block", ...style }} />;
}

// small pulsing "loading" caption shown atop skeletons
function LoadingTag() {
  return (
    <div className="sk-loading">
      <span className="sk-spinner" />
      Loading data from Cloudflare…
    </div>
  );
}

export function SkeletonStats({ count = 6 }) {
  return (
    <div className="stats">
      {Array.from({ length: count }).map((_, i) => (
        <div className="statcard" key={i}>
          <Sk h={26} w="55%" />
          <Sk h={12} w="70%" style={{ marginTop: 12 }} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 8, cols = 4 }) {
  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr>
            {Array.from({ length: cols }).map((_, i) => (
              <th key={i}><Sk h={12} w={`${50 + ((i * 13) % 40)}%`} /></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r}>
              {Array.from({ length: cols }).map((_, c) => (
                <td key={c}><Sk h={12} w={`${45 + ((r * 7 + c * 19) % 50)}%`} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SkeletonChart({ h = 260 }) {
  return (
    <div className="card">
      <Sk h={14} w="22%" />
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: h, marginTop: 18 }}>
        {Array.from({ length: 24 }).map((_, i) => (
          <Sk
            key={i}
            w="100%"
            r={4}
            style={{ height: `${25 + ((i * 37) % 70)}%` }}
          />
        ))}
      </div>
    </div>
  );
}

// full-page skeleton variants used by the route pages
export function PageSkeleton({ variant = "table", title = true, cols = 4, rows = 8 }) {
  return (
    <>
      {title && (
        <h2 className="pagetitle">
          <Sk h={20} w={220} />
        </h2>
      )}
      <LoadingTag />
      {variant === "dashboard" ? (
        <>
          <SkeletonStats />
          <SkeletonChart />
          <div className="twocol">
            <div className="card"><Sk h={14} w="30%" /><div style={{ marginTop: 14 }}><SkeletonTable rows={6} cols={3} /></div></div>
            <div className="card"><Sk h={14} w="30%" /><div style={{ marginTop: 14 }}><SkeletonTable rows={6} cols={2} /></div></div>
          </div>
        </>
      ) : variant === "chart" ? (
        <>
          <SkeletonStats count={2} />
          <SkeletonChart h={320} />
        </>
      ) : (
        <div className="card"><SkeletonTable rows={rows} cols={cols} /></div>
      )}
    </>
  );
}
