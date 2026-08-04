import { describe, expect, it } from "vitest";
import { computeLiveTiming, computeTiming, type PlanRow } from "../src/index";

const NINE_AM = 9 * 3600;
const rows: PlanRow[] = [
  { id: "a", type: "cue", durationSec: 90, hardStartSec: NINE_AM },
  { id: "b", type: "cue", durationSec: 120, hardStartSec: null },
  { id: "c", type: "cue", durationSec: 60, hardStartSec: null },
];
const timing = computeTiming(rows);

// Fixed clock world: t0 ms == 9:00:00 of day; helper maps ms → seconds-of-day linearly.
const T0 = 1_000_000_000;
const toSecondsOfDay = (ms: number) => NINE_AM + (ms - T0) / 1000;

describe("computeLiveTiming", () => {
  it("counts down inside a row and reports zero drift when on time", () => {
    // Row b planned 9:01:30; started exactly on time; 30s in.
    const startedAt = T0 + 90_000;
    const live = computeLiveTiming({
      timing,
      activeRowId: "b",
      activeRowStartedAtMs: startedAt,
      pausedAccumMs: 0,
      pausedAtMs: null,
      nowMs: startedAt + 30_000,
      toSecondsOfDay,
    })!;
    expect(live.elapsedInRowSec).toBe(30);
    expect(live.remainingInRowSec).toBe(90);
    expect(live.rowOverSec).toBe(0);
    expect(live.showDriftSec).toBe(0);
    expect(live.projectedEndSec).toBe(timing.endSec);
  });

  it("reports overrun and pushes drift + projected end", () => {
    // Row b started 40s late, and has been running 150s (30s over its 120s plan).
    const startedAt = T0 + 130_000;
    const live = computeLiveTiming({
      timing,
      activeRowId: "b",
      activeRowStartedAtMs: startedAt,
      pausedAccumMs: 0,
      pausedAtMs: null,
      nowMs: startedAt + 150_000,
      toSecondsOfDay,
    })!;
    expect(live.rowOverSec).toBe(30);
    expect(live.showDriftSec).toBe(70); // 40 late + 30 over
    expect(live.projectedEndSec).toBe(timing.endSec! + 70);
  });

  it("shows negative drift when running early", () => {
    // Row c planned 9:03:30 but started 50s early, 10s in.
    const startedAt = T0 + 160_000;
    const live = computeLiveTiming({
      timing,
      activeRowId: "c",
      activeRowStartedAtMs: startedAt,
      pausedAccumMs: 0,
      pausedAtMs: null,
      nowMs: startedAt + 10_000,
      toSecondsOfDay,
    })!;
    expect(live.showDriftSec).toBe(-50);
    expect(live.projectedEndSec).toBe(timing.endSec! - 50);
  });

  it("freezes elapsed while paused and honors accumulated pause time", () => {
    const startedAt = T0;
    const live = computeLiveTiming({
      timing,
      activeRowId: "a",
      activeRowStartedAtMs: startedAt,
      pausedAccumMs: 20_000,
      pausedAtMs: startedAt + 60_000, // paused at the 60s wall-clock mark
      nowMs: startedAt + 500_000, // long after — must not matter
      toSecondsOfDay,
    })!;
    expect(live.elapsedInRowSec).toBe(40); // 60 wall − 20 paused
  });

  it("returns null for an unknown active row", () => {
    expect(
      computeLiveTiming({
        timing,
        activeRowId: "nope",
        activeRowStartedAtMs: T0,
        pausedAccumMs: 0,
        pausedAtMs: null,
        nowMs: T0,
        toSecondsOfDay,
      }),
    ).toBeNull();
  });
});
