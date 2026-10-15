/**
 * Metric catalog: Cloudflare nu kaun-kaun no metric aave ane kaun na nahi.
 *
 * *** PHASE 0 - REQUIRED BEFORE TRUSTING NUMBERS ***
 * Niche na `dataset` ane `field` naam Cloudflare GraphQL docs pramane best-effort
 * defaults che. Tamara account par ek vaar LIVE verify karva:
 *   - GraphQL introspection ane ek chhotu test query chalai ne confirm karvu ke
 *     field vastavik ma data aape ke ghara (empty/null/error).
 *   - Je field confirm na thay te `available: false` rakhvu - ethi UI "Not available"
 *     dekhadshe, KANHI fake/derived number nahi.
 * README ma "verified-against (date + account)" note raakhjo.
 *
 * RULE (prompt no "DATA ACCURACY"): requests != users. Kaeda metric mate
 * sudhu Cloudflare je aape e j dekhavu; na male te "Not available".
 */

export const METRICS = {
  // ---- Available (zone-level Cloudflare native analytics) ----
  requests: {
    label: "Total Requests",
    kind: "count",
    available: true,
    dataset: "httpRequestsAdaptiveGroups",
    field: "requests", // sum.requests
  },
  bandwidth: {
    label: "Bandwidth",
    kind: "bytes", // clearly ALAG from requests
    available: true,
    dataset: "httpRequestsAdaptiveGroups",
    field: "edgeResponseBytes", // sum.edgeResponseBytes
  },
  countries: {
    label: "Traffic by Country",
    kind: "group",
    available: true,
    dataset: "httpRequestsAdaptiveGroups",
    dimension: "ClientCountryName",
  },
  errors: {
    label: "HTTP Errors (4xx/5xx)",
    kind: "group",
    available: true,
    dataset: "httpRequestsAdaptiveGroups",
    dimension: "EdgeResponseStatus",
  },
  trafficSeries: {
    label: "Requests / Bandwidth over time",
    kind: "timeSeries",
    available: true,
    datasetMinute: "httpRequests1mGroups",
    datasetDay: "httpRequests1dGroups",
  },

  // ---- Workers built-in analytics (Phase 0 LIVE-verified) ----
  workers: {
    label: "Workers analytics",
    kind: "group",
    available: true, // requests + CPU verified; backend query fail -> auto N/A
    dataset: "workersOverviewRequestsAdaptiveGroups",
    measures: ["requests (sum count)", "cpuTimeUs"],
    dimension: "scriptName",
    // The `status` dimension here is a small internal code (live: 1, 7), NOT an
    // HTTP status, so an error count is NOT derived (avoids a fabricated 0).
    errorsAvailable: false,
  },

  // ---- NOT available from Cloudflare free native analytics -> strict N/A ----
  uniqueUsers: {
    label: "Unique Users / Visitors",
    available: false, // Cloudflare "requests" ne "users" nathi; fabricated number nahi
    note: "Not available from Cloudflare native analytics on this plan.",
  },
  cities: {
    label: "Traffic by City",
    available: false, // city-level plan-gated / not exposed here
    note: "Not available (city-level data not returned by this dataset).",
  },
  device: {
    label: "Device / Browser / OS",
    available: false, // not in this dataset without extra plan/fingerprinting
    note: "Not available from the chosen Cloudflare dataset.",
  },
};

/**
 * N/A marker ane API response ma vaparyu - jethi frontend khali "Not available" dekhay.
 */
export function notAvailable(metricKey) {
  const m = METRICS[metricKey] || {};
  return {
    available: false,
    label: m.label || metricKey,
    value: null,
    note: m.note || "Not available from Cloudflare native analytics.",
  };
}

// Ek helper: value mano ke N/A
export function maybeValue(metricKey, value) {
  if (!METRICS[metricKey]?.available || value === null || value === undefined) {
    return notAvailable(metricKey);
  }
  return { available: true, label: METRICS[metricKey].label, value };
}
