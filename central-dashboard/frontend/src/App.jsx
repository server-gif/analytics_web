import React, { useEffect, useMemo, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { LiveProvider } from "./lib/live.jsx";
import { isAuthed, clearAuth, UNAUTHORIZED_EVENT } from "./lib/auth.js";
import Login from "./pages/Login.jsx";
import Layout from "./components/Layout.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Projects from "./pages/Projects.jsx";
import Domains from "./pages/Domains.jsx";
import Traffic from "./pages/Traffic.jsx";
import Countries from "./pages/Countries.jsx";
import Requests from "./pages/Requests.jsx";
import Bandwidth from "./pages/Bandwidth.jsx";
import Workers from "./pages/Workers.jsx";
import Pages from "./pages/Pages.jsx";
import Errors from "./pages/Errors.jsx";
import Journey from "./pages/Journey.jsx";
import Sessions from "./pages/Sessions.jsx";
import VisitedPages from "./pages/VisitedPages.jsx";
import Navigation from "./pages/Navigation.jsx";
import Visitors from "./pages/Visitors.jsx";

// Filter state (project / domain / date) URL query param mathi aavte - refresh/
// share thathu rahe. Layout ma aa state set thay.
export function useFiltersFromLocation(search) {
  return useMemo(() => {
    const q = new URLSearchParams(search);
    return {
      account: q.get("account") || "",
      project: q.get("project") || "",
      domain: q.get("domain") || "",
      preset: q.get("preset") || "7d",
      from: q.get("from") || "",
      to: q.get("to") || "",
      // User Journey drill-down filters (optional; set via URL / page controls).
      // The backend also caps the Journey window to the last 30 days.
      visitor: q.get("visitor") || "",
      session: q.get("session") || "",
      path: q.get("path") || "",
      event: q.get("event") || "",
    };
  }, [search]);
}

export default function App() {
  // Show the login page until a valid credential is stored; any /api 401 (from a
  // live poll or an expired/rotated password) drops back to the login page.
  const [authed, setAuthed] = useState(() => isAuthed());
  useEffect(() => {
    const onUnauthorized = () => {
      clearAuth();
      setAuthed(false);
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  if (!authed) return <Login onSuccess={() => setAuthed(true)} />;

  return (
    <LiveProvider>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="projects" element={<Projects />} />
          <Route path="domains" element={<Domains />} />
          <Route path="traffic" element={<Traffic />} />
          <Route path="countries" element={<Countries />} />
          <Route path="requests" element={<Requests />} />
          <Route path="bandwidth" element={<Bandwidth />} />
          <Route path="workers" element={<Workers />} />
          <Route path="pages" element={<Pages />} />
          <Route path="errors" element={<Errors />} />
          <Route path="journey" element={<Journey />} />
          <Route path="sessions" element={<Sessions />} />
          <Route path="visited-pages" element={<VisitedPages />} />
          <Route path="flow" element={<Navigation />} />
          <Route path="visitors" element={<Visitors />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </LiveProvider>
  );
}
