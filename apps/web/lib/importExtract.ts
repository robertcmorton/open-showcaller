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
  /** PDF only: the table's ruled horizontal lines per page — authoritative row boundaries. */
  rowLines?: { page: number; ys: number[] }[];
}

/**
 * How to load the PDF engine. The browser build needs a DOM, so anything
 * running headless (the import audit) supplies the legacy build instead. It is
 * injected rather than branched on so the client bundle still carries exactly
 * one copy of the engine.
 */
export type PdfjsLoader = () => Promise<typeof import("pdfjs-dist")>;

export async function extractGrid(file: File, pdfjsLoader?: PdfjsLoader): Promise<ExtractedSheet> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) return { grid: parseCsv(await file.text()), widths: [] };
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) return extractXlsx(await file.arrayBuffer());
  if (name.endsWith(".pdf")) return extractPdf(await file.arrayBuffer(), pdfjsLoader);
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

type Matrix = [number, number, number, number, number, number];

const matMul = (m1: Matrix, m2: Matrix): Matrix => [
  m1[0] * m2[0] + m1[2] * m2[1],
  m1[1] * m2[0] + m1[3] * m2[1],
  m1[0] * m2[2] + m1[2] * m2[3],
  m1[1] * m2[2] + m1[3] * m2[3],
  m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
  m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
];
const matApply = (m: Matrix, x: number, y: number): [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];

/**
 * The table's ruled lines, from the page's drawing operators.
 *
 * Horizontal: wide flat strokes/fills are row borders; wide filled rectangles
 * (section banner backgrounds, cell fills) contribute both edges. These are the
 * AUTHORITATIVE row boundaries the wrapped-row merge groups lines by.
 *
 * Vertical: tall thin strokes and the left/right edges of cell fills are COLUMN
 * borders. They matter because a single cell often contains several text runs
 * at different x positions — a bold label beside an italic aside, a name
 * followed by a note — and clustering text by position alone splits one column
 * into several. The ruled grid says where the columns really are.
 */
async function extractRules(
  page: { getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[] }> },
  OPS: Record<string, number>,
): Promise<{ ys: number[]; xs: number[] }> {
  const { fnArray, argsArray } = await page.getOperatorList();
  const ys: number[] = [];
  const xs: number[] = [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  const addSegment = (x1: number, y1: number, x2: number, y2: number) => {
    const [tx1, ty1] = matApply(ctm, x1, y1);
    const [tx2, ty2] = matApply(ctm, x2, y2);
    if (Math.abs(ty2 - ty1) <= 1.5 && Math.abs(tx2 - tx1) >= 100) ys.push((ty1 + ty2) / 2);
    else if (Math.abs(tx2 - tx1) <= 1.5 && Math.abs(ty2 - ty1) >= 8) xs.push((tx1 + tx2) / 2);
  };
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) ctm = matMul(ctm, argsArray[i] as Matrix);
    else if (fn === OPS.constructPath) {
      const entry = argsArray[i] as unknown[];
      if (!Array.isArray(entry)) continue;
      // Modern pdf.js encodes paths as [pathOp, [command streams], minMax]:
      // each stream is a flat array of {0:moveTo x y, 1:lineTo x y,
      // 2:curveTo ×6, 3:quadCurve ×4, 4:closePath}.
      const streams = Array.isArray(entry[1]) ? (entry[1] as ArrayLike<number>[]) : null;
      if (streams) {
        for (const s of streams) {
          if (!s || typeof s.length !== "number") continue;
          let p = 0;
          let curX = 0;
          let curY = 0;
          while (p < s.length) {
            const op = s[p++]!;
            if (op === 0) {
              curX = s[p]!;
              curY = s[p + 1]!;
              p += 2;
            } else if (op === 1) {
              addSegment(curX, curY, s[p]!, s[p + 1]!);
              curX = s[p]!;
              curY = s[p + 1]!;
              p += 2;
            } else if (op === 2) {
              curX = s[p + 4]!;
              curY = s[p + 5]!;
              p += 6;
            } else if (op === 3) {
              curX = s[p + 2]!;
              curY = s[p + 3]!;
              p += 4;
            } else if (op === 4) {
              // closePath
            } else {
              break; // unknown encoding — skip the rest of this stream
            }
          }
        }
        continue;
      }
      // Legacy encoding: [ops: number[], args: number[]] with OPS codes.
      const [pathOps, pathArgs] = entry as [number[], number[]];
      if (!Array.isArray(pathOps) || !Array.isArray(pathArgs)) continue;
      let p = 0;
      let curX = 0;
      let curY = 0;
      for (const op of pathOps) {
        if (op === OPS.moveTo) {
          curX = pathArgs[p]!;
          curY = pathArgs[p + 1]!;
          p += 2;
        } else if (op === OPS.lineTo) {
          addSegment(curX, curY, pathArgs[p]!, pathArgs[p + 1]!);
          curX = pathArgs[p]!;
          curY = pathArgs[p + 1]!;
          p += 2;
        } else if (op === OPS.rectangle) {
          const [x, y, w, h] = [pathArgs[p]!, pathArgs[p + 1]!, pathArgs[p + 2]!, pathArgs[p + 3]!];
          p += 4;
          const [, ty1] = matApply(ctm, x, y);
          const [tx2, ty2] = matApply(ctm, x + w, y + h);
          const [tx1] = matApply(ctm, x, y);
          const wide = Math.abs(tx2 - tx1) >= 100;
          const tall = Math.abs(ty2 - ty1) > 3;
          // A tall thin bar is a column border; a filled cell contributes both
          // of its vertical edges, which are column borders too.
          if (tall && (Math.abs(tx2 - tx1) <= 3 || wide)) xs.push(tx1, tx2);
          if (!wide) continue; // narrow verticals & decorations carry no row edge
          if (!tall) ys.push((ty1 + ty2) / 2); // a border drawn as a thin filled bar
          else ys.push(ty1, ty2); // cell/banner background — both edges are borders
        } else if (op === OPS.curveTo) p += 6;
        else if (op === OPS.curveTo2 || op === OPS.curveTo3) p += 4;
        // closePath consumes nothing
      }
    }
  }
  // Cluster: borders are drawn per-cell, producing dozens of hits per rule.
  ys.sort((a, b) => b - a);
  const clusteredYs: number[] = [];
  for (const y of ys) {
    if (clusteredYs.length === 0 || clusteredYs[clusteredYs.length - 1]! - y > 1.5) clusteredYs.push(y);
  }
  xs.sort((a, b) => a - b);
  const clusteredXs: number[] = [];
  for (const x of xs) {
    if (clusteredXs.length === 0 || x - clusteredXs[clusteredXs.length - 1]! > 2) clusteredXs.push(x);
  }
  return { ys: clusteredYs, xs: clusteredXs };
}

/**
 * PDF → grid via text-run clustering: group runs into lines by Y, cluster the
 * X start positions of all runs into column bands, then assign each line's
 * runs to bands. Works for text-based exports (spreadsheet "Save as PDF");
 * scanned documents have no text layer and produce a clear error upstream.
 */
async function extractPdf(buffer: ArrayBuffer, loader?: PdfjsLoader): Promise<ExtractedSheet> {
  const pdfjs = loader ? await loader() : await import("pdfjs-dist");
  if (!loader) pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

  const doc = await pdfjs.getDocument({ data: buffer }).promise;
  const Y_TOLERANCE = 4; // px: same visual line
  const X_GAP = 18; // px: bigger gaps start a new column band

  interface Run {
    x: number;
    y: number;
    /** Rendered width, so a run can be placed by its CENTRE rather than its left edge. */
    w: number;
    text: string;
  }

  const pages: Run[][] = [];
  const rowLines: { page: number; ys: number[] }[] = [];
  const ruleXs: number[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const runs: Run[] = [];
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const [, , , , x, y] = item.transform as number[];
      runs.push({ x: x!, y: y!, w: (item as { width?: number }).width ?? 0, text: item.str });
    }
    pages.push(runs);
    try {
      const rules = await extractRules(page, pdfjs.OPS as unknown as Record<string, number>);
      if (rules.ys.length > 0) rowLines.push({ page: p - 1, ys: rules.ys });
      ruleXs.push(...rules.xs);
    } catch {
      // No rules extracted → the merge falls back to nearest-number heuristics.
    }
  }
  if (pages.every((runs) => runs.length === 0)) {
    throw new Error("This PDF has no text layer (likely a scan) — export it from the original spreadsheet instead.");
  }

  // Column boundaries. The ruled grid is authoritative when the table has one:
  // a single cell routinely holds several runs at different x positions (a name
  // then an italic aside, a label then a value), and clustering by run position
  // alone splits that one column into several — which is how a sheet's NOTES
  // end up half under NOTES and half under "Column 17".
  //
  // A border must appear on most pages to count: stray verticals from a logo or
  // a one-off callout are not columns.
  const pageCount = pages.length;
  const columnEdges: number[] = [];
  {
    const sorted = [...ruleXs].sort((a, b) => a - b);
    const groups: { x: number; count: number }[] = [];
    for (const x of sorted) {
      const last = groups[groups.length - 1];
      if (last && x - last.x <= 2) last.count += 1;
      else groups.push({ x, count: 1 });
    }
    const minPages = Math.max(2, Math.ceil(pageCount * 0.6));
    const kept: number[] = [];
    for (const g of groups) if (g.count >= minPages) kept.push(g.x);
    // Cell fills are often inset a few points from the border they sit against,
    // leaving a sliver too narrow to be a column. Merging those into the column
    // on their left keeps the real grid — and the sliver is exactly where wide
    // BOLD text spills out of its cell, so dropping it recovers those values.
    const MIN_COLUMN = 14; // pt — narrower than any column that holds text
    for (const x of kept) {
      if (columnEdges.length === 0 || x - columnEdges[columnEdges.length - 1]! >= MIN_COLUMN) columnEdges.push(x);
    }
  }
  const ruled = columnEdges.length >= 3;

  // Fallback: cluster the x positions of every run on every page.
  const bands: number[] = [];
  if (!ruled) {
    const xs = pages
      .flat()
      .map((r) => r.x)
      .sort((a, b) => a - b);
    for (const x of xs) {
      if (bands.length === 0 || x - bands[bands.length - 1]! > X_GAP) bands.push(x);
    }
  }
  const bandFor = (run: Run): number => {
    if (ruled) {
      // Place by the run's CENTRE, not its left edge: bold and centred text is
      // wider than the plain text the column was ruled for and routinely starts
      // a few points outside its own cell. Its middle is still in the right one.
      const mid = run.x + run.w / 2;
      let cell = 0;
      for (let i = 0; i < columnEdges.length; i++) if (mid >= columnEdges[i]!) cell = i;
      return cell;
    }
    let best = 0;
    for (let i = 0; i < bands.length; i++) if (run.x >= bands[i]! - X_GAP / 2) best = i;
    return best;
  };

  const columnCount = ruled ? columnEdges.length : bands.length;
  const grid: string[][] = [];
  const lineMeta: { page: number; y: number }[] = [];
  pages.forEach((runs, pageIndex) => {
    // Lines: sort by page Y (PDF Y grows upward), group within tolerance.
    const sorted = [...runs].sort((a, b) => b.y - a.y || a.x - b.x);
    let line: Run[] = [];
    let lineY: number | null = null;
    const flush = () => {
      if (line.length === 0) return;
      const cells: string[] = Array.from({ length: columnCount }, () => "");
      for (const run of line) {
        const band = bandFor(run);
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
  // Column spans (pt ≈ px) give each source column a proportional width hint.
  const spans = ruled ? columnEdges : bands;
  const widths = spans.map((x, i) => {
    const next = spans[i + 1];
    return next != null ? Math.round((next - x) * 1.25) : null;
  });
  return { grid, widths, lineMeta, rowLines };
}
