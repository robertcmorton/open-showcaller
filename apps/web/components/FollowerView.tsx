"use client";

import { useEffect, useState } from "react";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { computeTiming, formatDuration, formatTimeOfDay } from "@open-showcaller/core";
import { projectRundownDoc } from "@open-showcaller/db/doc";
import { useShowChannel } from "../lib/showChannel";
import { useLiveTiming } from "../lib/useLiveTiming";

const DOC_WS_URL = process.env.NEXT_PUBLIC_DOC_WS_URL ?? "ws://localhost:8788";

/**
 * Companion follower surface: glanceable current/next cue, live countdown,
 * drift. Read-only; keeps the screen awake for show use.
 */
export function FollowerView({ rundownId }: { rundownId: string }) {
  const [doc] = useState(() => new Y.Doc());
  const [, setTick] = useState(0);

  useEffect(() => {
    const provider = new HocuspocusProvider({ url: DOC_WS_URL, name: rundownId, document: doc });
    const bump = () => setTick((n) => n + 1);
    doc.on("update", bump);

    // Wake lock: companion screens must not sleep mid-show.
    let lock: { release: () => Promise<void> } | null = null;
    const acquire = () =>
      (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<never> } }).wakeLock
        ?.request("screen")
        .then((l: { release: () => Promise<void> }) => (lock = l))
        .catch(() => undefined);
    void acquire();
    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release();
      doc.off("update", bump);
      provider.destroy();
    };
  }, [doc, rundownId]);

  const { meta, columns, rows } = projectRundownDoc(doc);
  const timing = computeTiming(rows, meta.plannedStartSec);
  const channel = useShowChannel(rundownId, "companion");
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
        <div style={{ fontSize: "0.8rem", color: "#9a9a9a" }}>{meta.name}</div>
        <div style={{ fontSize: "0.7rem", color: channel.connected ? "#3fb950" : "#f85149" }}>
          {channel.connected ? (isLive ? (show?.state === "paused" ? "PAUSED" : "● FOLLOWING") : "standing by") : "reconnecting…"}
        </div>
      </header>

      {!isLive || !active ? (
        <section style={{ margin: "auto", textAlign: "center", color: "#8a8a8a" }}>
          <div style={{ fontSize: "2rem", marginBottom: 8 }}>—</div>
          <div>Show has not started</div>
        </section>
      ) : (
        <>
          <section style={{ textAlign: "center", marginTop: "0.5rem" }}>
            <div style={{ color: "#8a8a8a", fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.1em" }}>
              Now · {activeIdx + 1}
            </div>
            <h1 style={{ fontSize: "1.6rem", margin: "0.3rem 0" }}>{active.title}</h1>
            <div
              style={{
                fontFamily: "ui-monospace, monospace",
                fontSize: "4rem",
                fontWeight: 600,
                color: over ? "#f85149" : "#3fb950",
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
              <div style={{ color: (live.showDriftSec ?? 0) > 0 ? "#f85149" : "#3fb950", fontSize: "0.85rem" }}>
                show {live.showDriftSec > 0 ? "+" : "−"}
                {formatDuration(Math.abs(live.showDriftSec))} · proj end{" "}
                {live.projectedEndSec != null ? formatTimeOfDay(Math.round(live.projectedEndSec), meta.use24h) : "—"}
              </div>
            )}
          </section>

          {active.cells[scriptKey] && (
            <section
              style={{
                background: "#141414",
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
            <section style={{ marginTop: "auto", borderTop: "1px solid #222", paddingTop: "0.8rem" }}>
              <div style={{ color: "#8a8a8a", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                Next
              </div>
              <div style={{ fontSize: "1.05rem" }}>
                {next.title}
                {next.durationSec != null && (
                  <span style={{ color: "#8a8a8a", marginLeft: 10, fontFamily: "ui-monospace, monospace" }}>
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
