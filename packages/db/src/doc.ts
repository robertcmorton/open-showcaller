import * as Y from "yjs";
import { ulid } from "ulid";
import type { PlanRow } from "@opencall/core";

/** Column kinds understood by the grid. Timing fields live on the row, not in cells. */
export type ColumnKind = "title" | "startTime" | "duration" | "richtext";

export interface ColumnDef {
  id: string;
  key: string;
  title: string;
  kind: ColumnKind;
  builtin?: boolean;
  /** Optional display width hint in px (imported sheets keep their proportions). */
  width?: number;
}

export interface SeedRow {
  type: "cue" | "group" | "milestone";
  title: string;
  durationSec?: number | null;
  hardStartSec?: number | null;
  backtime?: boolean;
  durationMuted?: boolean;
  /** The source sheet left this row's time BLANK (a sub-cue inside a timed block) — display no start. */
  untimed?: boolean;
  /** The sheet's own number for this row; rows the sheet didn't number show none. */
  sourceNumber?: string;
  color?: string;
  /** Outcome branch ("win" | "lose" | "draw" | "golden") — the caller picks one at full time. */
  outcome?: string | null;
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

export interface DocMeta {
  name?: string;
  plannedStartSec?: number | null;
  use24h?: boolean;
  /** Free-text version label shown on headers and print ("V2", "FINAL"). */
  versionLabel?: string;
  /** The imported column that carries role assignments (WHO, ROLE…), if any. */
  roleColumnKey?: string | null;
  /** The source sheet's own header names for the structural columns
   *  (e.g. ACTIVITY/TIME) — shown instead of the generic Title/Start/Duration. */
  baseTitles?: { title?: string; start?: string; duration?: string };
}

export interface KeyTime {
  id: string;
  label: string;
  sec: number;
}

/** An assigned role mined from the sheet (BGM, Camera 1…) with its colour. */
export interface RoleDef {
  id: string;
  name: string;
  color: string;
}

/**
 * Build a rundown Y.Doc from seed data, per the shape in docs/DATA-MODEL.md §2.
 * `extraColumns` adds rich-text columns; with `replaceDepartments` the doc gets
 * ONLY those (plus the structural built-ins) in the given order — the importer
 * uses this so a rundown mirrors its source sheet exactly, with no empty
 * default columns and no duplicates.
 */
export function buildRundownDoc(
  seedRows: SeedRow[],
  docMeta: DocMeta = {},
  extraColumns: { key: string; title: string; width?: number }[] = [],
  replaceDepartments = false,
  roles: { name: string; color: string }[] = [],
): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    const meta = doc.getMap("meta");
    meta.set("schemaVersion", 1);
    if (docMeta.name != null) meta.set("name", docMeta.name);
    if (docMeta.plannedStartSec != null) meta.set("plannedStartSec", docMeta.plannedStartSec);
    if (docMeta.use24h != null) meta.set("use24h", docMeta.use24h);
    if (docMeta.roleColumnKey != null) meta.set("roleColumnKey", docMeta.roleColumnKey);

    const columns = doc.getArray<Y.Map<unknown>>("columns");
    const columnIdByKey = new Map<string, string>();
    const baseColumns = replaceDepartments ? DEFAULT_COLUMNS.filter((c) => c.kind !== "richtext") : DEFAULT_COLUMNS;
    for (const def of baseColumns) {
      const col = new Y.Map();
      const colId = ulid();
      col.set("id", colId);
      col.set("key", def.key);
      const sheetTitle =
        def.kind === "title"
          ? docMeta.baseTitles?.title
          : def.kind === "startTime"
            ? docMeta.baseTitles?.start
            : def.kind === "duration"
              ? docMeta.baseTitles?.duration
              : undefined;
      col.set("title", sheetTitle || def.title);
      col.set("kind", def.kind);
      if (def.builtin) col.set("builtin", true);
      columns.push([col]);
      columnIdByKey.set(def.key, colId);
    }
    for (const extra of extraColumns) {
      if (columnIdByKey.has(extra.key)) continue;
      const col = new Y.Map();
      const colId = ulid();
      col.set("id", colId);
      col.set("key", extra.key);
      col.set("title", extra.title);
      col.set("kind", "richtext");
      if (extra.width) col.set("width", Math.round(extra.width));
      columns.push([col]);
      columnIdByKey.set(extra.key, colId);
    }

    const yRoles = doc.getArray<Y.Map<unknown>>("roles");
    for (const role of roles) {
      const r = new Y.Map();
      r.set("id", ulid());
      r.set("name", role.name);
      r.set("color", role.color);
      yRoles.push([r]);
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
      if (seed.untimed) row.set("untimed", true);
      if (seed.sourceNumber) row.set("sourceNumber", seed.sourceNumber);
      if (seed.color) row.set("color", seed.color);
      if (seed.outcome) row.set("outcome", seed.outcome);

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
  /** columnKey → the cell's XML, present only when it carries formatting marks. */
  cellsRich?: Record<string, string>;
  /** Source sheet had no time for this row — the grid shows no start for it. */
  untimed?: boolean;
  /** The sheet's own row number, mirrored into the grid's # column. */
  sourceNumber?: string;
  color?: string;
  /** Outcome branch this row belongs to ("win" | "lose" | "golden"), if any —
   *  the caller picks one at full time and the others auto-skip. */
  outcome?: string | null;
}

/** Marks the cell editor can produce — a cell mentioning one renders rich. */
const RICH_MARK = /<(bold|italic|underline|strike|highlight|link|strong|em|u|s|mark)[\s/>]/;

/** Project a rundown Y.Doc into plain rows for the timing engine and renderers. */
export function projectRundownDoc(doc: Y.Doc): {
  meta: Required<DocMeta>;
  keyTimes: KeyTime[];
  roles: RoleDef[];
  columns: ColumnDef[];
  rows: ProjectedRow[];
} {
  const metaMap = doc.getMap("meta");
  const meta: Required<DocMeta> = {
    name: (metaMap.get("name") as string | undefined) ?? "Untitled Rundown",
    plannedStartSec: (metaMap.get("plannedStartSec") as number | undefined) ?? null,
    use24h: (metaMap.get("use24h") as boolean | undefined) ?? false,
    versionLabel: (metaMap.get("versionLabel") as string | undefined) ?? "",
    roleColumnKey: (metaMap.get("roleColumnKey") as string | undefined) ?? null,
    // Sheet header names live on the columns themselves after building; the
    // projection never needs them separately.
    baseTitles: {},
  };
  const roles: RoleDef[] = doc
    .getArray<Y.Map<unknown>>("roles")
    .toArray()
    .map((r) => ({
      id: r.get("id") as string,
      name: (r.get("name") as string | undefined) ?? "",
      color: (r.get("color") as string | undefined) ?? "#2dd4bf",
    }));
  const keyTimes: KeyTime[] = doc
    .getArray<Y.Map<unknown>>("keyTimes")
    .toArray()
    .map((kt) => ({
      id: kt.get("id") as string,
      label: (kt.get("label") as string | undefined) ?? "",
      sec: (kt.get("sec") as number | undefined) ?? 0,
    }))
    .sort((a, b) => a.sec - b.sec);
  const columns: ColumnDef[] = doc
    .getArray<Y.Map<unknown>>("columns")
    .toArray()
    .map((col) => ({
      id: col.get("id") as string,
      key: col.get("key") as string,
      title: col.get("title") as string,
      kind: col.get("kind") as ColumnKind,
      builtin: (col.get("builtin") as boolean | undefined) ?? false,
      width: col.get("width") as number | undefined,
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
    let cellsRich: Record<string, string> | undefined;
    const cellMap = row.get("cells") as Y.Map<Y.XmlFragment> | undefined;
    cellMap?.forEach((fragment, colId) => {
      const key = keyById.get(colId);
      if (!key) return;
      // DOM-free plain-text projection: paragraph breaks become newlines,
      // every other tag is stripped.
      const xml = fragment.toString();
      cells[key] = xml.replace(/<\/paragraph>/g, "\n").replace(/<[^>]+>/g, "").replace(/\n$/, "");
      if (RICH_MARK.test(xml)) (cellsRich ??= {})[key] = xml;
    });

    rows.push({
      id: rowId,
      type: (row.get("type") as "cue" | "group" | "milestone") ?? "cue",
      durationSec: (row.get("durationSec") as number | null) ?? null,
      hardStartSec: (row.get("hardStartSec") as number | null) ?? null,
      backtime: (row.get("backtime") as boolean | undefined) ?? false,
      durationMuted: (row.get("durationMuted") as boolean | undefined) ?? false,
      skipped: (row.get("skipped") as boolean | undefined) ?? false,
      untimed: (row.get("untimed") as boolean | undefined) ?? false,
      sourceNumber: row.get("sourceNumber") as string | undefined,
      durationHidden: (row.get("durationHidden") as boolean | undefined) ?? false,
      title: cells["title"] ?? "",
      cells,
      cellsRich,
      color: row.get("color") as string | undefined,
      outcome: (row.get("outcome") as string | null | undefined) ?? null,
    });
  }
  return { meta, keyTimes, roles, columns, rows };
}

export const encodeDoc = (doc: Y.Doc): Uint8Array => Y.encodeStateAsUpdate(doc);

export function decodeDoc(bytes: Uint8Array): Y.Doc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, bytes);
  return doc;
}
