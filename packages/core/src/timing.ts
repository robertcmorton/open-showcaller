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
