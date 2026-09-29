"use client";

import { useState } from "react";
import { getAdminTableRows, getAdminTables } from "@/lib/client/api";
import type { AdminTableSummary, JsonValue, Party } from "@/lib/domain/types";
import { Card, EmptyState, ErrorState, LoadingState } from "@/components/ui";
import { PageHeader } from "@/components/consoles/PageShell";
import { useAsync } from "@/components/consoles/useAsync";

const PARTY_LABEL: Record<Party, string> = { oem: "OEM", biller: "Biller", nbbl: "NBBL", cou: "COU" };
const PARTY_ORDER: Party[] = ["oem", "biller", "nbbl", "cou"];

/** https://<ref>.supabase.co -> https://supabase.com/dashboard/project/<ref>/editor */
function supabaseEditorUrl(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  try {
    const ref = new URL(url).hostname.split(".")[0];
    if (!ref || ref === "your-project-ref") return null;
    return `https://supabase.com/dashboard/project/${ref}/editor`;
  } catch {
    return null;
  }
}

function cell(v: JsonValue | undefined): string {
  if (v === null || v === undefined) return "null";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

function Rows({ name }: { name: string }) {
  const rows = useAsync(() => getAdminTableRows(name), name);
  const d = rows.data;
  return (
    <Card title={<span>Rows in <span className="font-mono">{name}</span></span>} actions={<span className="text-xs text-ink-faint">Read-only, max 100</span>}>
      {rows.error ? (
        <ErrorState error={rows.error} onRetry={() => void rows.reload()} />
      ) : rows.loading || !d ? (
        <LoadingState label="Loading rows..." />
      ) : d.rows.length === 0 ? (
        <EmptyState title="Table is empty" />
      ) : (
        <div className="max-h-[32rem] max-w-full overflow-auto">
          <table className="min-w-max border-collapse text-xs tabular-nums">
            <caption className="sr-only">{name} rows</caption>
            <thead className="sticky top-0">
              <tr className="bg-surface-2 text-ink-muted">
                {d.columns.map((c) => (
                  <th key={c} scope="col" className="px-3 py-2 text-left font-medium whitespace-nowrap">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.rows.slice(0, 100).map((r, i) => (
                <tr key={i} className="border-t border-line">
                  {d.columns.map((c) => (
                    <td key={c} className="max-w-xs truncate px-3 py-1.5 font-mono whitespace-nowrap" title={cell(r[c])}>
                      {cell(r[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export default function AdminDbPage() {
  const tables = useAsync(getAdminTables, "tables");
  const [selected, setSelected] = useState<string | null>(null);
  const editor = supabaseEditorUrl();

  const groups = PARTY_ORDER.map((p) => ({ party: p, items: (tables.data ?? []).filter((t: AdminTableSummary) => t.party === p) }));

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
      <PageHeader
        title="Database explorer"
        subtitle="Read-only view of every party's tables."
        actions={
          editor ? (
            <a
              href={editor}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-accent hover:bg-surface-2"
            >
              Open in Supabase
            </a>
          ) : (
            <span className="text-xs text-ink-faint">Set NEXT_PUBLIC_SUPABASE_URL to enable the Supabase link</span>
          )
        }
      />

      <Card title="Tables" className="mb-6">
        {tables.error ? (
          <ErrorState error={tables.error} onRetry={() => void tables.reload()} />
        ) : tables.loading || !tables.data ? (
          <LoadingState label="Loading tables..." />
        ) : (
          <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
            {groups.map((g) => (
              <div key={g.party}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">{PARTY_LABEL[g.party]}</h3>
                <ul className="space-y-1">
                  {g.items.map((t) => (
                    <li key={t.table}>
                      <button
                        type="button"
                        aria-pressed={selected === t.table}
                        onClick={() => setSelected(t.table)}
                        className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-left text-sm ${
                          selected === t.table ? "border-accent bg-accent-soft text-accent" : "border-line hover:bg-surface-2"
                        }`}
                      >
                        <span className="font-mono text-xs">{t.table}</span>
                        <span className="rounded-pill bg-surface-2 px-2 text-xs tabular-nums text-ink-muted">{t.rows}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>

      {selected ? <Rows name={selected} /> : null}
    </main>
  );
}
