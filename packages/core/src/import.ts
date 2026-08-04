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

/** Finds the most header-like row near the top of the grid (first 8 rows). */
export function detectHeaderRow(grid: string[][]): number {
  let best = 0;
  let bestScore = -1;
  for (let i = 0; i < Math.min(grid.length, 8); i++) {
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
      if (target.kind === "title") title = value;
      else if (target.kind === "start") startRaw = value;
      else if (target.kind === "duration") durationRaw = value;
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

/** One-call pipeline: grid in, header + mapping + classified rows out. */
export function planImport(grid: string[][]): {
  headerIndex: number;
  headers: string[];
  mapping: ColumnTarget[];
  rows: ClassifiedRow[];
} {
  const headerIndex = detectHeaderRow(grid);
  const headers = grid[headerIndex] ?? [];
  // A data sample lets untitled columns be identified by their contents.
  const mapping = mapColumns(headers, grid.slice(headerIndex + 1, headerIndex + 60));
  return { headerIndex, headers, mapping, rows: classifyRows(grid, headerIndex, mapping) };
}
