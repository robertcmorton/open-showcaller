"use client";

import { useCallback, useState } from "react";
import { formatDuration, zoneSecondsOfDay, type LiveShowTiming, type PlanTiming } from "@opencall/core";
import type { ProjectedRow, RoleDef } from "@opencall/db/doc";
import type { ShowChannel } from "../lib/showChannel";
import { useDismiss } from "./ui";

/** Colour-codes every mention of a known role inside plain cell text. */
export function highlightRoles(text: string, roles: RoleDef[]): React.ReactNode {
  if (!text || roles.length === 0) return text;
  const escaped = [...roles]
    .sort((a, b) => b.name.length - a.name.length)
    .map((r) => r.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp(`(${escaped.join("|")})`, "gi");
  const byName = new Map(roles.map((r) => [r.name.toLowerCase(), r.color]));
  const parts = text.split(regex);
  if (parts.length === 1) return text;
  return parts.map((part, i) => {
    const color = byName.get(part.toLowerCase());
    if (!color) return part;
    return (
      <span key={i} style={{ background: `${color}22`, color, borderRadius: 3, padding: "0 3px", fontWeight: 600 }}>
        {part}
      </span>
    );
  });
}

/**
 * Does this row involve the given role? When the rundown knows which columns
 * record an assignment — the WHO column naming people, the cue column naming
 * the positions that operate the show — those are the record, and matching
 * against them (plus the title) avoids false positives from prose like "DJ
 * tracks" in a notes column. Without any, every cell may name the role.
 */
export function rowMatchesRole(row: ProjectedRow, role: string, roleColumnKeys?: string[] | null): boolean {
  const needle = role.trim().toLowerCase();
  if (!needle) return false;
  if (row.title.toLowerCase().includes(needle)) return true;
  const keys = (roleColumnKeys ?? []).filter(Boolean);
  if (keys.length > 0) return keys.some((k) => row.cells[k]?.toLowerCase().includes(needle) ?? false);
  return Object.values(row.cells).some((v) => v.toLowerCase().includes(needle));
}

/**
 * Publishes the crew bar's height so the sheet above can end clear of it.
 *
 * The bar is fixed to the bottom of the screen, and its height changes with
 * what it is saying — one line for a standing role, three when a cue is on
 * air. Measuring it from the page above meant reading a height before the bar
 * had rendered; the bar itself always knows.
 */
export function usePublishedBarHeight(): (el: HTMLDivElement | null) => void {
  return useCallback((el: HTMLDivElement | null) => {
    const root = document.documentElement;
    if (!el) {
      root.style.removeProperty("--rolebar-h");
      return;
    }
    const measure = () => root.style.setProperty("--rolebar-h", `${Math.ceil(el.getBoundingClientRect().height)}px`);
    measure();
    new ResizeObserver(measure).observe(el);
  }, []);
}

/** A user can hold several roles — the first of theirs this row involves (for its colour), or null. */
export function matchingRole(row: ProjectedRow, roles: string[], roleColumnKeys?: string[] | null): string | null {
  for (const role of roles) if (rowMatchesRole(row, role, roleColumnKeys)) return role;
  return null;
}

/**
 * Role picker: every user — admin, editor, or view-only — can mark which
 * assigned roles are theirs (BGM, Camera 1… — several at once is normal).
 * Suggestions come from the sheet itself. Stored per browser. Opens as an
 * overlay; never reflows the layout.
 */
export function RolePicker({
  rows,
  roles = [],
  myRoles,
  onChange,
}: {
  rows: ProjectedRow[];
  roles?: RoleDef[];
  myRoles: string[];
  onChange: (roles: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const ref = useDismiss(open, () => setOpen(false));

  const toggle = (role: string) => {
    const has = myRoles.some((r) => r.toLowerCase() === role.toLowerCase());
    onChange(has ? myRoles.filter((r) => r.toLowerCase() !== role.toLowerCase()) : [...myRoles, role]);
  };
  const firstColor = roles.find((r) => r.name.toLowerCase() === myRoles[0]?.toLowerCase())?.color ?? "#2dd4bf";

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

  const isMine = (name: string) => myRoles.some((r) => r.toLowerCase() === name.toLowerCase());

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        className={`btn btn-sm ${myRoles.length > 0 ? "is-on" : ""}`}
        style={
          myRoles.length > 0
            ? {
                maxWidth: 170,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                display: "inline-block",
                lineHeight: "24px",
                borderColor: firstColor,
                color: firstColor,
                background: `${firstColor}1a`,
              }
            : undefined
        }
        title="Pick your assigned roles — your items highlight and the bar below tracks your next one"
        onClick={() => setOpen((o) => !o)}
      >
        {myRoles.length === 0
          ? "My role"
          : myRoles.length === 1
            ? `Role: ${myRoles[0]}`
            : `Roles: ${myRoles[0]} +${myRoles.length - 1}`}
      </button>
      {open && (
        <div className="menu" style={{ top: "calc(100% + 5px)", right: 0, minWidth: 250, padding: 10 }}>
          <div className="menu-heading" style={{ padding: "0 0 6px" }}>
            Your assigned roles — pick any number
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
                toggle(text.trim());
                setText("");
              }
            }}
          />
          {roles.length > 0 && (
            <div className="chip-row" style={{ marginTop: 8, maxWidth: 320 }}>
              {roles.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={isMine(r.name) ? "is-on" : ""}
                  style={{
                    borderColor: r.color,
                    color: r.color,
                    background: isMine(r.name) ? `${r.color}40` : `${r.color}1a`,
                    fontWeight: isMine(r.name) ? 700 : 400,
                  }}
                  onClick={() => toggle(r.name)}
                >
                  {isMine(r.name) ? "✓ " : ""}
                  {r.name}
                </button>
              ))}
            </div>
          )}
          {suggestions.length > 0 && roles.length === 0 && (
            <div className="chip-row" style={{ marginTop: 8, maxWidth: 320 }}>
              {suggestions
                .filter((sugg) => !text || sugg.toLowerCase().includes(text.toLowerCase()))
                .slice(0, 12)
                .map((sugg) => (
                  <button key={sugg} type="button" className={isMine(sugg) ? "is-on" : ""} onClick={() => toggle(sugg)}>
                    {isMine(sugg) ? "✓ " : ""}
                    {sugg}
                  </button>
                ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            {myRoles.length > 0 && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange([])}>
                Clear all
              </button>
            )}
            <button type="button" className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={() => setOpen(false)}>
              Done
            </button>
          </div>
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
  myRoles,
  roleColorFor,
  roleColumnKeys,
  rows,
  timing,
  live,
  channel,
  activeRowId,
}: {
  myRoles: string[];
  roleColorFor: (role: string) => string;
  roleColumnKeys?: string[] | null;
  rows: ProjectedRow[];
  timing: PlanTiming;
  live: LiveShowTiming | null;
  channel: ShowChannel;
  activeRowId: string | null;
}) {
  // Declared before the early return: hooks cannot be conditional.
  const publishHeight = usePublishedBarHeight();
  if (!live || !activeRowId || myRoles.length === 0) return null;

  const activeIndex = rows.findIndex((r) => r.id === activeRowId);
  const activeRow = activeIndex >= 0 ? rows[activeIndex]! : null;
  const onAirRole = activeRow != null ? matchingRole(activeRow, myRoles, roleColumnKeys) : null;

  if (onAirRole != null) {
    const over = live.remainingInRowSec != null && live.remainingInRowSec < 0;
    const display =
      live.remainingInRowSec == null
        ? formatDuration(Math.round(live.elapsedInRowSec))
        : over
          ? `+${formatDuration(live.rowOverSec)}`
          : formatDuration(live.remainingInRowSec);
    return (
      <div className="role-bar on-air no-print" ref={publishHeight}>
        <span className="rb-onair">● YOU’RE ON</span>
        <span className="rb-role" style={{ color: roleColorFor(onAirRole) }}>{onAirRole}</span>
        <span className="rb-title">{activeRow!.title || "—"}</span>
        <span className="rb-count">{display}</span>
      </div>
    );
  }

  // Next item of mine — across ANY of my roles — after the active row.
  let next: { row: ProjectedRow; startSec: number | null; role: string } | null = null;
  for (let i = Math.max(0, activeIndex) + 1; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.type === "group" || row.skipped) continue;
    const role = matchingRole(row, myRoles, roleColumnKeys);
    if (!role) continue;
    next = { row, startSec: timing.rows[i]!.startSec, role };
    break;
  }

  const rolesLabel = myRoles.length === 1 ? myRoles[0]! : `${myRoles[0]} +${myRoles.length - 1}`;

  if (!next) {
    return (
      <div className="role-bar no-print" ref={publishHeight}>
        <span className="rb-role" style={{ color: roleColorFor(myRoles[0]!) }}>{rolesLabel}</span>
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
    <div className={`role-bar no-print ${imminent ? "imminent" : ""}`} ref={publishHeight}>
      <span className="rb-role" style={{ color: roleColorFor(next.role) }}>{next.role} · next</span>
      <span className="rb-title">{next.row.title || "—"}</span>
      <span className="rb-count">
        {countdown == null ? "—" : countdown <= 0 ? "any moment" : `in ${formatDuration(countdown)}`}
      </span>
    </div>
  );
}
