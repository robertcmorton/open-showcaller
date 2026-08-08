/**
 * Import fidelity audit: does a live run sheet still say exactly what its
 * source sheet said?
 *
 * An import looks lossy from the outside — rows merge, blank lines vanish,
 * numbers are inferred — and the only honest way to know nothing was lost or
 * moved is to put the two side by side, row by row. This does that
 * mechanically so nobody has to read 25 pages against a screen.
 *
 * It re-reads the SOURCE (the sheet stored with the rundown, or a file you
 * point it at) through the very same pipeline the import screen uses, reads
 * the LIVE document, and reports every row where they disagree: rows the sheet
 * has and the run sheet does not, numbering that drifted, times and durations
 * that changed, and cell text that landed under a different column.
 *
 * Usage (from apps/web):
 *   ../sync/node_modules/.bin/tsx scripts/import-audit.mts <rundownId> \
 *     [--api http://localhost:8787] [--ws ws://localhost:8787] \
 *     [--token <access token>] [--file <sheet.pdf>] [--json] [--limit 40]
 *
 * With no --file it audits against the sheet stored with the rundown at import
 * time — the version that actually produced it.
 *
 * Exits non-zero when rows disagree, so it can gate a release.
 */
import { readFile } from "node:fs/promises";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { projectRundownDoc, type ProjectedRow } from "@opencall/db/doc";
import { buildSheet, planImport, type BuiltRow } from "@opencall/core";
import { extractGrid } from "../lib/importExtract";

// The browser build of the PDF engine needs a DOM; headless uses the legacy one.
const legacyPdfjs = () => import("pdfjs-dist/legacy/build/pdf.mjs") as never;

const args = process.argv.slice(2);
const flag = (name: string, fallback?: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const positional = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const rundownId = positional[0];
const API = flag("api", "http://localhost:8787")!;
const WS = flag("ws", API.replace(/^http/, "ws"))!;
const TOKEN = flag("token", "dev")!;
const FILE = flag("file");
const LIMIT = Number(flag("limit", "40"));
const AS_JSON = args.includes("--json");

if (!rundownId) {
  console.error("usage: import-audit.mts <rundownId> [--api URL] [--ws URL] [--token T] [--file sheet.pdf] [--json]");
  process.exit(2);
}

// ── The two sides ─────────────────────────────────────────────────────────────

async function sourceSide(): Promise<{ name: string; rows: BuiltRow[] }> {
  let bytes: Uint8Array;
  let name: string;
  if (FILE) {
    bytes = new Uint8Array(await readFile(FILE));
    name = FILE.split("/").pop()!;
  } else {
    const res = await fetch(`${API}/rundowns/${rundownId}/source`, { headers: { authorization: `Bearer ${TOKEN}` } });
    if (!res.ok) throw new Error(`no stored source sheet (HTTP ${res.status}) — pass --file`);
    bytes = new Uint8Array(await res.arrayBuffer());
    name = decodeURIComponent(res.headers.get("x-source-name") ?? "sheet");
  }
  const file = new File([bytes as unknown as BlobPart], name);
  const extracted = await extractGrid(file, legacyPdfjs);
  const pdf = /\.pdf$/i.test(name);
  const plan = planImport(extracted.grid, {
    mergeWrapped: pdf,
    lineMeta: extracted.lineMeta,
    rowLines: extracted.rowLines,
  });
  return { name, rows: buildSheet(plan, { widths: extracted.widths }).rows };
}

async function liveSide(): Promise<ReturnType<typeof projectRundownDoc>> {
  const epoch = await fetch(`${API}/rundowns/${rundownId}/epoch`)
    .then((r) => r.json())
    .then((b: { epoch?: number }) => b.epoch ?? 0);
  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({ url: `${WS}/doc`, name: `${rundownId}@${epoch}`, document: doc, token: TOKEN });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for the document")), 45000);
    provider.on("synced", () => {
      clearTimeout(timer);
      resolve();
    });
    provider.on("authenticationFailed", ({ reason }: { reason?: string }) => {
      clearTimeout(timer);
      reject(new Error(`document refused: ${reason ?? "unknown"}`));
    });
  });
  // A long sheet keeps arriving after the first sync frame.
  await new Promise((r) => setTimeout(r, 3000));
  const projected = projectRundownDoc(doc);
  provider.destroy();
  return projected;
}

// ── Comparison ────────────────────────────────────────────────────────────────

const norm = (s: string | null | undefined): string => (s ?? "").replace(/\s+/g, " ").trim();
const hhmmss = (sec: number | null | undefined): string => {
  if (sec == null) return "—";
  const s = ((sec % 86400) + 86400) % 86400;
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, "0")).join(":");
};
const mmss = (sec: number | null | undefined): string =>
  sec == null ? "—" : `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;

export interface Finding {
  kind: string;
  at: string;
  detail: string;
}

/**
 * Walks both sides together. Rows are matched by POSITION, because that is what
 * a person reads down: once the two drift apart, every later row would be
 * reported as different, so a title mismatch stops that row's comparison and
 * the count difference is reported once at the top.
 */
export function compareRows(source: BuiltRow[], live: ProjectedRow[]): Finding[] {
  const findings: Finding[] = [];
  const where = (i: number, r: { sourceNumber?: string; title?: string }): string =>
    `row ${i + 1}${r.sourceNumber ? ` (sheet #${r.sourceNumber})` : ""}${r.title ? ` "${norm(r.title).slice(0, 48)}"` : ""}`;

  if (source.length !== live.length) {
    findings.push({ kind: "row-count", at: "sheet", detail: `source has ${source.length} rows, the run sheet has ${live.length}` });
  }

  const n = Math.min(source.length, live.length);
  for (let i = 0; i < n; i++) {
    const s = source[i]!;
    const l = live[i]!;
    if (norm(s.title) !== norm(l.title)) {
      findings.push({ kind: "title", at: where(i, l), detail: `source "${norm(s.title)}" · live "${norm(l.title)}"` });
      continue; // out of step — further cell diffs on this row would be noise
    }
    if ((s.sourceNumber ?? "") !== (l.sourceNumber ?? "")) {
      findings.push({ kind: "number", at: where(i, l), detail: `source #${s.sourceNumber || "—"} · live #${l.sourceNumber || "—"}` });
    }
    if (s.type !== l.type) findings.push({ kind: "row-type", at: where(i, l), detail: `source ${s.type} · live ${l.type}` });
    if ((s.hardStartSec ?? null) !== (l.hardStartSec ?? null)) {
      findings.push({ kind: "start", at: where(i, l), detail: `source ${hhmmss(s.hardStartSec)} · live ${hhmmss(l.hardStartSec)}` });
    }
    if ((s.durationSec ?? null) !== (l.durationSec ?? null)) {
      findings.push({ kind: "duration", at: where(i, l), detail: `source ${mmss(s.durationSec)} · live ${mmss(l.durationSec)}` });
    }
    for (const k of new Set([...Object.keys(s.cells ?? {}), ...Object.keys(l.cells ?? {})])) {
      // The live projection also exposes the title as a cell; it is compared
      // above, and reporting it twice would bury the real differences.
      if (k === "title") continue;
      const a = norm(s.cells?.[k]);
      const b = norm(l.cells?.[k]);
      if (a !== b) findings.push({ kind: `cell:${k}`, at: where(i, l), detail: `source "${a}" · live "${b}"` });
    }
  }

  for (let i = n; i < source.length; i++) {
    findings.push({ kind: "missing-row", at: `row ${i + 1}`, detail: `source has "${norm(source[i]!.title)}", the run sheet ends before it` });
  }
  for (let i = n; i < live.length; i++) {
    findings.push({ kind: "extra-row", at: where(i, live[i]!), detail: "the run sheet has a row the source does not" });
  }
  return findings;
}

// ── Run ───────────────────────────────────────────────────────────────────────

const { name, rows: src } = await sourceSide();
const projected = await liveSide();
const findings = compareRows(src, projected.rows);

if (AS_JSON) {
  console.log(JSON.stringify({ source: name, sourceRows: src.length, liveRows: projected.rows.length, findings }, null, 1));
} else {
  console.log(`source : ${name} → ${src.length} rows`);
  console.log(`live   : ${projected.meta.name} → ${projected.rows.length} rows\n`);
  if (findings.length === 0) {
    console.log("✓ every row matches the source sheet");
  } else {
    const byKind = new Map<string, number>();
    for (const f of findings) byKind.set(f.kind, (byKind.get(f.kind) ?? 0) + 1);
    console.log(`${findings.length} difference(s):`);
    for (const [kind, count] of [...byKind].sort((a, b) => b[1] - a[1])) console.log(`   ${String(count).padStart(4)}  ${kind}`);
    console.log("");
    for (const f of findings.slice(0, LIMIT)) console.log(`  [${f.kind}] ${f.at}\n        ${f.detail}`);
    if (findings.length > LIMIT) console.log(`\n  …and ${findings.length - LIMIT} more (raise --limit, or --json)`);
  }
}
process.exit(findings.length === 0 ? 0 : 1);
