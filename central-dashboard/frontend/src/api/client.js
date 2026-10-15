// Frontend API client - SUDHU relative /api/* call kare (no secrets, no CF token).
// Prod mate Worker same-origin route par hase (custom domain/route) ke
// VITE_API_BASE te set karo. Local dev mate vite proxy /api -> :8787 vapraay.
import { getAuthValue, notifyUnauthorized } from "../lib/auth.js";

const BASE = import.meta.env.VITE_API_BASE || "";

async function get(path, params = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const qs = q.toString();
  const headers = { accept: "application/json" };
  const auth = getAuthValue(); // Basic credential set by the login page
  if (auth) headers.Authorization = "Basic " + auth;
  const res = await fetch(`${BASE}${path}${qs ? "?" + qs : ""}`, { headers });
  if (res.status === 401) {
    // stored password is missing/wrong -> let the app fall back to the login page
    notifyUnauthorized();
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j && j.error) msg = j.error;
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export const api = {
  account: () => get("/api/account"),
  accounts: () => get("/api/accounts"),
  projects: () => get("/api/projects"),
  domains: () => get("/api/domains"),
  zones: () => get("/api/zones"),
  workersList: () => get("/api/workers"),
  pages: () => get("/api/pages"),
  overview: (p) => get("/api/analytics/overview", p),
  projectsAnalytics: (p) => get("/api/analytics/projects", p),
  traffic: (p) => get("/api/analytics/traffic", p),
  countries: (p) => get("/api/analytics/countries", p),
  errors: (p) => get("/api/analytics/errors", p),
  workers: (p) => get("/api/analytics/workers", p),
  // User Journey (custom-tracked via Analytics Engine) - separate from native CF
  journey: (p) => get("/api/analytics/journey", p),
  journeyPages: (p) => get("/api/analytics/pages", p),
  entryExit: (p) => get("/api/analytics/entry-exit", p),
  sessions: (p) => get("/api/analytics/sessions", p),
  sessionDetail: (p) => get("/api/analytics/sessions", p),
  navigation: (p) => get("/api/analytics/navigation", p),
  visitors: (p) => get("/api/analytics/visitors", p),
  visitorDetail: (p) => get("/api/analytics/visitors", p),
  // distinct tracked hostnames (Analytics Engine blob3) for the Domain filter
  trackedDomains: (p) => get("/api/analytics/tracked-domains", p),
};
