"use client";

import { parseCsv } from "@opencall/core";

/**
 * File → text grid extraction for the import pipeline. All parsing semantics
 * (headers, mapping, tolerant values) live in @opencall/core; this module only
 * turns uploaded files into string[][] in the browser. Nothing is uploaded —
 * extraction is fully client-side and the user confirms before anything is
 * created.
 */

export interface ExtractedSheet {
  grid: string[][];
  /** Per-source-column display width hints in px (when the file provides them). */
  widths: (number | null)[];
  /** PDF only: page + vertical position per grid row, for wrapped-row merging. */
  lineMeta?: { page: number; y: number }[];
}

export async function extractGrid(file: File): Promise<ExtractedSheet> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) return { grid: parseCsv(await file.text()), widths: [] };
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) return extractXlsx(await file.arrayBuffer());
  if (name.endsWith(".pdf")) return extractPdf(await file.arrayBuffer());
  throw new Error("Unsupported file type — use .xlsx, .xls, .csv, or .pdf");
}

async function extractXlsx(buffer: ArrayBuffer): Promise<ExtractedSheet> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { grid: [], widths: [] };
  const sheet = workbook.Sheets[sheetName]!;
  // raw:false renders cells the way the spreadsheet displays them (durations,
  // times) — exactly the text the tolerant parsers are built for.
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "" });
  // Column widths come as character counts; ~7.2 px per character.
  const widths = (sheet["!cols"] ?? []).map((c) => (c?.wch ? Math.round(c.wch * 7.2) : null));
  return { grid: rows.map((row) => row.map((cell) => String(cell ?? ""))), widths };
}

/**
 * PDF → grid via text-run clustering: group runs into lines by Y, cluster the
 * X start positions of all runs into column bands, then assign each line's
 * runs to bands. Works for text-based exports (spreadsheet "Save as PDF");
 * scanned documents have no text layer and produce a clear error upstream.
 */
async function extractPdf(buffer: ArrayBuffer): Promise<ExtractedSheet> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

  const doc = await pdfjs.getDocument({ data: buffer }).promise;
  const Y_TOLERANCE = 4; // px: same visual line
  const X_GAP = 18; // px: bigger gaps start a new column band

  interface Run {
    x: number;
    y: number;
    text: string;
  }

  const pages: Run[][] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const runs: Run[] = [];
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const [, , , , x, y] = item.transform as number[];
      runs.push({ x: x!, y: y!, text: item.str });
    }
    pages.push(runs);
  }
  if (pages.every((runs) => runs.length === 0)) {
    throw new Error("This PDF has no text layer (likely a scan) — export it from the original spreadsheet instead.");
  }

  // Column bands from the x positions of every run on every page.
  const xs = pages
    .flat()
    .map((r) => r.x)
    .sort((a, b) => a - b);
  const bands: number[] = [];
  for (const x of xs) {
    if (bands.length === 0 || x - bands[bands.length - 1]! > X_GAP) bands.push(x);
  }
  const bandFor = (x: number): number => {
    let best = 0;
    for (let i = 0; i < bands.length; i++) if (x >= bands[i]! - X_GAP / 2) best = i;
    return best;
  };

  const grid: string[][] = [];
  const lineMeta: { page: number; y: number }[] = [];
  pages.forEach((runs, pageIndex) => {
    // Lines: sort by page Y (PDF Y grows upward), group within tolerance.
    const sorted = [...runs].sort((a, b) => b.y - a.y || a.x - b.x);
    let line: Run[] = [];
    let lineY: number | null = null;
    const flush = () => {
      if (line.length === 0) return;
      const cells: string[] = Array.from({ length: bands.length }, () => "");
      for (const run of line) {
        const band = bandFor(run.x);
        cells[band] = cells[band] ? `${cells[band]} ${run.text.trim()}` : run.text.trim();
      }
      grid.push(cells);
      lineMeta.push({ page: pageIndex, y: line[0]!.y });
      line = [];
    };
    for (const run of sorted) {
      if (lineY === null || Math.abs(run.y - lineY) <= Y_TOLERANCE) {
        line.push(run);
        lineY = lineY ?? run.y;
      } else {
        flush();
        line = [run];
        lineY = run.y;
      }
    }
    flush();
  });
  // Band spans (pt ≈ px) give each source column a proportional width hint.
  const widths = bands.map((x, i) => {
    const next = bands[i + 1];
    return next != null ? Math.round((next - x) * 1.25) : null;
  });
  return { grid, widths, lineMeta };
}
