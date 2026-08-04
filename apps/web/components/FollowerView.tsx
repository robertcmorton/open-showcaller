"use client";

import { computeTiming, formatDuration, formatTimeOfDay } from "@opencall/core";
import { projectRundownDoc } from "@opencall/db/doc";
import { useShowChannel } from "../lib/showChannel";
import { useLiveTiming } from "../lib/useLiveTiming";
import { useRundownDoc, useWakeLock } from "../lib/useRundownDoc";

/**
 * Companion follower surface: glanceable current/next cue, live countdown,
 * drift. Read-only; keeps the screen awake for show use.
 */
export function FollowerView({ rundownId, joinCode }: { rundownId: string; joinCode?: string }) {
  useWakeLock();
  const { doc } = useRundownDoc(rundownId);
  const { meta, columns, rows } = projectRundownDoc(doc);
  const timing = computeTiming(rows, meta.plannedStartSec);
  const channel = useShowChannel(rundownId, "companion", joinCode);
  const live = useLiveTiming(channel, timing);
  const show = channel.show;

  const isLive = show?.state === "running" || show?.state === "paused";
  const activeIdx = isLive && show?.activeRowId ? rows.findIndex((r) => r.id === show.activeRowId) : -1;
  const active = activeIdx >= 0 ? rows[activeIdx] : null;
  const next = activeIdx >= 0 ? rows.slice(activeIdx + 1).find((r) => r.type === "cue") : null;
  const scriptKey = columns.find((c) => c.key === "script")?.key ?? "script";
  const over = live?.remainingInRowSec != null && live.remainingInRowSec < 0;

  return (
    <main style={{ minHeight: "100vh", display: "flex", flexDirection: "column", padding: "1.2rem", gap: "1rem" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={{ fontSize: "0.8rem", color: "var(--text-2)" }}>{meta.name}</div>
        <div style={{ fontSize: "0.7rem", color: channel.connected ? "var(--under)" : "var(--over)" }}>
          {channel.connected ? (isLive ? (show?.state === "paused" ? "PAUSED" : "● FOLLOWING") : "standing by") : "reconnecting…"}
        </div>
      </header>

      {!isLive || !active ? (
        <section style={{ margin: "auto", textAlign: "center", color: "var(--text-3)" }}>
          <div style={{ fontSize: "2rem", marginBottom: 8 }}>—</div>
          <div>Show has not started</div>
        </section>
      ) : (
        <>
          <section style={{ textAlign: "center", marginTop: "0.5rem" }}>
            <div style={{ color: "var(--text-3)", fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.1em" }}>
              Now · {activeIdx + 1}
            </div>
            <h1 style={{ fontSize: "1.6rem", margin: "0.3rem 0" }}>{active.title}</h1>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "4rem",
                fontWeight: 600,
                color: over ? "var(--over)" : "var(--under)",
                lineHeight: 1.1,
              }}
            >
              {live?.remainingInRowSec != null
                ? over
                  ? `+${formatDuration(live.rowOverSec)}`
                  : formatDuration(live.remainingInRowSec)
                : "—"}
            </div>
            {live?.showDriftSec != null && (
              <div style={{ color: (live.showDriftSec ?? 0) > 0 ? "var(--over)" : "var(--under)", fontSize: "0.85rem" }}>
                show {live.showDriftSec > 0 ? "+" : "−"}
                {formatDuration(Math.abs(live.showDriftSec))} · proj end{" "}
                {live.projectedEndSec != null ? formatTimeOfDay(Math.round(live.projectedEndSec), meta.use24h) : "—"}
              </div>
            )}
          </section>

          {active.cells[scriptKey] && (
            <section
              style={{
                background: "var(--surface)", border: "1px solid var(--border-subtle)",
                borderRadius: 10,
                padding: "0.9rem 1rem",
                fontSize: "0.95rem",
                lineHeight: 1.5,
                maxHeight: "30vh",
                overflowY: "auto",
              }}
            >
              {active.cells[scriptKey]}
            </section>
          )}

          {next && (
            <section style={{ marginTop: "auto", borderTop: "1px solid var(--border-subtle)", paddingTop: "0.8rem" }}>
              <div style={{ color: "var(--text-3)", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                Next
              </div>
              <div style={{ fontSize: "1.05rem" }}>
                {next.title}
                {next.durationSec != null && (
                  <span style={{ color: "var(--text-3)", marginLeft: 10, fontFamily: "var(--font-mono)" }}>
                    {formatDuration(next.durationSec)}
                  </span>
                )}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
