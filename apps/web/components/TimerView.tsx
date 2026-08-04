"use client";

import { computeTiming, formatDuration } from "@open-showcaller/core";
import { projectRundownDoc } from "@open-showcaller/db/doc";
import { useRundownDoc, useWakeLock } from "../lib/useRundownDoc";
import { useShowChannel } from "../lib/showChannel";
import { useLiveTiming } from "../lib/useLiveTiming";

/**
 * Speaker Timer: fullscreen countdown for the active cue. Green while on time,
 * amber inside the final stretch, red counting up on overrun. Meant for
 * confidence monitors and speakers' phones.
 */
export function TimerView({ rundownId }: { rundownId: string }) {
  useWakeLock();
  const { doc } = useRundownDoc(rundownId);
  const { meta, rows } = projectRundownDoc(doc);
  const timing = computeTiming(rows, meta.plannedStartSec);
  const channel = useShowChannel(rundownId, "companion");
  const live = useLiveTiming(channel, timing);
  const show = channel.show;

  const isLive = show?.state === "running" || show?.state === "paused";
  const active = isLive && show?.activeRowId ? rows.find((r) => r.id === show.activeRowId) : null;

  const planned = active?.durationSec ?? 0;
  const remaining = live?.remainingInRowSec ?? null;
  const over = remaining != null && remaining < 0;
  const amber = !over && remaining != null && planned > 0 && remaining <= Math.min(60, planned * 0.2);
  const color = !channel.connected ? "#777" : over ? "#f85149" : amber ? "#e8b03c" : "#2ee56a";

  const display =
    remaining == null ? "--:--" : over ? `+${formatDuration(live!.rowOverSec)}` : formatDuration(remaining);

  return (
    <main
      onDoubleClick={() => void document.documentElement.requestFullscreen?.().catch(() => undefined)}
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "2vh",
        background: "#000",
        cursor: "default",
        userSelect: "none",
      }}
    >
      <div style={{ color: "#9a9a9a", fontSize: "3.4vw", fontWeight: 500 }}>
        {active ? active.title : meta.name}
      </div>
      <div
        style={{
          border: "1px solid #6b5a2a",
          borderRadius: 8,
          padding: "2vh 5vw",
          fontFamily: "ui-monospace, 'SF Mono', monospace",
          fontWeight: 700,
          fontSize: "22vw",
          lineHeight: 1.05,
          color,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {isLive ? display : "--:--"}
      </div>
      <div style={{ color: "#666", fontSize: "1.6vw" }}>
        {!channel.connected
          ? "reconnecting…"
          : !isLive
            ? "standing by"
            : show?.state === "paused"
              ? "paused"
              : ""}
      </div>
    </main>
  );
}
