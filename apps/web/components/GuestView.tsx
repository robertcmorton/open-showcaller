"use client";

import { useEffect, useState } from "react";
import { computeTiming, formatDuration, formatTimeOfDay, type PlanRow } from "@opencall/core";
import { API_URL } from "../lib/api";
import { useColWidths } from "../lib/useColWidths";

interface GuestProjection {
  meta: { name: string; use24h: boolean; plannedStartSec: number | null; versionLabel: string | null };
  keyTimes: { id: string; label: string; sec: number }[];
  lastUpdated: string | null;
  columns: { id: string; key: string; title: string; kind: string }[];
  rows: (PlanRow & { title: string; color: string | null; cells: Record<string, string> })[];
}

/**
 * Guest pass: read-only, no login, refresh-to-update. The server sends a
 * column-filtered projection — the collaborative document never reaches guests.
 */
export function GuestView({ token }: { token: string }) {
  const [data, setData] = useState<GuestProjection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { widths, handle, tableStyle } = useColWidths(`oc:colwidths:guest:${token}`);

  useEffect(() => {
    fetch(`${API_URL}/guest/${token}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `${res.status}`);
        setData((await res.json()) as GuestProjection);
      })
      .catch((err) => setError(String(err.message ?? err)));
  }, [token]);

  if (error)
    return (
      <main style={{ padding: "4rem", textAlign: "center", color: "var(--over)" }}>
        This guest pass is invalid or has been revoked.
      </main>
    );
  if (!data) return <main style={{ padding: "4rem", textAlign: "center", color: "var(--text-3)" }}>Loading…</main>;

  const { meta, columns, rows } = data;
  const timing = computeTiming(rows, meta.plannedStartSec);
  // Columns render in the doc's order, which mirrors the source sheet.
  const orderedColumns = columns.filter(
    (c) => c.kind === "title" || c.kind === "startTime" || c.kind === "duration" || c.kind === "richtext",
  );

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "2rem 1.2rem" }}>
      <header style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap", marginBottom: "1rem" }}>
        <h1 style={{ fontSize: "1.2rem", margin: 0 }}>{meta.name}</h1>
        {meta.versionLabel && <span className="chip" style={{ color: "var(--warn)", borderColor: "var(--warn)" }}>{meta.versionLabel}</span>}
        {data.keyTimes.length > 0 && (
          <span style={{ color: "var(--text-2)", fontSize: "var(--fs-sm)" }} className="mono">
            {data.keyTimes.map((kt) => `${kt.label} ${formatTimeOfDay(kt.sec, meta.use24h)}`).join(" · ")}
          </span>
        )}
        <span style={{ color: "var(--text-3)", fontSize: "var(--fs-xs)" }}>
          read-only guest view
          {data.lastUpdated ? ` · last updated ${new Date(data.lastUpdated).toLocaleString()}` : ""} · refresh for the
          latest version
        </span>
        <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={() => window.print()}>
          Print
        </button>
      </header>

      {(() => {
        const orderedKeys = ["rownum", ...orderedColumns.map((c) => c.key)];
        const nextOf = (key: string): string | null => {
          const i = orderedKeys.indexOf(key);
          return i >= 0 && i < orderedKeys.length - 1 ? orderedKeys[i + 1]! : null;
        };
        const fixedStyle = tableStyle(orderedKeys);
        return (
      <table className={`rundown-grid ${fixedStyle ? "cols-fixed" : ""}`} style={fixedStyle}>
        <thead>
          <tr>
            <th data-colkey="rownum" style={{ width: widths["rownum"] }}>#{handle("rownum", nextOf("rownum"))}</th>
            {orderedColumns.map((c) => {
              const w = widths[c.key] ?? (c as { width?: number }).width;
              return (
                <th key={c.id} data-colkey={c.key} style={w ? { width: w } : undefined}>
                  {c.title}
                  {handle(c.key, nextOf(c.key))}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const t = timing.rows[i]!;
            return (
              <tr
                key={row.id}
                className={row.type === "group" ? "group-row" : row.type === "milestone" ? "milestone-row" : ""}
                style={{ background: row.type !== "group" && row.color ? row.color : undefined }}
              >
                <td className="row-number mono" style={{ cursor: "default" }}>
                  {(row as { sourceNumber?: string }).sourceNumber ?? i + 1}
                </td>
                {orderedColumns.map((c) =>
                  c.kind === "title" ? (
                    <td key={c.id} style={{ fontWeight: row.type === "group" ? 600 : 400 }}>{row.title}</td>
                  ) : c.kind === "startTime" ? (
                    <td key={c.id} className="mono">{t.startSec != null ? formatTimeOfDay(t.startSec, meta.use24h) : "—"}</td>
                  ) : c.kind === "duration" ? (
                    <td key={c.id} className="mono">{row.durationSec != null ? formatDuration(row.durationSec) : ""}</td>
                  ) : (
                    <td key={c.id}>{row.cells[c.key] ?? ""}</td>
                  ),
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
        );
      })()}
    </main>
  );
}
