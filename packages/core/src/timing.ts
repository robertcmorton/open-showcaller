import type { PlanRow, PlanTiming, TimedRow } from "./types";

const effDur = (row: PlanRow): number =>
  row.skipped || row.durationMuted || row.durationSec == null ? 0 : Math.max(0, row.durationSec);

/**
 * Cascade timing:
 *  - a row's start = previous row's end
 *  - anchored rows (hardStartSec) restart the cascade; last anchor wins
 *  - a back-timed anchor computes the rows between the previous anchor and itself
 *    upward from its own start instead
 *  - `plannedStartSec` acts as a virtual anchor above row 0 when row 0 is unanchored
 */
export function computeTiming(
  rows: PlanRow[],
  plannedStartSec: number | null = null,
): PlanTiming {
  const timed: TimedRow[] = rows.map((row) => ({
    id: row.id,
    startSec: null,
    endSec: null,
    effectiveDurationSec: effDur(row),
    anchored: row.hardStartSec != null,
    backtimed: false,
  }));

  // Forward pass.
  let cursor: number | null = plannedStartSec;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const t = timed[i]!;
    if (row.hardStartSec != null) cursor = row.hardStartSec;
    if (cursor != null) {
      t.startSec = cursor;
      t.endSec = cursor + t.effectiveDurationSec;
      cursor = t.endSec;
    }
  }

  // Back-timing pass: fill the open segment above each back-timed anchor upward.
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.hardStartSec == null || !row.backtime) continue;
    let cursorUp = row.hardStartSec;
    for (let j = i - 1; j >= 0; j--) {
      const above = rows[j]!;
      if (above.hardStartSec != null) break; // never override another anchor
      const t = timed[j]!;
      t.endSec = cursorUp;
      t.startSec = cursorUp - t.effectiveDurationSec;
      t.backtimed = true;
      cursorUp = t.startSec;
    }
  }

  const first = timed[0];
  const last = timed[timed.length - 1];
  return {
    rows: timed,
    startSec: first?.startSec ?? null,
    endSec: last?.endSec ?? null,
    totalDurationSec: timed.reduce((sum, t) => sum + t.effectiveDurationSec, 0),
  };
}

// ── Timing reconciliation ─────────────────────────────────────────────────────

export interface TimingGap {
  /** Index of the anchored row that opens the segment. */
  fromIndex: number;
  /** Index of the anchored row whose start disagrees with the cascade. */
  toIndex: number;
  /** anchoredStart − expectedStart: positive = unexplained gap, negative = overlap. */
  gapSec: number;
}

/** The shape findTimingGaps needs from a row — anchored start only. */
export interface AnchoredRow {
  hardStartSec: number | null;
}

/** How many rows in a row may sit alongside the running order before we stop looking. */
const MAX_PARALLEL_RUN = 4;

/**
 * Finds every place where an anchored start genuinely disagrees with the
 * durations above it.
 *
 * A run sheet is not one unbroken chain. Alongside the running order it
 * carries rows that happen AT a time rather than taking time in it: two things
 * booked for the same moment, a deadline ("team sheets due"), a standing cue
 * ("2 min bell"), a note that an activity elsewhere has finished. Read as links
 * in the chain they look like errors — each one appears to open a gap and then
 * close it again — and they bury the disagreements that are real.
 *
 * So a disagreeing row is only reported once we have checked the obvious
 * alternative: that it sits ALONGSIDE the running order. If skipping it (and
 * its duration) lets the next anchored row land exactly where the cascade
 * expected, it was never in the chain, and there is nothing to reconcile.
 */
export function findTimingGaps(rows: AnchoredRow[], timing: PlanTiming): TimingGap[] {
  const gaps: TimingGap[] = [];
  let lastAnchor = -1;
  let expected: number | null = null;

  /** Does the chain pick up again within a few rows if we skip from `i`? */
  const runsAlongside = (i: number, expectedAt: number): boolean => {
    let extra = 0;
    let anchorsSkipped = 0;
    for (let j = i + 1; j < rows.length; j++) {
      const start = rows[j]!.hardStartSec;
      if (start == null) {
        // An unanchored row between the two IS in the chain; its time counts.
        extra += timing.rows[j]?.effectiveDurationSec ?? 0;
        continue;
      }
      if (Math.abs(start - (expectedAt + extra)) < 1) return true;
      if (++anchorsSkipped >= MAX_PARALLEL_RUN) return false;
    }
    return false;
  };

  rows.forEach((row, i) => {
    const t = timing.rows[i]!;
    if (row.hardStartSec != null) {
      if (lastAnchor >= 0 && expected != null) {
        const gap = row.hardStartSec - expected;
        if (Math.abs(gap) >= 1) {
          // Alongside the running order → not a disagreement, and it must not
          // become the anchor the following rows are measured from.
          if (runsAlongside(i, expected)) return;
          gaps.push({ fromIndex: lastAnchor, toIndex: i, gapSec: Math.round(gap) });
        }
      }
      lastAnchor = i;
      expected = row.hardStartSec + t.effectiveDurationSec;
    } else if (expected != null) {
      expected += t.effectiveDurationSec;
    }
  });
  return gaps;
}
