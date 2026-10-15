import React, { useState } from "react";

// Compact, expandable list of domains as pill chips.
// Shows `initial` chips by default; the rest collapse behind a "+N more" toggle.
export default function DomainChips({ domains = [], initial = 5 }) {
  const [open, setOpen] = useState(false);
  if (!domains.length) return <span className="na">no linked domain</span>;

  const shown = open ? domains : domains.slice(0, initial);
  const hidden = domains.length - initial;

  return (
    <div className="chips">
      {shown.map((d) => (
        <span key={d} className="chip" title={d}>{d}</span>
      ))}
      {hidden > 0 && (
        <button type="button" className="chip more" onClick={() => setOpen((o) => !o)}>
          {open ? "show less" : `+${hidden} more`}
        </button>
      )}
    </div>
  );
}
