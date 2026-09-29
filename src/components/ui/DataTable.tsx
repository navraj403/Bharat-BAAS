import type { ReactNode } from "react";
import { EmptyState } from "./EmptyState";

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: "left" | "right";
  className?: string;
}

/** Semantic table; scrolls horizontally inside its own container. */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  empty,
  onRowClick,
  selectedKey,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  caption: string;
  empty?: string;
  onRowClick?: (row: T) => void;
  selectedKey?: string | null;
}) {
  if (rows.length === 0) return <EmptyState title={empty ?? "No rows"} />;
  return (
    <div className="max-w-full overflow-x-auto">
      <table className="w-full min-w-max border-collapse text-sm tabular-nums">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="bg-surface-2 text-xs uppercase tracking-wide text-ink-muted">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={`px-3 py-2 font-medium ${c.align === "right" ? "text-right" : "text-left"}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const k = rowKey(r);
            const selected = selectedKey === k;
            return (
              <tr key={k} className={`border-t border-line ${selected ? "bg-accent-soft" : onRowClick ? "hover:bg-surface-2" : ""}`}>
                {columns.map((c, i) => (
                  <td key={c.key} className={`px-3 py-2 align-middle ${c.align === "right" ? "text-right" : "text-left"} ${c.className ?? ""}`}>
                    {onRowClick && i === 0 ? (
                      <button
                        type="button"
                        onClick={() => onRowClick(r)}
                        aria-pressed={selected}
                        className="rounded font-medium text-accent underline-offset-2 hover:underline"
                      >
                        {c.render(r)}
                      </button>
                    ) : (
                      c.render(r)
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
