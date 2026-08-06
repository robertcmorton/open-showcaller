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
  /** Rich columns to include, in order (already filtered to visible). */
  richColumns: ColumnDef[];
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

  // Column layout: fixed structural widths, the rest shared proportionally to
  // the on-screen widths (user-resized or imported).
  const numW = 8;
  const startW = 19;
  const durW = 15;
  const flexible = pageW - margin * 2 - numW - startW - durW;
  const weights = [Math.max(120, input.widthFor("title") ?? 200), ...input.richColumns.map((c) => Math.max(70, input.widthFor(c.key) ?? 120))];
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const mmFor = (w: number) => (w / totalWeight) * flexible;

  const head = [["#", "Title", "Start", "Dur", ...input.richColumns.map((c) => c.title)]];
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
      r.title,
      start,
      dur,
      ...input.richColumns.map((c) => r.cells[c.key] ?? ""),
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
      1: { cellWidth: mmFor(weights[0]!), fontStyle: "bold" },
      2: { cellWidth: startW, halign: "left" },
      3: { cellWidth: durW },
      ...Object.fromEntries(input.richColumns.map((c, idx) => [4 + idx, { cellWidth: mmFor(weights[idx + 1]!) }])),
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
