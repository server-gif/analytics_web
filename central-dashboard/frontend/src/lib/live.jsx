import React, { createContext, useContext, useEffect, useState } from "react";

/**
 * Live mode: a global auto-refresh controller. useApi() polls on this interval so
 * Cloudflare-side updates appear on every page without a manual reload.
 *
 * NOTE: Cloudflare analytics is pull-based (not real-time push) - its freshest
 * buckets settle every few minutes - so "live" here = frequent polling that shows
 * the latest Cloudflare has as soon as it is available.
 */
const DEFAULT_MS = 60000;
export const LiveContext = createContext({
  enabled: true,
  intervalMs: DEFAULT_MS,
  lastUpdated: 0,
  setEnabled: () => {},
  setIntervalMs: () => {},
  touch: () => {},
});

export const useLive = () => useContext(LiveContext);

export function LiveProvider({ children }) {
  const [enabled, setEnabled] = useState(() => {
    try { return localStorage.getItem("live.enabled") !== "0"; } catch { return true; }
  });
  const [intervalMs, setIntervalMs] = useState(() => {
    try { return parseInt(localStorage.getItem("live.intervalMs") || "", 10) || DEFAULT_MS; } catch { return DEFAULT_MS; }
  });
  const [lastUpdated, setLastUpdated] = useState(0);

  useEffect(() => { try { localStorage.setItem("live.enabled", enabled ? "1" : "0"); } catch {} }, [enabled]);
  useEffect(() => { try { localStorage.setItem("live.intervalMs", String(intervalMs)); } catch {} }, [intervalMs]);

  // a successful fetch anywhere bumps the shared "last updated" clock
  const touch = () => setLastUpdated(Date.now());

  return (
    <LiveContext.Provider value={{ enabled, intervalMs, lastUpdated, setEnabled, setIntervalMs, touch }}>
      {children}
    </LiveContext.Provider>
  );
}

function ago(ts) {
  if (!ts) return "—";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 2) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

// The control shown in the filter bar. Re-renders each second so "Xs ago" ticks.
export function LiveBadge() {
  const { enabled, intervalMs, lastUpdated, setEnabled, setIntervalMs } = useLive();
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="live" role="group" aria-label="Live refresh">
      <span className={"live-dot" + (enabled ? " on" : "")} />
      <div className="live-info">
        <span className="live-state">{enabled ? "Live" : "Paused"}</span>
        <span className="live-sub">{enabled ? `updated ${ago(lastUpdated)}` : "auto-refresh off"}</span>
      </div>
      <select
        className="live-int"
        value={intervalMs}
        onChange={(e) => setIntervalMs(parseInt(e.target.value, 10))}
        title="Auto-refresh interval"
      >
        <option value={15000}>15s</option>
        <option value={30000}>30s</option>
        <option value={60000}>1m</option>
        <option value={300000}>5m</option>
      </select>
      <button type="button" className={"live-toggle" + (enabled ? " on" : "")} onClick={() => setEnabled(!enabled)}>
        {enabled ? "Pause" : "Resume"}
      </button>
    </div>
  );
}
