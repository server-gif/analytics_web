import React, { createContext, useContext, useEffect, useState, useMemo } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/client.js";
import { useFiltersFromLocation } from "../App.jsx";
import { LiveBadge } from "../lib/live.jsx";
import { logout } from "../lib/auth.js";
import Icon from "./icons.jsx";

const FiltersContext = createContext({});
export const useFilters = () => useContext(FiltersContext);

// Sidebar is grouped by DATA SOURCE so it is obvious where each page's numbers
// come from: "Cloudflare" = native/direct Cloudflare analytics (GraphQL),
// "Custom tracked" = our analytics.js snippet -> Workers Analytics Engine.
const NAV_GROUPS = [
  {
    label: "Cloudflare",
    source: "cf",
    items: [
      ["Dashboard", "/", "dashboard"],
      ["Projects", "/projects", "projects"],
      ["Domains", "/domains", "domains"],
      ["Traffic", "/traffic", "traffic"],
      ["Countries", "/countries", "countries"],
      ["Requests", "/requests", "requests"],
      ["Bandwidth", "/bandwidth", "bandwidth"],
      ["Workers", "/workers", "workers"],
      ["Pages", "/pages", "pages"],
      ["Errors", "/errors", "errors"],
    ],
  },
  {
    label: "Custom tracked",
    source: "custom",
    items: [
      ["Journey", "/journey", "journey"],
      ["Sessions", "/sessions", "sessions"],
      ["Visitors", "/visitors", "visitors"],
      ["Visited Pages", "/visited-pages", "visited"],
      ["Navigation", "/flow", "navigation"],
    ],
  },
];

const PRESETS = [
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["7d", "Last 7 Days"],
  ["30d", "Last 30 Days"],
  ["90d", "Last 90 Days"],
  ["custom", "Custom Range"],
];

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const filters = useFiltersFromLocation(location.search);

  const [accounts, setAccounts] = useState([]);
  const [projects, setProjects] = useState([]);
  const [domains, setDomains] = useState([]);
  const [tracked, setTracked] = useState([]);
  const [account, setAccount] = useState(null);
  const [loadErr, setLoadErr] = useState("");

  // collapsible sidebar (icon rail <-> full). Persist the choice across reloads.
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("cfj_sidebar") === "collapsed"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("cfj_sidebar", collapsed ? "collapsed" : "expanded"); } catch {}
  }, [collapsed]);

  useEffect(() => {
    let alive = true;
    Promise.all([api.accounts(), api.projects(), api.domains(), api.account()])
      .then(([acc, p, d, a]) => {
        if (!alive) return;
        setAccounts(acc.accounts || []);
        setProjects(p.projects || []);
        setDomains(d.domains || []);
        setAccount(a);
      })
      .catch((e) => alive && setLoadErr(e.message));
    return () => { alive = false; };
  }, []);

  // filters nu URL update karva (project/domain/preset/custom)
  const setFilter = (patch) => {
    const q = new URLSearchParams(location.search);
    Object.entries(patch).forEach(([k, v]) => (v ? q.set(k, v) : q.delete(k)));
    // domain badle project ane domain nu consistency: project delete rakhhi
    navigate({ pathname: location.pathname, search: q.toString() });
  };

  // Hostnames actually present in tracked (Analytics Engine) data, scoped to the
  // current account/project. Merged into the Domain dropdown below so a host that
  // is NOT a Cloudflare zone (Pages/external) is still selectable + filterable.
  useEffect(() => {
    let alive = true;
    api
      .trackedDomains({ account: filters.account, project: filters.project })
      .then((r) => alive && setTracked(r.rows || []))
      .catch(() => alive && setTracked([]));
    return () => { alive = false; };
  }, [filters.account, filters.project]);

  // projects scoped to the selected account (account-wise separation)
  const projectsForAccount = useMemo(() => {
    if (!filters.account) return projects;
    return projects.filter((p) => p.account === filters.account);
  }, [projects, filters.account]);

  const domainsForProject = useMemo(() => {
    // merge Cloudflare-discovered domains with tracked hostnames (dedup by name)
    const map = new Map();
    for (const d of domains) map.set(d.domain, { ...d });
    for (const t of tracked) {
      if (!map.has(t.domain)) {
        map.set(t.domain, {
          domain: t.domain,
          project: t.project || filters.project || null,
          account: filters.account || null,
          tracked: true,
        });
      }
    }
    let pool = [...map.values()];
    // account-wise narrowing (discovered rows carry their own account; the tracked
    // list is already server-scoped to the account, so keep those)
    if (filters.account) pool = pool.filter((d) => d.account === filters.account || d.tracked);
    // project-wise narrowing
    if (filters.project) {
      const inProj = pool.filter((d) => d.project === filters.project || d.tracked);
      if (inProj.length) pool = inProj;
    }
    return pool.sort((a, b) => String(a.domain).localeCompare(String(b.domain)));
  }, [domains, tracked, filters.project, filters.account]);

  return (
    <FiltersContext.Provider value={filters}>
      <div className="shell">
        <aside className={"sidebar" + (collapsed ? " collapsed" : "")}>
          <div className="sidehead">
            <div className="brand">
              <span className="dot" />
              <span className="navlabel">Cloudflare Analytics</span>
            </div>
            <button
              type="button"
              className="side-toggle"
              onClick={() => setCollapsed((c) => !c)}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-expanded={!collapsed}
            >
              <Icon name={collapsed ? "chevronR" : "chevronL"} size={18} />
            </button>
          </div>
          <nav>
            {NAV_GROUPS.map((g) => (
              <div className="navgroup" key={g.label}>
                <div className="navgroup-label" title={g.label}>
                  <span className={"navgroup-dot " + (g.source === "cf" ? "dot-cf" : "dot-custom")} />
                  <span className="navgroup-text">{g.label}</span>
                </div>
                {g.items.map(([label, to, icon]) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === "/"}
                    title={label}
                    className={({ isActive }) => "navitem" + (isActive ? " active" : "")}
                  >
                    <Icon name={icon} />
                    <span className="navlabel">{label}</span>
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
          <div className="acct">
            <span className="acct-dot" />
            <div className="acct-body">
              {loadErr && <div className="acct-err">Resource load failed: {loadErr}</div>}
              {account && <div className="acct-name">{account.name}</div>}
              <div className="acct-hint">Signed in · Cloudflare admin</div>
              <button type="button" className="acct-signout" onClick={logout} title="Sign out">
                Sign out
              </button>
            </div>
          </div>
        </aside>

        <div className="main">
          <header className="filterbar">
            <label>
              Account
              <select value={filters.account} onChange={(e) => setFilter({ account: e.target.value, project: "", domain: "" })}>
                <option value="">ALL ACCOUNTS</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.name}>{a.name}</option>
                ))}
              </select>
            </label>

            <label>
              Project
              <select value={filters.project} onChange={(e) => setFilter({ project: e.target.value, domain: "" })}>
                <option value="">ALL PROJECTS</option>
                {projectsForAccount.map((p) => (
                  <option key={p.type + p.name} value={p.name}>{p.name} ({p.type})</option>
                ))}
              </select>
            </label>

            <label>
              Domain
              <select value={filters.domain} onChange={(e) => setFilter({ domain: e.target.value })}>
                <option value="">ALL DOMAINS{filters.project ? ` (${domainsForProject.length})` : ""}</option>
                {domainsForProject.map((d) => (
                  <option key={d.domain} value={d.domain}>{d.domain}</option>
                ))}
              </select>
            </label>

            <label>
              Date
              <select value={filters.preset} onChange={(e) => setFilter({ preset: e.target.value })}>
                {PRESETS.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </label>

            {filters.preset === "custom" && (
              <>
                <label>From<input type="date" value={filters.from} onChange={(e) => setFilter({ from: e.target.value })} /></label>
                <label>To<input type="date" value={filters.to} onChange={(e) => setFilter({ to: e.target.value })} /></label>
              </>
            )}

            <LiveBadge />
          </header>

          <main className="content">
            <Outlet />
          </main>
        </div>
      </div>
    </FiltersContext.Provider>
  );
}
