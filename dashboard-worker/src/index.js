/**
 * Multi-project / multi-domain analytics dashboard.
 *
 * Data hierarchy (track.js ma lekhalo dataset):
 *   project (blob1) -> domain (blob2) -> country (blob3) / action (blob4) / path (blob5)
 * Ek project ma N domain auto-attach thay che (PROJECT_NAME env var thi).
 *
 * Env vars/secrets joiye (wrangler secret put):
 *   CF_ACCOUNT_ID       - Cloudflare account ID
 *   CF_API_TOKEN        - API token, "Account Analytics: Read" permission sathe
 *   DASHBOARD_PASSWORD  - aa dashboard kholva mate password
 */

const DATASET = "site_activity";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ---- Simple password gate ----
    const auth = request.headers.get("Authorization") || "";
    const expected = "Basic " + btoa("admin:" + env.DASHBOARD_PASSWORD);
    if (!env.DASHBOARD_PASSWORD || auth !== expected) {
      return new Response("Auth required", {
        status: 401,
        headers: { "WWW-Authenticate": 'Basic realm="Analytics Dashboard"' },
      });
    }

    const days = Math.min(90, Math.max(1, parseInt(url.searchParams.get("days") || "7", 10)));
    const project = (url.searchParams.get("project") || "").trim();
    const domain = (url.searchParams.get("domain") || "").trim();

    try {
      // 1) Badha projects nu overview (always, aa "manage all projects" mate che)
      const projects = await runQuery(env, `
        SELECT blob1 AS project,
               count() AS visits,
               uniqExact(blob2) AS domains
        FROM ${DATASET}
        WHERE ${timeFilter(days)}
        GROUP BY blob1
        ORDER BY visits DESC
        LIMIT 100
      `);

      // 2) Select karyela project na domains (domain-wise drill-down)
      const domains = project
        ? await runQuery(env, `
            SELECT blob2 AS domain, count() AS visits
            FROM ${DATASET}
            WHERE ${timeFilter(days)} AND blob1 = ${sqlStr(project)}
            GROUP BY blob2
            ORDER BY visits DESC
            LIMIT 100
          `)
        : [];

      // 3) Country / action / trend - current scope pramane (project + domain filter)
      const scope = scopeWhere(days, project, domain);
      const [byCountry, byAction, dailyTrend] = await Promise.all([
        runQuery(env, `
          SELECT blob3 AS country, count() AS visits
          FROM ${DATASET}
          WHERE ${scope}
          GROUP BY blob3
          ORDER BY visits DESC
          LIMIT 50
        `),
        runQuery(env, `
          SELECT blob4 AS action, count() AS total
          FROM ${DATASET}
          WHERE ${scope}
          GROUP BY blob4
          ORDER BY total DESC
          LIMIT 50
        `),
        runQuery(env, `
          SELECT toDate(timestamp) AS day, count() AS visits
          FROM ${DATASET}
          WHERE ${scope}
          GROUP BY day
          ORDER BY day ASC
        `),
      ]);

      return new Response(
        renderPage({ days, project, domain, projects, domains, byCountry, byAction, dailyTrend }),
        { headers: { "content-type": "text/html; charset=utf-8" } }
      );
    } catch (err) {
      return new Response("Dashboard error: " + err.message, { status: 500 });
    }
  },
};

// ---- SQL helpers ----
function timeFilter(days) {
  return `timestamp > NOW() - INTERVAL '${days}' DAY`;
}
function scopeWhere(days, project, domain) {
  let w = timeFilter(days);
  if (project) w += ` AND blob1 = ${sqlStr(project)}`;
  if (domain) w += ` AND blob2 = ${sqlStr(domain)}`;
  return w;
}
// single-quote escape - user-apela input SQL ma ghalva mate
function sqlStr(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

async function runQuery(env, sql) {
  const api = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`;
  const res = await fetch(api, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.CF_API_TOKEN}`,
      "content-type": "text/plain",
    },
    body: sql,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SQL API ${res.status}: ${text.slice(0, 300)}`);
  }

  const json = await res.json();
  return json.data || [];
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function table(title, rows, cols, linkCol) {
  if (!rows.length) {
    return `<div class="card"><h3>${esc(title)}</h3><p class="empty">Data nathi (hajuj thodu data collect thay chhe)</p></div>`;
  }
  const head = cols.map((c) => `<th>${esc(c.label)}</th>`).join("");
  const body = rows
    .map((r) => {
      const cells = cols
        .map((c) => {
          const val = esc(r[c.key]);
          if (linkCol && c.key === linkCol) return `<td><a href="${r._href}">${val}</a></td>`;
          return `<td>${val}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  return `<div class="card"><h3>${esc(title)}</h3><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderPage({ days, project, domain, projects, domains, byCountry, byAction, dailyTrend }) {
  // scope mathi total events
  const inScopeVisits = domain
    ? (domains.find((d) => d.domain === domain)?.visits ?? 0)
    : project
      ? domains.reduce((s, d) => s + Number(d.visits || 0), 0)
      : projects.reduce((s, p) => s + Number(p.visits || 0), 0);
  const totalDomains = domains.length;

  // Breadcrumb banavu
  const crumbs = [`<a href="?days=${days}">All projects</a>`];
  if (project) crumbs.push(`<a href="?days=${days}&project=${encodeURIComponent(project)}">${esc(project)}</a>`);
  if (domain) crumbs.push(`<span>${esc(domain)}</span>`);
  const crumbHtml = crumbs.join(" <span class='sep'>/</span> ");

  // Project dropdown (manage all projects)
  const projectOptions = projects
    .map(
      (p) =>
        `<option value="${esc(p.project)}" ${p.project === project ? "selected" : ""}>${esc(p.project)} (${p.domains} domain, ${p.visits})</option>`
    )
    .join("");

  // Domain rows ne click-thayable href aposhe
  const domainRows = domains.map((d) => ({
    ...d,
    _href: `?days=${days}&project=${encodeURIComponent(project)}&domain=${encodeURIComponent(d.domain)}`,
  }));

  // Project rows ne click-thayable href aposhe (drill-down)
  const projectRows = projects.map((p) => ({
    ...p,
    _href: `?days=${days}&project=${encodeURIComponent(p.project)}`,
  }));

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Analytics Dashboard</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px 20px; background: #0b0815; color: #f4f2fa;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .wrap { max-width: 1100px; margin: 0 auto; }
  h1 { font-size: 24px; margin: 0 0 4px; }
  .crumbs { font-size: 13px; color: #8d87a6; margin: 0 0 20px; }
  .crumbs a { color: #b9a4f7; text-decoration: none; }
  .crumbs .sep { color: #4a4363; margin: 0 6px; }
  .toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 20px; }
  .toolbar select, .toolbar input {
    background: #171029; color: #f4f2fa; border: 1px solid #2c2545;
    border-radius: 8px; padding: 8px 12px; font-size: 13px;
  }
  .toolbar input { min-width: 220px; }
  .toolbar button {
    background: #7c3aed; color: #fff; border: none; border-radius: 8px;
    padding: 8px 16px; font-size: 13px; cursor: pointer;
  }
  .filters { display: flex; gap: 8px; margin-bottom: 22px; }
  .filters a { padding: 8px 14px; border-radius: 8px; background: #171029; color: #b9a4f7;
    text-decoration: none; font-size: 13px; border: 1px solid #2c2545; }
  .filters a.active { background: #7c3aed; color: #fff; border-color: #7c3aed; }
  .stat-row { display: flex; gap: 16px; margin-bottom: 24px; }
  .stat-box { background: #140f22; border: 1px solid #26203b; border-radius: 14px;
    padding: 18px 20px; flex: 1; }
  .stat-box .num { font-size: 28px; font-weight: 700; color: #b9a4f7; }
  .stat-box .label { font-size: 12px; color: #8d87a6; margin-top: 4px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  @media (max-width: 800px) { .grid { grid-template-columns: 1fr; } .stat-row { flex-direction: column; } }
  .card { background: #140f22; border: 1px solid #26203b; border-radius: 14px;
    padding: 18px 20px; margin-bottom: 20px; }
  .card h3 { margin: 0 0 12px; font-size: 14px; color: #d8d3ea; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; color: #8d87a6; font-weight: 500; padding: 6px 8px; border-bottom: 1px solid #26203b; }
  td { padding: 6px 8px; border-bottom: 1px solid #1c1730; }
  td a { color: #b9a4f7; text-decoration: none; }
  .empty { color: #645d80; font-size: 13px; }
  .full { grid-column: 1 / -1; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Analytics Dashboard</h1>
  <p class="crumbs">${crumbHtml}</p>

  <!-- Project select + Domain add (manage all projects & domains) -->
  <form class="toolbar" method="GET">
    <input type="hidden" name="days" value="${days}">
    <select name="project" onchange="this.form.submit()">
      <option value="">— Badha projects —</option>
      ${projectOptions}
    </select>
    <input type="text" name="domain" placeholder="Domain add/dekhavu (domain.com)" value="${esc(domain)}">
    <button type="submit">Filter</button>
    <a href="?days=${days}${project ? "&project=" + encodeURIComponent(project) : ""}" class="reset">Reset</a>
  </form>

  <div class="filters">
    ${[1, 7, 30, 90]
      .map(
        (d) =>
          `<a href="?days=${d}${project ? "&project=" + encodeURIComponent(project) : ""}${domain ? "&domain=" + encodeURIComponent(domain) : ""}" class="${days === d ? "active" : ""}">${d === 1 ? "Today" : d + " days"}</a>`
      )
      .join("")}
  </div>

  <div class="stat-row">
    <div class="stat-box"><div class="num">${inScopeVisits}</div><div class="label">Events (current view)</div></div>
    <div class="stat-box"><div class="num">${projects.length}</div><div class="label">Projects</div></div>
    <div class="stat-box"><div class="num">${totalDomains || projects.reduce((s, p) => s + Number(p.domains || 0), 0)}</div><div class="label">Domains</div></div>
    <div class="stat-box"><div class="num">${byCountry.length}</div><div class="label">Countries</div></div>
  </div>

  <div class="grid">
    ${
      !project
        ? table("All projects (click to manage)", projectRows, [
            { key: "project", label: "Project" },
            { key: "domains", label: "Domains" },
            { key: "visits", label: "Events" },
          ], "project")
        : `<div class="card" onclick="event.stopPropagation()">` +
          `<h3>Domains in ${esc(project)} (click a domain)</h3>` +
          (domains.length
            ? `<table><thead><tr><th>Domain</th><th>Events</th></tr></thead><tbody>` +
              domainRows
                .map(
                  (d) =>
                    `<tr><td><a href="${d._href}">${esc(d.domain)}</a></td><td>${esc(d.visits)}</td></tr>`
                )
                .join("") +
              `</tbody></table>`
            : `<p class="empty">Aa project mate hajuj data nathi</p>`) +
          `</div>`
    }
    ${table("Country-wise visits", byCountry, [
      { key: "country", label: "Country" },
      { key: "visits", label: "Visits" },
    ])}
    <div class="full">
      ${table("Activity breakdown (user actions)", byAction, [
        { key: "action", label: "Action" },
        { key: "total", label: "Count" },
      ])}
    </div>
    <div class="full">
      ${table("Daily trend", dailyTrend, [
        { key: "day", label: "Date" },
        { key: "visits", label: "Visits" },
      ])}
    </div>
  </div>
</div>
</body>
</html>`;
}
