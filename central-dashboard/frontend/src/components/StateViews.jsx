import React from "react";

export function Loading() {
  return <div className="state loading">Loading Cloudflare analytics…</div>;
}

export function ErrorState({ message }) {
  return (
    <div className="state error">
      <strong>Unable to load Cloudflare analytics.</strong>
      <span>{message}</span>
    </div>
  );
}

export function Empty({ text = "No data for this selection." }) {
  return <div className="state empty">{text}</div>;
}

// STRICT: metric available nathi -> "Not available" (koi 0/estimate nathi)
export function NotAvailable({ note }) {
  return <span className="na" title={note || ""}>Not available</span>;
}
