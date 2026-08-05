"use client";

import { useState } from "react";
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
}: {
  doc: Y.Doc;
  rows: ProjectedRow[];
  timing: PlanTiming;
  gaps: TimingGap[];
  use24h: boolean;
  onClose: () => void;
}) {
  const [accepted, setAccepted] = useState<ReadonlySet<string>>(new Set());
  const yRows = doc.getMap<Y.Map<unknown>>("rows");

  const open = gaps.filter((g) => !accepted.has(`${rows[g.toIndex]?.id}`));
  const current = open[0];

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

      <div style={{ fontSize: "var(--fs-sm)", lineHeight: 1.6 }}>
        Between <strong>{from.title || "untitled"}</strong> ({from.hardStartSec != null && formatTimeOfDay(from.hardStartSec, use24h)}) and{" "}
        <strong>{to.title || "untitled"}</strong> (anchored {to.hardStartSec != null && formatTimeOfDay(to.hardStartSec, use24h)}), the
        durations {overlap ? "OVERSHOOT the anchor" : "leave a gap"} of{" "}
        <strong className="mono" style={{ color: overlap ? "var(--over)" : "var(--warn)" }}>
          {formatDuration(Math.abs(current.gapSec))}
        </strong>
        .
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          className="btn btn-sm btn-primary"
          title={`"${absorb.title || "untitled"}" duration ${absorb.durationSec != null ? formatDuration(absorb.durationSec) : "—"} → ${formatDuration(absorbNew)}`}
          onClick={() => {
            doc.transact(() => {
              yRows.get(absorb.id)?.set("durationSec", absorbNew);
            });
          }}
        >
          Absorb into “{(absorb.title || "untitled").slice(0, 24)}” ({formatDuration(absorbNew)})
        </button>
        <button
          className="btn btn-sm"
          title="Remove this anchor — the row will follow the cascade instead"
          onClick={() => {
            doc.transact(() => {
              yRows.get(to.id)?.set("hardStartSec", null);
            });
          }}
        >
          Un-anchor “{(to.title || "untitled").slice(0, 24)}”
        </button>
        <button
          className="btn btn-sm btn-ghost"
          title="The sheet intends this gap (a hold / doors period) — leave it"
          onClick={() => setAccepted(new Set([...accepted, to.id]))}
        >
          Gap is intentional
        </button>
      </div>
    </div>
  );
}
