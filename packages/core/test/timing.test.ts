import { describe, expect, it } from "vitest";
import { computeTiming, findTimingGaps, parseDurationShorthand, formatTimeOfDay, type PlanRow } from "../src/index";

const row = (id: string, patch: Partial<PlanRow> = {}): PlanRow => ({
  id,
  type: "cue",
  durationSec: null,
  hardStartSec: null,
  ...patch,
});

const NINE_AM = 9 * 3600;

describe("computeTiming — cascade", () => {
  it("cascades starts from the planned start", () => {
    const t = computeTiming(
      [row("a", { durationSec: 90 }), row("b", { durationSec: 60 }), row("c", { durationSec: 30 })],
      NINE_AM,
    );
    expect(t.rows.map((r) => r.startSec)).toEqual([NINE_AM, NINE_AM + 90, NINE_AM + 150]);
    expect(t.endSec).toBe(NINE_AM + 180);
    expect(t.totalDurationSec).toBe(180);
  });

  it("returns null starts when nothing is anchored and no planned start exists", () => {
    const t = computeTiming([row("a", { durationSec: 60 }), row("b")]);
    expect(t.rows.every((r) => r.startSec === null)).toBe(true);
    expect(t.startSec).toBeNull();
  });

  it("treats null duration and muted duration as zero", () => {
    const t = computeTiming(
      [row("a", { durationSec: 60 }), row("b", { durationSec: 300, durationMuted: true }), row("c", { durationSec: 30 })],
      0,
    );
    expect(t.rows[1]!.effectiveDurationSec).toBe(0);
    expect(t.rows[2]!.startSec).toBe(60);
    expect(t.totalDurationSec).toBe(90);
  });
});

describe("computeTiming — anchors", () => {
  it("last anchor wins as the foundation for subsequent rows", () => {
    const t = computeTiming(
      [
        row("a", { hardStartSec: NINE_AM, durationSec: 60 }),
        row("b", { durationSec: 60 }),
        row("c", { hardStartSec: 11 * 3600, durationSec: 600 }),
        row("d", { durationSec: 60 }),
      ],
      null,
    );
    expect(t.rows[1]!.startSec).toBe(NINE_AM + 60);
    expect(t.rows[2]!.startSec).toBe(11 * 3600);
    expect(t.rows[3]!.startSec).toBe(11 * 3600 + 600);
    expect(t.rows[2]!.anchored).toBe(true);
  });

  it("an anchor below the planned start overrides the running cascade even backwards in time", () => {
    const t = computeTiming(
      [row("a", { durationSec: 3600 }), row("b", { hardStartSec: NINE_AM, durationSec: 60 })],
      10 * 3600,
    );
    // "impossible sequence" is surfaced, not silently fixed
    expect(t.rows[0]!.endSec).toBe(11 * 3600);
    expect(t.rows[1]!.startSec).toBe(NINE_AM);
  });
});

describe("computeTiming — back-timing", () => {
  it("fills the open segment above a back-timed anchor upward", () => {
    const t = computeTiming(
      [
        row("walkin", { durationSec: 1800 }),
        row("video", { durationSec: 120 }),
        row("session", { hardStartSec: 11 * 3600, backtime: true, durationSec: 600 }),
      ],
      null,
    );
    expect(t.rows[1]!.endSec).toBe(11 * 3600);
    expect(t.rows[1]!.startSec).toBe(11 * 3600 - 120);
    expect(t.rows[0]!.startSec).toBe(11 * 3600 - 120 - 1800);
    expect(t.rows[0]!.backtimed).toBe(true);
    expect(t.rows[2]!.startSec).toBe(11 * 3600);
  });

  it("never overrides another anchor while back-filling", () => {
    const t = computeTiming(
      [
        row("a", { hardStartSec: NINE_AM, durationSec: 60 }),
        row("b", { durationSec: 120 }),
        row("c", { hardStartSec: 10 * 3600, backtime: true, durationSec: 60 }),
      ],
      null,
    );
    expect(t.rows[0]!.startSec).toBe(NINE_AM); // anchor untouched
    expect(t.rows[1]!.startSec).toBe(10 * 3600 - 120); // back-filled
  });
});

describe("format helpers", () => {
  it("parses duration shorthand", () => {
    expect(parseDurationShorthand("30m")).toBe(1800);
    expect(parseDurationShorthand("1m30s")).toBe(90);
    expect(parseDurationShorthand("90")).toBe(90);
    expect(parseDurationShorthand("2h")).toBe(7200);
    expect(parseDurationShorthand("1:30")).toBe(90);
    expect(parseDurationShorthand("01:02:03")).toBe(3723);
    expect(parseDurationShorthand("abc")).toBeNull();
  });

  it("formats time of day in both clock styles", () => {
    expect(formatTimeOfDay(9 * 3600)).toBe("9:00:00 AM");
    expect(formatTimeOfDay(21 * 3600 + 61, true)).toBe("21:01:01");
  });

  it("parses wall-clock times", async () => {
    const { parseTimeOfDay } = await import("../src/index");
    expect(parseTimeOfDay("9")).toBe(9 * 3600);
    expect(parseTimeOfDay("9:30")).toBe(9 * 3600 + 1800);
    expect(parseTimeOfDay("9:30 pm")).toBe(21 * 3600 + 1800);
    expect(parseTimeOfDay("12am")).toBe(0);
    expect(parseTimeOfDay("12pm")).toBe(12 * 3600);
    expect(parseTimeOfDay("21:05:10")).toBe(21 * 3600 + 310);
    expect(parseTimeOfDay("25:00")).toBeNull();
    expect(parseTimeOfDay("13pm")).toBeNull();
  });
});

describe("findTimingGaps", () => {
  const at = (h: number, m: number, s = 0) => h * 3600 + m * 60 + s;
  const gapsOf = (rows: { hardStartSec: number | null; durationSec: number | null }[]) => {
    const planRows: PlanRow[] = rows.map((r, i) => ({ ...r, id: `r${i}`, type: "cue" as const }));
    return findTimingGaps(rows, computeTiming(planRows, rows[0]!.hardStartSec));
  };

  it("reports a real disagreement", () => {
    // 10:00 + 10m should reach 10:10, but the next row is anchored at 10:30.
    const gaps = gapsOf([
      { hardStartSec: at(10, 0), durationSec: 600 },
      { hardStartSec: at(10, 30), durationSec: 600 },
    ]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.gapSec).toBe(1200);
  });

  it("accepts two rows booked at the same moment", () => {
    // A sheet routinely lists concurrent items: both start at 12:00, and the
    // running order picks up at 12:15 as the first row's duration says.
    expect(
      gapsOf([
        { hardStartSec: at(12, 0), durationSec: 900 },
        { hardStartSec: at(12, 0), durationSec: null },
        { hardStartSec: at(12, 15), durationSec: 2700 },
      ]),
    ).toEqual([]);
  });

  it("accepts a deadline sitting inside a block", () => {
    // "Team sheets due" happens DURING the half; the half still ends on time.
    expect(
      gapsOf([
        { hardStartSec: at(18, 0), durationSec: 1500 },
        { hardStartSec: at(18, 7), durationSec: 1800 },
        { hardStartSec: at(18, 25), durationSec: null },
      ]),
    ).toEqual([]);
  });

  it("accepts a run of markers alongside the order", () => {
    // Two notes ("mini league concludes", "teams warm up") between a block
    // that ends at 18:52:25 and the row that resumes at 18:52:25.
    expect(
      gapsOf([
        { hardStartSec: at(18, 48, 25), durationSec: 240 },
        { hardStartSec: at(18, 53), durationSec: null },
        { hardStartSec: at(18, 55), durationSec: null },
        { hardStartSec: at(18, 52, 25), durationSec: 30 },
      ]),
    ).toEqual([]);
  });

  it("still reports a disagreement that no later row explains", () => {
    expect(
      gapsOf([
        { hardStartSec: at(9, 0), durationSec: 600 },
        { hardStartSec: at(9, 5), durationSec: 600 },
        { hardStartSec: at(9, 40), durationSec: 600 },
      ]).length,
    ).toBeGreaterThan(0);
  });
});
