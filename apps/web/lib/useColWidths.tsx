"use client";

import { useEffect, useState, type CSSProperties, type ReactElement } from "react";

/**
 * Draggable column widths for a .rundown-grid table, persisted per storage
 * key. The first drag snapshots EVERY column's rendered width (each th must
 * carry data-colkey) so the table can switch to a fixed layout — from then on
 * a drag moves only the dragged column's edge instead of elastically
 * redistributing the others. Double-clicking any handle resets the whole
 * table to its natural widths.
 */
export function useColWidths(storageKey: string): {
  widths: Record<string, number>;
  handle: (key: string) => ReactElement;
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

  const startResize = (e: React.PointerEvent, key: string): void => {
    e.preventDefault();
    e.stopPropagation();
    const th = (e.target as HTMLElement).closest("th");
    const table = th?.closest("table");
    if (!th || !table) return;
    // Freeze every column at the width it is showing right now, so only the
    // dragged edge moves.
    const snapshot: Record<string, number> = {};
    table.querySelectorAll("th[data-colkey]").forEach((el) => {
      const k = (el as HTMLElement).dataset.colkey;
      if (k) snapshot[k] = Math.round(el.getBoundingClientRect().width);
    });
    const startW = th.getBoundingClientRect().width;
    const startX = e.clientX;
    let last = Math.round(startW);
    setWidths((prev) => ({ ...prev, ...snapshot }));
    const move = (ev: PointerEvent) => {
      last = Math.min(720, Math.max(56, Math.round(startW + ev.clientX - startX)));
      setWidths((prev) => ({ ...prev, [key]: last }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setWidths((prev) => {
        const next = { ...prev, [key]: last };
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

  const handle = (key: string): ReactElement => (
    <span
      className="col-resize no-print"
      title="Drag to resize — double-click to reset all columns"
      onPointerDown={(e) => startResize(e, key)}
      onDoubleClick={resetAll}
    />
  );

  const tableStyle = (renderedKeys: string[]): CSSProperties | undefined => {
    if (renderedKeys.length === 0 || !renderedKeys.every((k) => widths[k] != null)) return undefined;
    const total = renderedKeys.reduce((sum, k) => sum + widths[k]!, 0);
    return { tableLayout: "fixed", width: total, minWidth: 0 };
  };

  return { widths, handle, tableStyle };
}
