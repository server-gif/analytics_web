import React, { useCallback, useContext, useEffect, useRef, useState } from "react";
import { LiveContext } from "./live.jsx";

/**
 * useApi(fn, deps, opts) - darek filter change thathe ethi refetch.
 * returns { data, loading, refreshing, error, refresh }.
 *  - loading    : no data yet (initial / filter change) -> show skeleton
 *  - refreshing : have data, fetching a live update in the background -> NO flash
 *  - opts.live  : default true -> polls on the global Live interval
 * Live polling keeps the current data visible and silently swaps in fresh values;
 * a transient poll error never wipes good data.
 */
export function useApi(fn, deps = [], opts = {}) {
  const { live = true } = opts;
  const liveCtx = useContext(LiveContext);
  const fnRef = useRef(fn);
  useEffect(() => { fnRef.current = fn; });

  const [state, setState] = useState({ data: null, loading: true, refreshing: false, error: "" });

  const load = useCallback(async (mode) => {
    if (mode === "refresh") setState((s) => (s.data ? { ...s, refreshing: true } : s));
    else setState({ data: null, loading: true, refreshing: false, error: "" });
    try {
      const data = await fnRef.current();
      setState({ data, loading: false, refreshing: false, error: "" });
      liveCtx?.touch?.();
    } catch (e) {
      const msg = e.message || "Unable to load Cloudflare analytics.";
      // on a background refresh keep showing the last good data; only surface
      // errors from an initial/filter-change load (when there is nothing to show)
      setState((s) => (mode === "refresh" && s.data
        ? { ...s, refreshing: false }
        : { data: null, loading: false, refreshing: false, error: msg }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // initial load + whenever filters (deps) change
  useEffect(() => { load("initial"); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, deps);

  // live polling
  const polling = live && liveCtx?.enabled;
  const intervalMs = liveCtx?.intervalMs || 60000;
  useEffect(() => {
    if (!polling || !intervalMs) return;
    const id = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") load("refresh");
    }, intervalMs);
    return () => clearInterval(id);
  }, [polling, intervalMs, load]);

  return { ...state, refresh: () => load("refresh") };
}
