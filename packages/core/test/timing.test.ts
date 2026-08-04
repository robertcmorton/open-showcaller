import { describe, expect, it } from "vitest";
import { computeTiming, parseDurationShorthand, formatTimeOfDay, type PlanRow } from "../src/index";

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
