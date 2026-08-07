"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
      className={`${row.type === "group" ? "group-row" : ""} ${row.type === "milestone" ? "milestone-row" : ""} ${selected ? "selected" : ""} ${active ? "active-row" : ""} ${next ? "next-row" : ""} ${active && paused ? "paused" : ""} ${mine ? "my-role-row" : ""} ${row.skipped ? "skipped-row" : ""} ${clockMark ? "clock-row" : ""}`}
      title={clockMark ? "Event time is here per the TIME column" : undefined}
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
      </td>
      {children}
    </tr>
  );
}

/** Deep-copies the cell fragments of a row into a fresh Y.Map. */
function cloneRow(source: Y.Map<unknown>, newId: string): Y.Map<unknown> {
  const copy = new Y.Map();
  copy.set("id", newId);
  for (const field of ["type", "hardStartSec", "durationSec", "durationMuted", "durationHidden", "backtime", "color"]) {
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
  const [activeCell, setActiveCell] = useState<ActiveCell>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [lastSelected, setLastSelected] = useState<string | null>(null);
  const [editingTime, setEditingTime] = useState<string | null>(null); // rowId
  const [durationPopover, setDurationPopover] = useState<string | null>(null); // rowId
  const [panel, setPanel] = useState<"guest" | "history" | "join" | null>(null);
  const [reconciling, setReconciling] = useState(false);
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

  // The grid scrolls internally beneath the sticky top bar; its height is
  // whatever the viewport leaves after the measured bar.
  const topbarRef = useRef<HTMLDivElement>(null);
  const [gridMaxH, setGridMaxH] = useState<string | undefined>(undefined);
  useEffect(() => {
    const el = topbarRef.current;
    if (!el) return;
    const measure = () => setGridMaxH(`calc(100vh - ${Math.ceil(el.getBoundingClientRect().height) + 14}px)`);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
  useEffect(() => {
    if (!activeRowId || !followScroll) return;
    programmaticScroll.current = true;
    document.querySelector("tr.active-row")?.scrollIntoView({ block: "center", behavior: "smooth" });
    const t = window.setTimeout(() => {
      programmaticScroll.current = false;
    }, 1000);
    return () => window.clearTimeout(t);
  }, [activeRowId, followScroll]);
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
   *  no-op so opening the editor and clicking away never pins a flowing row. */
  const commitTime = (rowId: string, raw: string, currentSec: number | null): void => {
    const trimmed = raw.trim();
    if (trimmed === "") setRowField(rowId, "hardStartSec", null);
    else {
      const sec = parseTimeOfDay(trimmed);
      if (sec != null && sec !== currentSec) setRowField(rowId, "hardStartSec", sec);
    }
    setEditingTime(null);
  };

  const commitDuration = (rowId: string, raw: string): void => {
    const trimmed = raw.trim();
    setRowField(rowId, "durationSec", trimmed === "" ? null : parseDurationShorthand(trimmed));
  };

  const allRichColumns = columns.filter((c) => c.kind === "richtext");
  const richColumns = allRichColumns.filter((c) => !hiddenCols.has(c.key));
  const titleColumn = columns.find((c) => c.kind === "title");

  // Column order as rendered — each resize handle moves the boundary between
  // a column and the one after it, so the table's outer edges stay pinned.
  const orderedColKeys = [
    "rownum",
    "title",
    "start",
    "duration",
    ...(showZero ? ["zero"] : []),
    ...richColumns.map((c) => c.key),
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
    <div style={{ padding: "0.6rem 1.5rem 1.25rem" }}>
      <div className="show-topbar no-print" ref={topbarRef}>
      <header className="topbar-head">
        <div className="topbar-left">
        <h1 style={{ fontSize: "1.15rem", fontWeight: 650, margin: 0, letterSpacing: "-0.01em" }}>{meta.name}</h1>
        {mode !== "show" && <span className="chip">{mode === "edit" ? "EDIT — no transport" : "VIEW ONLY"}</span>}
        <button
          className="chip hide-mobile"
          style={{ cursor: canEditContent ? "pointer" : "default", border: meta.versionLabel ? "1px solid var(--warn)" : undefined, color: meta.versionLabel ? "var(--warn)" : undefined }}
          title="Version label — printed on exports"
          onClick={() => {
            if (!canEditContent) return;
            const label = window.prompt("Version label (e.g. V2, FINAL — empty to clear)", meta.versionLabel);
            if (label !== null) doc.getMap("meta").set("versionLabel", label.trim());
          }}
        >
          {meta.versionLabel || (canEditContent ? "+ version" : "")}
        </button>
        <KeyTimesEditor doc={doc} keyTimes={keyTimes} use24h={meta.use24h} canEdit={canEditContent} />
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
              title="Redo (⇧⌘Z)"
              onClick={() => undoMgr.redo()}
            >
              ↻
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
            title="Anchored times don't agree with the durations between them — resolve one by one"
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

          {canEditContent && selected.size > 0 && (
            <div className="selection-bar">
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
                  onClick={() =>
                    doc.transact(() => selected.forEach((id) => yRows.get(id)?.set("color", color)))
                  }
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
                onClick={() => {
                  setSelected(new Set());
                  setLastSelected(null);
                }}
              >
                ✕
              </button>
            </div>
          )}
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
          onClose={() => setReconciling(false)}
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
        <div className={`grid-scroll ${mobileAllCols ? "mobile-show-all" : ""}`} style={{ maxHeight: gridMaxH }}>
        <table className={`rundown-grid ${fixedStyle ? "cols-fixed" : ""}`} style={fixedStyle}>
          <thead>
            <tr>
              <th data-colkey="rownum" style={{ width: colWidths["rownum"] }}>{resizeHandle("rownum", nextColKey("rownum"))}</th>
              <th data-colkey="title" style={{ width: colWidths["title"] }}>Title{resizeHandle("title", nextColKey("title"))}</th>
              <th data-colkey="start" style={{ width: colWidths["start"] }}>Start{resizeHandle("start", nextColKey("start"))}</th>
              <th data-colkey="duration" style={{ width: colWidths["duration"] }}>Duration{resizeHandle("duration", nextColKey("duration"))}</th>
              {showZero && (
                <th data-colkey="zero" style={{ width: colWidths["zero"] }} title="Countdown to the next anchored time">
                  Zero{resizeHandle("zero", nextColKey("zero"))}
                </th>
              )}
              {richColumns.map((c) => {
                const w = colWidths[c.key] ?? c.width;
                return (
                  <th
                    key={c.id}
                    data-colkey={c.key}
                    className={richColClass(c)}
                    style={w ? { width: w, minWidth: Math.min(w, 140) } : undefined}
                  >
                    {c.title}
                    {resizeHandle(c.key, nextColKey(c.key))}
                  </th>
                );
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
                    paused={isPaused ?? false}
                    mine={myRowColors.has(rowRecord.id)}
                    mineColor={myRowColors.get(rowRecord.id) ?? "#2dd4bf"}
                    clockMark={clockRowId === rowRecord.id && !activeRowId}
                    disabled={!canEditContent}
                    onSelect={(e) => canEditContent && selectRow(rowRecord.id, e)}
                  >
                    {titleColumn ? (
                      (() => {
                        const cell = renderRichCell(rowRecord, titleColumn);
                        if (activeRowId !== rowRecord.id || !live || rowRecord.durationSec == null || rowRecord.durationSec <= 0)
                          return cell;
                        // Red only after a full second over — the moment between a cue
                        // ending and the next taking over must not flash red.
                        const over = live.remainingInRowSec != null && live.remainingInRowSec < -1;
                        const frac = over
                          ? 1
                          : live.remainingInRowSec != null
                            ? Math.min(1, Math.max(0, 1 - live.remainingInRowSec / rowRecord.durationSec))
                            : 0;
                        return (
                          <td key="title-live" className="mono-progress" style={{ position: "relative" }}>
                            {rowRecord.cells[titleColumn.key] ?? ""}
                            <BarFill className={`row-progress ${over ? "over" : ""}`} frac={frac} />
                          </td>
                        );
                      })()
                    ) : (
                      <td />
                    )}
                    <td className="mono" onDoubleClick={canEditContent ? () => setEditingTime(rowRecord.id) : undefined}>
                      {editingTime === rowRecord.id ? (
                        <input
                          ref={timeInputRef}
                          className="inline-edit"
                          autoFocus
                          size={1}
                          style={{ width: "100%", boxSizing: "border-box" }}
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
                    {richColumns.map((c) => renderRichCell(rowRecord, c))}
                  </SortableRow>
                );
                });
              })()}
            </tbody>
          </SortableContext>
        </table>
        </div>
      </DndContext>

      <CuePool doc={doc} mode={mode} channel={channel} />
      {myRoles.length > 0 && activeRowId && <div style={{ height: 72 }} />}
      {activeRowId && !followScroll && (
        <button
          className="btn btn-primary sync-cue"
          style={{ bottom: myRoles.length > 0 ? 86 : 18 }}
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
