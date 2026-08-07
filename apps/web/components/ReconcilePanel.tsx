"use client";

import { useEffect, useState } from "react";
import * as Y from "yjs";
import { formatDuration, formatTimeOfDay, type PlanTiming } from "@opencall/core";
import type { ProjectedRow } from "@opencall/db/doc";

export interface TimingGap {
  /** Index of the anchored row that opens the segment. */
  fromIndex: number;
  /** Index of the anchored row whose start disagrees with the cascade. */
  toIndex: number;
  /** anchoredStart − expectedStart: positive = unexplained gap, negative = overlap. */
  gapSec: number;
}

/**
 * Finds every place where an anchored start disagrees with the durations
 * above it — the classic imported-sheet problem where TIME and DURATION
 * columns don't add up.
 */
export function findTimingGaps(rows: ProjectedRow[], timing: PlanTiming): TimingGap[] {
  const gaps: TimingGap[] = [];
  let lastAnchor = -1;
  let expected: number | null = null;
  rows.forEach((row, i) => {
    const t = timing.rows[i]!;
    if (row.hardStartSec != null) {
      if (lastAnchor >= 0 && expected != null) {
        const gap = row.hardStartSec - expected;
        if (Math.abs(gap) >= 1) gaps.push({ fromIndex: lastAnchor, toIndex: i, gapSec: Math.round(gap) });
      }
      lastAnchor = i;
      expected = row.hardStartSec + t.effectiveDurationSec;
    } else if (expected != null) {
      expected += t.effectiveDurationSec;
    }
  });
  return gaps;
}

/**
 * Step-by-step reconciliation: for each mismatch the showcaller chooses —
 * absorb the gap into the segment's last duration, clear the disagreeing
 * anchor and let the cascade decide, or accept the gap as intentional
 * (a genuine hold in the original sheet).
 */
export function ReconcilePanel({
  doc,
  rows,
  timing,
  gaps,
  use24h,
  onClose,
  onCurrent,
}: {
  doc: Y.Doc;
  rows: ProjectedRow[];
  timing: PlanTiming;
  gaps: TimingGap[];
  use24h: boolean;
  onClose: () => void;
  /** Reports the rows of the issue on screen so the grid can highlight them. */
  onCurrent?: (focus: { fromId: string; toId: string } | null) => void;
}) {
  const [accepted, setAccepted] = useState<ReadonlySet<string>>(new Set());
  const yRows = doc.getMap<Y.Map<unknown>>("rows");

  const open = gaps.filter((g) => !accepted.has(`${rows[g.toIndex]?.id}`));
  const current = open[0];
  const fromId = current ? rows[current.fromIndex]?.id : undefined;
  const toId = current ? rows[current.toIndex]?.id : undefined;
  useEffect(() => {
    onCurrent?.(fromId && toId ? { fromId, toId } : null);
  }, [fromId, toId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!current) {
    return (
      <div className="panel" style={{ margin: "0 0 12px", display: "flex", gap: 12, alignItems: "center" }}>
        <strong>✓ Timings reconciled</strong>
        <span style={{ color: "var(--text-2)", fontSize: "var(--fs-sm)", flex: 1 }}>
          Every anchored time now agrees with the durations between them.
        </span>
        <button className="btn btn-sm" onClick={onClose}>
          Done
        </button>
      </div>
    );
  }

  const from = rows[current.fromIndex]!;
  const to = rows[current.toIndex]!;
  // The row whose duration absorbs the gap: the last row before the anchor
  // that HAS a duration, else the segment opener itself.
  let absorbIndex = current.toIndex - 1;
  while (absorbIndex > current.fromIndex && rows[absorbIndex]!.durationSec == null) absorbIndex--;
  const absorb = rows[absorbIndex]!;
  const absorbNew = Math.max(0, (absorb.durationSec ?? 0) + current.gapSec);

  const overlap = current.gapSec < 0;

  return (
    <div className="panel" style={{ margin: "0 0 12px", display: "grid", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <strong>Timing check</strong>
        <span className="chip" style={{ color: "var(--warn)", borderColor: "var(--warn)" }}>
          {open.length} of {gaps.length} to resolve
        </span>
        <span style={{ flex: 1 }} />
        <button className="btn btn-sm btn-ghost" onClick={onClose}>
          Close
        </button>
      </div>

      <div style={{ fontSize: "var(--fs-sm)", lineHeight: 1.6, color: "var(--text-2)" }}>
        The sheet's TIME column and its DURATION column disagree here. Starting from{" "}
        <strong style={{ color: "var(--text)" }}>{from.title || "untitled"}</strong> at{" "}
        <span className="mono">{from.hardStartSec != null ? formatTimeOfDay(from.hardStartSec, use24h) : "—"}</span> and adding
        up every duration between, <strong style={{ color: "var(--text)" }}>{to.title || "untitled"}</strong> should start at{" "}
        <strong className="mono" style={{ color: "var(--text)" }}>
          {to.hardStartSec != null ? formatTimeOfDay(to.hardStartSec - current.gapSec, use24h) : "—"}
        </strong>{" "}
        — but its printed time says{" "}
        <strong className="mono" style={{ color: "var(--text)" }}>
          {to.hardStartSec != null ? formatTimeOfDay(to.hardStartSec, use24h) : "—"}
        </strong>
        . That's{" "}
        <strong className="mono" style={{ color: overlap ? "var(--over)" : "var(--warn)" }}>
          {formatDuration(Math.abs(current.gapSec))}
        </strong>{" "}
        {overlap
          ? "MORE content than the clock allows — the items above run past the printed time."
          : "of unaccounted time — the sheet sits idle before the printed time."}{" "}
        Choose which number to trust:
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
          <button
            className="btn btn-sm btn-primary"
            style={{ flexShrink: 0 }}
            onClick={() => {
              doc.transact(() => {
                yRows.get(absorb.id)?.set("durationSec", absorbNew);
              });
            }}
          >
            Change “{(absorb.title || "untitled").slice(0, 24)}” duration to {formatDuration(absorbNew)}
          </button>
          <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-2)" }}>
            Trust the printed times: “{(absorb.title || "untitled").slice(0, 24)}” goes from{" "}
            <span className="mono">{absorb.durationSec != null ? formatDuration(absorb.durationSec) : "—"}</span> to{" "}
            <span className="mono">{formatDuration(absorbNew)}</span>, and the durations then meet the printed time exactly.
          </span>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
          <button
            className="btn btn-sm"
            style={{ flexShrink: 0 }}
            onClick={() => {
              // One fix clears the whole chain: the correction shifts THIS
              // row's fixed time and every fixed time below it by the same
              // amount — no walking the sheet gap by gap.
              doc.transact(() => {
                const delta = -current.gapSec;
                for (let i = current.toIndex; i < rows.length; i++) {
                  const r = rows[i]!;
                  if (r.hardStartSec != null) yRows.get(r.id)?.set("hardStartSec", r.hardStartSec + delta);
                }
              });
            }}
          >
            Change “{(to.title || "untitled").slice(0, 24)}” start to{" "}
            {to.hardStartSec != null ? formatTimeOfDay(to.hardStartSec - current.gapSec, use24h) : "—"} &amp; shift below
          </button>
          <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-2)" }}>
            Trust the durations: this row moves to{" "}
            <span className="mono">{to.hardStartSec != null ? formatTimeOfDay(to.hardStartSec - current.gapSec, use24h) : "—"}</span>{" "}
            and <strong>every fixed time below shifts with it</strong> — one fix, the whole sheet agrees again. One undo
            reverses it all.
          </span>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
          <button className="btn btn-sm btn-ghost" style={{ flexShrink: 0 }} onClick={() => setAccepted(new Set([...accepted, to.id]))}>
            Keep both — the gap is deliberate
          </button>
          <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-2)" }}>
            Both numbers are right — the sheet really does hold for{" "}
            <span className="mono">{formatDuration(Math.abs(current.gapSec))}</span> here (doors, walk-in, a changeover).
            Nothing changes; the check stops flagging it.
          </span>
        </div>
      </div>
    </div>
  );
}
