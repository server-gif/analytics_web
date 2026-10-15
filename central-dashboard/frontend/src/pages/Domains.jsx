import React from "react";
import { api } from "../api/client.js";
import { useApi } from "../lib/useApi.js";
import { useFilters } from "../components/Layout.jsx";
import DataTable from "../components/DataTable.jsx";
import PageHeader from "../components/PageHeader.jsx";
import { ErrorState } from "../components/StateViews.jsx";
import { PageSkeleton } from "../components/Skeleton.jsx";

// Domain list (apex + discovered subdomains). Respects the filter bar:
// selected Project narrows to its domains; selected Domain narrows to that one.
export default function Domains() {
  const f = useFilters();
  const { data, loading, error } = useApi(() => api.domains(), []);
  if (loading) return <PageSkeleton variant="table" cols={5} rows={9} />;
  if (error) return <ErrorState message={error} />;

  let rows = data?.domains || [];
  if (f.account) rows = rows.filter((d) => d.account === f.account);
  if (f.project) rows = rows.filter((d) => d.project === f.project || d.domain === f.project);
  if (f.domain) rows = rows.filter((d) => d.domain === f.domain);

  return (
    <>
      <PageHeader
        title="Domains"
        sub={`${rows.length} shown${f.account ? ` · account: ${f.account}` : ""}`}
        items={[
          "Every hostname the dashboard knows: Cloudflare zone apexes, their discovered subdomains, Pages domains, plus any hostnames seen in tracked (Analytics Engine) data.",
          "Select a domain in the filter bar (above) to scope Dashboard / Traffic / Countries and the User Journey pages to that exact host.",
          "Source = where the domain came from; Linked = whether it maps to a Cloudflare zone (unlinked hosts have no Cloudflare-native traffic but can still have tracked data).",
        ]}
      />
      <p className="foot">Per-domain analytics mate aa domain select karo (upaar filter bar mathi), ane Dashboard/Traffic tena mate refetch thay.</p>
      <DataTable
        columns={[
          { key: "domain", label: "Domain" },
          { key: "project", label: "Project" },
          { key: "account", label: "Account", width: "170px", render: (r) => r.account || <span className="na">n/a</span> },
          { key: "type", label: "Source", hint: "Where this hostname was discovered (zone / pages / tracked)." },
          {
            key: "linked",
            label: "Linked",
            hint: "Whether the host maps to a Cloudflare zone (yes = Cloudflare-native traffic is available for it).",
            render: (r) => (r.linked ? "yes" : <span className="na">no</span>),
          },
        ]}
        rows={rows}
      />
    </>
  );
}
