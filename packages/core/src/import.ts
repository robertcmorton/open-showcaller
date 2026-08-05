import { parseDurationShorthand, parseTimeOfDay } from "./format";

/**
 * Run-sheet import: turn an extracted text grid (from XLSX/XLS/CSV/PDF) into
 * classified, tolerantly-parsed rows ready for a mapping preview. Everything
 * here is pure — file extraction lives in the web app; this module owns the
 * messy real-world semantics and is unit-tested against synthetic grids
 * modeled on real production house styles.
 */

// ── Tolerant value parsers ────────────────────────────────────────────────────

/**
 * Real-world duration cells: "3 mins", "1min 27 secs", "30 secs", "0:90:00"
 * (spreadsheet oddity meaning 90 minutes), "08:00" (minutes:seconds), "2h",
 * "15 seconds", "0mins", plus everything parseDurationShorthand takes.
 * Returns whole seconds, or null when the cell just isn't a duration.
 */
export function parseDurationLoose(raw: string): number | null {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/^[~≈]/, "")
    .replace(/\s+/g, " ");
  if (s === "") return null;

  // Worded units, e.g. "1min 27 secs", "3 mins", "15 seconds", "2 hrs".
  const worded = s.match(
    /^(?:(\d+)\s*(?:hours?|hrs?|h)\b)?\s*(?:(\d+)\s*(?:minutes?|mins?|m)\b)?\s*(?:(\d+)\s*(?:seconds?|secs?|s)\b)?$/,
  );
  if (worded && (worded[1] || worded[2] || worded[3])) {
    return (
      (worded[1] ? parseInt(worded[1], 10) * 3600 : 0) +
      (worded[2] ? parseInt(worded[2], 10) * 60 : 0) +
      (worded[3] ? parseInt(worded[3], 10) : 0)
    );
  }
  // "0mins" and friends: a unit with zero.
  if (/^0\s*(?:hours?|hrs?|minutes?|mins?|seconds?|secs?)$/.test(s)) return 0;

  // Spreadsheet time-formatted durations that leaked AM/PM: "0:90:00 am".
  const leaked = s.match(/^(\d+):(\d{1,2}):(\d{2})\s*(?:am|pm)$/);
  if (leaked) return parseInt(leaked[1]!, 10) * 3600 + parseInt(leaked[2]!, 10) * 60 + parseInt(leaked[3]!, 10);

  // H:MM:SS where MM may overflow ("0:90:00" = 90 minutes).
  const colon = s.match(/^(\d+):(\d{1,3}):(\d{2})$/);
  if (colon) return parseInt(colon[1]!, 10) * 3600 + parseInt(colon[2]!, 10) * 60 + parseInt(colon[3]!, 10);

  // "MM:SS" (also covers "08:00" → 8 minutes).
  const two = s.match(/^(\d{1,3}):(\d{2})$/);
  if (two) return parseInt(two[1]!, 10) * 60 + parseInt(two[2]!, 10);

  return parseDurationShorthand(s);
}

/**
 * Real-world time-of-day cells: "5:00:00PM" (no space), "6:00:00 pm",
 * "16:00:00", "4:30pm", "0900" (military), "16:14:30", "9am". Returns
 * seconds since midnight, or null.
 */
export function parseTimeLoose(raw: string): number | null {
  let s = raw.trim().toLowerCase().replace(/\./g, ":");
  if (s === "") return null;
  // Glue a space before a trailing am/pm ("5:00:00pm" → "5:00:00 pm").
  s = s.replace(/(\d)(am|pm)$/, "$1 $2");
  // Military "0900" / "1615".
  const military = s.match(/^([01]\d|2[0-3])([0-5]\d)$/);
  if (military) return parseInt(military[1]!, 10) * 3600 + parseInt(military[2]!, 10) * 60;
  return parseTimeOfDay(s);
}

// ── Header detection & column mapping ─────────────────────────────────────────

export type ColumnTarget =
  | { kind: "title" }
  | { kind: "start" }
  | { kind: "duration" }
  | { kind: "type" }
  | { kind: "department"; key: string; title: string }
  | { kind: "skip" };

const TITLE_HEADERS = ["title", "item", "name", "action", "activity", "segment", "cue", "description"];
const START_HEADERS = ["start", "start time", "time", "time of day", "tod"];
const DURATION_HEADERS = ["duration", "dur", "length", "run time", "runtime", "rt"];
const TYPE_HEADERS = ["type", "row type"];
const NUMBER_HEADERS = ["#", "no", "no.", "item #", "item no"];

/** Department headers used only to SCORE header rows during detection. */
const DEFAULT_TITLE_TO_KEY = new Map<string, true>([
  ["audio", true],
  ["video", true],
  ["lights", true],
  ["graphics", true],
  ["script", true],
  ["production notes", true],
  ["prod notes", true],
]);

/** Common department headers — used only to SCORE header rows, never to fold columns. */
const DEPARTMENT_DETECTION_HEADERS = [
  "audio", "video", "lights", "graphics", "script", "notes", "location",
  "track", "big screen", "side panel", "led", "screen", "who", "what",
  "vtr", "gfx", "cameras", "camera", "crew", "read",
];

/** Values that identify an untitled column as the cue-type column. */
const CUE_TYPE_TOKENS = new Set([
  "audio", "gfx", "vtr", "led", "pa", "mc", "ga", "dj", "hk", "crew", "pyro",
  "lighting", "super", "takeover", "score", "note", "cam", "live vision",
  "live vsn", "gfx and led", "vtr and led", "gfx & led", "dj booth", "sting",
]);

function normalizeHeader(cell: string): string {
  return cell.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Score how header-like a row is (count of recognized header keywords). */
function headerScore(row: string[]): number {
  let score = 0;
  for (const cell of row) {
    const h = normalizeHeader(cell);
    if (!h) continue;
    if (
      TITLE_HEADERS.includes(h) ||
      START_HEADERS.includes(h) ||
      DURATION_HEADERS.includes(h) ||
      TYPE_HEADERS.includes(h) ||
      NUMBER_HEADERS.includes(h) ||
      DEFAULT_TITLE_TO_KEY.has(h) ||
      DEPARTMENT_DETECTION_HEADERS.includes(h)
    )
      score += 1;
  }
  return score;
}

/**
 * Finds the most header-like row near the top of the grid. Real sheets bury
 * the header under multi-line title blocks, so the scan window is generous
 * (30 rows); the preview also lets the user override the pick.
 */
export function detectHeaderRow(grid: string[][]): number {
  let best = 0;
  let bestScore = -1;
  for (let i = 0; i < Math.min(grid.length, 30); i++) {
    const score = headerScore(grid[i]!);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return bestScore >= 2 ? best : 0;
}

/**
 * Maps each source column to a rundown target. The title goes to the
 * STRONGEST candidate — "ITEM" is a row-number column on many real sheets, so
 * it only wins when nothing better (ACTION, ACTIVITY, TITLE…) exists; losing
 * title-synonyms are skipped as numbering. Every non-structural column
 * becomes a column in the rundown, mirroring the source sheet's format;
 * `sampleRows` lets untitled columns be recognized by their DATA (a header-
 * less column full of VTR/PA/GFX tokens is the cue-type column, and a
 * header-less column with any other content still imports as "Column N"
 * instead of being dropped).
 */
export function mapColumns(headers: string[], sampleRows: string[][] = []): ColumnTarget[] {
  const normalized = headers.map(normalizeHeader);
  // Priority: earlier entries in TITLE_HEADERS beat later ones; "item" is last.
  const priority = ["title", "name", "activity", "action", "segment", "cue", "description", "item"];
  let titleIndex = -1;
  for (const candidate of priority) {
    const at = normalized.indexOf(candidate);
    if (at >= 0) {
      titleIndex = at;
      break;
    }
  }

  const usedKeys = new Set<string>();
  const uniqueKey = (base: string): string => {
    let key = base;
    let n = 2;
    while (usedKeys.has(key)) key = `${base}-${n++}`;
    usedKeys.add(key);
    return key;
  };
  const usedTitles = new Set<string>();
  const uniqueTitle = (base: string): string => {
    let title = base;
    let n = 2;
    while (usedTitles.has(title.toLowerCase())) title = `${base} (${n++})`;
    usedTitles.add(title.toLowerCase());
    return title;
  };

  return headers.map((cell, i) => {
    const h = normalized[i]!;
    if (i === titleIndex) return { kind: "title" };
    if (NUMBER_HEADERS.includes(h) || /^\d+$/.test(h) || TITLE_HEADERS.includes(h)) return { kind: "skip" };
    if (START_HEADERS.includes(h)) return { kind: "start" };
    if (DURATION_HEADERS.includes(h)) return { kind: "duration" };
    if (TYPE_HEADERS.includes(h)) return { kind: "department", key: uniqueKey("type"), title: "Type" };

    if (!h) {
      // Untitled column: recognize it by what it contains.
      const values = sampleRows.map((row) => (row[i] ?? "").trim().toLowerCase()).filter(Boolean);
      if (values.length === 0) return { kind: "skip" };
      // Pure row numbering (sheets often mirror # on the right edge) → skip.
      if (values.filter((v) => /^\d+$/.test(v)).length / values.length >= 0.9) return { kind: "skip" };
      const typeish = values.filter((v) => CUE_TYPE_TOKENS.has(v)).length;
      if (typeish / values.length >= 0.5)
        return { kind: "department", key: uniqueKey("type"), title: uniqueTitle("Type") };
      return { kind: "department", key: uniqueKey(`column-${i + 1}`), title: uniqueTitle(`Column ${i + 1}`) };
    }

    // Every titled column keeps its header VERBATIM as the column name —
    // the imported rundown mirrors the source sheet exactly.
    return { kind: "department", key: uniqueKey(h.replace(/\W+/g, "-")), title: uniqueTitle(cell.trim()) };
  });
}

// ── Row classification ────────────────────────────────────────────────────────

export interface ClassifiedRow {
  kind: "cue" | "milestone" | "banner" | "spacer";
  title: string;
  /** Parsed start (anchor) seconds, when the row carries one. */
  startSec: number | null;
  /** Raw start text that failed to parse (flagged in the preview). */
  startRaw: string | null;
  durationSec: number | null;
  durationRaw: string | null;
  cells: Record<string, string>;
  /** Source row index in the original grid (for the preview). */
  sourceIndex: number;
}

/**
 * Classifies data rows using the mapping:
 * - spacer: every mapped cell empty (dropped on import);
 * - banner: a title but no time, no duration, and no department content
 *   (section headings like "MAIN SHOW" → group rows);
 * - milestone: a start time but no duration ("Gates Open", "TEAM LIST DUE");
 * - cue: everything else.
 * Unparseable start/duration text is preserved in *Raw for the preview.
 */
export function classifyRows(grid: string[][], headerIndex: number, mapping: ColumnTarget[]): ClassifiedRow[] {
  const headerRow = grid[headerIndex]!;
  const out: ClassifiedRow[] = [];

  for (let i = headerIndex + 1; i < grid.length; i++) {
    const row = grid[i]!;
    // Repeated page headers (PDF extraction) are dropped.
    if (headerScore(row) >= 2 && row.join("|") === headerRow.join("|")) continue;

    let title = "";
    let startRaw = "";
    let durationRaw = "";
    const cells: Record<string, string> = {};
    let departmentContent = false;

    mapping.forEach((target, col) => {
      const value = (row[col] ?? "").trim();
      if (!value) return;
      if (target.kind === "title") title = title ? `${title} ${value}` : value;
      else if (target.kind === "start") {
        // Merged multi-line cells may hold several lines; the first parseable one wins.
        for (const line of value.split("\n")) {
          const v = line.trim();
          if (!v) continue;
          if (!startRaw || (parseTimeLoose(startRaw) == null && parseTimeLoose(v) != null)) startRaw = v;
        }
      } else if (target.kind === "duration") {
        for (const line of value.split("\n")) {
          const v = line.trim();
          if (!v) continue;
          if (!durationRaw || (parseDurationLoose(durationRaw) == null && parseDurationLoose(v) != null))
            durationRaw = v;
        }
      }
      else if (target.kind === "department") {
        cells[target.key] = cells[target.key] ? `${cells[target.key]}\n${value}` : value;
        departmentContent = true;
      }
    });

    const empty = !title && !startRaw && !durationRaw && !departmentContent;
    if (empty) {
      out.push({ kind: "spacer", title: "", startSec: null, startRaw: null, durationSec: null, durationRaw: null, cells: {}, sourceIndex: i });
      continue;
    }

    const startSec = startRaw ? parseTimeLoose(startRaw) : null;
    const durationSec = durationRaw ? parseDurationLoose(durationRaw) : null;

    let kind: ClassifiedRow["kind"] = "cue";
    if (title && !startRaw && !durationRaw && !departmentContent) kind = "banner";
    else if (startSec != null && !durationRaw) kind = "milestone";

    out.push({
      kind,
      title,
      startSec,
      startRaw: startRaw && startSec == null ? startRaw : null,
      durationSec,
      durationRaw: durationRaw && durationSec == null ? durationRaw : null,
      cells,
      sourceIndex: i,
    });
  }
  return out;
}

/** Page/vertical position of each extracted grid line (from the PDF extractor). */
export interface LineMeta {
  page: number;
  /** PDF y (grows upward — larger is higher on the page). */
  y: number;
}

/** The table's ruled horizontal lines on one page — authoritative row boundaries. */
export interface RowLines {
  page: number;
  ys: number[];
}

/**
 * PDF text extraction emits one grid row per VISUAL LINE, so a sheet item
 * whose cells wrap (a four-line WHAT column) arrives as several rows — most
 * of them empty shells. Real sheets number their items, and that column is
 * the row boundary: numbered lines start logical rows, every other line is a
 * continuation of a neighbouring item, cell lines joined with newlines.
 *
 * Attachment, in order of authority: (1) `rowLines` — the table's actual
 * ruled borders; two lines between the same pair of rules are the same
 * physical row. A ruled row with NO item number is a section banner when it
 * carries title-column content alone (kept as its own row); otherwise it is
 * a SUB-ROW of a merged item (sheets rule the WHO/WHAT lines inside one
 * item) and joins the previous numbered row. (2) `lineMeta` y-distance to
 * the nearer numbered line (cells are vertically centred, so a wrapped
 * cell's top lines sit ABOVE the item number). (3) The previous numbered
 * line. Without a credible item-number column the grid is returned
 * untouched.
 */
export function mergeWrappedRows(
  grid: string[][],
  headerIndex: number,
  lineMeta?: LineMeta[],
  rowLines?: RowLines[],
  mapping?: ColumnTarget[],
): string[][] {
  const headerRow = grid[headerIndex] ?? [];
  const dataRows = grid.slice(headerIndex + 1);
  if (dataRows.length === 0) return grid;

  // The item-number column: mostly pure integers, enough of them to matter.
  const columnCount = Math.max(...dataRows.map((r) => r.length), 0);
  let groupCol = -1;
  let groupInts = 0;
  for (let c = 0; c < columnCount; c++) {
    let nonEmpty = 0;
    let ints = 0;
    for (const row of dataRows) {
      const v = (row[c] ?? "").trim();
      if (!v) continue;
      nonEmpty += 1;
      if (/^\d+$/.test(v)) ints += 1;
    }
    if (ints >= 5 && ints / Math.max(1, nonEmpty) >= 0.8 && ints > groupInts) {
      groupCol = c;
      groupInts = ints;
    }
  }
  if (groupCol < 0) return grid;

  // Data lines in order, page headers repeated by pagination dropped.
  const lineIdxs: number[] = [];
  for (let i = headerIndex + 1; i < grid.length; i++) {
    const row = grid[i]!;
    if (headerScore(row) >= 2 && row.join("|") === headerRow.join("|")) continue;
    if (row.some((v) => v.trim())) lineIdxs.push(i);
  }

  // Numbered lines each open an item.
  const itemOf = new Map<number, number>();
  const numbered: number[] = [];
  for (const i of lineIdxs) {
    if (/^\d+$/.test((grid[i]![groupCol] ?? "").trim())) {
      itemOf.set(i, numbered.length);
      numbered.push(i);
    }
  }
  if (numbered.length === 0) return grid;

  // Physical-row bands from the ruled lines: band = which inter-rule gap a
  // line's y falls into. Two lines in the same band share a table row.
  const boundsByPage = new Map<number, number[]>();
  for (const b of rowLines ?? []) {
    if (b.ys.length > 0) boundsByPage.set(b.page, [...b.ys].sort((x, y) => y - x));
  }
  const bandOf = (i: number): string | null => {
    const m = lineMeta?.[i];
    if (!m) return null;
    const ys = boundsByPage.get(m.page);
    if (!ys) return null;
    let k = 0;
    while (k < ys.length && ys[k]! > m.y) k++;
    return `${m.page}:${k}`;
  };
  const itemByBand = new Map<string, number>();
  for (const n of numbered) {
    const band = bandOf(n);
    if (band != null && !itemByBand.has(band)) itemByBand.set(band, itemOf.get(n)!);
  }

  // Does this line look like a section banner? Title-column content and
  // nothing in any data column (times, durations, departments).
  const titleOnly = (i: number): boolean => {
    if (!mapping) return true; // no mapping knowledge — keep the row standalone
    let title = false;
    for (let c = 0; c < (grid[i]?.length ?? 0); c++) {
      if (!(grid[i]![c] ?? "").trim()) continue;
      const kind = mapping[c]?.kind ?? "skip";
      if (kind === "title") title = true;
      else if (kind !== "skip") return false;
    }
    return title;
  };

  const itemLines: number[][] = numbered.map((i) => [i]);
  const soloBands = new Map<string, number[]>(); // banner rows, merged per band
  const standalone: number[] = []; // unattachable lines, kept as their own rows
  let prevNum: number | null = null;
  for (const i of lineIdxs) {
    if (itemOf.has(i)) {
      prevNum = i;
      continue;
    }
    const band = bandOf(i);
    if (band != null) {
      const owner = itemByBand.get(band);
      if (owner != null) {
        itemLines[owner]!.push(i);
        continue;
      }
      // Numberless ruled row: a banner keeps its own row; anything else is a
      // sub-row of the item above (ruled WHO/WHAT lines inside one item).
      if (titleOnly(i)) {
        const lines = soloBands.get(band) ?? [];
        lines.push(i);
        soloBands.set(band, lines);
        continue;
      }
      const nextNum = numbered.find((n) => n > i);
      const target = prevNum != null ? itemOf.get(prevNum)! : nextNum != null ? itemOf.get(nextNum)! : null;
      if (target != null) itemLines[target]!.push(i);
      else standalone.push(i);
      continue;
    }
    const nextNum = numbered.find((n) => n > i);
    let target: number | null = prevNum != null ? itemOf.get(prevNum)! : null;
    if (lineMeta && nextNum != null) {
      const m = lineMeta[i];
      const nm = lineMeta[nextNum];
      const pm = prevNum != null ? lineMeta[prevNum] : undefined;
      if (m && nm && nm.page === m.page) {
        if (!pm || pm.page !== m.page || Math.abs(m.y - nm.y) < Math.abs(m.y - pm.y))
          target = itemOf.get(nextNum)!;
      }
    }
    if (target == null) standalone.push(i);
    else itemLines[target]!.push(i);
  }

  const build = (idxs: number[]): string[] => {
    const out: string[] = Array.from({ length: columnCount }, () => "");
    for (const i of [...idxs].sort((a, b) => a - b)) {
      grid[i]!.forEach((v, c) => {
        const value = v.trim();
        if (!value) return;
        out[c] = out[c] ? `${out[c]}\n${value}` : value;
      });
    }
    return out;
  };

  // Sheet order is preserved: each unit (item, banner band, or standalone
  // line) lands where its first line appeared.
  const units: { at: number; rows: () => string[] }[] = [
    ...itemLines.map((lines, idx) => ({ at: Math.min(...lines), rows: () => build(itemLines[idx]!) })),
    ...[...soloBands.values()].map((lines) => ({ at: Math.min(...lines), rows: () => build(lines) })),
    ...standalone.map((i) => ({ at: i, rows: () => [...grid[i]!] })),
  ].sort((a, b) => a.at - b.at);
  return [...grid.slice(0, headerIndex + 1), ...units.map((u) => u.rows())];
}

/** Headers that mark the sheet's own role/assignment column (labels vary per production house). */
const ROLE_HEADERS = [
  "who", "role", "roles", "resp", "responsible", "owner", "assigned", "assigned to",
  "crew", "talent", "presenter", "cast", "dept",
];

/** The imported column that carries role assignments, if the sheet has one. */
export function findRoleColumn(headers: string[], mapping: ColumnTarget[]): string | null {
  for (let i = 0; i < mapping.length; i++) {
    const t = mapping[i];
    if (t?.kind === "department" && ROLE_HEADERS.includes(normalizeHeader(headers[i] ?? ""))) return t.key;
  }
  return null;
}

/** One-call pipeline: grid in, header + mapping + classified rows out. */
export function planImport(
  grid: string[][],
  opts: { headerIndex?: number; mergeWrapped?: boolean; lineMeta?: LineMeta[]; rowLines?: RowLines[] } = {},
): {
  grid: string[][];
  headerIndex: number;
  headers: string[];
  mapping: ColumnTarget[];
  roleColumnKey: string | null;
  rows: ClassifiedRow[];
} {
  const headerIndex = opts.headerIndex ?? detectHeaderRow(grid);
  const headers = grid[headerIndex] ?? [];
  const dataRows = grid.slice(headerIndex + 1);
  // A data sample lets untitled columns be identified by their contents.
  const mapping = mapColumns(headers, dataRows.slice(0, 60));

  // Centered/right-aligned columns (common in PDF layouts) put header text in
  // a different x-band than the data beneath, leaving the mapped column nearly
  // empty while the values sit in an untitled neighbour. Rescue each
  // structural target by ALSO mapping the data-rich neighbour to it; values
  // accumulate and the first parseable one wins.
  if (dataRows.length > 0) {
    const coverage = (col: number, parses?: (v: string) => boolean): number =>
      dataRows.filter((r) => {
        const v = (r[col] ?? "").trim();
        return v && (!parses || parses(v));
      }).length;

    // Times and durations can both parse as each other ("0:15:00" is a valid
    // time, "2:00:00PM" leaks as a 2-hour duration), so the two targets are
    // rescued JOINTLY: each candidate band is scored by parse coverage minus a
    // distance penalty from the declared header, and a band claimed by one
    // target is excluded from the other. Reading order does the rest — the
    // time band always sits nearer the TIME header than the duration band.
    const claimed = new Set<number>();
    const rescue = (
      kind: "title" | "start" | "duration",
      parses: ((v: string) => boolean) | undefined,
      reach: number,
    ) => {
      const at = mapping.findIndex((t) => t.kind === kind);
      if (at < 0) return;
      const declared = coverage(at, parses);
      if (declared / dataRows.length >= 0.3) return; // the declared column works
      const penalty = Math.max(1, dataRows.length * 0.08);
      let bestCol = -1;
      let bestScore = -Infinity;
      let bestCoverage = 0;
      mapping.forEach((t, i) => {
        if (t.kind !== "department" || !t.key.startsWith("column-") || claimed.has(i)) return;
        const dist = Math.abs(i - at);
        if (dist > reach) return;
        const c = coverage(i, parses);
        const score = c - dist * penalty;
        if (score > bestScore) {
          bestScore = score;
          bestCol = i;
          bestCoverage = c;
        }
      });
      if (bestCol >= 0 && bestCoverage > Math.max(declared * 2, dataRows.length * 0.1)) {
        mapping[bestCol] = { kind };
        claimed.add(bestCol);
      }
    };

    rescue("start", (v) => parseTimeLoose(v) != null, 3);
    rescue("duration", (v) => parseDurationLoose(v) != null, 3);
    rescue("title", undefined, 2);
  }
  const finalGrid = opts.mergeWrapped
    ? mergeWrappedRows(grid, headerIndex, opts.lineMeta, opts.rowLines, mapping)
    : grid;
  return {
    grid: finalGrid,
    headerIndex,
    headers,
    mapping,
    roleColumnKey: findRoleColumn(headers, mapping),
    rows: classifyRows(finalGrid, headerIndex, mapping),
  };
}

// ── Role detection ────────────────────────────────────────────────────────────

/** Distinct, readable highlight colours assigned to detected roles in order. */
export const ROLE_COLORS = [
  "#2dd4bf", "#f59e0b", "#818cf8", "#f472b6", "#34d399", "#38bdf8",
  "#fb923c", "#a78bfa", "#4ade80", "#facc15", "#f87171", "#22d3ee",
];

export interface DetectedRole {
  name: string;
  color: string;
}

/**
 * Mines assigned roles (BGM, Camera 1, PA, VTR…) from classified rows: short
 * cell lines that repeat across the sheet and aren't times or durations. Each
 * role gets a stable colour from the palette, most frequent first. When the
 * sheet has its own role column (WHO, ROLE…) pass its key — roles come from
 * that column alone, with a lower repeat threshold since it IS the roster.
 */
export function detectRoles(rows: ClassifiedRow[], max = 12, roleColumnKey?: string | null): DetectedRole[] {
  const counts = new Map<string, { name: string; count: number }>();
  const minCount = roleColumnKey ? 2 : 3;
  for (const row of rows) {
    const values = roleColumnKey
      ? row.cells[roleColumnKey] != null
        ? [row.cells[roleColumnKey]!]
        : []
      : Object.values(row.cells);
    for (const value of values) {
      // Multi-role cells are common ("VTR | LED", "GA, GFX") — each part is a role.
      for (const line of value.split(/\n|\s*[|,+]\s*|\s+&\s+|\s+and\s+/i)) {
        const v = line.trim();
        if (!v || v.length > 24) continue;
        if (/^\d/.test(v)) continue; // numbering, times, "2 x wedges"…
        if (parseTimeLoose(v) != null || parseDurationLoose(v) != null) continue;
        const key = v.toLowerCase();
        const entry = counts.get(key);
        if (entry) entry.count += 1;
        else counts.set(key, { name: v, count: 1 });
      }
    }
  }
  return [...counts.values()]
    .filter((e) => e.count >= minCount)
    .sort((a, b) => b.count - a.count)
    .slice(0, max)
    .map((e, i) => ({ name: e.name, color: ROLE_COLORS[i % ROLE_COLORS.length]! }));
}
