"use client";

import { useEffect, useState, type CSSProperties, type ReactElement } from "react";

const MIN_COL = 56;

/**
 * Draggable column widths for a .rundown-grid table, persisted per storage
 * key. The table's outer edges stay pinned to the page: a drag moves only the
 * boundary between a column and its right-hand neighbour, transferring width
 * between the two (every th must carry data-colkey). The first drag snapshots
 * every column's rendered width so the table can switch to a fixed layout —
 * nothing else shifts, the total never changes, and no horizontal scrollbar
 * appears; squeezed text wraps onto extra lines instead. Double-clicking any
 * handle resets the whole table to its natural widths.
 */
export function useColWidths(storageKey: string): {
  widths: Record<string, number>;
  /** Handle between `key` and `nextKey`; the last column (no neighbour) gets none. */
  handle: (key: string, nextKey: string | null) => ReactElement | null;
  /** Fixed-layout style once every rendered column has a width; else undefined (natural layout). */
  tableStyle: (renderedKeys: string[]) => CSSProperties | undefined;
} {
  const [widths, setWidths] = useState<Record<string, number>>({});

  // Loaded after mount: localStorage isn't available during SSR.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      setWidths(stored ? (JSON.parse(stored) as Record<string, number>) : {});
    } catch {
      setWidths({});
    }
  }, [storageKey]);

  const startResize = (e: React.PointerEvent, key: string, nextKey: string): void => {
    e.preventDefault();
    e.stopPropagation();
    const th = (e.target as HTMLElement).closest("th");
    const table = th?.closest("table");
    if (!th || !table) return;
    // Freeze every column at the width it is showing right now, so only the
    // dragged boundary moves.
    const snapshot: Record<string, number> = {};
    table.querySelectorAll("th[data-colkey]").forEach((el) => {
      const k = (el as HTMLElement).dataset.colkey;
      if (k) snapshot[k] = Math.round(el.getBoundingClientRect().width);
    });
    const startW = snapshot[key] ?? Math.round(th.getBoundingClientRect().width);
    const startNext = snapshot[nextKey] ?? MIN_COL;
    const startX = e.clientX;
    let lastW = startW;
    let lastNext = startNext;
    setWidths((prev) => ({ ...prev, ...snapshot }));
    const move = (ev: PointerEvent) => {
      // The pair shares a fixed budget: what one gains the other gives up.
      lastW = Math.min(startW + startNext - MIN_COL, Math.max(MIN_COL, Math.round(startW + ev.clientX - startX)));
      lastNext = startW + startNext - lastW;
      setWidths((prev) => ({ ...prev, [key]: lastW, [nextKey]: lastNext }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setWidths((prev) => {
        const next = { ...prev, [key]: lastW, [nextKey]: lastNext };
        localStorage.setItem(storageKey, JSON.stringify(next));
        return next;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const resetAll = (): void => {
    setWidths({});
    localStorage.removeItem(storageKey);
  };

  const handle = (key: string, nextKey: string | null): ReactElement | null =>
    nextKey == null ? null : (
      <span
        className="col-resize no-print"
        title="Drag to resize — double-click to reset all columns"
        onPointerDown={(e) => startResize(e, key, nextKey)}
        onDoubleClick={resetAll}
      />
    );

  const tableStyle = (renderedKeys: string[]): CSSProperties | undefined => {
    if (renderedKeys.length === 0 || !renderedKeys.every((k) => widths[k] != null)) return undefined;
    // Width stays 100%: the browser scales the stored widths proportionally,
    // keeping both edges pinned with no horizontal scroll.
    return { tableLayout: "fixed", width: "100%" };
  };

  return { widths, handle, tableStyle };
}
