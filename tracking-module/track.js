/**
 * Analytics tracking module.
 * Darek project ma aa file copy karo, ane Worker na fetch handler ma import kari ne vaparo.
 *
 * Setup (wrangler.toml ma, aa project na):
 *   [[analytics_engine_datasets]]
 *   binding = "ANALYTICS"
 *   dataset = "site_activity"
 *
 *   # Darek project mate ek unique naam - jethi aa project na badha domain
 *   # ek j "project" niche group thay (1 project = N domain auto-attach).
 *   [vars]
 *   PROJECT_NAME = "project-a"
 *
 * Usage (Worker code ma):
 *   import { trackEvent } from "./track.js";
 *   trackEvent(env, request, "page_view");
 *   trackEvent(env, request, "video_play", { videoId: "abc123" });
 */

export function trackEvent(env, request, actionName, extra = {}) {
  if (!env.ANALYTICS) {
    console.warn("[analytics] ANALYTICS binding missing - skipping track:", actionName);
    return;
  }

  const url = new URL(request.url);
  const domain = url.hostname;
  // PROJECT_NAME env var mate aapelo - ek project na badha domain aa j naam niche group thay
  const project = env.PROJECT_NAME || "default";
  // request.cf.country Cloudflare potej free ma aape che - koi IP lookup service ni jarur nathi
  const country = (request.cf && request.cf.country) || "XX";
  const path = url.pathname;
  const extraJson = JSON.stringify(extra).slice(0, 500); // length cap, Analytics Engine limit

  try {
    env.ANALYTICS.writeDataPoint({
      // blobs = text fields (max 20, each up to 5120 bytes)
      // order: project, domain, country, action, path, extra
      blobs: [project, domain, country, actionName, path, extraJson],
      // doubles = number fields (max 20) - count hamesha 1, summing/counting mate
      doubles: [1],
      // indexes = fast-lookup field (max 1) - domain thi index karyu, jethi per-domain query fast thay
      indexes: [domain],
    });
  } catch (err) {
    console.error("[analytics] writeDataPoint failed:", err.message);
  }
}
