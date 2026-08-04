import * as Y from "yjs";
import { ulid } from "ulid";
import type { PlanRow } from "@open-showcaller/core";

/** Column kinds understood by the grid. Timing fields live on the row, not in cells. */
export type ColumnKind = "title" | "startTime" | "duration" | "richtext";

export interface ColumnDef {
  id: string;
  key: string;
  title: string;
  kind: ColumnKind;
  builtin?: boolean;
}

export interface SeedRow {
  type: "cue" | "group";
  title: string;
  durationSec?: number | null;
  hardStartSec?: number | null;
  backtime?: boolean;
  durationMuted?: boolean;
  color?: string;
  /** columnKey → plain text; converted into a single-paragraph rich-text fragment. */
  cells?: Record<string, string>;
}

export const DEFAULT_COLUMNS: Omit<ColumnDef, "id">[] = [
  { key: "title", title: "Title", kind: "title", builtin: true },
  { key: "start", title: "Start Time", kind: "startTime", builtin: true },
  { key: "duration", title: "Duration", kind: "duration", builtin: true },
  { key: "prodNotes", title: "Production Notes", kind: "richtext" },
  { key: "audio", title: "Audio", kind: "richtext" },
  { key: "video", title: "Video", kind: "richtext" },
  { key: "lights", title: "Lights", kind: "richtext" },
  { key: "graphics", title: "Graphics", kind: "richtext" },
  { key: "script", title: "Script", kind: "richtext" },
];

function fillFragment(fragment: Y.XmlFragment, text: string): void {
  const paragraph = new Y.XmlElement("paragraph");
  const content = new Y.XmlText();
  content.insert(0, text);
  paragraph.insert(0, [content]);
  fragment.insert(0, [paragraph]);
}

/** Build a rundown Y.Doc from seed data, per the shape in docs/DATA-MODEL.md §2. */
export function buildRundownDoc(seedRows: SeedRow[]): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    const meta = doc.getMap("meta");
    meta.set("schemaVersion", 1);

    const columns = doc.getArray<Y.Map<unknown>>("columns");
    const columnIdByKey = new Map<string, string>();
    for (const def of DEFAULT_COLUMNS) {
      const col = new Y.Map();
      const colId = ulid();
      col.set("id", colId);
      col.set("key", def.key);
      col.set("title", def.title);
      col.set("kind", def.kind);
      if (def.builtin) col.set("builtin", true);
      columns.push([col]);
      columnIdByKey.set(def.key, colId);
    }

    const rowOrder = doc.getArray<string>("rowOrder");
    const rows = doc.getMap<Y.Map<unknown>>("rows");
    for (const seed of seedRows) {
      const rowId = ulid();
      const row = new Y.Map();
      row.set("id", rowId);
      row.set("type", seed.type);
      row.set("hardStartSec", seed.hardStartSec ?? null);
      if (seed.backtime) row.set("backtime", true);
      row.set("durationSec", seed.durationSec ?? null);
      if (seed.durationMuted) row.set("durationMuted", true);
      if (seed.color) row.set("color", seed.color);

      const cells = new Y.Map<Y.XmlFragment>();
      const titleFragment = new Y.XmlFragment();
      fillFragment(titleFragment, seed.title);
      cells.set(columnIdByKey.get("title")!, titleFragment);
      for (const [key, text] of Object.entries(seed.cells ?? {})) {
        const colId = columnIdByKey.get(key);
        if (!colId) continue;
        const fragment = new Y.XmlFragment();
        fillFragment(fragment, text);
        cells.set(colId, fragment);
      }
      row.set("cells", cells);

      rows.set(rowId, row);
      rowOrder.push([rowId]);
    }
  });
  return doc;
}

export interface ProjectedRow extends PlanRow {
  title: string;
  cells: Record<string, string>; // columnKey → plain text
  color?: string;
}

/** Project a rundown Y.Doc into plain rows for the timing engine and renderers. */
export function projectRundownDoc(doc: Y.Doc): { columns: ColumnDef[]; rows: ProjectedRow[] } {
  const columns: ColumnDef[] = doc
    .getArray<Y.Map<unknown>>("columns")
    .toArray()
    .map((col) => ({
      id: col.get("id") as string,
      key: col.get("key") as string,
      title: col.get("title") as string,
      kind: col.get("kind") as ColumnKind,
      builtin: (col.get("builtin") as boolean | undefined) ?? false,
    }));
  const keyById = new Map(columns.map((c) => [c.id, c.key]));

  const rowsMap = doc.getMap<Y.Map<unknown>>("rows");
  const seen = new Set<string>();
  const rows: ProjectedRow[] = [];
  for (const rowId of doc.getArray<string>("rowOrder").toArray()) {
    if (seen.has(rowId)) continue; // reconciliation: first occurrence wins
    seen.add(rowId);
    const row = rowsMap.get(rowId);
    if (!row) continue; // reconciliation: dangling id ignored

    const cells: Record<string, string> = {};
    const cellMap = row.get("cells") as Y.Map<Y.XmlFragment> | undefined;
    cellMap?.forEach((fragment, colId) => {
      const key = keyById.get(colId);
      // DOM-free plain-text projection: serialize and strip tags.
      if (key) cells[key] = fragment.toString().replace(/<[^>]+>/g, "");
    });

    rows.push({
      id: rowId,
      type: (row.get("type") as "cue" | "group") ?? "cue",
      durationSec: (row.get("durationSec") as number | null) ?? null,
      hardStartSec: (row.get("hardStartSec") as number | null) ?? null,
      backtime: (row.get("backtime") as boolean | undefined) ?? false,
      durationMuted: (row.get("durationMuted") as boolean | undefined) ?? false,
      title: cells["title"] ?? "",
      cells,
      color: row.get("color") as string | undefined,
    });
  }
  return { columns, rows };
}

export const encodeDoc = (doc: Y.Doc): Uint8Array => Y.encodeStateAsUpdate(doc);

export function decodeDoc(bytes: Uint8Array): Y.Doc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, bytes);
  return doc;
}
