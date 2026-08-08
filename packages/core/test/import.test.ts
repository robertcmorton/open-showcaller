import { describe, expect, it } from "vitest";
import { buildSheet, classifySheet, looksLikeBotchedValue, findCueTypeColumn, PROMPTER_TAG, classifyRows, detectHeaderRow, detectOutcomes, detectRoles, findRoleColumn, mapColumns, mergeWrappedRows, parseDurationLoose, parseTimeLoose, planImport, suggestDurationFix, suggestTimeFix, UNPARSED_DURATION_KEY } from "../src/import";

describe("parseDurationLoose", () => {
  it("parses worded durations", () => {
    expect(parseDurationLoose("3 mins")).toBe(180);
    expect(parseDurationLoose("1min 27 secs")).toBe(87);
    expect(parseDurationLoose("30 secs")).toBe(30);
    expect(parseDurationLoose("15 seconds")).toBe(15);
    expect(parseDurationLoose("2min 10 secs")).toBe(130);
    expect(parseDurationLoose("0mins")).toBe(0);
    expect(parseDurationLoose("2 hrs")).toBe(7200);
  });
  it("parses colon forms incl. spreadsheet oddities", () => {
    expect(parseDurationLoose("0:90:00")).toBe(90 * 60); // 90-minute leak
    expect(parseDurationLoose("0:90:00 am")).toBe(90 * 60); // AM/PM leak
    expect(parseDurationLoose("08:00")).toBe(480);
    expect(parseDurationLoose("1:30")).toBe(90);
    expect(parseDurationLoose("0:01:30")).toBe(90);
  });
  it("keeps shorthand working and rejects garbage", () => {
    expect(parseDurationLoose("1m30s")).toBe(90);
    expect(parseDurationLoose("90")).toBe(90);
    expect(parseDurationLoose("Sau")).toBeNull();
    expect(parseDurationLoose("")).toBeNull();
  });
});

describe("parseTimeLoose", () => {
  it("parses real-world time formats", () => {
    expect(parseTimeLoose("5:00:00PM")).toBe(17 * 3600);
    expect(parseTimeLoose("6:00:00 pm")).toBe(18 * 3600);
    expect(parseTimeLoose("16:00:00")).toBe(16 * 3600);
    expect(parseTimeLoose("4:30pm")).toBe(16.5 * 3600);
    expect(parseTimeLoose("0900")).toBe(9 * 3600);
    expect(parseTimeLoose("1615")).toBe(16 * 3600 + 15 * 60);
    expect(parseTimeLoose("9am")).toBe(9 * 3600);
  });
  it("rejects garbage", () => {
    expect(parseTimeLoose("Sau")).toBeNull();
    expect(parseTimeLoose("")).toBeNull();
    expect(parseTimeLoose("9900")).toBeNull();
  });
});

// House style A: segment run sheet — ITEM | TIME | DURATION | ACTION | WHO | WHAT
const styleA: string[][] = [
  ["", "", "", "Springfield Derby — FINAL", "", ""],
  ["ITEM", "TIME", "DURATION", "ACTION", "WHO", "WHAT"],
  ["1", "3:45:00PM", "0:90:00 am", "Check Content", "", "Crew call"],
  ["2", "6:00:00 pm", "0:00:20", "Pre Record - Walk Over", "CREW", "Overlay only"],
  ["3", "7:00:00 pm", "", "TEAM LIST DUE", "", ""],
  ["", "", "", "", "", ""],
  ["4", "7:00:00 pm", "0:07:30", "House Beats", "AUDIO", "DJ tracks"],
];

// House style B: presentation grid with free-text durations and errors
const styleB: string[][] = [
  ["#", "TIME", "DURATION", "ACTIVITY", "LOCATION", "AUDIO", "BIG SCREEN", "NOTES"],
  ["1", "16:00:00", "0mins", "Gates Open", "", "", "", ""],
  ["2", "16:13:00", "1 min 30 secs", "Underscore", "Ctrl Room", "PA", "", ""],
  ["3", "Sau", "3 mins", "MC Segment 1", "FOP", "PA", "Live Vision", "typo time"],
  ["", "", "", "", "", "", "", ""],
];

// House style C: agency cue sheet — # | TIME OF DAY | ACTIVITY | DUR | SCREEN
const styleC: string[][] = [
  ["CUE SHEET", "", "", "", ""],
  ["#", "TIME OF DAY", "ACTIVITY", "DUR", "SCREEN"],
  ["21", "3:30:00 PM", "Holding Graphic", "08:00", "Holding Graphic"],
  ["24", "3:30:00 PM", "Exhibition Match Begins", "", ""],
  ["58", "4:12:00 PM", "TVC Reel 1", "02:42", "TVC Reel 1"],
];

describe("header detection & mapping", () => {
  it("finds the header row past title junk", () => {
    expect(detectHeaderRow(styleA)).toBe(1);
    expect(detectHeaderRow(styleB)).toBe(0);
    expect(detectHeaderRow(styleC)).toBe(1);
  });
  it("maps known and unknown headers", () => {
    const mapping = mapColumns(styleB[0]!);
    expect(mapping[0]).toEqual({ kind: "skip" }); // #
    expect(mapping[1]).toEqual({ kind: "start" });
    expect(mapping[2]).toEqual({ kind: "duration" });
    expect(mapping[3]).toEqual({ kind: "title" }); // ACTIVITY
    // Every header is kept VERBATIM — the rundown mirrors the sheet exactly.
    expect(mapping[4]).toEqual({ kind: "department", key: "location", title: "LOCATION" });
    expect(mapping[5]).toEqual({ kind: "department", key: "audio", title: "AUDIO" });
    expect(mapping[6]).toEqual({ kind: "department", key: "big-screen", title: "BIG SCREEN" });
  });
});

describe("row classification", () => {
  it("classifies style A: cues, milestone, spacer, duration leak", () => {
    const { rows } = planImport(styleA);
    expect(rows[0]!.kind).toBe("cue");
    expect(rows[0]!.durationSec).toBe(90 * 60);
    expect(rows[1]!.durationSec).toBe(20);
    expect(rows[2]!.kind).toBe("milestone"); // TEAM LIST DUE: time, no duration
    expect(rows[3]!.kind).toBe("spacer");
    // WHO and WHAT import as their own columns, mirroring the sheet.
    expect(rows[4]!.cells.who).toBe("AUDIO");
    expect(rows[4]!.cells.what).toBe("DJ tracks");
  });
  it("flags unparseable cells instead of dropping them (style B)", () => {
    const { rows } = planImport(styleB);
    expect(rows[0]!.kind).toBe("cue"); // "0mins" parses to 0 → cue, not milestone
    expect(rows[0]!.durationSec).toBe(0);
    const typo = rows[2]!;
    expect(typo.startSec).toBeNull();
    expect(typo.startRaw).toBe("Sau"); // preserved for the preview
    expect(typo.durationSec).toBe(180);
  });
  it("classifies style C: match-state banner is a milestone with time", () => {
    const { rows } = planImport(styleC);
    expect(rows[0]!.durationSec).toBe(480); // "08:00" = 8 minutes
    expect(rows[1]!.kind).toBe("milestone");
    expect(rows[2]!.durationSec).toBe(162);
  });
  it("drops repeated page headers from PDF extraction", () => {
    const grid = [...styleB, styleB[0]!, ["4", "17:00:00", "2 mins", "Read 1", "", "PA", "", ""]];
    const { rows } = planImport(grid);
    expect(rows.filter((r) => r.title === "ACTIVITY")).toHaveLength(0);
    expect(rows[rows.length - 1]!.title).toBe("Read 1");
  });
});

describe("classifyRows direct", () => {
  it("banner rows: title only", () => {
    const grid = [
      ["TITLE", "START", "DURATION"],
      ["MAIN SHOW", "", ""],
    ];
    const rows = classifyRows(grid, 0, mapColumns(grid[0]!));
    expect(rows[0]!.kind).toBe("banner");
  });
});

describe("untitled columns", () => {
  it("recognizes a header-less cue-type column by its data", () => {
    const grid = [
      ["#", "TIME", "", "ACTIVITY", "AUDIO"],
      ["1", "16:00:00", "VTR", "Opening Reel", ""],
      ["2", "", "PA", "Welcome Read", "PA"],
      ["3", "", "GFX", "Sponsor Graphic", ""],
    ];
    const { mapping, rows } = planImport(grid);
    expect(mapping[2]).toEqual({ kind: "department", key: "type", title: "Type" });
    expect(rows[0]!.cells.type).toBe("VTR");
  });
  it("imports other header-less columns as Column N instead of dropping them", () => {
    const grid = [
      ["TIME", "ACTIVITY", ""],
      ["16:00:00", "Doors", "escort VIPs via north gate"],
    ];
    const { mapping, rows } = planImport(grid);
    expect(mapping[2]).toEqual({ kind: "department", key: "column-3", title: "Column 3" });
    expect(rows[0]!.cells["column-3"]).toContain("escort");
  });
});

describe("column fidelity", () => {
  it("suffixes duplicate headers so no two columns share a name", () => {
    const mapping = mapColumns(["ACTIVITY", "NOTES", "NOTES"]);
    expect(mapping[1]).toEqual({ kind: "department", key: "notes", title: "NOTES" });
    expect(mapping[2]).toEqual({ kind: "department", key: "notes-2", title: "NOTES (2)" });
  });
});

describe("detectRoles", () => {
  it("mines repeated role tokens with colours, skipping times and durations", () => {
    const grid = [
      ["ACTIVITY", "TYPE", "LOCATION"],
      ["Open", "PA", "Ctrl Room"],
      ["Read", "PA", "Ctrl Room"],
      ["Reel", "VTR", "Ctrl Room"],
      ["Read 2", "PA", "16:00:00"],
      ["Reel 2", "VTR", "Ctrl Room"],
      ["Sting", "VTR", ""],
    ];
    const { rows } = planImport(grid);
    const roles = detectRoles(rows);
    const names = roles.map((r) => r.name);
    expect(names).toContain("PA");
    expect(names).toContain("VTR");
    expect(names).toContain("Ctrl Room");
    expect(names).not.toContain("16:00:00");
    expect(new Set(roles.map((r) => r.color)).size).toBe(roles.length); // distinct colours
  });
});

describe("mergeWrappedRows", () => {
  // A PDF-extracted grid: one row per visual line, items numbered in col 0,
  // wrapped cells spilling onto continuation lines.
  const pdfGrid = [
    ["ITEM", "TIME", "DURATION", "ACTION", "WHO", "WHAT"],
    ["1", "", "", "", "", "KA, Production Crew"],
    ["", "", "", "Check Content", "", "SET - Tunnel go pro"],
    ["", "3:00:00PM", "0:60:00", "", "", "CHECK - Dressing room cam"],
    ["2", "4:30:00PM", "0:15:00", "Crew arrive", "", "DJ set desk"],
    ["3", "5:45:00PM", "0:30:00", "Rehearsals", "", "- 5:45 - soundcheck"],
    ["", "", "", "", "", "- 6:00 - MC segment"],
    ["", "", "", "", "", "- 6:10 - rehearsal"],
    ["4", "6:30:00PM", "0:17:30", "Music Fill", "AUDIO", "DJ tracks"],
    ["", "", "", "", "GFX", "Holding loop"],
    ["5", "6:50:00PM", "0:01:15", "Toss seg", "JORDAN", "Pre-record"],
    ["6", "7:00:00PM", "0:01:15", "Meet seg", "JORDAN", "Pre-record"],
  ];

  it("merges continuation lines into one row per numbered item", () => {
    const { grid, rows } = planImport(pdfGrid, { mergeWrapped: true });
    // 6 items → 6 data rows (plus the header).
    expect(grid.length).toBe(7);
    const importable = rows.filter((r) => r.kind !== "spacer");
    expect(importable.length).toBe(6);
    // Item 1's title came from a continuation line; its time from another.
    expect(importable[0]!.title).toBe("Check Content");
    expect(importable[0]!.startSec).toBe(15 * 3600);
    expect(importable[0]!.cells["what"]).toContain("Tunnel go pro");
    // Item 3's wrapped WHAT lines all merged (times inside stay in WHAT).
    expect(importable[2]!.cells["what"]!.split("\n").length).toBe(3);
    expect(importable[2]!.startSec).toBe(17 * 3600 + 45 * 60);
    // No empty shell rows between items.
    expect(importable.every((r) => r.title || r.cells["what"])).toBe(true);
  });

  it("leaves grids without a credible item-number column untouched", () => {
    const grid = [
      ["TIME", "ACTIVITY"],
      ["16:00:00", "Doors"],
      ["16:30:00", "Show"],
    ];
    expect(mergeWrappedRows(grid, 0)).toBe(grid);
  });

  it("identifies the sheet's own role column and mines roles from it alone", () => {
    const { headers, mapping, roleColumnKey, rows } = planImport(pdfGrid, { mergeWrapped: true });
    expect(roleColumnKey).toBe(findRoleColumn(headers, mapping));
    expect(roleColumnKey).toBe("who");
    const roles = detectRoles(rows.filter((r) => r.kind !== "spacer"), 12, roleColumnKey);
    const names = roles.map((r) => r.name);
    expect(names).toContain("JORDAN");
    // "DJ tracks" lives in WHAT — never a role when the sheet has a WHO column.
    expect(names.every((n) => !n.includes("tracks"))).toBe(true);
  });
});

describe("mergeWrappedRows with ruled-line boundaries", () => {
  // Row layout (page 0, y descending). Rules at 100/88/50/38/26:
  //   [100..88]  item 1 (one line)
  //   [88..50]   item 2 — tall: number on its 2nd line, 2 more lines BELOW
  //              the midpoint to item 3 (previously mis-attached forward)
  //   [50..38]   an unnumbered ALL-CAPS banner row (its own row)
  //   [38..26]   item 3 (one line)
  const grid = [
    ["ITEM", "TIME", "ACTION", "WHAT"],
    ["1", "5:00:00PM", "Open", "walk in"],          // y 94
    ["", "", "", "wrapped a"],                       // y 82
    ["2", "5:10:00PM", "Long segment", "wrapped b"], // y 74
    ["", "", "", "wrapped c"],                       // y 62
    ["", "", "", "wrapped d"],                       // y 54  (nearer item 3's line!)
    ["", "", "MAIN SHOW", ""],                       // y 44  banner band
    ["3", "5:30:00PM", "Kick", "boom"],              // y 32
    ["4", "5:40:00PM", "A", ""],                     // pad to reach the ≥5 integers bar
    ["5", "5:41:00PM", "B", ""],
    ["6", "5:42:00PM", "C", ""],
    ["7", "5:43:00PM", "D", ""],
  ];
  const lineMeta = [
    { page: 0, y: 200 },
    { page: 0, y: 94 },
    { page: 0, y: 82 },
    { page: 0, y: 74 },
    { page: 0, y: 62 },
    { page: 0, y: 54 },
    { page: 0, y: 44 },
    { page: 0, y: 32 },
    { page: 0, y: 20 },
    { page: 0, y: 16 },
    { page: 0, y: 12 },
    { page: 0, y: 8 },
  ];
  const rowLines = [{ page: 0, ys: [100, 88, 50, 38, 26] }];

  it("groups by physical row, keeps unnumbered banner rows, preserves order", () => {
    const merged = mergeWrappedRows(grid, 0, lineMeta, rowLines);
    // header + item1 + item2 + banner + items 3..7
    expect(merged.length).toBe(9);
    expect(merged[2]![3]).toBe("wrapped a\nwrapped b\nwrapped c\nwrapped d"); // ALL of item 2's lines
    expect(merged[3]![2]).toBe("MAIN SHOW"); // banner survives as its own row, in place
    expect(merged[4]![0]).toBe("3");
    expect(merged[4]![3]).toBe("boom"); // nothing leaked into item 3
  });

  it("still classifies the banner as a section after the merge", () => {
    const { rows } = planImport(grid, { mergeWrapped: true, lineMeta, rowLines });
    const banner = rows.find((r) => r.title === "MAIN SHOW");
    expect(banner?.kind).toBe("banner");
  });
});

describe("mergeWrappedRows: ruled sub-rows inside one item", () => {
  // Sheets rule the WHO/WHAT lines INSIDE a merged item: bands without a
  // number that carry data-column content join the item above; only
  // title-only bands stay standalone.
  const grid = [
    ["ITEM", "TIME", "ACTION", "WHO", "WHAT"],
    ["1", "6:30:00PM", "Music Fill", "AUDIO", "track list"],  // y 94
    ["", "", "", "GFX", "holding loop"],                       // y 82 — own band!
    ["", "", "", "GFX", "title card"],                         // y 70 — own band!
    ["2", "6:50:00PM", "Toss seg", "HOST", "prerecord"],       // y 58
    ["3", "6:55:00PM", "A", "", ""],
    ["4", "6:56:00PM", "B", "", ""],
    ["5", "6:57:00PM", "C", "", ""],
  ];
  const lineMeta = [
    { page: 0, y: 200 },
    { page: 0, y: 94 },
    { page: 0, y: 82 },
    { page: 0, y: 70 },
    { page: 0, y: 58 },
    { page: 0, y: 46 },
    { page: 0, y: 34 },
    { page: 0, y: 22 },
  ];
  // Rules split item 1 into three inner sub-rows.
  const rowLines = [{ page: 0, ys: [100, 88, 76, 64, 52, 40, 28, 16] }];

  it("joins ruled sub-rows to the item above them", () => {
    const { rows } = planImport(grid, { mergeWrapped: true, lineMeta, rowLines });
    const item1 = rows.find((r) => r.title === "Music Fill");
    expect(item1?.cells.who).toBe("AUDIO\nGFX\nGFX");
    expect(item1?.cells.what).toBe("track list\nholding loop\ntitle card");
    const item2 = rows.find((r) => r.title === "Toss seg");
    expect(item2?.cells.who).toBe("HOST");
  });
});

describe("unparseable-cell repair suggestions", () => {
  it("repairs common time typos", () => {
    expect(suggestTimeFix("19h30")).toBe("19:30");
    expect(suggestTimeFix("7;30 pm")).toBe("7:30 pm");
    expect(suggestTimeFix("TBC 7:30pm approx")).toBe("7:30 pm");
    expect(suggestTimeFix("730pm")).toBe("7:30 pm");
    expect(suggestTimeFix("Sau")).toBeNull();
    expect(suggestTimeFix("16:00:00")).toBeNull(); // already parses — nothing to fix
  });
  it("repairs common duration typos", () => {
    expect(suggestDurationFix("2.30")).toBe("2:30");
    expect(suggestDurationFix("approx 5 mins TBC")).toBe("5 mins");
    expect(suggestDurationFix("¬5¬")).toBe("5:00"); // bare number = minutes
    expect(suggestDurationFix("1m30s")).toBeNull(); // already parses
  });
});

describe("parseDurationLoose summed parts", () => {
  it("sums plus-joined durations", () => {
    expect(parseDurationLoose("40mins + 3mins")).toBe(43 * 60);
    expect(parseDurationLoose("1 hr + 15 mins")).toBe(75 * 60);
    expect(parseDurationLoose("5 + banana")).toBeNull();
  });
});

describe("detectOutcomes", () => {
  const row = (title: string): import("../src/import").ClassifiedRow => ({
    kind: "cue",
    title,
    startSec: null,
    startRaw: null,
    durationSec: null,
    durationRaw: null,
    cells: {},
    sourceIndex: 0,
  });

  it("tags ending blocks from their banners, draw-at-fulltime as golden", () => {
    const rows = [
      row("Kick off"),
      row("Fulltime - HOME TEAM WIN"),
      row("Celebration"),
      row("Fulltime - HOME TEAM LOSE"),
      row("Wrap"),
      row("Full Time (DRAW)"),
      row("GOLDEN POINT Kick off"),
      row("GP Try"),
    ];
    detectOutcomes(rows);
    expect(rows.map((r) => r.outcome ?? null)).toEqual([null, "win", "win", "lose", "lose", "golden", "golden", "golden"]);
  });

  it("leaves sheets without ending banners untouched", () => {
    const rows = [row("Walk in"), row("Anthem"), row("Full time siren")];
    detectOutcomes(rows);
    expect(rows.every((r) => !r.outcome)).toBe(true);
  });
});

describe("centred department headers", () => {
  it("gives an anonymous data band the sheet's own column name", () => {
    // A NOTES header sits in its own band while the note text lands one band
    // to the left — the PDF layout case that imports "Column 7" beside an
    // empty "NOTES".
    const grid: string[][] = [
      ["ITEM", "TIME", "ACTION", "", "NOTES"],
      ...Array.from({ length: 20 }, (_, i) => [
        String(i + 1),
        `1${String(i).padStart(2, "0")}0`,
        `Cue ${i + 1}`,
        i % 3 === 0 ? `note ${i}` : "",
        "",
      ]),
    ];
    const { mapping } = planImport(grid);
    const notes = mapping
      .map((t, i) => ({ t, i }))
      .filter((x) => x.t.kind === "department" && (x.t as { title: string }).title === "NOTES");
    expect(notes.length).toBe(1);
    expect(notes[0]!.i).toBe(3); // the band holding the notes, not the empty header band
  });
});

// ── Import fidelity: what the sheet says is what the rundown says ─────────────
// These encode the ways a real sheet lost content on the way in. The fixtures
// are synthetic — shaped like production sheets, carrying none of their text.

describe("buildSheet fidelity", () => {
  /** A cue sheet with the shape that broke: ITEM/TIME/DUR/SCR/ACTION/WHO/NOTES. */
  const sheet = (): string[][] => [
    ["ITEM", "TIME", "DUR", "SCR", "ACTION", "WHO", "NOTES", ""],
    ["1", "17:15:00", "", "", "GATES", "", "", ""],
    ["2", "17:15:00", "01:00", "VTR", "HOLDING", "", "", "00:00"],
    ["3", "17:16:00", "00:30", "", "WELCOME", "GH", "arrive 1pm", "00:15"],
    ["4", "17:16:30", "00:30", "GFX", "PARTNER CARD", "", "check content", "00:45"],
    ["5", "", "Fullback", "1", "A. Player", "", "", ""],
    ["6", "", "Interchange", "", "", "", "", ""],
    ["7", "17:17:00", "00:45", "GFX", "TEAM READ", "GH", "", "01:15"],
  ];
  const build = (grid: string[][]) => buildSheet(planImport(grid));

  it("keeps every numbered row, with the sheet's own numbering", () => {
    const built = build(sheet());
    expect(built.rows.map((r) => r.sourceNumber)).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
  });

  it("carries times, durations and cells across unchanged", () => {
    const row = build(sheet()).rows.find((r) => r.sourceNumber === "3")!;
    expect(row.hardStartSec).toBe(17 * 3600 + 16 * 60);
    expect(row.durationSec).toBe(30);
    expect(row.cells?.who).toBe("GH");
    expect(row.cells?.notes).toBe("arrive 1pm");
  });

  it("keeps the sheet's headings and its left-to-right column order", () => {
    const built = build(sheet());
    expect(built.baseTitles).toEqual({ title: "ACTION", start: "TIME", duration: "DUR" });
    expect(built.columnOrder.indexOf("start")).toBeLessThan(built.columnOrder.indexOf("duration"));
    expect(built.columnOrder.indexOf("duration")).toBeLessThan(built.columnOrder.indexOf("title"));
    expect(built.columnOrder.indexOf("title")).toBeLessThan(built.columnOrder.indexOf("notes"));
  });

  it("keeps text a structural column cannot hold, instead of dropping it", () => {
    // "Fullback" sits in the DUR column of a team list. It is not a duration,
    // and it used to vanish; now it lands beside the column it came from.
    const built = build(sheet());
    const row = built.rows.find((r) => r.sourceNumber === "5")!;
    expect(row.cells?.[UNPARSED_DURATION_KEY]).toBe("Fullback");
    expect(built.columns.some((c) => c.key === UNPARSED_DURATION_KEY)).toBe(true);
    expect(built.columnOrder).toContain(UNPARSED_DURATION_KEY);
  });

  it("keeps an untitled column whose data starts far down the sheet", () => {
    // A countdown column that is blank for the first pages was sampled as empty
    // and dropped; identification now reads the whole sheet.
    const grid = sheet();
    const late = [["ITEM", "TIME", "DUR", "SCR", "ACTION", "WHO", "NOTES", ""]];
    for (let i = 1; i <= 80; i++) late.push([String(i), "17:15:00", "00:30", "", `ITEM ${i}`, "", "", ""]);
    late.push(["81", "17:20:00", "00:30", "", "LATE", "", "", "05:00"]);
    const built = buildSheet(planImport(late));
    expect(built.rows[80]!.cells?.["column-8"]).toBe("05:00");
    void grid;
  });

  it("drops a right-hand column that only mirrors row numbers", () => {
    const grid = [
      ["ITEM", "TIME", "DUR", "ACTION", ""],
      ["1", "17:15:00", "00:30", "ONE", "1"],
      ["2", "17:15:30", "00:30", "TWO", "2"],
      ["3", "17:16:00", "00:30", "THREE", "3"],
    ];
    const built = buildSheet(planImport(grid));
    expect(built.columns.map((c) => c.key)).not.toContain("column-5");
  });
});

describe("script detection", () => {
  // A run sheet marks the words a presenter says by setting them in italic.
  const sheet = (): string[][] => [
    ["ITEM", "TIME", "DUR", "SCR", "ACTION", "WHO"],
    ["1", "19:00:00", "01:00", "CAM", "WELCOME", "LC"],
    ["2", "", "", "", "Ladies and gentlemen, please welcome to the field a proud son of this club,", ""],
    ["3", "", "", "", "a premiership winner and a true champion of the game.", ""],
    ["4", "", "", "TRK", "WALK-ON MUSIC - EDIT 2", ""],
    ["5", "", "", "", "LX - STAGE LIGHTS TO FULL", ""],
    ["6", "19:02:00", "00:30", "VTR", "SPONSOR REEL", ""],
    ["7", "19:02:30", "00:30", "GFX", "SCORE BUG", ""],
    ["8", "19:03:00", "00:20", "LED", "CROWD PROMPT", ""],
    ["9", "19:03:20", "00:10", "CAM", "WIDE SHOT", ""],
  ];
  const italics = [
    "Ladies and gentlemen, please welcome to the field a proud son of this club,",
    "a premiership winner and a true champion of the game.",
    "WALK-ON MUSIC - EDIT 2",
  ];
  const build = () => buildSheet(planImport(sheet(), { italicText: italics }));

  it("marks italic sentences as script", () => {
    const rows = classifySheet(sheet(), 0, mapColumns(sheet()[0]!, sheet().slice(1)), italics);
    expect(rows.filter((r) => r.script).map((r) => r.sourceNumber)).toEqual(["2", "3"]);
  });

  it("does not mark an italic LABEL — a track name is not a read", () => {
    const rows = classifySheet(sheet(), 0, mapColumns(sheet()[0]!, sheet().slice(1)), italics);
    expect(rows.find((r) => r.sourceNumber === "4")?.script).toBeFalsy();
  });

  it("does not mark an all-caps instruction, however long", () => {
    const rows = classifySheet(sheet(), 0, mapColumns(sheet()[0]!, sheet().slice(1)), italics);
    expect(rows.find((r) => r.sourceNumber === "5")?.script).toBeFalsy();
  });

  it("marks nothing at all when the source carries no italics", () => {
    const rows = classifySheet(sheet(), 0, mapColumns(sheet()[0]!, sheet().slice(1)), undefined);
    expect(rows.some((r) => r.script)).toBe(false);
  });

  it("tags script rows in the sheet's own cue column", () => {
    const built = build();
    const tagged = built.rows.filter((r) => r.cells?.scr === PROMPTER_TAG);
    expect(tagged.map((r) => r.sourceNumber)).toEqual(["2", "3"]);
  });

  it("never overwrites a cue the sheet already gave a row", () => {
    const built = build();
    expect(built.rows.find((r) => r.sourceNumber === "1")?.cells?.scr).toBe("CAM");
    expect(built.rows.find((r) => r.sourceNumber === "4")?.cells?.scr).toBe("TRK");
  });

  it("keeps a read as a row, not a section header", () => {
    // Text-only rows classify as banners; a read rendered as a grey heading is
    // both wrong to look at and loses the cells the marker lives in.
    expect(build().rows.filter((r) => r.sourceNumber === "2")[0]?.type).toBe("cue");
  });

  it("finds the cue column by its contents, not its name", () => {
    const grid = sheet();
    const mapping = mapColumns(grid[0]!, grid.slice(1));
    expect(findCueTypeColumn(mapping, classifySheet(grid, 0, mapping))).toBe("scr");
  });
});

describe("looksLikeBotchedValue", () => {
  it("treats a label in a time column as content, not an error", () => {
    // A team list puts positions in the duration column; a pre-show row says
    // TBC. The sheet is right — there is nothing for anyone to fix.
    for (const v of ["Interchange", "Head Coach", "Fullback", "Second Row", "TBC", "Assistant Coach"]) {
      expect(looksLikeBotchedValue(v)).toBe(false);
    }
  });

  it("still flags a value that was reaching for a time or duration", () => {
    for (const v of ["7.3O pm", "0:9O:00", "2 mins x", "12:", "1030hrs?"]) {
      expect(looksLikeBotchedValue(v)).toBe(true);
    }
  });
});

describe("roles from every column that assigns work", () => {
  const grid = (): string[][] => [
    ["ITEM", "TIME", "DUR", "SCR", "ACTION", "WHO"],
    ["1", "19:00:00", "00:30", "VTR", "SPONSOR REEL", "GH"],
    ["2", "19:00:30", "00:30", "GFX", "SCORE BUG", "LC"],
    ["3", "19:01:00", "00:20", "LED", "CROWD PROMPT", "GH"],
    ["4", "19:01:20", "00:10", "CAM", "WIDE SHOT", "LC JM"],
    ["5", "19:01:30", "00:30", "VTR", "HIGHLIGHTS", "cue DP"],
    ["6", "19:02:00", "00:30", "GFX", "TEAM LIST", "DP cue"],
  ];
  const built = () => buildSheet(planImport(grid()));

  it("finds the people AND the positions that run the show", () => {
    const names = built().roles.map((r) => r.name);
    for (const expected of ["GH", "LC", "DP", "VTR", "GFX"]) expect(names).toContain(expected);
  });

  it("reports both columns as places an assignment is recorded", () => {
    expect(built().roleColumnKeys).toEqual(expect.arrayContaining(["who", "scr"]));
  });

  it("never turns the prompter marker into a crew position", () => {
    const withScript = grid();
    withScript.push(["7", "", "", "", "Ladies and gentlemen, please welcome our guest tonight.", ""]);
    const b = buildSheet(planImport(withScript, { italicText: ["Ladies and gentlemen, please welcome our guest tonight."] }));
    expect(b.rows.some((r) => r.cells?.scr === PROMPTER_TAG)).toBe(true);
    expect(b.roles.map((r) => r.name.toLowerCase())).not.toContain(PROMPTER_TAG);
  });
});
