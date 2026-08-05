"use client";

import { useMemo, useState } from "react";
import {
  classifyRows,
  detectRoles,
  findRoleColumn,
  formatDuration,
  formatTimeOfDay,
  planImport,
  type ClassifiedRow,
  type ColumnTarget,
} from "@opencall/core";
import { DEFAULT_COLUMNS, type SeedRow } from "@opencall/db/doc";
import { api } from "../lib/api";
import { extractGrid } from "../lib/importExtract";

const TARGET_OPTIONS: { value: string; label: string }[] = [
  { value: "title", label: "Title" },
  { value: "start", label: "Start time" },
  { value: "duration", label: "Duration" },
  ...DEFAULT_COLUMNS.filter((c) => c.kind === "richtext").map((c) => ({ value: `dept:${c.key}`, label: c.title })),
  { value: "custom", label: "New column (keep header)" },
  { value: "skip", label: "Skip" },
];

const targetToValue = (t: ColumnTarget): string => {
  if (t.kind === "department")
    return DEFAULT_COLUMNS.some((c) => c.key === t.key) ? `dept:${t.key}` : "custom";
  if (t.kind === "type") return "skip";
  return t.kind;
};

const valueToTarget = (value: string, header: string, index: number): ColumnTarget => {
  if (value === "title") return { kind: "title" };
  if (value === "start") return { kind: "start" };
  if (value === "duration") return { kind: "duration" };
  if (value === "custom")
    return {
      kind: "department",
      key: header.trim().toLowerCase().replace(/\W+/g, "-") || `column-${index + 1}`,
      title: header.trim() || `Column ${index + 1}`,
    };
  if (value.startsWith("dept:")) {
    const key = value.slice(5);
    const def = DEFAULT_COLUMNS.find((c) => c.key === key);
    return { kind: "department", key, title: def?.title ?? key };
  }
  return { kind: "skip" };
};

const KIND_STYLE: Record<ClassifiedRow["kind"], { label: string; color: string }> = {
  cue: { label: "cue", color: "var(--accent-text)" },
  milestone: { label: "milestone", color: "var(--warn)" },
  banner: { label: "section", color: "var(--text-2)" },
  spacer: { label: "spacer", color: "var(--text-3)" },
};

/**
 * Upload → extract → map columns → preview → import. Extraction is entirely
 * client-side; nothing is created until "Import" is pressed.
 */
export function ImportPanel({ eventId, onDone, onClose }: { eventId: string; onDone: (rundownId: string) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const [rawGrid, setRawGrid] = useState<string[][] | null>(null); // as extracted, pre-merge
  const [lineMeta, setLineMeta] = useState<{ page: number; y: number }[] | undefined>(undefined);
  const [isPdf, setIsPdf] = useState(false);
  const [grid, setGrid] = useState<string[][] | null>(null);
  const [headerIndex, setHeaderIndex] = useState(0);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ColumnTarget[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [widths, setWidths] = useState<(number | null)[]>([]);

  const rows = useMemo(
    () => (grid ? classifyRows(grid, headerIndex, mapping) : []),
    [grid, headerIndex, mapping],
  );
  const importable = rows.filter((r) => r.kind !== "spacer");
  const warnings = rows.filter((r) => r.startRaw || r.durationRaw).length;
  // The sheet's own role column (WHO, ROLE…) is the roster when it exists.
  const roleKey = useMemo(() => findRoleColumn(headers, mapping), [headers, mapping]);
  const roles = useMemo(() => detectRoles(importable, 12, roleKey), [importable, roleKey]);

  const applyPlan = (
    source: string[][],
    pdf: boolean,
    forcedHeaderIndex?: number,
    meta?: { page: number; y: number }[],
  ) => {
    const plan = planImport(source, { headerIndex: forcedHeaderIndex, mergeWrapped: pdf, lineMeta: meta });
    setGrid(plan.grid);
    setHeaderIndex(plan.headerIndex);
    setHeaders(plan.headers);
    setMapping(plan.mapping);
  };

  const onFile = async (file: File) => {
    setError(null);
    setBusy(true);
    try {
      const pdf = /\.pdf$/i.test(file.name);
      const { grid: extracted, widths: extractedWidths, lineMeta: meta } = await extractGrid(file);
      setRawGrid(extracted);
      setLineMeta(meta);
      setIsPdf(pdf);
      setWidths(extractedWidths);
      applyPlan(extracted, pdf, undefined, meta);
      setName(file.name.replace(/\.(xlsx|xls|csv|pdf)$/i, ""));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setGrid(null);
      setRawGrid(null);
    } finally {
      setBusy(false);
    }
  };

  const doImport = () => {
    // When the sheet has NO role column of its own, every detected role that
    // appears in a row's cells lands in a synthesized "Roles" column (an item
    // can carry several). Sheets with a WHO/ROLE column keep it as-is.
    const rolesFor = (r: ClassifiedRow): string => {
      if (roleKey) return "";
      const hay = `${r.title}\n${Object.values(r.cells).join("\n")}`.toLowerCase();
      return roles
        .filter((role) => hay.includes(role.name.toLowerCase()))
        .map((role) => role.name)
        .join(", ");
    };
    const seedRows: SeedRow[] = importable.map((r) => {
      if (r.kind === "banner") return { type: "group", title: r.title };
      if (r.kind === "milestone") {
        // Keep the cells, and let the banner title fall back to the first cell
        // value — PDF extraction sometimes lands a title in a neighboring band.
        const fallback = Object.values(r.cells).find((v) => v.trim());
        return {
          type: "milestone",
          title: r.title || fallback || "—",
          durationSec: null,
          hardStartSec: r.startSec,
          cells: r.cells,
        };
      }
      const assigned = rolesFor(r);
      return {
        type: "cue",
        title: r.title,
        durationSec: r.durationSec,
        hardStartSec: r.startSec,
        cells: assigned ? { ...r.cells, roles: assigned } : r.cells,
      };
    });
    // The rundown mirrors the sheet: every department column with data, in
    // source order, with the source's own name and a proportional width.
    const usedKeys = new Set(importable.flatMap((r) => Object.keys(r.cells)));
    const clampWidth = (w: number | null | undefined): number | undefined =>
      w ? Math.min(420, Math.max(80, w)) : undefined;
    const roleColumn: { key: string; title: string; width?: number }[] =
      roles.length > 0 && !roleKey ? [{ key: "roles", title: "Roles", width: 140 }] : [];
    const customColumns = roleColumn.concat(
      mapping
      .map((t, i) => ({ t, i }))
      .filter(
        (x): x is { t: Extract<ColumnTarget, { kind: "department" }>; i: number } =>
          x.t.kind === "department" && usedKeys.has(x.t.key),
      )
      .map(({ t, i }) => ({ key: t.key, title: t.title, width: clampWidth(widths[i]) })),
    );
    setBusy(true);
    api
      .createRundown({
        eventId,
        name: name.trim() || "Imported rundown",
        rows: seedRows,
        columns: customColumns,
        roles,
        roleColumnKey: roleKey ?? (roles.length > 0 ? "roles" : null),
      })
      .then(({ id }) => onDone(id))
      .catch((err) => {
        setError(String(err));
        setBusy(false);
      });
  };

  return (
    <div className="panel" style={{ margin: "0 16px 14px", display: "grid", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <strong style={{ flex: 1 }}>Import a run sheet (XLSX, XLS, CSV, or PDF)</strong>
        <button className="btn btn-sm btn-ghost" onClick={onClose}>
          ✕
        </button>
      </div>

      {!grid && (
        <label
          className="empty"
          style={{
            border: `1.5px dashed ${dragOver ? "var(--accent)" : "var(--border)"}`,
            background: dragOver ? "var(--accent-soft)" : undefined,
            borderRadius: "var(--r-md)",
            cursor: "pointer",
            display: "block",
            transition: "border-color var(--t-fast) var(--ease), background var(--t-fast) var(--ease)",
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) void onFile(file);
          }}
        >
          <input
            type="file"
            accept=".xlsx,.xls,.csv,.pdf"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onFile(file);
            }}
          />
          <div className="glyph">⤒</div>
          <div>
            {busy
              ? "Reading file…"
              : dragOver
                ? "Drop it here"
                : "Drop a file here or click to choose — spreadsheets and text-based PDFs work; nothing uploads until you confirm."}
          </div>
        </label>
      )}

      {error && <div style={{ color: "var(--over)", fontSize: "var(--fs-sm)" }}>{error}</div>}

      {grid && (
        <>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div>
              <label className="field-label">Rundown name</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} style={{ minWidth: 240 }} />
            </div>
            <div>
              <label className="field-label" title="Which source row holds the column headers — adjust if detection picked the wrong one">
                Header row
              </label>
              <input
                className="input mono"
                type="number"
                min={1}
                max={grid.length}
                value={headerIndex + 1}
                style={{ width: 74 }}
                onChange={(e) => {
                  if (!rawGrid) return;
                  const idx = Math.min(rawGrid.length - 1, Math.max(0, Number(e.target.value) - 1));
                  applyPlan(rawGrid, isPdf, idx, lineMeta);
                }}
              />
            </div>
            <span style={{ color: "var(--text-2)", fontSize: "var(--fs-sm)", paddingBottom: 7 }}>
              {importable.length} rows ({importable.filter((r) => r.kind === "milestone").length} milestones,{" "}
              {importable.filter((r) => r.kind === "banner").length} sections)
              {warnings > 0 && (
                <span style={{ color: "var(--warn)" }}> · {warnings} cells couldn’t be parsed — shown below</span>
              )}
            </span>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <button className="btn btn-ghost" onClick={() => setGrid(null)}>
                Different file
              </button>
              <button className="btn btn-primary" disabled={busy || importable.length === 0} onClick={doImport}>
                {busy ? "Importing…" : `Import ${importable.length} rows`}
              </button>
            </div>
          </div>

          {roles.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span className="field-label" style={{ margin: 0 }}>
                Detected roles
              </span>
              {roles.map((r) => (
                <span
                  key={r.name}
                  className="chip"
                  style={{ borderColor: r.color, color: r.color, background: `${r.color}1a` }}
                >
                  {r.name}
                </span>
              ))}
            </div>
          )}

          <div style={{ overflowX: "auto" }}>
            <table className="rundown-grid" style={{ fontSize: "0.78rem" }}>
              <thead>
                <tr>
                  <th style={{ width: 90 }}>Row</th>
                  {headers.map((h, i) => (
                    <th key={i}>
                      <div style={{ marginBottom: 4 }}>{h.trim() || "—"}</div>
                      <select
                        className="input"
                        style={{ padding: "2px 6px", fontSize: "0.72rem" }}
                        value={targetToValue(mapping[i] ?? { kind: "skip" })}
                        onChange={(e) => {
                          const next = [...mapping];
                          next[i] = valueToTarget(e.target.value, h, i);
                          setMapping(next);
                        }}
                      >
                        {TARGET_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 40).map((r) =>
                  r.kind === "spacer" ? null : (
                    <tr key={r.sourceIndex} className={r.kind === "banner" ? "group-row" : ""}>
                      <td style={{ color: KIND_STYLE[r.kind].color, fontSize: "0.7rem", whiteSpace: "nowrap" }}>
                        {KIND_STYLE[r.kind].label}
                      </td>
                      {headers.map((_, col) => {
                        const target = mapping[col] ?? { kind: "skip" };
                        const raw = (grid[r.sourceIndex]?.[col] ?? "").trim();
                        let display: React.ReactNode = raw;
                        let bad = false;
                        if (target.kind === "start" && raw) {
                          bad = r.startRaw != null;
                          display = bad ? raw : r.startSec != null ? formatTimeOfDay(r.startSec, false) : raw;
                        }
                        if (target.kind === "duration" && raw) {
                          bad = r.durationRaw != null;
                          display = bad ? raw : r.durationSec != null ? formatDuration(r.durationSec) : raw;
                        }
                        return (
                          <td
                            key={col}
                            style={{
                              opacity: target.kind === "skip" ? 0.35 : 1,
                              background: bad ? "var(--over-soft)" : undefined,
                              color: bad ? "var(--over)" : undefined,
                            }}
                            title={bad ? `Couldn't parse "${raw}" — it will import empty` : undefined}
                          >
                            {display}
                          </td>
                        );
                      })}
                    </tr>
                  ),
                )}
              </tbody>
            </table>
            {rows.length > 40 && (
              <p style={{ color: "var(--text-3)", fontSize: "var(--fs-xs)", margin: "6px 0 0" }}>
                Showing the first 40 rows — all {importable.length} import.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
