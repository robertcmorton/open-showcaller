"use client";

import { useEffect } from "react";
import { formatDuration, formatTimeOfDay, type LiveShowTiming } from "@open-showcaller/core";
import type { ShowChannel } from "../lib/showChannel";

function signed(sec: number): string {
  const sign = sec < 0 ? "−" : "+";
  return `${sign}${formatDuration(Math.abs(sec))}`;
}

export function LiveReadouts({ live, use24h }: { live: LiveShowTiming | null; use24h: boolean }) {
  if (!live) return null;
  const over = live.remainingInRowSec != null && live.remainingInRowSec < 0;
  return (
    <>
      <div>
        <div className="header-label">Item</div>
        <div className="header-clock" style={{ color: over ? "#f85149" : "#3fb950" }}>
          {live.remainingInRowSec != null
            ? over
              ? `+${formatDuration(live.rowOverSec)}`
              : formatDuration(live.remainingInRowSec)
            : "—"}
        </div>
      </div>
      <div>
        <div className="header-label">Show</div>
        <div className="header-clock" style={{ color: (live.showDriftSec ?? 0) > 0 ? "#f85149" : "#3fb950" }}>
          {live.showDriftSec != null ? signed(live.showDriftSec) : "—"}
        </div>
      </div>
      <div>
        <div className="header-label">Proj. end</div>
        <div className="header-clock">
          {live.projectedEndSec != null ? formatTimeOfDay(Math.round(live.projectedEndSec), use24h) : "—"}
        </div>
      </div>
    </>
  );
}

export function TransportBar({
  channel,
  orderedRowIds,
}: {
  channel: ShowChannel;
  orderedRowIds: string[];
}) {
  const show = channel.show;
  const liveState = show?.state ?? "idle";
  const isLive = liveState === "running" || liveState === "paused";

  const step = (dir: 1 | -1) => {
    if (!show?.activeRowId) return;
    const idx = orderedRowIds.indexOf(show.activeRowId);
    const target = orderedRowIds[idx + dir];
    if (target) channel.sendCmd(dir === 1 ? "next" : "prev", target);
  };

  // Space / Shift+Space transport shortcuts — ignored while typing in a cell.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || !isLive) return;
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable=true]")) return;
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (channel.role !== "caller") return null;

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      {!isLive && (
        <button
          className="toolbar-btn"
          style={{ background: "#1a3a1a", borderColor: "#2f6f2f" }}
          onClick={() => channel.sendCmd("start", orderedRowIds[0])}
          disabled={!channel.connected || orderedRowIds.length === 0}
        >
          ▶ Start
        </button>
      )}
      {isLive && (
        <>
          {liveState === "running" ? (
            <button className="toolbar-btn" onClick={() => channel.sendCmd("pause")}>
              ⏸ Pause
            </button>
          ) : (
            <button className="toolbar-btn" onClick={() => channel.sendCmd("resume")}>
              ▶ Resume
            </button>
          )}
          <button className="toolbar-btn" onClick={() => step(-1)}>
            ⏮ Prev
          </button>
          <button className="toolbar-btn" onClick={() => step(1)}>
            Next ⏭
          </button>
          <button
            className="toolbar-btn"
            onClick={() => {
              if (window.confirm("Stop the show?")) channel.sendCmd("stop");
            }}
          >
            ⏹ Stop
          </button>
          <span className="live-badge">{liveState === "paused" ? "PAUSED" : "LIVE"}</span>
        </>
      )}
    </div>
  );
}
