/**
 * User Journey tracking snippet - the manual embed (the only rollout path).
 * Drop this on each site you want to measure. It POSTs events to the central
 * Worker's public /api/track endpoint, which writes to Workers Analytics Engine
 * (dataset: user_journey).
 *
 * Install (one <script> tag per site, e.g. before </head>). Zero-config: the
 * snippet is served by the central Worker, so it derives the /api/track URL from
 * its OWN src - no data-endpoint needed:
 *   <script src="https://<central-worker>/analytics.js" defer></script>
 *
 *   - data-endpoint : override the /api/track URL (default = the origin serving this script)
 *   - data-project  : a stable label grouping this site's domains (defaults to hostname)
 *
 * EVENT MODEL: page_view, page_duration, navigation, session_activity. No
 * session_start/session_end source of truth - a session rolls over after 30 min idle;
 * while the tab is VISIBLE a session_activity heartbeat keeps it alive and supplies
 * last-activity for exit page / session duration.
 *
 * TIME-ON-PAGE counts ACTIVE/visible time only (visibilitychange + focus/blur pause
 * the clock), so hidden/background time is never counted. Route change order:
 * finalize previous page -> page_duration -> navigation(from,to) -> new page_view.
 *
 * Anonymous only: random visitorId (localStorage) + sessionId (sessionStorage).
 * No cookies, no PII. Respects Do Not Track.
 */
(function () {
  "use strict";
  var script = document.currentScript || (function () {
    var s = document.getElementsByTagName("script");
    return s[s.length - 1];
  })();
  if (!script) return;
  if (navigator.doNotTrack === "1" || window.doNotTrack === "1") return;

  // Zero-config: default the ingest URL to the origin that SERVES this snippet
  // (the central Worker), so a plain <script src=".../analytics.js"> works on any
  // cross-origin site. Only fall back to same-origin if we have no src (inline).
  var ENDPOINT = script.getAttribute("data-endpoint") ||
    (script.src ? new URL(script.src, location.href).origin + "/api/track" : "/api/track");
  var PROJECT = script.getAttribute("data-project") || location.hostname;
  var IDLE = 30 * 60 * 1000; // 30 min idle -> new session
  var HB = 30000; // visible heartbeat interval
  var KV = "cfj_vid", KS = "cfj_sid", KT = "cfj_last";

  function rid() {
    return (crypto && crypto.randomUUID && crypto.randomUUID()) ||
      Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  function lg(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsv(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function sg(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssv(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }

  var vid = lg(KV) || rid();
  lsv(KV, vid);

  var now = Date.now();
  var last = Number(sg(KT) || 0);
  var sid = sg(KS);
  var newSess = !sid || now - last > IDLE;
  if (newSess) sid = rid();
  ssv(KS, sid);
  ssv(KT, String(now));

  function send(ev, extra) {
    extra = extra || {};
    var payload = {
      e: ev, p: PROJECT, d: location.hostname,
      path: extra.path != null ? extra.path : location.pathname,
      ref: extra.ref != null ? extra.ref : "",
      v: vid, s: sid, dur: extra.dur || 0, ts: Date.now(),
    };
    var body = JSON.stringify(payload);
    try {
      // text/plain is a CORS-safelisted type -> the cross-origin beacon is a
      // "simple" request (no preflight), so sendBeacon reliably delivers it. The
      // backend reads the raw text and JSON.parses it, so content-type is fine.
      if (navigator.sendBeacon) {
        navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "text/plain;charset=UTF-8" }));
      } else {
        fetch(ENDPOINT, { method: "POST", body: body, mode: "no-cors", keepalive: true });
      }
    } catch (e) {}
  }
  function touch() { ssv(KT, String(Date.now())); }

  // --- active-time tracking for the current page ---
  var path = location.pathname;   // path currently being measured
  var acc = 0;                     // accumulated active ms (prior visible segments)
  var seg = document.visibilityState === "visible" ? Date.now() : null; // current visible segment start
  var open = true;                 // page still awaiting its single page_duration

  function activeSec() { return Math.round((acc + (seg != null ? Date.now() - seg : 0)) / 1000); }
  function pause() { if (seg != null) { acc += Date.now() - seg; seg = null; } }
  function resume() { if (seg == null && document.visibilityState === "visible") seg = Date.now(); }
  function startPage(p) { path = p; acc = 0; seg = document.visibilityState === "visible" ? Date.now() : null; open = true; }
  function endPage() {
    if (!open) return;
    var s = activeSec();
    open = false;
    if (s > 0) send("page_duration", { path: path, ref: path, dur: s });
  }
  function pageView(ref) {
    send("page_view", { path: location.pathname, ref: ref != null ? ref : document.referrer || "" });
  }

  // route change: finalize old -> page_duration -> navigation(from,to) -> new page_view
  function go() {
    if (location.pathname === path) return;
    endPage();
    var from = path;
    send("navigation", { path: location.pathname, ref: from });
    startPage(location.pathname);
    pageView(from);
    touch();
  }

  ["pushState", "replaceState"].forEach(function (fn) {
    var orig = history[fn];
    history[fn] = function () { var r = orig.apply(history, arguments); setTimeout(go, 0); return r; };
  });
  window.addEventListener("popstate", function () { setTimeout(go, 0); });

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") pause(); else resume();
  });
  window.addEventListener("blur", pause);
  window.addEventListener("focus", resume);

  function bye() { endPage(); }
  window.addEventListener("pagehide", bye);
  window.addEventListener("beforeunload", bye);

  // liveness heartbeat while visible: keeps the session open + marks last activity
  setInterval(function () {
    if (document.visibilityState === "visible") { touch(); send("session_activity", { path: location.pathname }); }
  }, HB);

  // initial events
  if (newSess) send("session_activity", { path: location.pathname, ref: document.referrer || "" });
  pageView(document.referrer || "");
})();
