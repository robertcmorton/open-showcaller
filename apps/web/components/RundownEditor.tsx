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
import { api } from "../lib/api";
import { projectRundownDoc, type ColumnDef, type ProjectedRow } from "@opencall/db/doc";
import { CellEditor } from "./CellEditor";
import { GuestPassPanel, HistoryPanel, JoinCodesPanel } from "./SharePanels";
import { LiveReadouts, TransportBar } from "./TransportBar";
import { Dropdown, HeaderClock, Icon } from "./ui";
import { useShowChannel } from "../lib/showChannel";
import { useLiveTiming } from "../lib/useLiveTiming";
import { useRundownDoc } from "../lib/useRundownDoc";

type ActiveCell = { rowId: string; columnId: string } | null;

function SortableRow({
  row,
  index,
  children,
  selected,
  active,
  onSelect,
}: {
  row: ProjectedRow;
  index: number;
  children: React.ReactNode;
  selected: boolean;
  active: boolean;
  onSelect: (e: React.MouseEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.id });
  return (
    <tr
      ref={setNodeRef}
      className={`${row.type === "group" ? "group-row" : ""} ${selected ? "selected" : ""} ${active ? "active-row" : ""}`}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        background: row.type === "cue" && row.color ? row.color : undefined,
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

export function RundownEditor({ rundownId }: { rundownId: string }) {
  const { doc, connected } = useRundownDoc(rundownId);
  // The hook re-renders on every doc update, so projecting during render stays fresh.
  const { meta, columns, rows } = projectRundownDoc(doc);
  const timing = computeTiming(rows, meta.plannedStartSec);
  const channel = useShowChannel(rundownId, "console");
  const live = useLiveTiming(channel, timing);
  const activeRowId = channel.show?.state === "running" || channel.show?.state === "paused" ? channel.show.activeRowId : null;
  const [activeCell, setActiveCell] = useState<ActiveCell>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [lastSelected, setLastSelected] = useState<string | null>(null);
  const [editingTime, setEditingTime] = useState<string | null>(null); // rowId
  const [durationPopover, setDurationPopover] = useState<string | null>(null); // rowId
  const [panel, setPanel] = useState<"guest" | "history" | "join" | null>(null);
  const [hiddenCols, setHiddenCols] = useState<ReadonlySet<string>>(new Set());
  const timeInputRef = useRef<HTMLInputElement>(null);

  // Per-user column visibility, loaded after mount to avoid hydration mismatch.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(HIDDEN_COLS_KEY(rundownId));
      if (raw) setHiddenCols(new Set(JSON.parse(raw) as string[]));
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

  const addRow = (type: "cue" | "group"): void => {
    doc.transact(() => {
      const rowId = ulid();
      const yRow = new Y.Map();
      yRow.set("id", rowId);
      yRow.set("type", type);
      yRow.set("hardStartSec", null);
      yRow.set("durationSec", type === "cue" ? 60 : null);
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

  const renderRichCell = (rowRecord: ProjectedRow, column: ColumnDef) => {
    const isActive = activeCell?.rowId === rowRecord.id && activeCell.columnId === column.id;
    if (isActive) {
      const fragment = getFragment(rowRecord.id, column.id);
      if (fragment)
        return (
          <td key={column.id} className="active-cell">
            <CellEditor fragment={fragment} onDone={() => setActiveCell(null)} />
          </td>
        );
    }
    return (
      <td key={column.id} onDoubleClick={() => setActiveCell({ rowId: rowRecord.id, columnId: column.id })}>
        {rowRecord.cells[column.key] ?? ""}
      </td>
    );
  };

  const renderDurationCell = (rowRecord: ProjectedRow) => {
    const open = durationPopover === rowRecord.id;
    return (
      <td
        className="mono"
        style={{ position: "relative", cursor: "default" }}
        onDoubleClick={() => setDurationPopover(rowRecord.id)}
      >
        {rowRecord.durationSec != null ? (
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

  return (
    <div style={{ padding: "1.25rem 1.5rem" }}>
      <header style={{ display: "flex", alignItems: "center", gap: "1.75rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        <h1 style={{ fontSize: "1.15rem", fontWeight: 650, margin: 0, letterSpacing: "-0.01em" }}>{meta.name}</h1>
        <div>
          <div className="header-label">Planned</div>
          <div className="header-clock mono">
            {timing.startSec != null ? formatTimeOfDay(timing.startSec, meta.use24h) : "—"} · dur{" "}
            {formatDuration(timing.totalDurationSec)} · end{" "}
            {timing.endSec != null ? formatTimeOfDay(timing.endSec, meta.use24h) : "—"}
          </div>
        </div>
        <LiveReadouts live={live} use24h={meta.use24h} />
        <div style={{ marginLeft: "auto", display: "flex", gap: 16, alignItems: "center" }}>
          <span className={`status-dot ${connected ? "ok" : ""}`}>doc</span>
          <span className={`status-dot ${channel.connected ? "ok" : ""}`}>show</span>
          <HeaderClock use24h={meta.use24h} />
        </div>
      </header>

      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
        <TransportBar channel={channel} orderedRowIds={rows.map((r) => r.id)} />
        <button className="btn" onClick={() => addRow("cue")}>
          {Icon.plus} Row
        </button>
        <button className="btn" onClick={() => addRow("group")}>
          {Icon.plus} Group
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
          <button type="button" className="menu-item" onClick={addColumn}>
            <span className="check">{Icon.plus}</span> Add column…
          </button>
        </Dropdown>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {selected.size > 0 && (
            <div className="selection-bar">
              <span className="count">{selected.size} selected</span>
              <button className="btn btn-sm" onClick={duplicateSelected}>
                Duplicate
              </button>
              <button className="btn btn-sm" onClick={toggleGroupSelected}>
                Group
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
          <Dropdown label={Icon.dots} align="right">
            <div className="menu-heading">Views</div>
            {(["follow", "timer", "prompter"] as const).map((view) => (
              <a key={view} className="menu-item" href={`/${view}/${rundownId}`} target="_blank" rel="noreferrer">
                <span className="check" />
                {view[0]!.toUpperCase() + view.slice(1)}
              </a>
            ))}
            <div className="menu-sep" />
            <button type="button" className="menu-item" onClick={exportCsv}>
              <span className="check" />
              Export CSV
            </button>
            <button type="button" className="menu-item" onClick={saveAsTemplate}>
              <span className="check" />
              Save as template
            </button>
            <div className="menu-sep" />
            <button type="button" className="menu-item" onClick={() => setPanel("guest")}>
              <span className="check" />
              Guest pass…
            </button>
            <button type="button" className="menu-item" onClick={() => setPanel("history")}>
              <span className="check" />
              History…
            </button>
            <button type="button" className="menu-item" onClick={() => setPanel("join")}>
              <span className="check" />
              Join codes…
            </button>
          </Dropdown>
        </div>
      </div>

      {panel === "guest" && <GuestPassPanel rundownId={rundownId} columns={columns} onClose={() => setPanel(null)} />}
      {panel === "history" && <HistoryPanel rundownId={rundownId} onClose={() => setPanel(null)} />}
      {panel === "join" && <JoinCodesPanel rundownId={rundownId} onClose={() => setPanel(null)} />}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <table className="rundown-grid">
          <thead>
            <tr>
              <th />
              <th>Title</th>
              <th>Start</th>
              <th>Duration</th>
              {richColumns.map((c) => (
                <th key={c.id}>{c.title}</th>
              ))}
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
                    onSelect={(e) => selectRow(rowRecord.id, e)}
                  >
                    {titleColumn ? renderRichCell(rowRecord, titleColumn) : <td />}
                    <td className="mono" onDoubleClick={() => setEditingTime(rowRecord.id)}>
                      {rowRecord.hardStartSec != null && (
                        <span
                          className="anchor-flag"
                          title="Anchored start — click to reset to auto"
                          onClick={(e) => {
                            e.stopPropagation();
                            setRowField(rowRecord.id, "hardStartSec", null);
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
                    {richColumns.map((c) => renderRichCell(rowRecord, c))}
                  </SortableRow>
                );
              })}
            </tbody>
          </SortableContext>
        </table>
      </DndContext>

      {rows.length === 0 && (
        <div className="empty">
          <div className="glyph">◴</div>
          <div>Empty rundown — add your first row above.</div>
        </div>
      )}

      <p style={{ color: "var(--text-3)", fontSize: "var(--fs-xs)", marginTop: "1rem" }}>
        Double-click a cell to edit · double-click Duration for hide/mute · double-click Start to anchor (⚑ resets) ·
        <kbd>⇧</kbd>/<kbd>⌘</kbd>-click row numbers for multi-select · drag row numbers to reorder · edits sync live.
      </p>
    </div>
  );
}
