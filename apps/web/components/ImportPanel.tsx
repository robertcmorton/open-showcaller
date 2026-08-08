"use client";

import { useEffect, useMemo, useState } from "react";
import {
  buildSheet,
  classifySheet,
  looksLikeBotchedValue,
  detectRoles,
  findCueTypeColumn,
  findRoleColumn,
  formatDuration,
  formatTimeOfDay,
  parseDurationLoose,
  parseTimeLoose,
  planImport,
  suggestDurationFix,
  suggestTimeFix,
  type ClassifiedRow,
  type ColumnTarget,
} from "@opencall/core";
import { DEFAULT_COLUMNS, type SeedRow } from "@opencall/db/doc";
import { api, fetchRundownSource } from "../lib/api";
import { extractGrid } from "../lib/importExtract";

/** ArrayBuffer → base64 (chunked — sheets can be megabytes). */
function bufferToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

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

interface RowSummary {
  rowNumber: number;
  title: string;
  time: string;
  dur: string;
}

interface CellIssue {
  key: string;
  rowNumber: number;
  title: string;
  kind: "start" | "duration";
  raw: string;
  suggestion: string | null;
  sourceIndex: number;
  anchorBefore: RowSummary | null;
  around: RowSummary[];
}

/** One unparseable cell: raw value, an editable suggested fix, apply/clear/keep. */
function IssueFixRow({
  issue,
  onApply,
  onKeep,
}: {
  issue: CellIssue;
  onApply: (issue: CellIssue, value: string) => void;
  onKeep: () => void;
}) {
  const [value, setValue] = useState(issue.suggestion ?? "");
  const parses = issue.kind === "start" ? parseTimeLoose(value) != null : parseDurationLoose(value) != null;
  return (
    <div style={{ display: "grid", gap: 3, fontSize: "var(--fs-sm)" }}>
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ color: "var(--text-3)", minWidth: 52 }}>Row {issue.rowNumber}</span>
      <span style={{ minWidth: 120, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {issue.title || "—"}
      </span>
      <span className="chip">{issue.kind === "start" ? "START" : "DURATION"}</span>
      <code style={{ color: "var(--over)", background: "var(--over-soft)", padding: "2px 6px", borderRadius: 4 }}>{issue.raw}</code>
      <span style={{ color: "var(--text-3)" }}>→</span>
      <input
        className="input mono"
        style={{ width: 110, padding: "3px 8px" }}
        placeholder={issue.kind === "start" ? "e.g. 7:30 pm" : "e.g. 5:00"}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        title={issue.suggestion ? `Suggested: ${issue.suggestion}` : "No automatic suggestion — type the intended value"}
      />
      <button className="btn btn-sm btn-primary" disabled={!parses} title={parses ? "Replace the cell with this value" : "Doesn't parse yet"} onClick={() => onApply(issue, value)}>
        Apply
      </button>
      <button className="btn btn-sm btn-ghost" title="Import this cell as empty" onClick={() => onApply(issue, "")}>
        Clear
      </button>
      <button className="btn btn-sm btn-ghost" title="Leave it — the cell imports empty but the text stays visible here" onClick={onKeep}>
        Keep as is
      </button>
    </div>
    <div style={{ color: "var(--text-3)", fontSize: "var(--fs-xs)", paddingLeft: 52 }}>
      {issue.anchorBefore
        ? `sits after row ${issue.anchorBefore.rowNumber} “${issue.anchorBefore.title.slice(0, 34)}” at ${issue.anchorBefore.time}`
        : "sits before the first timed row"}
      <details style={{ display: "inline-block", marginLeft: 10 }}>
        <summary style={{ cursor: "pointer", display: "inline" }}>surrounding rows</summary>
        <table style={{ margin: "4px 0 2px", borderCollapse: "collapse" }}>
          <tbody>
            {issue.around.map((s) => (
              <tr key={s.rowNumber} style={s.rowNumber === issue.rowNumber ? { color: "var(--warn)", fontWeight: 600 } : undefined}>
                <td style={{ padding: "1px 10px 1px 0" }}>{s.rowNumber}</td>
                <td style={{ padding: "1px 10px 1px 0", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</td>
                <td className="mono" style={{ padding: "1px 10px 1px 0" }}>{s.time}</td>
                <td className="mono" style={{ padding: "1px 0" }}>{s.dur}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
    </div>
  );
}

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
export function ImportPanel({
  eventId,
  replaceRundown,
  onDone,
  onClose,
}: {
  eventId: string;
  /** Update mode: the imported sheet REPLACES this rundown's content (same id, links, codes). */
  replaceRundown?: { id: string; name: string };
  onDone: (rundownId: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [rawGrid, setRawGrid] = useState<string[][] | null>(null); // as extracted, pre-merge
  const [lineMeta, setLineMeta] = useState<{ page: number; y: number }[] | undefined>(undefined);
  const [rowLines, setRowLines] = useState<{ page: number; ys: number[] }[] | undefined>(undefined);
  // Text the source set in ITALIC — how a run sheet marks words to be read
  // aloud. Kept in state because rows are re-classified as cells are fixed.
  const [italicText, setItalicText] = useState<string[] | undefined>(undefined);
  const [isPdf, setIsPdf] = useState(false);
  const [grid, setGrid] = useState<string[][] | null>(null);
  const [headerIndex, setHeaderIndex] = useState(0);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ColumnTarget[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [widths, setWidths] = useState<(number | null)[]>([]);
  // The dropped file itself — stored with the rundown so future updates can
  // re-read it with whatever the pipeline has learned since.
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [autoLoaded, setAutoLoaded] = useState<string | null>(null);

  const rows = useMemo(
    // classifySheet, not classifyRows: the item numbers and outcome branches
    // come with it. Re-classifying without them is how imports lost the
    // sheet’s own numbering.
    () => (grid ? classifySheet(grid, headerIndex, mapping, italicText) : []),
    [grid, headerIndex, mapping, italicText],
  );
  const importable = rows.filter((r) => r.kind !== "spacer");
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  // Every cell that failed to parse, with a repair suggestion — fixable one by
  // one, each shown with its surroundings so the fix can be judged in context.
  const issues = useMemo(() => {
    const summaries: { rowNumber: number; title: string; time: string; dur: string }[] = [];
    const pending: { key: string; rowNumber: number; title: string; kind: "start" | "duration"; raw: string; suggestion: string | null; sourceIndex: number; at: number }[] = [];
    let n = 0;
    for (const r of rows) {
      if (r.kind === "spacer") continue;
      n += 1;
      summaries.push({
        rowNumber: n,
        title: r.title || (r.kind === "banner" ? "— section —" : "—"),
        time: r.startSec != null ? formatTimeOfDay(r.startSec, false) : r.startRaw ? (looksLikeBotchedValue(r.startRaw) ? `⚠ ${r.startRaw}` : r.startRaw) : "",
        dur: r.durationSec != null ? formatDuration(r.durationSec) : r.durationRaw ? (looksLikeBotchedValue(r.durationRaw) ? `⚠ ${r.durationRaw}` : r.durationRaw) : "",
      });
      const at = summaries.length - 1;
      // Only offer a fix where one is plausibly needed. A TIME or DUR cell
      // holding a label ("Interchange", "Head Coach", "TBC") is the sheet
      // using the column for something else, not a value typed wrong — the
      // text is kept beside the column either way.
      if (r.startRaw && looksLikeBotchedValue(r.startRaw))
        pending.push({ key: `${r.sourceIndex}:start`, rowNumber: n, title: r.title, kind: "start", raw: r.startRaw, suggestion: suggestTimeFix(r.startRaw), sourceIndex: r.sourceIndex, at });
      if (r.durationRaw && looksLikeBotchedValue(r.durationRaw))
        pending.push({ key: `${r.sourceIndex}:duration`, rowNumber: n, title: r.title, kind: "duration", raw: r.durationRaw, suggestion: suggestDurationFix(r.durationRaw), sourceIndex: r.sourceIndex, at });
    }
    return pending
      .filter((i) => !dismissed.has(i.key))
      .map(({ at, ...issue }) => ({
        ...issue,
        // The nearest TIMED row above (where in the show this sits) + a 5-row excerpt.
        anchorBefore: [...summaries.slice(0, at)].reverse().find((s) => s.time && !s.time.startsWith("⚠")) ?? null,
        around: summaries.slice(Math.max(0, at - 2), at + 3),
      }));
  }, [rows, dismissed]);
  const warnings = issues.length;

  /** Rewrites the offending line inside the source cell; empty removes it. */
  const applyFix = (issue: (typeof issues)[number], value: string) => {
    if (!grid) return;
    const col = mapping.findIndex((t) => t.kind === issue.kind);
    if (col < 0) return;
    const next = grid.map((row) => [...row]);
    const cell = next[issue.sourceIndex]?.[col] ?? "";
    const lines = cell.split("\n");
    const li = lines.findIndex((l) => l.trim() === issue.raw);
    if (li >= 0) {
      if (value.trim() === "") lines.splice(li, 1);
      else lines[li] = value.trim();
      next[issue.sourceIndex]![col] = lines.join("\n");
    } else {
      next[issue.sourceIndex]![col] = value.trim();
    }
    setGrid(next);
  };
  // The sheet's own role column (WHO, ROLE…) is the roster when it exists.
  const roleKey = useMemo(() => findRoleColumn(headers, mapping), [headers, mapping]);
  // Both columns that assign work: the WHO column naming people, and the cue
  // column naming the positions that run the show (VTR, GFX, LED, CAM).
  const roleKeys = useMemo(
    () => [roleKey, findCueTypeColumn(mapping, importable)].filter((k): k is string => !!k),
    [roleKey, mapping, importable],
  );
  const roles = useMemo(() => detectRoles(importable, 12, roleKeys), [importable, roleKeys]);

  const applyPlan = (
    source: string[][],
    pdf: boolean,
    forcedHeaderIndex?: number,
    meta?: { page: number; y: number }[],
    rules?: { page: number; ys: number[] }[],
  ) => {
    const plan = planImport(source, { headerIndex: forcedHeaderIndex, mergeWrapped: pdf, lineMeta: meta, rowLines: rules });
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
      const { grid: extracted, widths: extractedWidths, lineMeta: meta, rowLines: rules, italicText: italics } = await extractGrid(file);
      setRawGrid(extracted);
      setLineMeta(meta);
      setRowLines(rules);
      setItalicText(italics);
      setIsPdf(pdf);
      setWidths(extractedWidths);
      setSourceFile(file);
      applyPlan(extracted, pdf, undefined, meta, rules);
      setName(file.name.replace(/\.(xlsx|xls|csv|pdf)$/i, ""));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setGrid(null);
      setRawGrid(null);
    } finally {
      setBusy(false);
    }
  };

  // Update mode: re-read the STORED sheet automatically — the whole point is
  // "look at the run sheet again with the latest pipeline", no re-dropping.
  useEffect(() => {
    if (!replaceRundown) return;
    let cancelled = false;
    setBusy(true);
    void fetchRundownSource(replaceRundown.id)
      .then((file) => {
        if (cancelled || !file) return;
        setAutoLoaded(file.name);
        return onFile(file);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replaceRundown?.id]);

  const doImport = () => {
    // One conversion, shared with the audit script and the unit tests: what a
    // sheet BECOMES must not be decided by code only a browser can run.
    const built = buildSheet({ headers, mapping, rows }, { widths, roleColumnKey: roleKey, roles });
    setBusy(true);
    const buildPayload = async () => {
      const payload: Parameters<typeof api.replaceRundownContent>[1] = {
        rows: built.rows as SeedRow[],
        columns: built.columns,
        roles: built.roles,
        roleColumnKey: built.roleColumnKey,
        roleColumnKeys: built.roleColumnKeys,
        plannedStartSec: built.plannedStartSec,
        baseTitles: built.baseTitles,
        columnOrder: built.columnOrder,
      };
      if (sourceFile && sourceFile.size <= 12_000_000) {
        payload.sourceName = sourceFile.name;
        payload.sourceFileB64 = bufferToB64(await sourceFile.arrayBuffer());
      }
      return payload;
    };
    void buildPayload()
      .then((payload) =>
        replaceRundown
          ? api.replaceRundownContent(replaceRundown.id, payload).then(() => replaceRundown.id)
          : api.createRundown({ eventId, name: name.trim() || "Imported rundown", ...payload }).then(({ id }) => id),
      )
      .then((id) => onDone(id))
      .catch((err) => {
        setError(String(err));
        setBusy(false);
      });
  };

  return (
    <div className="panel" style={{ margin: "0 16px 14px", display: "grid", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <strong style={{ flex: 1 }}>
          {replaceRundown
            ? `Update “${replaceRundown.name}” from a run sheet — the new import replaces its content (links and codes keep working; the old content is snapshotted first)`
            : "Import a run sheet (XLSX, XLS, CSV, or PDF)"}
        </strong>
        <button className="btn btn-sm btn-ghost" onClick={onClose}>
          ✕
        </button>
      </div>

      {autoLoaded && grid && (
        <div style={{ color: "var(--text-2)", fontSize: "var(--fs-sm)" }}>
          Re-read the stored sheet <strong>{autoLoaded}</strong> with the current pipeline — review below, then
          update. Or drop a newer file via “Different file”.
        </div>
      )}

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
            {!replaceRundown && (
              <div>
                <label className="field-label">Rundown name</label>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} style={{ minWidth: 240 }} />
              </div>
            )}
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
                  applyPlan(rawGrid, isPdf, idx, lineMeta, rowLines);
                }}
              />
            </div>
            <span style={{ color: "var(--text-2)", fontSize: "var(--fs-sm)", paddingBottom: 7 }}>
              {importable.length} rows ({importable.filter((r) => r.kind === "milestone").length} milestones,{" "}
              {importable.filter((r) => r.kind === "banner").length} sections)
              {warnings > 0 && (
                <span style={{ color: "var(--warn)" }}> · {warnings} cell{warnings === 1 ? "" : "s"} couldn’t be parsed — fix below</span>
              )}
            </span>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <button className="btn btn-ghost" onClick={() => setGrid(null)}>
                Different file
              </button>
              <button className="btn btn-primary" disabled={busy || importable.length === 0} onClick={doImport}>
                {busy ? "Importing…" : `${replaceRundown ? "Update with" : "Import"} ${importable.length} rows`}
              </button>
            </div>
          </div>

          {issues.length > 0 && (
            <div className="panel" style={{ display: "grid", gap: 8, borderColor: "var(--warn)" }}>
              <strong style={{ fontSize: "var(--fs-sm)" }}>
                {issues.length} cell{issues.length === 1 ? "" : "s"} couldn’t be parsed — fix, clear, or keep each one
              </strong>
              <div style={{ display: "grid", gap: 8, maxHeight: "38vh", overflow: "auto" }}>
                {issues.map((issue) => (
                  <IssueFixRow key={issue.key} issue={issue} onApply={applyFix} onKeep={() => setDismissed(new Set([...dismissed, issue.key]))} />
                ))}
              </div>
            </div>
          )}

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

          <div style={{ overflow: "auto", maxHeight: "62vh" }}>
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
                {rows.map((r) =>
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
                        // Amber means "this needs your attention". A label in a
                        // time column does not — it is simply text, kept as text.
                        if (target.kind === "start" && raw) {
                          bad = r.startRaw != null && looksLikeBotchedValue(r.startRaw);
                          display = r.startSec != null ? formatTimeOfDay(r.startSec, false) : raw;
                        }
                        if (target.kind === "duration" && raw) {
                          bad = r.durationRaw != null && looksLikeBotchedValue(r.durationRaw);
                          display = r.durationSec != null ? formatDuration(r.durationSec) : raw;
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
            <p style={{ color: "var(--text-3)", fontSize: "var(--fs-xs)", margin: "6px 0 0" }}>
              All {rows.length} rows shown — {importable.length} will import.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
