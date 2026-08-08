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

  // Summed parts: "40mins + 3mins", "1hr + 15 mins".
  if (s.includes("+")) {
    const parts = s.split("+").map((p) => parseDurationLoose(p));
    if (parts.length > 1 && parts.every((p) => p != null)) return parts.reduce((a, b) => a! + b!, 0);
  }

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
  "trk", "track", "vt", "cam", "scr", "ob", "ppt", "stills",
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
  /** The sheet's own number for this row (its ITEM/# cell), when it has one. */
  sourceNumber?: string;
  /** Detected outcome branch ("win" | "lose" | "draw" | "golden") — sport
   *  sheets carry alternate full-time endings; the caller picks one live. */
  outcome?: string | null;
  /** Words meant to be READ ALOUD, not performed — feeds the prompter. */
  script?: boolean;
}

/**
 * Tags alternate-ending blocks from their banner rows: "Fulltime - X WIN",
 * "Full Time (DRAW)", "GOLDEN POINT Kick off"… A trigger row starts a block
 * that runs until the next trigger (or the end of the sheet). A full-time
 * DRAW block is tagged "golden" — in NRL a level score goes to golden point,
 * and that block carries the extra-time content.
 */
export function detectOutcomes(rows: ClassifiedRow[]): void {
  const trigger = (title: string): string | null => {
    const t = title.toLowerCase();
    const fullTime = /\bfull\s?time\b/.test(t);
    if (fullTime && /\bwin\b/.test(t)) return "win";
    if (fullTime && /\b(lose|loss|lost)\b/.test(t)) return "lose";
    if (/\bgolden\s?point\b/.test(t)) return "golden";
    if (fullTime && /\bdraw\b/.test(t)) return "golden";
    return null;
  };
  let current: string | null = null;
  for (const r of rows) {
    if (r.kind === "spacer") continue;
    const next = trigger(r.title);
    if (next) current = next;
    if (current) r.outcome = current;
  }
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

/**
 * The sheet's own item/cue-number column: mostly pure integers with enough of
 * them to matter. Drives wrapped-row merging AND the rundown's row numbering
 * (which mirrors the sheet — see `sourceNumber`).
 */
/**
 * An item number in the sheet's own numbering column. Real run sheets insert
 * late additions as "129a"/"129b" rather than renumber the whole document, so
 * a trailing letter still opens a row — treating those as unnumbered
 * continuation lines merges them into the row above and drags their times
 * with them, which scrambles the running order.
 */
const ITEM_NUMBER = /^\d{1,4}[a-z]?$/i;

/**
 * Classification PLUS everything that makes a row match its source line: the
 * sheet's own item number, and which alternate ending it belongs to.
 *
 * This exists as one function because it used not to be. The import screen
 * re-classified the grid on its own — so it could reflect the user's fixes to
 * unparseable cells — and in doing so quietly produced rows with NO item
 * numbers and NO outcome branches, while the preview it was built from had
 * both. Every sheet imported that way lost its numbering. Anything that turns
 * a grid into rows must come through here.
 */
/**
 * Is this cell a botched time or duration, or simply not one?
 *
 * A run sheet uses its TIME and DUR columns for other things on some rows — a
 * team list puts positions there, a pre-show row says "TBC". Those are not
 * mistakes to be corrected; the sheet is right and there is nothing to fix.
 * Only a value that was clearly REACHING for a time deserves to be flagged,
 * and every one of those has a digit in it ("7.3O pm", "0:9O:00", "2 mins").
 */
export const looksLikeBotchedValue = (raw: string): boolean => /\d/.test(raw);

export function classifySheet(
  grid: string[][],
  headerIndex: number,
  mapping: ColumnTarget[],
  italicText?: string[],
): ClassifiedRow[] {
  const rows = classifyRows(grid, headerIndex, mapping);
  // Row numbering mirrors the sheet: each row carries ITS OWN number (first
  // line of it for merged rows); rows the sheet didn't number get none.
  const numberCol = detectNumberColumn(grid, headerIndex);
  if (numberCol != null) {
    for (const r of rows) {
      const value = (grid[r.sourceIndex]?.[numberCol] ?? "").split("\n")[0]!.trim();
      if (ITEM_NUMBER.test(value)) r.sourceNumber = value;
    }
  }
  detectOutcomes(rows);
  detectScript(rows, italicText);
  return rows;
}

/**
 * Marks the rows that are WORDS TO BE READ ALOUD rather than things to do.
 *
 * Run sheets set them in italic — a presenter's read, an interview question,
 * an announcement — and that is the signal used here, because it is the one
 * the sheet's author actually intended. A row counts as script when its title
 * text was italic in the source and it carries no time, duration or cue type
 * of its own: an italic aside inside a normal cue is decoration, not a read.
 *
 * Without italics (a CSV, a plain export) nothing is marked, which is the
 * honest outcome — inventing script from sentence length would put stage
 * directions and notes in front of a presenter mid-show.
 */
/**
 * Words in sentences, as opposed to a label or an instruction.
 *
 * Case carries the distinction on a run sheet: things said are written like
 * speech ("Please welcome to the field, tonight's special guest!"),
 * while cues and directions are shouted in capitals ("LX - STAGE BACK LIGHTS
 * ON", "WALK-ON - EDIT 2"). Length alone puts those in front of a presenter.
 */
const isProse = (line: string): boolean => {
  const words = line.split(/\s+/).filter(Boolean);
  const spoken = words.filter((w) => /^[a-z]/.test(w)).length;
  if (words.length >= 6 && spoken >= 3) return true;
  return /[.!?]$/.test(line) && words.length >= 3 && spoken >= 1;
};

export function detectScript(rows: ClassifiedRow[], italicText?: string[]): void {
  if (!italicText || italicText.length === 0) return;
  const italic = new Set(italicText.map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean));
  if (italic.size === 0) return;
  // Which rows are set in italic — necessary, but not sufficient. A row may
  // carry the italic read AND the line that pays it off ("…the one and only /
  // LADIES AND GENTLEMEN, WELCOME TO THE FIELD … THEIR NAME!"), which the sheet
  // sets in bold. Those belong together, so a non-italic line is tolerated as
  // long as it too is speech.
  const allItalic = rows.map((row) => {
    if (row.kind === "spacer") return false;
    const lines = row.title.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
    if (lines.length === 0) return false;
    const italicLines = lines.filter((l) => italic.has(l));
    if (italicLines.length === 0) return false;
    return lines.every((l) => italic.has(l) || isProse(l));
  });

  // Pass one seeds on italic PROSE: sentences someone says. An italic label
  // ("WALK-ON - EDIT 2", "Back Announce") is a name or a stage direction, and
  // putting either in front of a presenter mid-show would be worse than
  // missing it. Timing and cue types are not disqualifying — the opening line
  // of a read normally carries both.
  for (let i = 0; i < rows.length; i++) {
    if (!allItalic[i]) continue;
    const lines = rows[i]!.title.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
    if (lines.some(isProse)) rows[i]!.script = true;
  }

  // Pass two extends through the block: a short italic line sitting between
  // two spoken ones is part of the same read — "<Captain to speak>",
  // "Thank you." — and belongs with it.
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (!allItalic[i] || row.script) continue;
    // …but never a row that names its own piece of media. An italic track
    // title sitting right after a read is still a track, not a line to say.
    if (Object.values(row.cells).some((v) => CUE_TYPE_TOKENS.has(v.trim().toLowerCase()))) continue;
    if (rows[i - 1]?.script || rows[i + 1]?.script) row.script = true;
  }

  // Pass three picks up the lines a read runs into that are not italic at all:
  // the hole left when an author misses the italics mid-sentence, and the
  // pay-off line a sheet sets in bold to close a welcome ("Please welcome to
  // the field, tonight's special guest!"). Both sit directly against
  // spoken lines and have nothing of their own to do — no time, no duration,
  // no cue. Judged against the rows marked BEFORE this pass, so one absorbed
  // line cannot drag the next cue in after it.
  const seeded = rows.map((r) => r.script === true);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.script || row.kind === "spacer") continue;
    if (!seeded[i - 1] && !seeded[i + 1]) continue;
    if (row.startSec != null || row.durationSec != null) continue;
    if (Object.values(row.cells).some((v) => v.trim())) continue;
    const lines = row.title.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
    if (lines.length > 0 && lines.every(isProse)) row.script = true;
  }

  // A read is not a section header. Rows with nothing but text classify as
  // banners, which is how a paragraph of script ended up rendering as a great
  // grey heading across the sheet — and, because banners carry no cells, is
  // why the marker had nowhere to live. They are cues with no time of their own.
  for (const row of rows) if (row.script && row.kind === "banner") row.kind = "cue";
}

export function detectNumberColumn(grid: string[][], headerIndex: number): number | null {
  const dataRows = grid.slice(headerIndex + 1);
  if (dataRows.length === 0) return null;
  const columnCount = Math.max(...dataRows.map((r) => r.length), 0);
  let best: number | null = null;
  let bestInts = 0;
  for (let c = 0; c < columnCount; c++) {
    let nonEmpty = 0;
    let ints = 0;
    for (const row of dataRows) {
      const v = (row[c] ?? "").trim();
      if (!v) continue;
      nonEmpty += 1;
      if (ITEM_NUMBER.test(v)) ints += 1;
    }
    if (ints >= 5 && ints / Math.max(1, nonEmpty) >= 0.8 && ints > bestInts) {
      best = c;
      bestInts = ints;
    }
  }
  return best;
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

  const columnCount = Math.max(...dataRows.map((r) => r.length), 0);
  const groupCol = detectNumberColumn(grid, headerIndex);
  if (groupCol == null) return grid;

  // Page furniture: the title block, running heads, and footers a document
  // repeats on every page. They carry no item number and no time, so they
  // would otherwise be absorbed as continuation lines of whatever row happens
  // to precede a page break — dragging a page's masthead into a cue title.
  // Identified by repetition: the same text on three or more pages.
  const pagesOfText = new Map<string, Set<number>>();
  if (lineMeta) {
    for (let i = headerIndex + 1; i < grid.length; i++) {
      const row = grid[i]!;
      const text = row.join("|").trim();
      const page = lineMeta[i]?.page;
      if (!text || page == null) continue;
      const numbered = ITEM_NUMBER.test((row[groupCol] ?? "").trim());
      const timed = row.some((v) => parseTimeLoose(v) != null || parseDurationLoose(v) != null);
      if (numbered || timed) continue; // real content, however often it repeats
      const seen = pagesOfText.get(text) ?? new Set<number>();
      seen.add(page);
      pagesOfText.set(text, seen);
    }
  }
  const isFurniture = (i: number): boolean => (pagesOfText.get(grid[i]!.join("|").trim())?.size ?? 0) >= 3;

  // Data lines in order, page headers repeated by pagination dropped.
  const lineIdxs: number[] = [];
  for (let i = headerIndex + 1; i < grid.length; i++) {
    const row = grid[i]!;
    if (headerScore(row) >= 2 && row.join("|") === headerRow.join("|")) continue;
    if (isFurniture(i)) continue;
    if (row.some((v) => v.trim())) lineIdxs.push(i);
  }

  // Numbered lines each open an item.
  const itemOf = new Map<number, number>();
  const numbered: number[] = [];
  for (const i of lineIdxs) {
    if (ITEM_NUMBER.test((grid[i]![groupCol] ?? "").trim())) {
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

  /**
   * A line that carries its own clock time is a ROW of the sheet, not a
   * wrapped continuation of the one above. Whole blocks go unnumbered on real
   * sheets (everything before the first cue — call times, rehearsals, doors),
   * and folding them into a neighbour swallows every one of their times and
   * collapses the block into a single row hours long.
   */
  const hasOwnTime = (i: number): boolean => {
    if (!mapping) return false;
    for (let c = 0; c < (grid[i]?.length ?? 0); c++) {
      const v = (grid[i]![c] ?? "").trim();
      // Anything the author put in the time column counts, parseable or not:
      // call-time rows are routinely written "TBC" and are still real rows.
      if (v && mapping[c]?.kind === "start") return true;
    }
    return false;
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
      if (hasOwnTime(i)) {
        standalone.push(i);
        continue;
      }
      const nextNum = numbered.find((n) => n > i);
      const target = prevNum != null ? itemOf.get(prevNum)! : nextNum != null ? itemOf.get(nextNum)! : null;
      if (target != null) itemLines[target]!.push(i);
      else standalone.push(i);
      continue;
    }
    // Without ruled lines there is no way to tell a genuine row from a
    // wrapped cell, so a time here still belongs to the item it follows.
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
  opts: { headerIndex?: number; mergeWrapped?: boolean; lineMeta?: LineMeta[]; rowLines?: RowLines[]; italicText?: string[] } = {},
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
  // The WHOLE sheet, not a sample: an untitled column is identified by what it
  // contains, and "contains nothing" drops it. A column whose data starts on
  // page five — a countdown, a late-running note — looked empty in a 60-row
  // sample and was silently discarded.
  const mapping = mapColumns(headers, dataRows);

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
    rescue("title", undefined, 6);

    // The same band mismatch hits NAMED department columns: a centred ACTION
    // or NOTES header sits in one band while its left-aligned text sits in
    // another, so the sheet's own column imports empty next to an anonymous
    // "Column 7" holding the real content. Give that content the sheet's name
    // and drop the empty shell, so a rundown carries the sheet's headings over
    // the sheet's data.
    // The test is RELATIVE, not a fixed share of the sheet: notes and other
    // optional columns are legitimately sparse (a couple of dozen rows out of
    // hundreds), so a neighbour only needs to hold clearly more than the
    // named column to be recognised as that column's real content.
    const adopted = new Set<number>();
    mapping.forEach((t, i) => {
      if (t.kind !== "department" || t.key.startsWith("column-")) return;
      const named = coverage(i);
      if (named / dataRows.length >= 0.15) return; // the named column has its data
      let best = -1;
      let bestCoverage = 0;
      for (let distance = 1; distance <= 6 && best < 0; distance++) {
        for (const j of [i - distance, i + distance]) {
          const candidate = mapping[j];
          if (!candidate || candidate.kind !== "department" || !candidate.key.startsWith("column-")) continue;
          if (adopted.has(j) || claimed.has(j)) continue;
          const c = coverage(j);
          if (c > bestCoverage) {
            bestCoverage = c;
            best = j;
          }
        }
      }
      if (best < 0 || bestCoverage < 3 || bestCoverage < named * 3 + 1) return;
      mapping[best] = { kind: "department", key: t.key, title: t.title };
      mapping[i] = { kind: "skip" };
      adopted.add(best);
    });
  }
  const finalGrid = opts.mergeWrapped
    ? mergeWrappedRows(grid, headerIndex, opts.lineMeta, opts.rowLines, mapping)
    : grid;
  const rows = classifySheet(finalGrid, headerIndex, mapping, opts.italicText);
  return {
    grid: finalGrid,
    headerIndex,
    headers,
    mapping,
    roleColumnKey: findRoleColumn(headers, mapping),
    rows,
  };
}

// ── Unparseable-cell repair suggestions ───────────────────────────────────────

/**
 * Suggests a fixed spelling for a time cell that failed to parse — wrong
 * separators ("7.30", "7;30"), glued digits ("730pm", "1930"), or a time
 * buried in prose ("TBC 7:30pm"). Returns a string that parses, or null.
 */
export function suggestTimeFix(raw: string): string | null {
  const s = raw.trim();
  if (s === "" || parseTimeLoose(s) != null) return null;
  const sep = s.match(/(\d{1,2})\s*[:.;hH]\s*(\d{2})(?:\s*[:.;]\s*(\d{2}))?\s*(am|pm)?/i);
  if (sep) {
    const cand = `${sep[1]}:${sep[2]}${sep[3] ? `:${sep[3]}` : ""}${sep[4] ? ` ${sep[4].toLowerCase()}` : ""}`;
    if (parseTimeLoose(cand) != null) return cand;
  }
  const glued = s.match(/\b(\d{3,4})\s*(am|pm)?\b/i);
  if (glued) {
    const digits = glued[1]!;
    const cand = `${digits.slice(0, digits.length - 2)}:${digits.slice(-2)}${glued[2] ? ` ${glued[2].toLowerCase()}` : ""}`;
    if (parseTimeLoose(cand) != null) return cand;
  }
  return null;
}

/**
 * Suggests a fixed spelling for a duration cell that failed to parse —
 * "2.30" → "2:30", a duration buried in prose ("approx 5 mins TBC"), or a
 * bare number (treated as minutes). Returns a string that parses, or null.
 */
export function suggestDurationFix(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (s === "" || parseDurationLoose(s) != null) return null;
  const sep = s.match(/^(\d{1,3})\s*[.;]\s*(\d{2})$/);
  if (sep) {
    const cand = `${sep[1]}:${sep[2]}`;
    if (parseDurationLoose(cand) != null) return cand;
  }
  const worded = s.match(/(\d+)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/);
  if (worded) {
    const cand = `${worded[1]} ${worded[2]}`;
    if (parseDurationLoose(cand) != null) return cand;
  }
  const bare = s.match(/^\D*?(\d{1,3})\D*$/);
  if (bare) return `${bare[1]}:00`; // a lone number in a duration column is minutes
  return null;
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
/**
 * One WHO cell → the people it names.
 *
 * Two things get in the way of reading it straight. A cell often says what to
 * DO with someone rather than naming them — "cue DP", "DP cue" — and treated
 * literally those become two separate roles, neither of which is a person.
 * And a cell naming two people by their initials separates them with nothing
 * but a space ("LC JM"), so the pair reads as one unknown role and neither
 * person's rows light up for them.
 *
 * Names are left alone: "Wayne Bennett" is one person, not two.
 */
export function roleTokens(cell: string): string[] {
  let v = cell.trim();
  if (!v) return [];
  // "cue" is the verb, not part of anyone's name.
  v = v.replace(/^cue\s+/i, "").replace(/\s+cue$/i, "").trim();
  if (!v) return [];
  const parts = v.split(/\s+/);
  // Initials only — two or three capitals — split into one role each.
  if (parts.length > 1 && parts.every((p) => /^[A-Z]{2,3}$/.test(p))) return parts;
  return [v];
}

export function detectRoles(
  rows: ClassifiedRow[],
  max = 12,
  roleColumns?: string | string[] | null,
): DetectedRole[] {
  const keys = (typeof roleColumns === "string" ? [roleColumns] : (roleColumns ?? [])).filter(Boolean);
  const counts = new Map<string, { name: string; count: number }>();
  const minCount = keys.length > 0 ? 2 : 3;
  for (const row of rows) {
    const values =
      keys.length > 0
        ? keys.map((k) => row.cells[k]).filter((v): v is string => v != null)
        : Object.values(row.cells);
    for (const value of values) {
      // Multi-role cells are common ("VTR | LED", "GA, GFX") — each part is a role.
      for (const line of value.split(/\n|\s*[|,+]\s*|\s+&\s+|\s+and\s+/i)) {
        for (const v of roleTokens(line)) {
        if (!v || v.length > 24) continue;
        if (/^\d/.test(v)) continue; // numbering, times, "2 x wedges"…
        if (parseTimeLoose(v) != null || parseDurationLoose(v) != null) continue;
        // The prompter marker is something this app writes, not a crew position.
        if (v.toLowerCase() === PROMPTER_TAG) continue;
        const key = v.toLowerCase();
        const entry = counts.get(key);
        if (entry) entry.count += 1;
        else counts.set(key, { name: v, count: 1 });
        }
      }
    }
  }
  return [...counts.values()]
    .filter((e) => e.count >= minCount)
    .sort((a, b) => b.count - a.count)
    .slice(0, max)
    .map((e, i) => ({ name: e.name, color: ROLE_COLORS[i % ROLE_COLORS.length]! }));
}

// ── Plan → rundown ────────────────────────────────────────────────────────────

/**
 * Where text rescued from a structural column lands. A sheet's TIME or DUR cell
 * that holds a label rather than a value keeps its content under the sheet's
 * own heading for that column.
 */
export const UNPARSED_START_KEY = "start-text";
export const UNPARSED_DURATION_KEY = "duration-text";

/** A row as the rundown stores it. Structural mirror of the doc package's SeedRow. */
export interface BuiltRow {
  type: "cue" | "group" | "milestone";
  title: string;
  durationSec?: number | null;
  hardStartSec?: number | null;
  durationMuted?: boolean;
  untimed?: boolean;
  sourceNumber?: string;
  outcome?: string | null;
  cells?: Record<string, string>;
}

/** The value written into a sheet's cue column to send a row to the prompter. */
export const PROMPTER_TAG = "prompter";

/**
 * The column a sheet uses to say what KIND of thing each row is — SCR, TYPE,
 * SOURCE — recognised by its contents (VTR, GFX, LED, CAM…) rather than its
 * name, because every house calls it something different. That is where a
 * marker belongs: the showcaller can see it, and change it, in the same place
 * they already read the cue from.
 */
export function findCueTypeColumn(mapping: ColumnTarget[], rows: ClassifiedRow[]): string | null {
  let best: string | null = null;
  let bestScore = 0;
  for (const target of mapping) {
    if (target.kind !== "department") continue;
    let filled = 0;
    let cueish = 0;
    for (const row of rows) {
      const value = (row.cells[target.key] ?? "").trim().toLowerCase();
      if (!value) continue;
      filled += 1;
      if (CUE_TYPE_TOKENS.has(value)) cueish += 1;
    }
    if (filled < 5 || cueish / filled < 0.6) continue;
    if (cueish > bestScore) {
      bestScore = cueish;
      best = target.key;
    }
  }
  return best;
}

export interface BuiltSheet {
  rows: BuiltRow[];
  columns: { key: string; title: string; width?: number }[];
  roles: DetectedRole[];
  roleColumnKey: string | null;
  /** Every column that says who a row is for — the WHO column and the cue column. */
  roleColumnKeys: string[];
  plannedStartSec: number | null;
  baseTitles: { title?: string; start?: string; duration?: string };
  columnOrder: string[];
}

/**
 * Turns a classified sheet into the rundown that gets created.
 *
 * This lived inside the import screen, which meant the rules that decide what
 * the sheet BECOMES — which rows are groups, which times are real, which
 * columns survive and in what order — could not be tested or checked against a
 * source sheet without driving a browser. It is the same conversion either
 * way; only its address changed.
 */
export function buildSheet(
  plan: { headers: string[]; mapping: ColumnTarget[]; rows: ClassifiedRow[] },
  opts: { widths?: (number | null)[]; roleColumnKey?: string | null; roles?: DetectedRole[] } = {},
): BuiltSheet {
  const { headers, mapping } = plan;
  // Spacers are the sheet's blank separator lines — they carry nothing.
  const importable = plan.rows.filter((r) => r.kind !== "spacer");
  const roleKey = opts.roleColumnKey !== undefined ? opts.roleColumnKey : findRoleColumn(headers, mapping);
  // The cue column names positions — VTR, GFX, LED, CAM — and the people on
  // those desks need to find their rows just as much as the ones named by
  // initials in WHO. Both are role columns.
  const cueKey = findCueTypeColumn(mapping, importable);
  const roleKeys = [roleKey, cueKey].filter((k): k is string => !!k);
  const roles = opts.roles ?? detectRoles(importable, 12, roleKeys);
  const widths = opts.widths ?? [];

  // When the sheet has NO role column of its own, every detected role that
  // appears in a row's cells lands in a synthesized "Roles" column.
  const rolesFor = (r: ClassifiedRow): string => {
    if (roleKey) return "";
    const hay = `${r.title}\n${Object.values(r.cells).join("\n")}`.toLowerCase();
    return roles
      .filter((role) => hay.includes(role.name.toLowerCase()))
      .map((role) => role.name)
      .join(", ");
  };

  // Sparse-timed sheets (cue-sheet style) time only PARENT rows; rows with a
  // blank TIME cell are sub-cues inside that block. Marking them `untimed`
  // keeps the grid faithful — no invented cascade times.
  const cueish = importable.filter((r) => r.kind !== "banner");
  const sparseTimed = cueish.length >= 10 && cueish.filter((r) => r.startSec != null).length / cueish.length < 0.5;

  // Rows the sheet meant to be read aloud are TAGGED in the sheet's own cue
  // column, so the prompter can find them and a showcaller can see — and
  // change — the decision in the place they already read cues from.
  const cueTypeKey = cueKey;

  const rows: BuiltRow[] = importable.map((r) => {
    if (r.kind === "banner") return { type: "group", title: r.title, sourceNumber: r.sourceNumber, outcome: r.outcome ?? undefined };
    if (r.kind === "milestone") {
      const fallback = Object.values(r.cells).find((v) => v.trim());
      return {
        type: "milestone",
        title: r.title || fallback || "—",
        durationSec: null,
        hardStartSec: r.startSec,
        sourceNumber: r.sourceNumber,
        outcome: r.outcome ?? undefined,
        cells: r.cells,
      };
    }
    const assigned = rolesFor(r);
    const untimed = sparseTimed && r.startSec == null;
    // Text in a TIME or DUR column that is not a time or a duration — a sheet
    // that puts "Fullback" or "Interchange" in the duration column of a team
    // list — has nowhere to live in a structural column, and used to simply
    // vanish. Keep it beside the row so the rundown still says what the sheet
    // said; the import preview offers to turn it into a real value.
    const spilled: Record<string, string> = {};
    if (r.startRaw) spilled[UNPARSED_START_KEY] = r.startRaw;
    if (r.durationRaw) spilled[UNPARSED_DURATION_KEY] = r.durationRaw;
    // Never overwrite a cue the sheet already gave the row.
    if (r.script && cueTypeKey && !(r.cells[cueTypeKey] ?? "").trim()) spilled[cueTypeKey] = PROMPTER_TAG;
    return {
      type: "cue",
      title: r.title,
      durationSec: r.durationSec,
      hardStartSec: r.startSec,
      untimed: untimed || undefined,
      durationMuted: untimed && r.durationSec != null ? true : undefined,
      sourceNumber: r.sourceNumber,
      outcome: r.outcome ?? undefined,
      cells: { ...r.cells, ...spilled, ...(assigned ? { roles: assigned } : {}) },
    };
  });

  // The structural columns keep the sheet's own header names. Several bands can
  // map to one structural target (a centred header and the data beneath it);
  // the NAMED one is the sheet's own heading.
  const headerFor = (kind: "title" | "start" | "duration"): string | undefined => {
    for (let i = 0; i < mapping.length; i++) {
      if (mapping[i]?.kind !== kind) continue;
      const h = headers[i]?.trim();
      if (h) return h;
    }
    return undefined;
  };

  // The rundown mirrors the sheet: every department column with data, in
  // source order, with the source's own name and a proportional width.
  const usedKeys = new Set(rows.flatMap((r) => Object.keys(r.cells ?? {})));
  const clampWidth = (w: number | null | undefined): number | undefined =>
    w ? Math.min(420, Math.max(80, w)) : undefined;
  const roleColumn: { key: string; title: string; width?: number }[] =
    roles.length > 0 && !roleKey ? [{ key: "roles", title: "Roles", width: 140 }] : [];
  const columns: { key: string; title: string; width?: number }[] = roleColumn.concat(
    mapping
      .map((t, i) => ({ t, i }))
      .filter((x): x is { t: Extract<ColumnTarget, { kind: "department" }>; i: number } => x.t.kind === "department" && usedKeys.has(x.t.key))
      .map(({ t, i }) => ({ key: t.key, title: t.title, width: clampWidth(widths[i]) })),
  );

  // Rescued structural text gets its own column, named after the sheet's
  // heading for the column it came from, and sits immediately beside it.
  const spillColumns: { key: string; title: string; after: string }[] = [];
  if (usedKeys.has(UNPARSED_START_KEY))
    spillColumns.push({ key: UNPARSED_START_KEY, title: `${headerFor("start") ?? "Start"} (text)`, after: "start" });
  if (usedKeys.has(UNPARSED_DURATION_KEY))
    spillColumns.push({ key: UNPARSED_DURATION_KEY, title: `${headerFor("duration") ?? "Duration"} (text)`, after: "duration" });
  for (const c of spillColumns) columns.push({ key: c.key, title: c.title, width: 110 });

  // …and their exact left-to-right POSITIONS: the grid renders this order.
  const columnOrder: string[] = [];
  const push = (key: string) => {
    if (!columnOrder.includes(key)) columnOrder.push(key);
    for (const c of spillColumns) if (c.after === key && !columnOrder.includes(c.key)) columnOrder.push(c.key);
  };
  for (const t of mapping) {
    const key =
      t.kind === "title"
        ? "title"
        : t.kind === "start"
          ? "start"
          : t.kind === "duration"
            ? "duration"
            : t.kind === "department" && usedKeys.has(t.key)
              ? t.key
              : null;
    if (key) push(key);
  }
  if (roleColumn.length > 0) columnOrder.push("roles");

  return {
    rows,
    columns,
    roles,
    roleColumnKey: roleKey ?? (roles.length > 0 ? "roles" : null),
    roleColumnKeys: roleKeys.length > 0 ? roleKeys : roles.length > 0 ? ["roles"] : [],
    plannedStartSec: importable.find((r) => r.startSec != null)?.startSec ?? null,
    baseTitles: { title: headerFor("title"), start: headerFor("start"), duration: headerFor("duration") },
    columnOrder,
  };
}
