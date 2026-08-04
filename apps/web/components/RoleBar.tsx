"use client";

import { useState } from "react";
import { formatDuration, zoneSecondsOfDay, type LiveShowTiming, type PlanTiming } from "@opencall/core";
import type { ProjectedRow } from "@opencall/db/doc";
import type { ShowChannel } from "../lib/showChannel";
import { useDismiss } from "./ui";

/** Does this row involve the given role? Any cell (or the title) may name it. */
export function rowMatchesRole(row: ProjectedRow, role: string): boolean {
  const needle = role.trim().toLowerCase();
  if (!needle) return false;
  if (row.title.toLowerCase().includes(needle)) return true;
  return Object.values(row.cells).some((v) => v.toLowerCase().includes(needle));
}

/**
 * Role picker: every user — admin, editor, or view-only — can mark which
 * assigned role is theirs (BGM, Camera 1…). Suggestions come from the sheet
 * itself: short values that repeat across cells. Stored per browser.
 */
export function RolePicker({
  rows,
  myRole,
  onChange,
}: {
  rows: ProjectedRow[];
  myRole: string | null;
  onChange: (role: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const ref = useDismiss(open, () => setOpen(false));

  // Candidate roles: short cell lines seen at least twice.
  const counts = new Map<string, number>();
  for (const row of rows)
    for (const value of Object.values(row.cells))
      for (const line of value.split("\n")) {
        const v = line.trim();
        if (!v || v.length > 24) continue;
        counts.set(v, (counts.get(v) ?? 0) + 1);
      }
  const suggestions = [...counts.entries()]
    .filter(([v, n]) => n >= 2 && !/^\d/.test(v))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 18)
    .map(([v]) => v);

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        className={`btn btn-sm ${myRole ? "is-on" : ""}`}
        style={myRole ? { borderColor: "#2dd4bf", color: "#2dd4bf", background: "rgba(45,212,191,0.1)" } : undefined}
        title="Pick your assigned role — your items highlight and the bar below tracks your next one"
        onClick={() => setOpen((o) => !o)}
      >
        {myRole ? `Role: ${myRole}` : "My role"}
      </button>
      {open && (
        <div className="menu" style={{ top: "calc(100% + 5px)", left: 0, minWidth: 240, padding: 10 }}>
          <div className="menu-heading" style={{ padding: "0 0 6px" }}>
            Your assigned role
          </div>
          <input
            className="input"
            autoFocus
            placeholder="e.g. Camera 1, BGM, PA"
            style={{ width: "100%" }}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && text.trim()) {
                onChange(text.trim());
                setOpen(false);
                setText("");
              }
            }}
          />
          {suggestions.length > 0 && (
            <div className="chip-row" style={{ marginTop: 8, maxWidth: 320 }}>
              {suggestions
                .filter((sugg) => !text || sugg.toLowerCase().includes(text.toLowerCase()))
                .slice(0, 12)
                .map((sugg) => (
                  <button
                    key={sugg}
                    type="button"
                    onClick={() => {
                      onChange(sugg);
                      setOpen(false);
                      setText("");
                    }}
                  >
                    {sugg}
                  </button>
                ))}
            </div>
          )}
          {myRole && (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              style={{ marginTop: 8 }}
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              Clear role
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The bottom bar for crew: while the show runs it counts down to your next
 * item (planned start shifted by the live drift), grows into a full-width
 * ON-AIR banner while your item is live, then moves on to the one after.
 */
export function RoleBar({
  myRole,
  rows,
  timing,
  live,
  channel,
  activeRowId,
}: {
  myRole: string;
  rows: ProjectedRow[];
  timing: PlanTiming;
  live: LiveShowTiming | null;
  channel: ShowChannel;
  activeRowId: string | null;
}) {
  if (!live || !activeRowId) return null;

  const activeIndex = rows.findIndex((r) => r.id === activeRowId);
  const activeRow = activeIndex >= 0 ? rows[activeIndex]! : null;
  const onAir = activeRow != null && rowMatchesRole(activeRow, myRole);

  if (onAir) {
    const over = live.remainingInRowSec != null && live.remainingInRowSec < 0;
    const display =
      live.remainingInRowSec == null
        ? formatDuration(Math.round(live.elapsedInRowSec))
        : over
          ? `+${formatDuration(live.rowOverSec)}`
          : formatDuration(live.remainingInRowSec);
    return (
      <div className="role-bar on-air no-print">
        <span className="rb-onair">● YOU’RE ON</span>
        <span className="rb-role">{myRole}</span>
        <span className="rb-title">{activeRow!.title || "—"}</span>
        <span className="rb-count">{display}</span>
      </div>
    );
  }

  // Next item of mine after the active row.
  let next: { row: ProjectedRow; startSec: number | null } | null = null;
  for (let i = Math.max(0, activeIndex) + 1; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.type === "group" || !rowMatchesRole(row, myRole)) continue;
    next = { row, startSec: timing.rows[i]!.startSec };
    break;
  }

  if (!next) {
    return (
      <div className="role-bar no-print">
        <span className="rb-role">{myRole}</span>
        <span className="rb-done">No more items for you in this show.</span>
      </div>
    );
  }

  let countdown: number | null = null;
  if (next.startSec != null) {
    const nowSec = zoneSecondsOfDay(channel.serverNow(), channel.timezone);
    countdown = Math.round(next.startSec + (live.showDriftSec ?? 0) - nowSec);
  }
  const imminent = countdown != null && countdown <= 60;

  return (
    <div className={`role-bar no-print ${imminent ? "imminent" : ""}`}>
      <span className="rb-role">{myRole} · next</span>
      <span className="rb-title">{next.row.title || "—"}</span>
      <span className="rb-count">
        {countdown == null ? "—" : countdown <= 0 ? "any moment" : `in ${formatDuration(countdown)}`}
      </span>
    </div>
  );
}
