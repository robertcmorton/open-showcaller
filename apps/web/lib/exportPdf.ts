"use client";

import { formatDuration, formatTimeOfDay, type PlanTiming } from "@opencall/core";
import type { ColumnDef, KeyTime, ProjectedRow } from "@opencall/db/doc";

/**
 * A real PDF file of the rundown — A4 landscape, repeating table header,
 * anchored times marked, group banners as full-width bands, row highlight
 * colours preserved, and the same name/planned/key-times header as print.
 * Generated entirely client-side; the libraries load on demand.
 */
export interface PdfExportInput {
  name: string;
  versionLabel: string;
  use24h: boolean;
  keyTimes: KeyTime[];
  /** ALL columns to include in display order — the source sheet's order —
   *  already filtered to visible (title / startTime / duration / richtext). */
  columns: ColumnDef[];
  /** Effective display width per column key (user override or imported hint). */
  widthFor: (key: string) => number | undefined;
  rows: ProjectedRow[];
  timing: PlanTiming;
}

/** "rgba(229,72,77,0.16)" blended onto white → [r,g,b] for the PDF. */
function rowFill(color: string | undefined): [number, number, number] | null {
  const m = color?.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\)/);
  if (!m) return null;
  const a = m[4] != null ? parseFloat(m[4]) : 1;
  const blend = (c: number) => Math.round(255 * (1 - a) + c * a);
  return [blend(parseInt(m[1]!, 10)), blend(parseInt(m[2]!, 10)), blend(parseInt(m[3]!, 10))];
}

export async function exportRundownPdf(input: PdfExportInput): Promise<void> {
  const { default: JsPdf } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const doc = new JsPdf({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 10;

  // Column layout mirrors the sheet's order: fixed widths for start/duration
  // wherever they sit, the rest shared proportionally to the on-screen widths.
  const numW = 8;
  const startW = 19;
  const durW = 15;
  const fixedFor = (c: ColumnDef): number | null =>
    c.kind === "startTime" ? startW : c.kind === "duration" ? durW : null;
  const flexible =
    pageW - margin * 2 - numW - input.columns.reduce((sum, c) => sum + (fixedFor(c) ?? 0), 0);
  const weightFor = (c: ColumnDef): number =>
    c.kind === "title" ? Math.max(120, input.widthFor(c.key) ?? 200) : Math.max(70, input.widthFor(c.key) ?? 120);
  const totalWeight = input.columns.filter((c) => fixedFor(c) == null).reduce((sum, c) => sum + weightFor(c), 0);
  const mmFor = (c: ColumnDef) => (weightFor(c) / totalWeight) * flexible;

  const head = [["#", ...input.columns.map((c) => c.title)]];
  const columnCount = head[0]!.length;

  type Cell = string | { content: string; colSpan?: number; styles?: Record<string, unknown> };
  const body: Cell[][] = [];
  const rowMeta: { fill: [number, number, number] | null; skipped: boolean; group: boolean }[] = [];

  input.rows.forEach((r, i) => {
    const t = input.timing.rows[i]!;
    if (r.type === "group") {
      body.push([
        {
          content: r.title || "—",
          colSpan: columnCount,
          styles: { fillColor: [34, 38, 46], textColor: [255, 255, 255], fontStyle: "bold", halign: "left" },
        },
      ]);
      rowMeta.push({ fill: null, skipped: false, group: true });
      return;
    }
    const anchored = r.hardStartSec != null;
    const start =
      r.untimed && !anchored
        ? "" // untimed in the source sheet — no invented time
        : t.startSec != null
          ? `${anchored ? "*" : ""}${formatTimeOfDay(t.startSec, input.use24h)}`
          : "—";
    const dur = r.type === "milestone" ? "—" : r.durationSec != null ? formatDuration(r.durationSec) : "";
    body.push([
      String(i + 1),
      ...input.columns.map((c) =>
        c.kind === "title" ? r.title : c.kind === "startTime" ? start : c.kind === "duration" ? dur : (r.cells[c.key] ?? ""),
      ),
    ]);
    rowMeta.push({ fill: rowFill(r.color), skipped: r.skipped === true, group: false });
  });

  const headerLines = () => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(`${input.name}${input.versionLabel ? `  ·  ${input.versionLabel}` : ""}`, margin, 9);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    const planned =
      input.timing.startSec != null
        ? `Planned ${formatTimeOfDay(input.timing.startSec, input.use24h)} · duration ${formatDuration(input.timing.totalDurationSec)}${input.timing.endSec != null ? ` · end ${formatTimeOfDay(input.timing.endSec, input.use24h)}` : ""}`
        : `Duration ${formatDuration(input.timing.totalDurationSec)}`;
    doc.text(planned, margin, 13.5);
    if (input.keyTimes.length > 0) {
      const kt = input.keyTimes.map((k) => `${k.label} ${formatTimeOfDay(k.sec, input.use24h)}`).join("   ·   ");
      doc.text(kt, pageW - margin, 13.5, { align: "right" });
    }
  };

  autoTable(doc, {
    head,
    body,
    startY: 17,
    margin: { left: margin, right: margin, top: 17, bottom: 10 },
    styles: { fontSize: 7, cellPadding: 1.4, overflow: "linebreak", valign: "top", lineColor: [205, 208, 214], lineWidth: 0.15 },
    headStyles: { fillColor: [34, 38, 46], textColor: [255, 255, 255], fontSize: 7, fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: numW, halign: "right", textColor: [130, 134, 142] },
      ...Object.fromEntries(
        input.columns.map((c, idx) => [
          idx + 1,
          c.kind === "startTime"
            ? { cellWidth: startW, halign: "left" }
            : c.kind === "duration"
              ? { cellWidth: durW }
              : c.kind === "title"
                ? { cellWidth: mmFor(c), fontStyle: "bold" }
                : { cellWidth: mmFor(c) },
        ]),
      ),
    },
    didParseCell: (data) => {
      if (data.section !== "body") return;
      const meta = rowMeta[data.row.index];
      if (!meta || meta.group) return;
      if (meta.fill) data.cell.styles.fillColor = meta.fill;
      if (meta.skipped) data.cell.styles.textColor = [175, 178, 186];
    },
    didDrawPage: () => {
      headerLines();
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
      doc.setTextColor(130, 134, 142);
      doc.text(`${input.name} — page ${doc.getNumberOfPages()}`, margin, pageH - 4);
      doc.text(`Generated ${new Date().toLocaleString()} · OpenCall  (* = anchored time)`, pageW - margin, pageH - 4, {
        align: "right",
      });
      doc.setTextColor(0, 0, 0);
    },
  });

  doc.save(`${input.name.replace(/[^\w-]+/g, "_") || "rundown"}.pdf`);
}
