import React, { useEffect, useMemo, useState } from "react";
import { Empty } from "./StateViews.jsx";
import { InfoTip } from "./PageHeader.jsx";

/**
 * DataTable columns: [{ key, label, hint?, render?(row), align?, width? }]
 *  - render vaparyu to cell e value e rendering karay; natari row[key] dekhay.
 *  - hint  : th label par info tooltip (metric samaj mate).
 * Pagination: pageSize>0 ane rows mota hoy to page-nav controls dekhay, etle
 * long lists page ne lambi na kare. Default 25 per page.
 * onRowClick/rowKey/isSelected: row-ne clickable + selected highlight (drill-down mate).
 */
export default function DataTable({
  columns,
  rows,
  pageSize = 25,
  onRowClick,
  rowKey,
  isSelected,
  emptyText,
}) {
  const total = rows ? rows.length : 0;
  const pageCount = pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  const [page, setPage] = useState(0);

  // whenever the dataset shrinks below the current page (e.g. a filter change),
  // clamp back into range so we never show an empty page
  useEffect(() => {
    setPage((p) => Math.min(p, pageCount - 1));
  }, [pageCount, total]);

  const visible = useMemo(() => {
    if (!rows || !rows.length) return [];
    if (pageSize <= 0 || total <= pageSize) return rows;
    const start = page * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, page, pageSize, total]);

  if (!total) return <Empty text={emptyText} />;

  const from = pageSize > 0 && total > pageSize ? page * pageSize + 1 : 1;
  const to = pageSize > 0 && total > pageSize ? Math.min(total, (page + 1) * pageSize) : total;

  return (
    <>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} style={{ textAlign: c.align || "left", width: c.width }}>
                  {c.label}
                  {c.hint ? <InfoTip text={c.hint} /> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, i) => (
              <tr
                key={rowKey ? rowKey(row, i) : i}
                onClick={onRowClick ? () => onRowClick(row, i) : undefined}
                className={
                  (onRowClick ? " clickable" : "") +
                  (isSelected && isSelected(row, page * pageSize + i) ? " selected" : "")
                }
              >
                {columns.map((c) => (
                  <td key={c.key} style={{ textAlign: c.align || "left" }}>
                    {c.render ? c.render(row) : row[c.key] ?? "Not available"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pageSize > 0 && total > pageSize && (
        <div className="pager">
          <span className="pager-info">
            {from}–{to} of {total.toLocaleString("en-US")}
          </span>
          <button type="button" className="chip more" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
            ‹ Prev
          </button>
          <span className="pager-page">
            Page {page + 1} / {pageCount}
          </span>
          <button type="button" className="chip more" disabled={page >= pageCount - 1} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}>
            Next ›
          </button>
        </div>
      )}
    </>
  );
}
