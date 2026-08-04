"use client";

import { useMemo, useState } from "react";
import {
  classifyRows,
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

const valueToTarget = (value: string, header: string): ColumnTarget => {
  if (value === "title") return { kind: "title" };
  if (value === "start") return { kind: "start" };
  if (value === "duration") return { kind: "duration" };
  if (value === "custom")
    return {
      kind: "department",
      key: header.trim().toLowerCase().replace(/\W+/g, "-") || "column",
      title: header.trim() || "Column",
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
  const [grid, setGrid] = useState<string[][] | null>(null);
  const [headerIndex, setHeaderIndex] = useState(0);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ColumnTarget[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const rows = useMemo(
    () => (grid ? classifyRows(grid, headerIndex, mapping) : []),
    [grid, headerIndex, mapping],
  );
  const importable = rows.filter((r) => r.kind !== "spacer");
  const warnings = rows.filter((r) => r.startRaw || r.durationRaw).length;

  const onFile = async (file: File) => {
    setError(null);
    setBusy(true);
    try {
      const extracted = await extractGrid(file);
      const plan = planImport(extracted);
      setGrid(extracted);
      setHeaderIndex(plan.headerIndex);
      setHeaders(plan.headers);
      setMapping(plan.mapping);
      setName(file.name.replace(/\.(xlsx|xls|csv|pdf)$/i, ""));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setGrid(null);
    } finally {
      setBusy(false);
    }
  };

  const doImport = () => {
    const seedRows: SeedRow[] = importable.map((r) => {
      if (r.kind === "banner") return { type: "group", title: r.title };
      if (r.kind === "milestone")
        return { type: "milestone", title: r.title || "—", durationSec: null, hardStartSec: r.startSec };
      return {
        type: "cue",
        title: r.title,
        durationSec: r.durationSec,
        hardStartSec: r.startSec,
        cells: r.cells,
      };
    });
    const customColumns = mapping
      .filter(
        (t): t is Extract<ColumnTarget, { kind: "department" }> =>
          t.kind === "department" && !DEFAULT_COLUMNS.some((c) => c.key === t.key),
      )
      .map((t) => ({ key: t.key, title: t.title }));
    setBusy(true);
    api
      .createRundown({ eventId, name: name.trim() || "Imported rundown", rows: seedRows, columns: customColumns })
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
                          next[i] = valueToTarget(e.target.value, h);
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
