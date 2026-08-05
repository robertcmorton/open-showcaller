"use client";

import { useEffect, useRef, useState } from "react";
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
import { RoleBar, RolePicker, highlightRoles, rowMatchesRole } from "./RoleBar";
import { useShowChannel } from "../lib/showChannel";
import { useLiveTiming } from "../lib/useLiveTiming";
import { useRundownDoc } from "../lib/useRundownDoc";

type ActiveCell = { rowId: string; columnId: string } | null;

/** Default cue-type vocabulary from real production sheets. Free text always works too. */
const CUE_TYPE_CHIPS = ["AUDIO", "GFX", "VTR", "LED", "PA", "MC", "GA", "DJ", "CREW", "PYRO", "LIGHTING", "LIVE VSN", "CAM", "SUPER", "TAKEOVER", "SCORE", "NOTE"];

function SortableRow({
  row,
  index,
  children,
  selected,
  active,
  next,
  paused,
  mine,
  mineColor,
  disabled,
  onSelect,
}: {
  row: ProjectedRow;
  index: number;
  children: React.ReactNode;
  selected: boolean;
  active: boolean;
  next: boolean;
  paused: boolean;
  mine: boolean;
  mineColor: string;
  disabled: boolean;
  onSelect: (e: React.MouseEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.id, disabled });
  return (
    <tr
      ref={setNodeRef}
      className={`${row.type === "group" ? "group-row" : ""} ${row.type === "milestone" ? "milestone-row" : ""} ${selected ? "selected" : ""} ${active ? "active-row" : ""} ${next ? "next-row" : ""} ${active && paused ? "paused" : ""} ${mine ? "my-role-row" : ""} ${row.skipped ? "skipped-row" : ""}`}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        background: mine ? `${mineColor}14` : row.type !== "group" && row.color ? row.color : undefined,
        boxShadow: mine ? `inset 3px 0 0 ${mineColor}` : undefined,
      }}
    >
      <td className="row-number mono" onClick={onSelect} {...attributes} {...listeners}>
        {index + 1}
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
  const amber =
    !over && remaining != null && plannedSec != null && plannedSec > 0 && remaining <= Math.min(60, plannedSec * 0.2);
  const display =
    remaining == null
      ? formatDuration(Math.round(live.elapsedInRowSec))
      : over
        ? `+${formatDuration(live.rowOverSec)}`
        : formatDuration(remaining);
  const stateClass = paused ? "paused-state" : over ? "over" : amber ? "amber" : "under";
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
        <div style={{ width: `${frac * 100}%` }} />
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
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const [showZero, setShowZero] = useState(false);
  const [followScroll, setFollowScroll] = useState(true);
  const [myRole, setMyRole] = useState<string | null>(null);
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
      const widths = localStorage.getItem(COL_WIDTHS_KEY(rundownId));
      if (widths) setColWidths(JSON.parse(widths) as Record<string, number>);
      setShowZero(localStorage.getItem(`oc:zerocol:${rundownId}`) === "1");
      setMyRole(localStorage.getItem(`oc:myrole:${rundownId}`));
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

  /** Drag a header's right edge to resize its column; stored per browser. */
  const startResize = (e: React.PointerEvent, key: string): void => {
    e.preventDefault();
    e.stopPropagation();
    const th = (e.target as HTMLElement).closest("th");
    if (!th) return;
    const startW = th.getBoundingClientRect().width;
    const startX = e.clientX;
    let last = Math.round(startW);
    const move = (ev: PointerEvent) => {
      last = Math.min(720, Math.max(56, Math.round(startW + ev.clientX - startX)));
      setColWidths((prev) => ({ ...prev, [key]: last }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setColWidths((prev) => {
        const next = { ...prev, [key]: last };
        localStorage.setItem(COL_WIDTHS_KEY(rundownId), JSON.stringify(next));
        return next;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** Double-click a handle: back to the column's natural / imported width. */
  const resetWidth = (key: string): void => {
    setColWidths((prev) => {
      const next = { ...prev };
      delete next[key];
      localStorage.setItem(COL_WIDTHS_KEY(rundownId), JSON.stringify(next));
      return next;
    });
  };

  const resizeHandle = (key: string) => (
    <span
      className="col-resize no-print"
      title="Drag to resize — double-click to reset"
      onPointerDown={(e) => startResize(e, key)}
      onDoubleClick={() => resetWidth(key)}
    />
  );

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
  const myRoleRows = myRole
    ? new Set(rows.filter((r) => rowMatchesRole(r, myRole, meta.roleColumnKey)).map((r) => r.id))
    : null;
  const myRoleColor = myRole
    ? (roles.find((r) => r.name.toLowerCase() === myRole.toLowerCase())?.color ?? "#2dd4bf")
    : "#2dd4bf";

  const yRows = doc.getMap<Y.Map<unknown>>("rows");
  const yOrder = doc.getArray<string>("rowOrder");

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
      timing.rows[i]!.startSec != null ? formatTimeOfDay(timing.rows[i]!.startSec!, true) : "",
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

  const commitTime = (rowId: string, raw: string): void => {
    const trimmed = raw.trim();
    setRowField(rowId, "hardStartSec", trimmed === "" ? null : parseTimeOfDay(trimmed));
    setEditingTime(null);
  };

  const commitDuration = (rowId: string, raw: string): void => {
    const trimmed = raw.trim();
    setRowField(rowId, "durationSec", trimmed === "" ? null : parseDurationShorthand(trimmed));
  };

  const allRichColumns = columns.filter((c) => c.kind === "richtext");
  const richColumns = allRichColumns.filter((c) => !hiddenCols.has(c.key));
  const titleColumn = columns.find((c) => c.kind === "title");

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
    return (
      <td
        key={column.id}
        className={richColClass(column)}
        onDoubleClick={canEditContent ? () => setActiveCell({ rowId: rowRecord.id, columnId: column.id }) : undefined}
      >
        {highlightRoles(rowRecord.cells[column.key] ?? "", roles)}
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
    <div style={{ padding: "1.25rem 1.5rem" }}>
      {live && activeRow && (
        <BigTimer
          live={live}
          paused={isPaused ?? false}
          title={activeRow.title}
          plannedSec={activeRow.durationSec}
        />
      )}
      <header className="no-print" style={{ display: "flex", alignItems: "center", gap: "1.75rem", marginBottom: "1rem", flexWrap: "wrap" }}>
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
          <div className="header-clock mono">
            {timing.startSec != null ? formatTimeOfDay(timing.startSec, meta.use24h) : "—"} · dur{" "}
            {formatDuration(timing.totalDurationSec)} · end{" "}
            {timing.endSec != null ? formatTimeOfDay(timing.endSec, meta.use24h) : "—"}
          </div>
        </div>
        <LiveReadouts live={live} use24h={meta.use24h} />
        <div style={{ marginLeft: "auto", display: "flex", gap: 16, alignItems: "center" }}>
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
        {canEditContent && (
          <>
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
            myRole={myRole}
            onChange={(role) => {
              setMyRole(role);
              if (role) localStorage.setItem(`oc:myrole:${rundownId}`, role);
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
        <div className={`grid-scroll ${mobileAllCols ? "mobile-show-all" : ""}`}>
        <table className="rundown-grid">
          <thead>
            <tr>
              <th />
              <th style={{ width: colWidths["title"] }}>Title{resizeHandle("title")}</th>
              <th style={{ width: colWidths["start"] }}>Start{resizeHandle("start")}</th>
              <th style={{ width: colWidths["duration"] }}>Duration{resizeHandle("duration")}</th>
              {showZero && <th title="Countdown to the next anchored time">Zero</th>}
              {richColumns.map((c) => {
                const w = colWidths[c.key] ?? c.width;
                return (
                  <th
                    key={c.id}
                    className={richColClass(c)}
                    style={w ? { width: w, minWidth: Math.min(w, 140) } : undefined}
                  >
                    {c.title}
                    {resizeHandle(c.key)}
                  </th>
                );
              })}
            </tr>
          </thead>
          <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
            <tbody>
              {rows.map((rowRecord, i) => {
                const t = timing.rows[i]!;
                return (
                  <SortableRow
                    key={rowRecord.id}
                    row={rowRecord}
                    index={i}
                    selected={selected.has(rowRecord.id)}
                    active={activeRowId === rowRecord.id}
                    next={nextRowId === rowRecord.id}
                    paused={isPaused ?? false}
                    mine={myRoleRows?.has(rowRecord.id) ?? false}
                    mineColor={myRoleColor}
                    disabled={!canEditContent}
                    onSelect={(e) => canEditContent && selectRow(rowRecord.id, e)}
                  >
                    {titleColumn ? (
                      (() => {
                        const cell = renderRichCell(rowRecord, titleColumn);
                        if (activeRowId !== rowRecord.id || !live || rowRecord.durationSec == null || rowRecord.durationSec <= 0)
                          return cell;
                        const over = live.remainingInRowSec != null && live.remainingInRowSec < 0;
                        const frac = over
                          ? 1
                          : live.remainingInRowSec != null
                            ? Math.min(1, Math.max(0, 1 - live.remainingInRowSec / rowRecord.durationSec))
                            : 0;
                        return (
                          <td key="title-live" className="mono-progress" style={{ position: "relative" }}>
                            {rowRecord.cells[titleColumn.key] ?? ""}
                            <div className={`row-progress ${over ? "over" : ""}`} style={{ width: `${frac * 100}%` }} />
                          </td>
                        );
                      })()
                    ) : (
                      <td />
                    )}
                    <td className="mono" onDoubleClick={canEditContent ? () => setEditingTime(rowRecord.id) : undefined}>
                      {rowRecord.hardStartSec != null && (
                        <span
                          className="anchor-flag"
                          title="Anchored start — click to reset to auto"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (canEditContent) setRowField(rowRecord.id, "hardStartSec", null);
                          }}
                        >
                          ⚑
                        </span>
                      )}
                      {editingTime === rowRecord.id ? (
                        <input
                          ref={timeInputRef}
                          className="inline-edit"
                          autoFocus
                          defaultValue={rowRecord.hardStartSec != null ? formatTimeOfDay(rowRecord.hardStartSec, true) : ""}
                          placeholder="9:30 am"
                          onBlur={(e) => commitTime(rowRecord.id, e.currentTarget.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitTime(rowRecord.id, e.currentTarget.value);
                            if (e.key === "Escape") setEditingTime(null);
                          }}
                        />
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
              })}
            </tbody>
          </SortableContext>
        </table>
        </div>
      </DndContext>

      <CuePool doc={doc} mode={mode} channel={channel} />
      {myRole && activeRowId && <div style={{ height: 72 }} />}
      {activeRowId && !followScroll && (
        <button
          className="btn btn-primary sync-cue"
          style={{ bottom: myRole ? 86 : 18 }}
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
      {myRole && (
        <RoleBar
          myRole={myRole}
          roleColor={myRoleColor}
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
            Double-click a cell to edit · double-click Duration for hide/mute · double-click Start to anchor (⚑ resets)
            · <kbd>⇧</kbd>/<kbd>⌘</kbd>-click row numbers for multi-select · drag row numbers to reorder · edits sync
            live.
          </>
        ) : (
          <>Read-only view — live position highlights as the show runs. Use the Columns menu to tailor what you see.</>
        )}
      </p>
    </div>
    </WithSideNav>
  );
}
