import type { PlanTiming } from "./types";

export interface LiveShowInput {
  /** Planned timing for the rundown (computeTiming output). */
  timing: PlanTiming;
  /** Planned duration of the active row (effective seconds). */
  activeRowId: string;
  /** Server-clock ms when the active row started. */
  activeRowStartedAtMs: number;
  /** Accumulated paused ms inside the active row. */
  pausedAccumMs: number;
  /** Ms frozen at pause time, null while running. */
  pausedAtMs: number | null;
  /** Current server-clock ms (Date.now() + measured offset). */
  nowMs: number;
  /** Converts server-clock ms → seconds since local midnight (show timezone). */
  toSecondsOfDay: (ms: number) => number;
}

export interface LiveShowTiming {
  /** Seconds spent in the active row (pause-adjusted). */
  elapsedInRowSec: number;
  /** Planned duration minus elapsed; negative once over. */
  remainingInRowSec: number | null;
  /** How far over the active row is running (0 while under). */
  rowOverSec: number;
  /**
   * Cumulative show drift: how late (+) or early (−) the show is running,
   * measured at the active row's actual vs planned start, plus any overrun
   * inside the active row. Null when the active row has no planned start.
   */
  showDriftSec: number | null;
  /** Planned end shifted by the current drift. */
  projectedEndSec: number | null;
}

/** All countdown math is local: derived from timestamps, never from streamed ticks. */
export function computeLiveTiming(input: LiveShowInput): LiveShowTiming | null {
  const { timing, activeRowId, activeRowStartedAtMs, pausedAccumMs, pausedAtMs, nowMs, toSecondsOfDay } = input;
  const index = timing.rows.findIndex((r) => r.id === activeRowId);
  if (index < 0) return null;
  const active = timing.rows[index]!;

  const effectiveNowMs = pausedAtMs ?? nowMs;
  const elapsedInRowSec = Math.max(0, (effectiveNowMs - activeRowStartedAtMs - pausedAccumMs) / 1000);

  const planned = active.effectiveDurationSec;
  const remainingInRowSec = planned > 0 || active.startSec != null ? planned - elapsedInRowSec : null;
  const rowOverSec = Math.max(0, elapsedInRowSec - planned);

  let showDriftSec: number | null = null;
  let projectedEndSec: number | null = null;
  if (active.startSec != null) {
    const actualStartSec = toSecondsOfDay(activeRowStartedAtMs);
    showDriftSec = actualStartSec - active.startSec + rowOverSec;
    if (timing.endSec != null) projectedEndSec = timing.endSec + showDriftSec;
  }

  return { elapsedInRowSec, remainingInRowSec, rowOverSec, showDriftSec, projectedEndSec };
}

/** Default show-timezone mapping: local seconds since midnight. */
export function localSecondsOfDay(ms: number): number {
  const d = new Date(ms);
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000;
}
