"use client";

import { useEffect, useState } from "react";
import { formatDuration, formatTimeOfDay, type LiveShowTiming } from "@opencall/core";
import type { ShowChannel } from "../lib/showChannel";
import { Icon } from "./ui";

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
        <div className="header-clock mono" style={{ color: over ? "var(--over)" : "var(--under)" }}>
          {live.remainingInRowSec != null
            ? over
              ? `+${formatDuration(live.rowOverSec)}`
              : formatDuration(live.remainingInRowSec)
            : "—"}
        </div>
      </div>
      <div>
        <div className="header-label">Show</div>
        <div className="header-clock mono" style={{ color: (live.showDriftSec ?? 0) > 0 ? "var(--over)" : "var(--under)" }}>
          {live.showDriftSec != null ? signed(live.showDriftSec) : "—"}
        </div>
      </div>
      <div>
        <div className="header-label">Proj. end</div>
        <div className="header-clock mono">
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
  const [armStop, setArmStop] = useState(false);

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
          className="btn btn-positive"
          onClick={() => channel.sendCmd("start", orderedRowIds[0])}
          disabled={!channel.connected || orderedRowIds.length === 0}
        >
          {Icon.play} Start show
        </button>
      )}
      {isLive && (
        <>
          {liveState === "running" ? (
            <button className="btn" title="Pause" onClick={() => channel.sendCmd("pause")}>
              {Icon.pause} Pause
            </button>
          ) : (
            <button className="btn btn-positive" title="Resume" onClick={() => channel.sendCmd("resume")}>
              {Icon.play} Resume
            </button>
          )}
          <button className="btn" title="Previous cue (Shift+Space)" onClick={() => step(-1)}>
            {Icon.prev} Prev
          </button>
          <button className="btn btn-primary" title="Next cue (Space)" onClick={() => step(1)}>
            Next {Icon.next}
          </button>
          <button
            className={`btn btn-danger ${armStop ? "is-on" : ""}`}
            title="Stop the show"
            onClick={() => {
              if (armStop) {
                channel.sendCmd("stop");
                setArmStop(false);
              } else {
                setArmStop(true);
                window.setTimeout(() => setArmStop(false), 3000);
              }
            }}
          >
            {Icon.stop} {armStop ? "Confirm stop" : "Stop"}
          </button>
          <span className={`live-badge ${liveState === "paused" ? "paused" : ""}`}>
            {liveState === "paused" ? "PAUSED" : "LIVE"}
          </span>
        </>
      )}
    </div>
  );
}
