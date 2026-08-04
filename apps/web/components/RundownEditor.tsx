"use client";

import { useRef, useState } from "react";
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
} from "@open-showcaller/core";
import { api } from "../lib/api";
import { projectRundownDoc, type ColumnDef, type ProjectedRow } from "@open-showcaller/db/doc";
import { CellEditor } from "./CellEditor";
import { LiveReadouts, TransportBar } from "./TransportBar";
import { useShowChannel } from "../lib/showChannel";
import { useLiveTiming } from "../lib/useLiveTiming";
import { useRundownDoc } from "../lib/useRundownDoc";
import "./editor.css";

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
  onSelect: () => void;
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

export function RundownEditor({ rundownId }: { rundownId: string }) {
  const { doc, connected } = useRundownDoc(rundownId);
  // The hook re-renders on every doc update, so projecting during render stays fresh.
  const { meta, columns, rows } = projectRundownDoc(doc);
  const timing = computeTiming(rows, meta.plannedStartSec);
  const channel = useShowChannel(rundownId, "console");
  const live = useLiveTiming(channel, timing);
  const activeRowId = channel.show?.state === "running" || channel.show?.state === "paused" ? channel.show.activeRowId : null;
  const [activeCell, setActiveCell] = useState<ActiveCell>(null);
  const [selectedRow, setSelectedRow] = useState<string | null>(null);
  const [editingTime, setEditingTime] = useState<string | null>(null); // rowId
  const [editingDuration, setEditingDuration] = useState<string | null>(null);
  const timeInputRef = useRef<HTMLInputElement>(null);

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

  const addRow = (type: "cue" | "group", afterRowId?: string): void => {
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
      const at = afterRowId ? order.indexOf(afterRowId) + 1 : order.length;
      yOrder.insert(at > 0 ? at : order.length, [rowId]);
    });
  };

  const deleteRow = (rowId: string): void => {
    doc.transact(() => {
      const order = yOrder.toArray();
      const idx = order.indexOf(rowId);
      if (idx >= 0) yOrder.delete(idx, 1);
      yRows.delete(rowId);
    });
    if (selectedRow === rowId) setSelectedRow(null);
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
    setEditingDuration(null);
  };

  const richColumns = columns.filter((c) => c.kind === "richtext");
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

  return (
    <div style={{ padding: "1.5rem" }}>
      <header style={{ display: "flex", alignItems: "baseline", gap: "2rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        <h1 style={{ fontSize: "1.1rem", margin: 0 }}>{meta.name}</h1>
        <div>
          <div className="header-label">Planned</div>
          <div className="header-clock">
            {timing.startSec != null ? formatTimeOfDay(timing.startSec, meta.use24h) : "—"} · dur{" "}
            {formatDuration(timing.totalDurationSec)} · end{" "}
            {timing.endSec != null ? formatTimeOfDay(timing.endSec, meta.use24h) : "—"}
          </div>
        </div>
        <LiveReadouts live={live} use24h={meta.use24h} />
        <div style={{ marginLeft: "auto", display: "flex", gap: 14, alignItems: "baseline", fontSize: "0.75rem" }}>
          <nav style={{ display: "flex", gap: 10 }}>
            {(["follow", "timer", "prompter"] as const).map((view) => (
              <a
                key={view}
                href={`/${view}/${rundownId}`}
                target="_blank"
                rel="noreferrer"
                style={{ color: "#8ab4f8", textDecoration: "none" }}
              >
                {view}
              </a>
            ))}
          </nav>
          <span style={{ color: connected ? "#3fb950" : "#f85149" }}>{connected ? "● doc" : "○ doc…"}</span>
          <span style={{ color: channel.connected ? "#3fb950" : "#f85149" }}>
            {channel.connected ? "● show" : "○ show…"}
          </span>
        </div>
      </header>

      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <TransportBar channel={channel} orderedRowIds={rows.map((r) => r.id)} />
        <button className="toolbar-btn" onClick={() => addRow("cue", selectedRow ?? undefined)}>
          + Row
        </button>
        <button className="toolbar-btn" onClick={() => addRow("group", selectedRow ?? undefined)}>
          + Group
        </button>
        <button className="toolbar-btn" onClick={addColumn}>
          + Column
        </button>
        <button className="toolbar-btn" onClick={exportCsv}>
          Export CSV
        </button>
        <button className="toolbar-btn" onClick={saveAsTemplate}>
          Save as template
        </button>
        {selectedRow && (
          <>
            <button
              className="toolbar-btn"
              onClick={() => {
                const target = rows.find((r) => r.id === selectedRow);
                if (target) setRowField(selectedRow, "type", target.type === "group" ? "cue" : "group");
              }}
            >
              Toggle group
            </button>
            <button className="toolbar-btn" onClick={() => deleteRow(selectedRow)}>
              Delete row
            </button>
          </>
        )}
      </div>

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
                    selected={selectedRow === rowRecord.id}
                    active={activeRowId === rowRecord.id}
                    onSelect={() => setSelectedRow(selectedRow === rowRecord.id ? null : rowRecord.id)}
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
                    <td className="mono" onDoubleClick={() => setEditingDuration(rowRecord.id)}>
                      {editingDuration === rowRecord.id ? (
                        <input
                          className="inline-edit"
                          autoFocus
                          defaultValue={rowRecord.durationSec != null ? formatDuration(rowRecord.durationSec) : ""}
                          placeholder="1m30s"
                          onBlur={(e) => commitDuration(rowRecord.id, e.currentTarget.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitDuration(rowRecord.id, e.currentTarget.value);
                            if (e.key === "Escape") setEditingDuration(null);
                          }}
                        />
                      ) : rowRecord.durationSec != null ? (
                        formatDuration(rowRecord.durationSec)
                      ) : (
                        ""
                      )}
                    </td>
                    {richColumns.map((c) => renderRichCell(rowRecord, c))}
                  </SortableRow>
                );
              })}
            </tbody>
          </SortableContext>
        </table>
      </DndContext>

      <p style={{ color: "#666", fontSize: "0.75rem", marginTop: "1rem" }}>
        Double-click a cell to edit · double-click Start to anchor (⚑ resets to auto) · drag row numbers to reorder ·
        edits sync live to every connected device.
      </p>
    </div>
  );
}
