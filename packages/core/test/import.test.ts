import { describe, expect, it } from "vitest";
import { classifyRows, detectHeaderRow, mapColumns, parseDurationLoose, parseTimeLoose, planImport } from "../src/import";

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
    expect(mapping[5]).toEqual({ kind: "department", key: "audio", title: "Audio" });
    expect(mapping[6]).toEqual({ kind: "department", key: "video", title: "Video" }); // BIG SCREEN
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
    // WHO + WHAT columns stack into production notes, preserving both lines.
    expect(rows[4]!.cells.prodNotes).toBe("AUDIO\nDJ tracks");
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
