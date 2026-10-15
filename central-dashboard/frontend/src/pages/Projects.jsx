import React from "react";
import { api } from "../api/client.js";
import { useApi } from "../lib/useApi.js";
import { useFilters } from "../components/Layout.jsx";
import DataTable from "../components/DataTable.jsx";
import DomainChips from "../components/DomainChips.jsx";
import PageHeader from "../components/PageHeader.jsx";
import { ErrorState } from "../components/StateViews.jsx";
import { PageSkeleton } from "../components/Skeleton.jsx";
import { fmtBytes, fmtNumber } from "../lib/format.js";

// Projects = auto-discovered Zone/Worker/Pages, each with its discovered
// domains + Requests/Bandwidth for the CURRENT date filter. The filter bar
// (project / domain / date) narrows & re-fetches this table server-side.
const NA = () => <span className="na">Not available</span>;
const Dash = () => <span className="na">—</span>;

export default function Projects() {
  const f = useFilters();
  const params = { account: f.account, project: f.project, domain: f.domain, preset: f.preset, from: f.from, to: f.to };
  const { data, loading, error } = useApi(
    () => api.projectsAnalytics(params),
    [f.account, f.project, f.domain, f.preset, f.from, f.to]
  );
  if (loading) return <PageSkeleton variant="table" cols={7} rows={9} />;
  if (error) return <ErrorState message={error} />;

  const scope = (f.account ? ` · account: ${f.account}` : "") + (f.project ? ` · filtered to ${f.project}` : f.domain ? ` · filtered to ${f.domain}` : "");

  return (
    <>
      <PageHeader
        title="Projects"
        sub={`Zones · Workers · Pages (auto-discovered)${scope}`}
        items={[
          "Every Zone, Worker and Pages project Cloudflare reports, auto-discovered across your accounts, with its linked domains.",
          "Requests / Bandwidth are resolved through the project's backing Cloudflare zone(s) for the selected date range - a Pages project with no Cloudflare zone shows — (Not available), never a guess.",
          "Workers report requests + errors but Cloudflare gives no per-worker bandwidth.",
          "The filter bar narrows this table: Account limits rows to that account; selecting a Project or Domain filters to it.",
        ]}
      />
      <DataTable
        columns={[
          { key: "type", label: "Type", width: "120px", render: (r) => (
            <span>{r.type}{r.pages ? <span className="badge">Pages</span> : null}</span>
          ) },
          { key: "project", label: "Project / Name", width: "220px", render: (r) => (
            <div className="projcell">
              <span>{r.project}</span>
              {r.note ? <span className="projnote" title={r.note}>{r.note}</span> : null}
            </div>
          ) },
          { key: "account", label: "Account", width: "150px", render: (r) => r.account || NA() },
          { key: "domainCount", label: "# Domains", width: "90px", align: "right", hint: "Domains linked to this project (apex + discovered subdomains).", render: (r) => fmtNumber(r.domainCount || 0) },
          {
            key: "domains",
            label: "Linked Domains",
            render: (r) => <DomainChips domains={r.domains || []} />,
          },
          { key: "requests", label: "Requests", width: "110px", align: "right", hint: "Cloudflare requests for the project's zone(s) in the selected period. — means no backing zone / no data.", render: (r) => (r.requests != null ? fmtNumber(r.requests) : Dash()) },
          { key: "bandwidthBytes", label: "Bandwidth", width: "110px", align: "right", hint: "Response bytes served by the project's zone(s). Not reported per Worker.", render: (r) => (r.bandwidthBytes != null ? fmtBytes(r.bandwidthBytes) : Dash()) },
        ]}
        rows={data?.rows || []}
      />
      <p className="foot">
        Numbers follow the selected date range. Workers report requests (Pages have no native
        traffic metric → Not available). Bandwidth is not reported per Worker by Cloudflare.
      </p>
    </>
  );
}
