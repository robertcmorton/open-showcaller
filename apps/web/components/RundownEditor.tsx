"use client";

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import { ulid } from "ulid";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  computeTiming,
  formatDuration,
  formatTimeOfDay,
  parseDurationShorthand,
  parseTimeOfDay,
  serializeCsv,
  zoneSecondsOfDay,
} from "@opencall/core";
import { api, setActiveJoinCode } from "../lib/api";
import { exportRundownPdf } from "../lib/exportPdf";
import { projectRundownDoc, type ColumnDef, type ProjectedRow } from "@opencall/db/doc";
import { CuePool } from "./CuePool";
import { ReconcilePanel, findTimingGaps } from "./ReconcilePanel";
import { KeyTimesEditor } from "./KeyTimes";
import { CellEditor } from "./CellEditor";
import { GuestPassPanel, HistoryPanel, JoinCodesPanel } from "./SharePanels";
import { LiveReadouts, TransportBar } from "./TransportBar";
import { Dropdown, HeaderClock, Icon } from "./ui";
import { SideNavSection, WithSideNav } from "./SideNav";
import { RoleBar, RolePicker, highlightRoles, matchingRole } from "./RoleBar";
import { RichCellText } from "./RichCellText";
import { useColWidths } from "../lib/useColWidths";
import { useShowChannel } from "../lib/showChannel";
import { useLiveTiming } from "../lib/useLiveTiming";
import { useRundownDoc } from "../lib/useRundownDoc";

type ActiveCell = { rowId: string; columnId: string } | null;

/** Default cue-type vocabulary from real production sheets. Free text always works too. */
const CUE_TYPE_CHIPS = ["AUDIO", "GFX", "VTR", "LED", "PA", "MC", "GA", "DJ", "CREW", "PYRO", "LIGHTING", "LIVE VSN", "CAM", "SUPER", "TAKEOVER", "SCORE", "NOTE"];

function SortableRow({
  row,
  displayNumber,
  children,
  selected,
  active,
  next,
  walk,
  gapMark,
  paused,
  mine,
  mineColor,
  clockMark,
  disabled,
  onSelect,
}: {
  row: ProjectedRow;
  /** Mirrors the source sheet's numbering on imports; sequential otherwise; blank when the sheet had none. */
  displayNumber: string;
  children: React.ReactNode;
  selected: boolean;
  active: boolean;
  next: boolean;
  /** Pre-show walkthrough cursor sits on this row. */
  walk: boolean;
  /** This row is part of the timing-check issue on screen. */
  gapMark?: "from" | "to" | null;
  paused: boolean;
  mine: boolean;
  mineColor: string;
  /** Event-local "now" sits at this row per the TIME column. */
  clockMark: boolean;
  disabled: boolean;
  onSelect: (e: React.MouseEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.id, disabled });
  return (
    <tr
      ref={setNodeRef}
      className={`${row.type === "group" ? "group-row" : ""} ${row.type === "milestone" ? "milestone-row" : ""} ${selected ? "selected" : ""} ${active ? "active-row" : ""} ${next ? "next-row" : ""} ${walk ? "walk-row" : ""} ${gapMark ? `gap-row gap-row-${gapMark}` : ""} ${active && paused ? "paused" : ""} ${mine ? "my-role-row" : ""} ${row.skipped ? "skipped-row" : ""} ${clockMark ? "clock-row" : ""}`}
      title={walk ? "Walkthrough position — synced to every screen" : clockMark ? "Event time is here per the TIME column" : undefined}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        background: mine ? `${mineColor}14` : row.type !== "group" && row.color ? row.color : undefined,
        boxShadow: mine ? `inset 3px 0 0 ${mineColor}` : undefined,
      }}
    >
      <td className="row-number mono" onClick={onSelect} {...attributes} {...listeners}>
        <span className="rn-num">{displayNumber}</span>
        {active && <span className="cue-badge">CUE</span>}
        {!active && row.outcome && (
          <span className={`outcome-chip oc-${row.outcome}`} title="Alternate ending — plays only when this outcome is picked at full time">
            {row.outcome === "win" ? "WIN" : row.outcome === "lose" ? "LOSE" : row.outcome === "golden" ? "GP" : row.outcome === "draw" ? "DRAW" : row.outcome}
          </span>
        )}
      </td>
      {children}
    </tr>
  );
}

/** Deep-copies the cell fragments of a row into a fresh Y.Map. */
function cloneRow(source: Y.Map<unknown>, newId: string): Y.Map<unknown> {
  const copy = new Y.Map();
  copy.set("id", newId);
  for (const field of ["type", "hardStartSec", "durationSec", "durationMuted", "durationHidden", "backtime", "color", "outcome"]) {
    const v = source.get(field);
    if (v !== undefined) copy.set(field, v);
  }
  const cells = new Y.Map<Y.XmlFragment>();
  const sourceCells = source.get("cells") as Y.Map<Y.XmlFragment> | undefined;
  sourceCells?.forEach((fragment, columnId) => {
    const target = new Y.XmlFragment();
    try {
      target.insert(0, fragment.toArray().map((node) => node.clone() as Y.XmlElement | Y.XmlText));
    } catch {
      // Fall back to plain text if a node type refuses to clone.
    }
    cells.set(columnId, target);
  });
  copy.set("cells", cells);
  return copy;
}

const HIDDEN_COLS_KEY = (rundownId: string) => `oc:hiddencols:${rundownId}`;
const COL_WIDTHS_KEY = (rundownId: string) => `oc:colwidths:${rundownId}`;

/**
 * Progress-bar fill that only ever animates forwards. Chrome will start the
 * CSS width transition from the previous fill's value even across a remount,
 * so on a row change the bar visibly receded instead of snapping to zero —
 * the transition is disabled inline whenever the fraction shrinks (and on
 * first paint), which prevents any width transition from starting.
 */
function BarFill({ frac, className }: { frac: number; className?: string }) {
  const prevRef = useRef<number | null>(null);
  const snap = prevRef.current == null || frac < prevRef.current;
  useLayoutEffect(() => {
    prevRef.current = frac;
  });
  return <div className={className} style={{ width: `${frac * 100}%`, transition: snap ? "none" : undefined }} />;
}

/**
 * The unmissable clock: fixed centre-top while the show runs. Counts down the
 * active item (green → amber in the final stretch → red counting up on
 * overrun), dims amber while paused.
 */
function BigTimer({
  live,
  paused,
  title,
  plannedSec,
}: {
  live: import("@opencall/core").LiveShowTiming;
  paused: boolean;
  title: string;
  plannedSec: number | null;
}) {
  const remaining = live.remainingInRowSec;
  const over = remaining != null && remaining < 0;
  // The red state waits a full second past zero so a cue handing over to the
  // next row (follow-clock advances within a second) never flashes red.
  const overLate = remaining != null && remaining < -1;
  const amber =
    !over && remaining != null && plannedSec != null && plannedSec > 0 && remaining <= Math.min(60, plannedSec * 0.2);
  const display =
    remaining == null
      ? formatDuration(Math.round(live.elapsedInRowSec))
      : over
        ? `+${formatDuration(live.rowOverSec)}`
        : formatDuration(remaining);
  const stateClass = paused ? "paused-state" : overLate ? "over" : amber || over ? "amber" : "under";
  const frac =
    plannedSec != null && plannedSec > 0 ? Math.min(1, Math.max(0, live.elapsedInRowSec / plannedSec)) : 0;
  return (
    <div className={`big-timer no-print ${stateClass}`}>
      <div className="bt-label">
        {paused ? "PAUSED · " : ""}
        {title || "—"}
      </div>
      <div className="bt-time">{display}</div>
      <div className="bt-bar">
        <BarFill frac={frac} />
      </div>
    </div>
  );
}

export type EditorMode = "show" | "edit" | "view";

export function RundownEditor({
  rundownId,
  mode = "show",
  joinCode,
}: {
  rundownId: string;
  mode?: EditorMode;
  joinCode?: string;
}) {
  const isShow = mode === "show";
  const canEditContent = mode !== "view";
  const { doc, connected } = useRundownDoc(rundownId, joinCode);
  // The hook re-renders on every doc update, so projecting during render stays fresh.
  const { meta, keyTimes, roles, columns, rows } = projectRundownDoc(doc);
  const timing = computeTiming(rows, meta.plannedStartSec);
  const channel = useShowChannel(rundownId, "console", joinCode);
  // Panel API calls (join codes, snapshots…) inherit this page's code.
  useEffect(() => {
    setActiveJoinCode(joinCode ?? null);
    return () => setActiveJoinCode(null);
  }, [joinCode]);
  const live = useLiveTiming(channel, timing);
  const activeRowId = channel.show?.state === "running" || channel.show?.state === "paused" ? channel.show.activeRowId : null;
  // Pre-show walkthrough cursor — shared across every connected device.
  const walkRowId = !activeRowId ? (channel.show?.walkRowId ?? null) : null;
  const [activeCell, setActiveCell] = useState<ActiveCell>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [lastSelected, setLastSelected] = useState<string | null>(null);
  const [editingTime, setEditingTime] = useState<string | null>(null); // rowId
  const [durationPopover, setDurationPopover] = useState<string | null>(null); // rowId
  const [panel, setPanel] = useState<"guest" | "history" | "join" | null>(null);
  const [reconciling, setReconciling] = useState(false);
  // The timing-check issue currently on screen: its rows are highlighted in
  // the grid and the disagreeing row is scrolled into view.
  const [gapFocus, setGapFocus] = useState<{ fromId: string; toId: string } | null>(null);
  // The selection bar sits just above the first selected row, inside the
  // scroller so it moves with the sheet.
  const [selBarTop, setSelBarTop] = useState(36);
  useEffect(() => {
    if (selected.size === 0) return;
    const tr = document.querySelector(".rundown-grid tbody tr.selected") as HTMLElement | null;
    if (tr) setSelBarTop(Math.max(36, tr.offsetTop - 46));
  }, [selected, rows.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!gapFocus) return;
    document.querySelector("tr.gap-row-to")?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [gapFocus?.toId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [hiddenCols, setHiddenCols] = useState<ReadonlySet<string>>(new Set());
  // Per-user column width overrides (drag the header edges); imported sheets
  // still provide the starting widths.
  const { widths: colWidths, handle: resizeHandle, tableStyle } = useColWidths(COL_WIDTHS_KEY(rundownId));
  const [showZero, setShowZero] = useState(false);
  const [followScroll, setFollowScroll] = useState(true);
  // A user can hold several roles at once (Camera 1 AND PA). Stored per browser.
  const [myRoles, setMyRoles] = useState<string[]>([]);
  // Ticks the event-local clock cursor along the TIME column.
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setNowTick((n) => n + 1), 15000);
    return () => window.clearInterval(id);
  }, []);
  // Phones show only the essentials (title/start/duration + the role column);
  // this opts back into the full sheet.
  const [mobileAllCols, setMobileAllCols] = useState(false);
  // Set after mount: locale-formatted dates differ between server and client,
  // and rendering one during SSR causes a hydration mismatch.
  const [printedAt, setPrintedAt] = useState("");
  useEffect(() => {
    setPrintedAt(new Date().toLocaleString());
  }, []);
  const timeInputRef = useRef<HTMLInputElement>(null);

  // Per-user column visibility, loaded after mount to avoid hydration mismatch.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(HIDDEN_COLS_KEY(rundownId));
      if (raw) setHiddenCols(new Set(JSON.parse(raw) as string[]));
      setShowZero(localStorage.getItem(`oc:zerocol:${rundownId}`) === "1");
      const storedRoles = localStorage.getItem(`oc:myrole:${rundownId}`);
      if (storedRoles) {
        try {
          const parsed = JSON.parse(storedRoles) as unknown;
          setMyRoles(Array.isArray(parsed) ? (parsed as string[]) : [storedRoles]);
        } catch {
          setMyRoles([storedRoles]); // pre-multi-role value: a bare string
        }
      }
    } catch {
      /* ignore */
    }
  }, [rundownId]);

  const toggleColumn = (key: string): void => {
    const next = new Set(hiddenCols);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setHiddenCols(next);
    localStorage.setItem(HIDDEN_COLS_KEY(rundownId), JSON.stringify([...next]));
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  // Auto-scroll keeps the active row centered while following. A manual
  // scroll (wheel/touch) disengages following instead of fighting the user;
  // the floating "Sync Cue" button re-engages it.
  const programmaticScroll = useRef(false);
  const focusRowId = activeRowId ?? walkRowId;
  useEffect(() => {
    if (!focusRowId || !followScroll) return;
    // Opening a rundown that is ALREADY live: the show state often arrives
    // before the document's rows have rendered, so retry until the live row
    // exists — first thing on screen is the current cue, centred.
    let cancelled = false;
    let settle: number | undefined;
    const attempt = (left: number) => {
      if (cancelled) return;
      const el = document.querySelector("tr.active-row, tr.walk-row");
      if (el) {
        programmaticScroll.current = true;
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        settle = window.setTimeout(() => {
          programmaticScroll.current = false;
        }, 1000);
      } else if (left > 0) {
        settle = window.setTimeout(() => attempt(left - 1), 300);
      }
    };
    attempt(20);
    return () => {
      cancelled = true;
      window.clearTimeout(settle);
    };
  }, [focusRowId, followScroll]);
  useEffect(() => {
    if (!activeRowId) return;
    const disengage = () => {
      if (!programmaticScroll.current) setFollowScroll(false);
    };
    window.addEventListener("wheel", disengage, { passive: true });
    window.addEventListener("touchmove", disengage, { passive: true });
    return () => {
      window.removeEventListener("wheel", disengage);
      window.removeEventListener("touchmove", disengage);
    };
  }, [activeRowId]);

  // Next cue after the active row gets a subtle tint on every surface.
  const nextRowId = (() => {
    if (!activeRowId) return null;
    const at = rows.findIndex((r) => r.id === activeRowId);
    if (at < 0) return null;
    return rows.slice(at + 1).find((r) => r.type === "cue")?.id ?? null;
  })();
  const isPaused = channel.show?.state === "paused";
  const timingGaps = findTimingGaps(rows, timing);
  const roleColorFor = (name: string): string =>
    roles.find((r) => r.name.toLowerCase() === name.toLowerCase())?.color ?? "#2dd4bf";
  // rowId → the colour of MY role this row involves (rows can match different roles).
  const myRowColors = new Map<string, string>();
  if (myRoles.length > 0)
    for (const r of rows) {
      const match = matchingRole(r, myRoles, meta.roleColumnKey);
      if (match) myRowColors.set(r.id, roleColorFor(match));
    }

  // The event-local clock's position along the TIME column: the last row whose
  // (anchored or cascaded) start has passed. Marked in the grid; clock-follow
  // drives the live show to it.
  const clockTarget = (rowList: ProjectedRow[], t: typeof timing, tz: string | null | undefined): string | null => {
    const now = zoneSecondsOfDay(channel.serverNow(), tz);
    let target: string | null = null;
    for (let i = 0; i < rowList.length; i++) {
      const r = rowList[i]!;
      if (r.type === "group" || r.skipped) continue;
      if (r.untimed && r.hardStartSec == null) continue;
      const start = t.rows[i]!.startSec;
      if (start != null && start <= now) target = r.id;
    }
    return target;
  };
  const clockRowId = clockTarget(rows, timing, channel.timezone);

  // Clock-follow runs on the SERVER (live fail-safe: no console needs to stay
  // open). This toggle just flips the session mode; show_state carries it to
  // every screen.
  const clockFollow = channel.show?.clockFollow ?? false;
  const showLive = channel.show?.state === "running" || channel.show?.state === "paused";

  const yRows = doc.getMap<Y.Map<unknown>>("rows");
  const yOrder = doc.getArray<string>("rowOrder");

  // Undo/redo over structural row edits — delete a row (live or not), then
  // take it back. Scoped to rows + order; cell text has its own history.
  const undoMgr = useMemo(() => new Y.UndoManager([yRows, yOrder], { captureTimeout: 400 }), [doc]); // eslint-disable-line react-hooks/exhaustive-deps
  const [, undoTick] = useState(0);
  useEffect(() => {
    const bump = () => undoTick((n) => n + 1);
    undoMgr.on("stack-item-added", bump);
    undoMgr.on("stack-item-popped", bump);
    undoMgr.on("stack-cleared", bump);
    return () => {
      undoMgr.off("stack-item-added", bump);
      undoMgr.off("stack-item-popped", bump);
      undoMgr.off("stack-cleared", bump);
      undoMgr.destroy();
    };
  }, [undoMgr]);
  useEffect(() => {
    if (!canEditContent) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable=true]")) return; // cell/text editing keeps native undo
      e.preventDefault();
      if (e.shiftKey) undoMgr.redo();
      else undoMgr.undo();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [undoMgr, canEditContent]);

  const getFragment = (rowId: string, columnId: string): Y.XmlFragment | null => {
    const yRow = yRows.get(rowId);
    if (!yRow) return null;
    const cells = yRow.get("cells") as Y.Map<Y.XmlFragment>;
    let fragment = cells.get(columnId);
    if (!fragment) {
      fragment = new Y.XmlFragment();
      cells.set(columnId, fragment);
    }
    return fragment;
  };

  const setRowField = (rowId: string, field: string, value: unknown): void => {
    doc.transact(() => {
      yRows.get(rowId)?.set(field, value);
    });
  };

  // Outcome branches (win / lose / draw / golden point): picking one plays
  // its rows and skips the other endings — in one undoable transaction,
  // synced to every screen, and the transport jumps to the branch when live.
  const outcomeRows = rows.filter((r) => r.outcome);
  const outcomesPresent = (["golden", "win", "lose", "draw"] as const).filter((o) => outcomeRows.some((r) => r.outcome === o));
  const chosenOutcome = (() => {
    for (const o of outcomesPresent) {
      const mine = outcomeRows.filter((r) => r.outcome === o);
      const others = outcomeRows.filter((r) => r.outcome !== o);
      if (mine.length > 0 && mine.every((r) => !r.skipped) && others.length > 0 && others.every((r) => r.skipped)) return o;
    }
    return null;
  })();
  const pickOutcome = (o: string): void => {
    doc.transact(() => {
      for (const r of outcomeRows) yRows.get(r.id)?.set("skipped", r.outcome !== o);
    });
    if (showLive) {
      const first = rows.find((r) => r.outcome === o && r.type === "cue");
      if (first) channel.sendCmd("jump", first.id);
    }
  };
  const clearOutcome = (): void => {
    doc.transact(() => {
      for (const r of outcomeRows) yRows.get(r.id)?.set("skipped", false);
    });
  };
  // NRL flow: at full time the choices are Win / Lose / ⚡Golden point (a
  // level score goes to golden point, never straight to a draw). Once golden
  // point is playing, the final pick returns as Win / Lose / Draw. Events
  // without a sport show every tagged ending.
  const visibleOutcomes =
    channel.sport === "nrl"
      ? chosenOutcome === "golden"
        ? outcomesPresent.filter((o) => o !== "golden")
        : outcomesPresent.filter((o) => o !== "draw")
      : outcomesPresent;
  const outcomeLabel = (o: string): string =>
    o === "golden" ? "⚡ Golden point" : o === "win" ? "Win" : o === "lose" ? "Lose" : "Draw";
  // Position-based nudge — never clock-based, so stoppage time, injuries and
  // penalties can stretch the game freely: once the live row is within two
  // cues of the ending blocks and no result is picked, the chooser pulses.
  const decisionSoon = (() => {
    if (!showLive || chosenOutcome || outcomeRows.length === 0 || !activeRowId) return false;
    const firstOutcomeIdx = rows.findIndex((r) => r.outcome);
    const activeIdx = rows.findIndex((r) => r.id === activeRowId);
    if (firstOutcomeIdx < 0 || activeIdx < 0 || activeIdx >= firstOutcomeIdx) return false;
    const between = rows.slice(activeIdx + 1, firstOutcomeIdx).filter((r) => r.type === "cue" && !r.skipped).length;
    return between <= 2;
  })();

  const selectRow = (rowId: string, e: React.MouseEvent): void => {
    const order = rows.map((r) => r.id);
    if (e.shiftKey && lastSelected) {
      const a = order.indexOf(lastSelected);
      const b = order.indexOf(rowId);
      if (a >= 0 && b >= 0) {
        const [from, to] = a < b ? [a, b] : [b, a];
        setSelected(new Set(order.slice(from, to + 1)));
        return;
      }
    }
    if (e.metaKey || e.ctrlKey) {
      const next = new Set(selected);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      setSelected(next);
      setLastSelected(rowId);
      return;
    }
    setSelected(selected.size === 1 && selected.has(rowId) ? new Set() : new Set([rowId]));
    setLastSelected(rowId);
  };

  const addRow = (type: "cue" | "group" | "milestone"): void => {
    doc.transact(() => {
      const rowId = ulid();
      const yRow = new Y.Map();
      yRow.set("id", rowId);
      yRow.set("type", type);
      yRow.set("hardStartSec", null);
      yRow.set("durationSec", type === "cue" ? 60 : null); // groups & milestones carry no duration
      yRow.set("cells", new Y.Map<Y.XmlFragment>());
      yRows.set(rowId, yRow);
      const order = yOrder.toArray();
      const at = lastSelected ? order.indexOf(lastSelected) + 1 : order.length;
      yOrder.insert(at > 0 ? at : order.length, [rowId]);
    });
  };

  const deleteSelected = (): void => {
    if (selected.size === 0) return;
    doc.transact(() => {
      const order = yOrder.toArray();
      // Delete back-to-front so indices stay valid.
      [...selected]
        .map((id) => order.indexOf(id))
        .filter((i) => i >= 0)
        .sort((a, b) => b - a)
        .forEach((i) => yOrder.delete(i, 1));
      selected.forEach((id) => yRows.delete(id));
    });
    setSelected(new Set());
    setLastSelected(null);
  };

  const duplicateSelected = (): void => {
    if (selected.size === 0) return;
    doc.transact(() => {
      const order = yOrder.toArray();
      const picked = order.filter((id) => selected.has(id));
      const last = picked[picked.length - 1];
      let at = (last ? order.indexOf(last) : order.length - 1) + 1;
      for (const id of picked) {
        const source = yRows.get(id);
        if (!source) continue;
        const newId = ulid();
        yRows.set(newId, cloneRow(source, newId));
        yOrder.insert(at, [newId]);
        at += 1;
      }
    });
  };

  const toggleGroupSelected = (): void => {
    doc.transact(() => {
      selected.forEach((id) => {
        const yRow = yRows.get(id);
        if (!yRow) return;
        yRow.set("type", yRow.get("type") === "group" ? "cue" : "group");
      });
    });
  };

  const addColumn = (): void => {
    const title = window.prompt("Column name");
    if (!title) return;
    doc.transact(() => {
      const col = new Y.Map();
      col.set("id", ulid());
      col.set("key", title.toLowerCase().replace(/\W+/g, "-"));
      col.set("title", title);
      col.set("kind", "richtext");
      doc.getArray<Y.Map<unknown>>("columns").push([col]);
    });
  };

  const exportCsv = (): void => {
    const header = ["Type", "Title", "Start", "Duration", ...richColumns.map((c) => c.title)];
    const body = rows.map((r, i) => [
      r.type,
      r.title,
      r.untimed && r.hardStartSec == null
        ? ""
        : timing.rows[i]!.startSec != null
          ? formatTimeOfDay(timing.rows[i]!.startSec!, true)
          : "",
      r.durationSec != null ? formatDuration(r.durationSec) : "",
      ...richColumns.map((c) => r.cells[c.key] ?? ""),
    ]);
    const blob = new Blob([serializeCsv([header, ...body])], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${meta.name.replace(/[^\w-]+/g, "_")}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const exportPdf = (): void => {
    void exportRundownPdf({
      name: meta.name,
      versionLabel: meta.versionLabel,
      use24h: meta.use24h,
      keyTimes,
      richColumns,
      widthFor: (key) => colWidths[key] ?? columns.find((c) => c.key === key)?.width,
      rows,
      timing,
    });
  };

  const saveAsTemplate = (): void => {
    const name = window.prompt("Template name", `${meta.name} template`);
    if (!name) return;
    void api.saveTemplate({ rundownId, name }).then(() => window.alert(`Saved template "${name}".`));
  };

  const onDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    doc.transact(() => {
      const order = yOrder.toArray();
      const from = order.indexOf(String(active.id));
      const to = order.indexOf(String(over.id));
      if (from < 0 || to < 0) return;
      yOrder.delete(from, 1);
      yOrder.insert(to, [String(active.id)]);
    });
  };

  /** Empty clears the fixed time (back to auto flow); an unchanged value is a
   *  no-op so opening the editor and clicking away never pins a flowing row.
   *  A changed time ripples like a changed duration: every fixed time BELOW
   *  shifts by the same amount, one undoable transaction. */
  const commitTime = (rowId: string, raw: string, currentSec: number | null): void => {
    const trimmed = raw.trim();
    if (trimmed === "") setRowField(rowId, "hardStartSec", null);
    else {
      const sec = parseTimeOfDay(trimmed);
      if (sec != null && sec !== currentSec) {
        const delta = currentSec != null ? sec - currentSec : 0;
        doc.transact(() => {
          yRows.get(rowId)?.set("hardStartSec", sec);
          if (delta === 0) return;
          const order = yOrder.toArray();
          const idx = order.indexOf(rowId);
          if (idx < 0) return;
          for (let i = idx + 1; i < order.length; i++) {
            const later = yRows.get(order[i]!);
            const fixed = later?.get("hardStartSec") as number | null | undefined;
            if (fixed != null) later!.set("hardStartSec", fixed + delta);
          }
        });
      }
    }
    setEditingTime(null);
  };

  /** A changed duration ripples through the show: every fixed time BELOW the
   *  row shifts by the same amount, so an item running long or short moves the
   *  rest of the sheet with it. One transaction — one undo step reverses the
   *  duration and the whole ripple together. */
  const commitDuration = (rowId: string, raw: string): void => {
    const trimmed = raw.trim();
    const newSec = trimmed === "" ? null : parseDurationShorthand(trimmed);
    const yRow = yRows.get(rowId);
    const oldSec = (yRow?.get("durationSec") as number | null | undefined) ?? null;
    // Muted and skipped rows sit outside the running order — no ripple.
    const inTiming = !yRow?.get("durationMuted") && !yRow?.get("skipped");
    doc.transact(() => {
      yRow?.set("durationSec", newSec);
      if (!inTiming || newSec == null || oldSec == null || newSec === oldSec) return;
      const delta = newSec - oldSec;
      const order = yOrder.toArray();
      const idx = order.indexOf(rowId);
      if (idx < 0) return;
      for (let i = idx + 1; i < order.length; i++) {
        const later = yRows.get(order[i]!);
        const fixed = later?.get("hardStartSec") as number | null | undefined;
        if (fixed != null) later!.set("hardStartSec", fixed + delta);
      }
    });
  };

  const allRichColumns = columns.filter((c) => c.kind === "richtext");
  const richColumns = allRichColumns.filter((c) => !hiddenCols.has(c.key));
  const titleColumn = columns.find((c) => c.kind === "title");
  const startColumn = columns.find((c) => c.kind === "startTime");
  const durationColumn = columns.find((c) => c.kind === "duration");

  /** Double-click a header to rename the column — imported sheets keep their
   *  own header names, and any of them can be changed here. */
  const renameColumn = (col: ColumnDef | undefined): void => {
    if (!col || !canEditContent) return;
    const next = window.prompt("Column name", col.title);
    if (next === null || !next.trim()) return;
    const yCols = doc.getArray<Y.Map<unknown>>("columns");
    doc.transact(() => {
      for (const c of yCols) if (c.get("id") === col.id) c.set("title", next.trim());
    });
  };

  // Columns render in the DOC's order — which mirrors the source sheet, so a
  // run sheet with TIME before ACTIVITY looks the same on screen. The Zero
  // column (synthetic) rides directly after the duration column.
  const orderedColumns = columns.filter(
    (c) => c.kind === "title" || c.kind === "startTime" || c.kind === "duration" || (c.kind === "richtext" && !hiddenCols.has(c.key)),
  );
  const orderedColKeys = [
    "rownum",
    ...orderedColumns.flatMap((c) => (c.kind === "duration" && showZero ? [c.key, "zero"] : [c.key])),
  ];
  const nextColKey = (key: string): string | null => {
    const i = orderedColKeys.indexOf(key);
    return i >= 0 && i < orderedColKeys.length - 1 ? orderedColKeys[i + 1]! : null;
  };
  const fixedStyle = tableStyle(orderedColKeys);

  const richColClass = (column: ColumnDef): string =>
    column.kind !== "richtext" ? "" : `col-rich${column.key === meta.roleColumnKey ? " col-role" : ""}`;

  const renderRichCell = (rowRecord: ProjectedRow, column: ColumnDef) => {
    const isActive = activeCell?.rowId === rowRecord.id && activeCell.columnId === column.id;
    if (isActive) {
      const fragment = getFragment(rowRecord.id, column.id);
      if (fragment)
        return (
          <td key={column.id} className={`active-cell ${richColClass(column)}`}>
            <CellEditor
              fragment={fragment}
              onDone={() => setActiveCell(null)}
              chips={/^(cue\s*)?type$/i.test(column.title) ? CUE_TYPE_CHIPS : undefined}
            />
          </td>
        );
    }
    // A formatted cell renders its marks; plain cells get role colouring.
    const richXml = rowRecord.cellsRich?.[column.key];
    return (
      <td
        key={column.id}
        className={richColClass(column)}
        onDoubleClick={canEditContent ? () => setActiveCell({ rowId: rowRecord.id, columnId: column.id }) : undefined}
      >
        {richXml ? <RichCellText xml={richXml} /> : highlightRoles(rowRecord.cells[column.key] ?? "", roles)}
      </td>
    );
  };

  const renderDurationCell = (rowRecord: ProjectedRow) => {
    const open = durationPopover === rowRecord.id;
    return (
      <td
        className="mono"
        style={{ position: "relative", cursor: "default" }}
        onDoubleClick={canEditContent ? () => setDurationPopover(rowRecord.id) : undefined}
      >
        {rowRecord.type === "milestone" ? (
          <span className="duration-hidden-marker">—</span>
        ) : rowRecord.durationSec != null ? (
          <span
            className={
              rowRecord.durationMuted ? "duration-muted" : rowRecord.durationHidden ? "duration-hidden-marker" : ""
            }
            title={
              rowRecord.durationMuted
                ? "Muted — excluded from timing"
                : rowRecord.durationHidden
                  ? "Hidden on shared views"
                  : undefined
            }
          >
            {formatDuration(rowRecord.durationSec)}
            {rowRecord.durationHidden ? " ·" : ""}
          </span>
        ) : (
          ""
        )}
        {open && (
          <div className="popover" data-popover style={{ top: "calc(100% - 2px)", left: 0, width: 210 }}>
            <label className="field-label">Duration</label>
            <input
              className="inline-edit"
              autoFocus
              defaultValue={rowRecord.durationSec != null ? formatDuration(rowRecord.durationSec) : ""}
              placeholder="1m30s"
              style={{ width: "100%", marginBottom: 8 }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  commitDuration(rowRecord.id, e.currentTarget.value);
                  setDurationPopover(null);
                }
                if (e.key === "Escape") setDurationPopover(null);
              }}
              onBlur={(e) => commitDuration(rowRecord.id, e.currentTarget.value)}
            />
            <div style={{ color: "var(--text-3)", fontSize: "var(--fs-xs)", marginBottom: 8 }}>
              Changing it shifts every time below by the same amount.
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                className={`btn btn-sm ${rowRecord.durationHidden ? "is-on" : ""}`}
                title="Keep the duration in timing but hide it on shared and guest views"
                onClick={() => setRowField(rowRecord.id, "durationHidden", !rowRecord.durationHidden)}
              >
                Hide
              </button>
              <button
                type="button"
                className={`btn btn-sm ${rowRecord.durationMuted ? "is-on" : ""}`}
                title="Exclude this duration from the running-order math"
                onClick={() => setRowField(rowRecord.id, "durationMuted", !rowRecord.durationMuted)}
              >
                Mute
              </button>
              <button type="button" className="btn btn-sm btn-ghost" style={{ marginLeft: "auto" }} onClick={() => setDurationPopover(null)}>
                Done
              </button>
            </div>
          </div>
        )}
      </td>
    );
  };

  // Close the duration popover on any pointerdown outside it. React's event root
  // is also document-level, so stopPropagation can't shield the popover — check
  // the target instead.
  useEffect(() => {
    if (!durationPopover) return;
    const onDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest?.("[data-popover]")) return;
      setDurationPopover(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [durationPopover]);

  const settings = (
    <>
      <SideNavSection heading="Views">
        {(["follow", "timer", "prompter"] as const).map((view) => (
          <a
            key={view}
            className="menu-item"
            href={`/${view}/${rundownId}${joinCode ? `?code=${joinCode}` : ""}`}
            target="_blank"
            rel="noreferrer"
          >
            <span className="check" />
            {view[0]!.toUpperCase() + view.slice(1)}
          </a>
        ))}
      </SideNavSection>
      <SideNavSection heading="Output">
        <button type="button" className="menu-item" onClick={exportPdf}>
          <span className="check" />
          Export PDF
        </button>
        <button type="button" className="menu-item" onClick={() => window.print()}>
          <span className="check" />
          Print
        </button>
        <button type="button" className="menu-item" onClick={exportCsv}>
          <span className="check" />
          Export CSV
        </button>
      </SideNavSection>
      {isShow && (
        <SideNavSection heading="Show settings">
          <button type="button" className="menu-item" onClick={saveAsTemplate}>
            <span className="check" />
            Save as template
          </button>
          <button type="button" className="menu-item" onClick={() => setPanel(panel === "guest" ? null : "guest")}>
            <span className="check" />
            Guest pass
          </button>
          <button type="button" className="menu-item" onClick={() => setPanel(panel === "history" ? null : "history")}>
            <span className="check" />
            History
          </button>
          <button type="button" className="menu-item" onClick={() => setPanel(panel === "join" ? null : "join")}>
            <span className="check" />
            Join codes
          </button>
        </SideNavSection>
      )}
    </>
  );

  const activeRow = activeRowId ? rows.find((r) => r.id === activeRowId) : null;

  return (
    <WithSideNav title={meta.name} settings={settings}>
    <div className="show-page" style={{ padding: "0.6rem 1.5rem 1.25rem" }}>
      <div className="show-topbar no-print">
      <header className="topbar-head">
        <div className="topbar-left">
        <h1 style={{ fontSize: "1.15rem", fontWeight: 650, margin: 0, letterSpacing: "-0.01em" }}>{meta.name}</h1>
        {mode !== "show" && <span className="chip">{mode === "edit" ? "EDIT — no transport" : "VIEW ONLY"}</span>}
        <div className="hide-mobile">
          <div className="header-label">Planned</div>
          <div
            className="header-clock mono"
            style={canEditContent ? { cursor: "pointer" } : undefined}
            title={canEditContent ? "Click to change the planned start time (an anchored first row overrides it)" : undefined}
            onClick={() => {
              if (!canEditContent) return;
              const raw = window.prompt(
                "Planned start time",
                timing.startSec != null ? formatTimeOfDay(timing.startSec, true) : "9:00 am",
              );
              if (raw === null) return;
              const sec = parseTimeOfDay(raw.trim());
              if (sec == null) {
                window.alert(`Couldn't read "${raw}" as a time — try e.g. 7:30 pm or 19:30.`);
                return;
              }
              doc.getMap("meta").set("plannedStartSec", sec);
            }}
          >
            {timing.startSec != null ? formatTimeOfDay(timing.startSec, meta.use24h) : "—"} · dur{" "}
            {formatDuration(timing.totalDurationSec)} · end{" "}
            {(() => {
              // The last timed item without a duration gets a 30-minute
              // assumption so the show still shows an approximate end.
              let lastIdx = -1;
              for (let i = rows.length - 1; i >= 0; i--) {
                const r = rows[i]!;
                if (r.type !== "group" && !r.skipped && timing.rows[i]!.startSec != null) {
                  lastIdx = i;
                  break;
                }
              }
              // A trailing item with no duration leaves the end open — assume 30
              // minutes, unless the item itself IS the ending (Full time, End…).
              const endish = /\b(end|ends|finish|close|out|full ?time|wrap)\b/i;
              const openEnded =
                lastIdx >= 0 &&
                rows[lastIdx]!.durationSec == null &&
                !rows[lastIdx]!.durationMuted &&
                !endish.test(rows[lastIdx]!.title);
              if (openEnded) {
                const approx = timing.rows[lastIdx]!.startSec! + 30 * 60;
                return <span title="The last item has no duration — assuming 30 minutes">≈{formatTimeOfDay(approx, meta.use24h)}</span>;
              }
              return timing.endSec != null ? formatTimeOfDay(timing.endSec, meta.use24h) : "—";
            })()}
          </div>
        </div>
        </div>
        <div className="topbar-center">
          {live && activeRow && (
            <BigTimer
              live={live}
              paused={isPaused ?? false}
              title={activeRow.title}
              plannedSec={activeRow.durationSec}
            />
          )}
        </div>
        <div className="topbar-right">
          <LiveReadouts live={live} use24h={meta.use24h} />
          <span className={`status-dot hide-mobile ${connected ? "ok" : ""}`}>doc</span>
          <span className={`status-dot hide-mobile ${channel.connected ? "ok" : ""}`}>show</span>
          <HeaderClock use24h={meta.use24h} timeZone={channel.timezone} />
        </div>
      </header>

      <div className="no-print" style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
        {isShow && (
          <TransportBar
            channel={channel}
            orderedRowIds={rows.filter((r) => !r.skipped || r.id === activeRowId).map((r) => r.id)}
          />
        )}
        {isShow && !showLive && rows.length > 0 && (
          <>
            {/* Pre-show walkthrough: step the shared cursor through the sheet
                with the crew — every connected screen follows along. */}
            {(() => {
              const walkable = rows.filter((r) => r.type !== "group" && !r.skipped);
              const at = walkRowId ? walkable.findIndex((r) => r.id === walkRowId) : -1;
              return (
                <>
                  <span className="chip" title="Rehearse the sheet before the show — Prev/Next move a highlight that every open screen sees">
                    Walkthrough{at >= 0 ? ` ${at + 1}/${walkable.length}` : ""}
                  </span>
                  <button
                    className="btn btn-sm"
                    disabled={at <= 0}
                    onClick={() => at > 0 && channel.sendCmd("walk", walkable[at - 1]!.id)}
                  >
                    {Icon.prev} Prev
                  </button>
                  <button
                    className="btn btn-sm"
                    disabled={at >= walkable.length - 1}
                    onClick={() => channel.sendCmd("walk", walkable[Math.min(at + 1, walkable.length - 1)]!.id)}
                  >
                    Next {Icon.next}
                  </button>
                  {walkRowId && (
                    <button className="btn btn-sm btn-ghost" title="Clear the walkthrough highlight on every screen" onClick={() => channel.sendCmd("walk")}>
                      End walkthrough
                    </button>
                  )}
                </>
              );
            })()}
          </>
        )}
        {isShow && outcomesPresent.length > 0 && (
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <span
              className={`chip ${decisionSoon ? "decision-pulse" : ""}`}
              title="This sheet has alternate endings. Pick the real result when it happens — the other branches skip themselves and every screen follows. Golden point loops back here for the final pick."
            >
              {decisionSoon ? "Full time — pick the result" : "Full time:"}
            </span>
            {chosenOutcome === "golden" && (
              <span className="chip" style={{ color: "var(--warn)", borderColor: "var(--warn)" }} title="Golden point is playing — pick the final result when it lands">
                ⚡ Golden point playing
              </span>
            )}
            {visibleOutcomes.map((o) => (
              <button
                key={o}
                className={`btn btn-sm ${chosenOutcome === o ? "is-on" : ""}`}
                style={
                  chosenOutcome === o
                    ? {
                        borderColor: o === "win" ? "var(--under)" : o === "lose" ? "var(--over)" : o === "draw" ? "var(--accent)" : "var(--warn)",
                        color: o === "win" ? "var(--under)" : o === "lose" ? "var(--over)" : o === "draw" ? "var(--accent)" : "var(--warn)",
                      }
                    : undefined
                }
                title={
                  o === "golden"
                    ? "Scores level — play the golden-point block; the final pick comes back after it"
                    : `Play the ${o} ending and skip the others`
                }
                onClick={() => pickOutcome(o)}
              >
                {outcomeLabel(o)}
              </button>
            ))}
            {chosenOutcome && (
              <button className="btn btn-sm btn-ghost" title="Un-choose: all endings visible again" onClick={clearOutcome}>
                Reset
              </button>
            )}
          </span>
        )}
        {isShow && showLive && (
          <button
            className={`btn btn-sm ${clockFollow ? "is-on" : ""}`}
            style={clockFollow ? { borderColor: "var(--warn)", color: "var(--warn)", background: "var(--warn-soft)" } : undefined}
            title="The SERVER runs the show off the TIME column — every item starts at its scheduled moment and finished items hand over automatically, even with every console closed. Pause holds; manual jumps self-correct; toggle off for manual control."
            onClick={() => channel.sendCmd(clockFollow ? "clock_off" : "clock_on")}
          >
            ◷ {clockFollow ? "Following clock" : "Follow clock"}
          </button>
        )}
        {canEditContent && (
          <>
            <button
              className="btn btn-sm"
              disabled={undoMgr.undoStack.length === 0}
              title="Undo the last row change (⌘Z) — including deletes, live or not"
              onClick={() => undoMgr.undo()}
            >
              ↺ Undo
            </button>
            <button
              className="btn btn-sm"
              disabled={undoMgr.redoStack.length === 0}
              title="Redo the undone change (⇧⌘Z)"
              onClick={() => undoMgr.redo()}
            >
              ↻ Redo
            </button>
            <button className="btn" onClick={() => addRow("cue")}>
              {Icon.plus} Row
            </button>
            <button className="btn" onClick={() => addRow("group")}>
              {Icon.plus} Group
            </button>
            <button className="btn" onClick={() => addRow("milestone")} title="A timed marker with no duration — gates open, kick-off, doors">
              {Icon.plus} Milestone
            </button>
          </>
        )}
        {canEditContent && timingGaps.length > 0 && !reconciling && (
          <button
            className="btn btn-sm"
            style={{ borderColor: "var(--warn)", color: "var(--warn)", background: "var(--warn-soft)" }}
            title="The sheet's TIME and DURATION columns don't add up in these places — open to see each one explained, with the choices for fixing it"
            onClick={() => setReconciling(true)}
          >
            ⚠ {timingGaps.length} timing gap{timingGaps.length === 1 ? "" : "s"} — Reconcile
          </button>
        )}
        <button
          className="btn btn-sm mobile-only"
          title="Phones show only the essentials — switch to see every column"
          onClick={() => setMobileAllCols((v) => !v)}
        >
          {mobileAllCols ? "Key columns" : "All columns"}
        </button>
        <Dropdown label={<>{Icon.columns} Columns</>}>
          <div className="menu-heading">Show columns</div>
          {allRichColumns.map((c) => (
            <button key={c.id} type="button" className="menu-item" data-keep-open onClick={() => toggleColumn(c.key)}>
              <span className="check">{!hiddenCols.has(c.key) && Icon.check}</span>
              {c.title}
            </button>
          ))}
          <div className="menu-sep" />
          <button
            type="button"
            className="menu-item"
            data-keep-open
            onClick={() => {
              const next = !showZero;
              setShowZero(next);
              localStorage.setItem(`oc:zerocol:${rundownId}`, next ? "1" : "0");
            }}
          >
            <span className="check">{showZero && Icon.check}</span>
            ZERO countdown
          </button>
          {canEditContent && (
            <>
              <div className="menu-sep" />
              <button type="button" className="menu-item" onClick={addColumn}>
                <span className="check">{Icon.plus}</span> Add column…
              </button>
            </>
          )}
        </Dropdown>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <RolePicker
            rows={rows}
            roles={roles}
            myRoles={myRoles}
            onChange={(next) => {
              setMyRoles(next);
              if (next.length > 0) localStorage.setItem(`oc:myrole:${rundownId}`, JSON.stringify(next));
              else localStorage.removeItem(`oc:myrole:${rundownId}`);
            }}
          />

        </div>
      </div>
      </div>

      <div className="print-only print-header">
        <div>
          <div style={{ fontSize: "14pt", fontWeight: 700 }}>
            {meta.name}
            {meta.versionLabel ? `  ·  ${meta.versionLabel}` : ""}
          </div>
          <div style={{ fontSize: "9pt" }}>
            Planned {timing.startSec != null ? formatTimeOfDay(timing.startSec, meta.use24h) : "—"} · duration{" "}
            {formatDuration(timing.totalDurationSec)} · end{" "}
            {timing.endSec != null ? formatTimeOfDay(timing.endSec, meta.use24h) : "—"}
          </div>
        </div>
        {keyTimes.length > 0 && (
          <table style={{ fontSize: "8.5pt", borderCollapse: "collapse" }}>
            <tbody>
              {keyTimes.map((kt) => (
                <tr key={kt.id}>
                  <td style={{ paddingRight: 10, fontWeight: 600 }}>{kt.label}</td>
                  <td className="mono">{formatTimeOfDay(kt.sec, meta.use24h)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {reconciling && (
        <ReconcilePanel
          doc={doc}
          rows={rows}
          timing={timing}
          gaps={timingGaps}
          use24h={meta.use24h}
          onClose={() => {
            setReconciling(false);
            setGapFocus(null);
          }}
          onCurrent={setGapFocus}
        />
      )}

      {panel === "guest" && (
        <div className="no-print">
          <GuestPassPanel rundownId={rundownId} columns={columns} onClose={() => setPanel(null)} />
        </div>
      )}
      {panel === "history" && (
        <div className="no-print">
          <HistoryPanel rundownId={rundownId} onClose={() => setPanel(null)} />
        </div>
      )}
      {panel === "join" && (
        <div className="no-print">
          <JoinCodesPanel rundownId={rundownId} onClose={() => setPanel(null)} />
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <div className="grid-wrap">
        {activeRowId && !followScroll && (
          <button
            className="btn btn-primary sync-cue"
            title="Jump back to the live cue and follow along again"
            onClick={() => {
              setFollowScroll(true);
              programmaticScroll.current = true;
              document.querySelector("tr.active-row")?.scrollIntoView({ block: "center", behavior: "smooth" });
              window.setTimeout(() => {
                programmaticScroll.current = false;
              }, 1000);
            }}
          >
            ⇣ Sync Cue
          </button>
        )}
        <div className={`grid-scroll ${mobileAllCols ? "mobile-show-all" : ""}`}>
        {canEditContent && selected.size > 0 && (
          // Anchored just above the first selected row — the actions clearly
          // belong to the rows they act on, and scroll with them.
          <div className="selection-bar" style={{ position: "absolute", top: selBarTop, left: 8, zIndex: 6 }}>
            <span className="count">{selected.size} selected</span>
            <button className="btn btn-sm" onClick={duplicateSelected}>
              Duplicate
            </button>
            <button className="btn btn-sm" onClick={toggleGroupSelected}>
              Group
            </button>
            <button
              className="btn btn-sm"
              title="Skip: keeps the row visible but removes it from timing and transport — the show catches back up to the original anchors"
              onClick={() =>
                doc.transact(() =>
                  selected.forEach((id) => {
                    const yRow = yRows.get(id);
                    yRow?.set("skipped", !(yRow.get("skipped") as boolean | undefined));
                  }),
                )
              }
            >
              Skip
            </button>
            <Dropdown label="Outcome" className="btn btn-sm">
              {(
                [
                  ["win", "Win"],
                  ["lose", "Lose"],
                  ["draw", "Draw (final result)"],
                  ["golden", "Golden point (extra time)"],
                  [null, "Not an outcome branch"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={String(value)}
                  type="button"
                  className="menu-item"
                  title="Tag the selected rows as an alternate ending — at full time the caller picks one branch and the others skip themselves"
                  onClick={() => doc.transact(() => selected.forEach((id) => yRows.get(id)?.set("outcome", value)))}
                >
                  <span className="check" />
                  {label}
                </button>
              ))}
            </Dropdown>
            {[
              ["rgba(229,72,77,0.16)", "Red"],
              ["rgba(232,176,60,0.16)", "Amber"],
              ["rgba(63,214,143,0.14)", "Green"],
              ["rgba(76,141,255,0.15)", "Blue"],
              ["rgba(167,139,250,0.16)", "Purple"],
            ].map(([color, label]) => (
              <button
                key={color}
                className="color-swatch"
                title={`Highlight ${label}`}
                style={{ background: color }}
                onClick={() => doc.transact(() => selected.forEach((id) => yRows.get(id)?.set("color", color)))}
              />
            ))}
            <button
              className="color-swatch"
              title="Clear highlight"
              style={{ background: "transparent" }}
              onClick={() => doc.transact(() => selected.forEach((id) => yRows.get(id)?.set("color", null)))}
            >
              ✕
            </button>
            <button className="btn btn-sm btn-danger" onClick={deleteSelected}>
              Delete
            </button>
            <button
              className="btn btn-sm btn-ghost"
              title="Clear selection"
              onClick={() => {
                setSelected(new Set());
                setLastSelected(null);
              }}
            >
              ✕
            </button>
          </div>
        )}
        <table className={`rundown-grid ${fixedStyle ? "cols-fixed" : ""}`} style={fixedStyle}>
          <thead>
            <tr>
              <th data-colkey="rownum" style={{ width: colWidths["rownum"] }}>{resizeHandle("rownum", nextColKey("rownum"))}</th>
              {orderedColumns.map((c) => {
                const w = c.kind === "richtext" ? (colWidths[c.key] ?? c.width) : colWidths[c.key];
                const th = (
                  <th
                    key={c.id}
                    data-colkey={c.key}
                    className={richColClass(c)}
                    style={w ? { width: w, ...(c.kind === "richtext" ? { minWidth: Math.min(w, 140) } : {}) } : undefined}
                    title={canEditContent ? "Double-click to rename this column" : undefined}
                    onDoubleClick={() => renameColumn(c)}
                  >
                    {c.title}
                    {resizeHandle(c.key, nextColKey(c.key))}
                  </th>
                );
                if (c.kind === "duration" && showZero)
                  return (
                    <Fragment key={c.id}>
                      {th}
                      <th data-colkey="zero" style={{ width: colWidths["zero"] }} title="Countdown to the next anchored time">
                        Zero{resizeHandle("zero", nextColKey("zero"))}
                      </th>
                    </Fragment>
                  );
                return th;
              })}
            </tr>
          </thead>
          <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
            <tbody>
              {(() => {
                // Imported sheets keep THEIR numbering (blank where the sheet
                // had none); manual rundowns count sequentially.
                const mirrored = rows.some((r) => r.sourceNumber != null);
                return rows.map((rowRecord, i) => {
                const t = timing.rows[i]!;
                return (
                  <SortableRow
                    key={rowRecord.id}
                    row={rowRecord}
                    displayNumber={mirrored ? (rowRecord.sourceNumber ?? "") : String(i + 1)}
                    selected={selected.has(rowRecord.id)}
                    active={activeRowId === rowRecord.id}
                    next={nextRowId === rowRecord.id}
                    walk={walkRowId === rowRecord.id}
                    gapMark={
                      gapFocus ? (gapFocus.toId === rowRecord.id ? "to" : gapFocus.fromId === rowRecord.id ? "from" : null) : null
                    }
                    paused={isPaused ?? false}
                    mine={myRowColors.has(rowRecord.id)}
                    mineColor={myRowColors.get(rowRecord.id) ?? "#2dd4bf"}
                    clockMark={clockRowId === rowRecord.id && !activeRowId}
                    disabled={!canEditContent}
                    onSelect={(e) => canEditContent && selectRow(rowRecord.id, e)}
                  >
                    {orderedColumns.map((col) => {
                      if (col.kind === "richtext") return renderRichCell(rowRecord, col);
                      if (col.kind === "title") {
                        const cell = (() => {
                          const plain = renderRichCell(rowRecord, col);
                          if (activeRowId !== rowRecord.id || !live || rowRecord.durationSec == null || rowRecord.durationSec <= 0)
                            return plain;
                          // Red only after a full second over — the moment between a cue
                          // ending and the next taking over must not flash red.
                          const over = live.remainingInRowSec != null && live.remainingInRowSec < -1;
                          const frac = over
                            ? 1
                            : live.remainingInRowSec != null
                              ? Math.min(1, Math.max(0, 1 - live.remainingInRowSec / rowRecord.durationSec))
                              : 0;
                          return (
                            <td className="mono-progress" style={{ position: "relative" }}>
                              {rowRecord.cells[col.key] ?? ""}
                              <BarFill className={`row-progress ${over ? "over" : ""}`} frac={frac} />
                            </td>
                          );
                        })();
                        return <Fragment key={col.id}>{cell}</Fragment>;
                      }
                      if (col.kind === "startTime")
                        return (
                          <td
                            key={col.id}
                            className="mono"
                            style={{ position: "relative" }}
                            onDoubleClick={canEditContent ? () => setEditingTime(rowRecord.id) : undefined}
                          >
                            {editingTime === rowRecord.id ? (
                              // The editor OVERLAYS the cell; the invisible copy of the
                              // display text keeps the column width pixel-identical, so
                              // opening it never shifts the layout.
                              <>
                                <span style={{ visibility: "hidden" }}>
                                  {t.startSec != null ? formatTimeOfDay(t.startSec, meta.use24h) : "—"}
                                </span>
                                <input
                                  ref={timeInputRef}
                                  className="inline-edit"
                                  autoFocus
                                  size={1}
                                  style={{ position: "absolute", inset: "1px 2px", width: "calc(100% - 4px)", boxSizing: "border-box" }}
                                  defaultValue={
                                    rowRecord.hardStartSec != null
                                      ? formatTimeOfDay(rowRecord.hardStartSec, meta.use24h)
                                      : t.startSec != null
                                        ? formatTimeOfDay(t.startSec, meta.use24h)
                                        : ""
                                  }
                                  placeholder="9:30 am"
                                  onFocus={(e) => e.currentTarget.select()}
                                  onBlur={(e) => commitTime(rowRecord.id, e.currentTarget.value, t.startSec ?? null)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") commitTime(rowRecord.id, e.currentTarget.value, t.startSec ?? null);
                                    if (e.key === "Escape") setEditingTime(null);
                                  }}
                                />
                              </>
                            ) : rowRecord.untimed && rowRecord.hardStartSec == null ? (
                              // The source sheet left this row untimed (a sub-cue) —
                              // faithful blank instead of an invented cascade time.
                              <span style={{ color: "var(--text-3)" }} title="Untimed in the source sheet — double-click to set a time">
                                —
                              </span>
                            ) : t.startSec != null ? (
                              formatTimeOfDay(t.startSec, meta.use24h)
                            ) : (
                              "—"
                            )}
                          </td>
                        );
                      // duration column (the synthetic Zero column rides after it)
                      return (
                        <Fragment key={col.id}>
                          {renderDurationCell(rowRecord)}
                          {showZero && (
                            <td className="mono" style={{ color: "var(--text-2)" }}>
                              {(() => {
                                const start = t.startSec;
                                if (start == null) return "";
                                for (let j = i; j < rows.length; j++) {
                                  const other = rows[j]!;
                                  const ot = timing.rows[j]!;
                                  if (other.hardStartSec != null && ot.startSec != null && j > i) {
                                    const zero = ot.startSec - start;
                                    return zero > 0 ? `-${formatDuration(zero)}` : "";
                                  }
                                }
                                return "";
                              })()}
                            </td>
                          )}
                        </Fragment>
                      );
                    })}
                  </SortableRow>
                );
                });
              })()}
            </tbody>
          </SortableContext>
        </table>
        </div>
        </div>
      </DndContext>

      <CuePool doc={doc} mode={mode} channel={channel} />
      {myRoles.length > 0 && activeRowId && <div style={{ height: 72 }} />}
      {myRoles.length > 0 && (
        <RoleBar
          myRoles={myRoles}
          roleColorFor={roleColorFor}
          roleColumnKey={meta.roleColumnKey}
          rows={rows}
          timing={timing}
          live={live}
          channel={channel}
          activeRowId={activeRowId}
        />
      )}

      {rows.length === 0 && (
        <div className="empty">
          <div className="glyph">◴</div>
          <div>Empty rundown — add your first row above.</div>
        </div>
      )}

      <div className="print-only print-footer">
        <span>
          {meta.name}
          {meta.versionLabel ? ` · ${meta.versionLabel}` : ""}
        </span>
        <span>Generated {printedAt} · OpenCall</span>
      </div>

      <p className="no-print hide-mobile" style={{ color: "var(--text-3)", fontSize: "var(--fs-xs)", marginTop: "1rem" }}>
        {canEditContent ? (
          <>
            Double-click a cell to edit · double-click Start to set a fixed time (clear it to return to auto flow) ·
            double-click Duration to edit, hide, or mute · <kbd>⇧</kbd>/<kbd>⌘</kbd>-click row numbers for multi-select
            · drag row numbers to reorder · edits sync live.
          </>
        ) : (
          <>Read-only view — live position highlights as the show runs. Use the Columns menu to tailor what you see.</>
        )}
      </p>
    </div>
    </WithSideNav>
  );
}
