"use client";

import { useEffect, useRef, useState } from "react";
import { projectRundownDoc } from "@opencall/db/doc";
import { computeTiming, formatTimeOfDay, PROMPTER_TAG } from "@opencall/core";
import { useRundownDoc, useWakeLock } from "../lib/useRundownDoc";
import { useShowChannel } from "../lib/showChannel";

/**
 * Prompter: renders the script column full-screen with auto-scroll (Space to
 * start/stop, arrows for speed), font-size controls, mirror mode, a fixed
 * read-position caret, and follow-the-caller (jumps to the active cue).
 */
export function PrompterView({ rundownId, joinCode }: { rundownId: string; joinCode?: string }) {
  useWakeLock();
  const { doc } = useRundownDoc(rundownId);
  const { columns, rows, meta } = projectRundownDoc(doc);
  const channel = useShowChannel(rundownId, "companion", joinCode);
  const show = channel.show;

  const [fontSize, setFontSize] = useState(42);
  const [mirror, setMirror] = useState(false);
  const [scrolling, setScrolling] = useState(false);
  const [speed, setSpeed] = useState(60); // px per second
  const containerRef = useRef<HTMLDivElement>(null);
  const lastActiveRef = useRef<string | null>(null);

  // What to read, in order of how explicit the sheet was:
  //  1. rows marked "prompter" in the sheet's own cue column — set on import
  //     for the passages written to be read aloud, and editable by hand;
  //  2. failing that, a Script column, which some sheets carry outright.
  // The words are the row's own text in case 1 and the Script cell in case 2.
  const scriptKey = columns.find((c) => c.key === "script")?.key ?? "script";
  const tagged = rows.filter((r) => Object.values(r.cells).some((v) => v.trim().toLowerCase() === PROMPTER_TAG));
  const usingTags = tagged.length > 0;
  const cues = usingTags ? tagged : rows.filter((r) => r.type === "cue" && r.cells[scriptKey]?.trim());
  const wordsOf = (r: (typeof rows)[number]): string => (usingTags ? r.title : (r.cells[scriptKey] ?? ""));

  // Every read carries the clock time it is due — the person holding the
  // prompter needs to know how long they have as much as what to say.
  const timing = computeTiming(rows, meta.plannedStartSec);
  const startById = new Map(rows.map((r, i) => [r.id, timing.rows[i]?.startSec ?? null]));
  const use24h = meta.use24h ?? false;

  const wordCount = cues.reduce((n, r) => n + wordsOf(r).split(/\s+/).filter(Boolean).length, 0);
  const estMinutes = Math.max(1, Math.round(wordCount / 150));

  // Follow the caller: smooth-jump to the active cue when it changes.
  useEffect(() => {
    const activeId = show?.state === "running" || show?.state === "paused" ? show.activeRowId : null;
    if (activeId && activeId !== lastActiveRef.current) {
      lastActiveRef.current = activeId;
      document.getElementById(`prompt-${activeId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [show?.activeRowId, show?.state]);

  // Auto-scroll loop.
  useEffect(() => {
    if (!scrolling) return;
    let raf = 0;
    let last = performance.now();
    let carry = 0;
    const step = (now: number) => {
      const el = containerRef.current;
      if (el) {
        carry += ((now - last) / 1000) * speed;
        const px = Math.floor(carry);
        if (px > 0) {
          el.scrollTop += px;
          carry -= px;
        }
      }
      last = now;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [scrolling, speed]);

  // Keyboard: Space toggles scroll, arrows adjust speed, +/- font size.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        setScrolling((s) => !s);
      } else if (e.key === "ArrowDown") setSpeed((s) => Math.min(300, s + 10));
      else if (e.key === "ArrowUp") setSpeed((s) => Math.max(10, s - 10));
      else if (e.key === "+" || e.key === "=") setFontSize((f) => Math.min(96, f + 4));
      else if (e.key === "-") setFontSize((f) => Math.max(20, f - 4));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const activeId = show?.state === "running" || show?.state === "paused" ? show.activeRowId : null;

  return (
    <main style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#000" }}>
      {/* Read-position caret */}
      <div
        style={{
          position: "fixed",
          left: 8,
          top: "30vh",
          width: 0,
          height: 0,
          borderTop: "14px solid transparent",
          borderBottom: "14px solid transparent",
          borderLeft: "20px solid #b91c1c",
          zIndex: 10,
        }}
      />
      <div
        ref={containerRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "30vh 8vw 60vh",
          transform: mirror ? "scaleX(-1)" : undefined,
        }}
      >
        {cues.length === 0 && (
          <div style={{ color: "#777", fontSize: "1.1rem", lineHeight: 1.6, maxWidth: "40ch" }}>
            Nothing to read yet. Mark a row <strong style={{ color: "#f2f2f2" }}>{PROMPTER_TAG}</strong> in the run
            sheet&rsquo;s cue column — the words in that row then appear here, with the time they are due.
          </div>
        )}
        {cues.map((row, i) => {
          const startSec = startById.get(row.id) ?? null;
          const words = wordsOf(row);
          return (
            <section key={row.id} id={`prompt-${row.id}`} style={{ marginBottom: "1.2em" }}>
              <div
                style={{
                  color: activeId === row.id ? "#2f81f7" : "#555",
                  fontSize: "0.85rem",
                  letterSpacing: "0.1em",
                  marginBottom: 6,
                  display: "flex",
                  gap: 12,
                }}
              >
                <span style={{ fontVariantNumeric: "tabular-nums" }}>
                  {startSec != null ? formatTimeOfDay(startSec, use24h) : "—"}
                </span>
                {row.durationSec != null && (
                  <span style={{ color: "#444" }}>
                    {Math.floor(row.durationSec / 60)}:{String(row.durationSec % 60).padStart(2, "0")}
                  </span>
                )}
                <span style={{ color: "#444" }}>{row.sourceNumber ? `#${row.sourceNumber}` : `${i + 1}`}</span>
              </div>
              {words && (
                <div style={{ fontSize, lineHeight: 1.45, color: "#f2f2f2", fontWeight: 500 }}>{words}</div>
              )}
            </section>
          );
        })}
      </div>

      <footer
        style={{
          display: "flex",
          gap: 14,
          alignItems: "center",
          padding: "8px 14px",
          background: "#0d0d0d",
          borderTop: "1px solid #222",
          fontSize: "0.78rem",
          color: "#9a9a9a",
        }}
      >
        <button className="btn btn-sm" onClick={() => setScrolling((s) => !s)}>
          {scrolling ? "⏸" : "▶"}
        </button>
        <label>
          speed{" "}
          <input
            type="range"
            min={10}
            max={300}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
          />
        </label>
        <button className="btn btn-sm" onClick={() => setFontSize((f) => Math.max(20, f - 4))}>
          A−
        </button>
        <button className="btn btn-sm" onClick={() => setFontSize((f) => Math.min(96, f + 4))}>
          A+
        </button>
        <button className="btn btn-sm" onClick={() => setMirror((m) => !m)}>
          {mirror ? "unmirror" : "mirror"}
        </button>
        <span style={{ marginLeft: "auto" }}>
          {wordCount} words · ~{estMinutes}m ·{" "}
          <span style={{ color: channel.connected ? "#3fb950" : "#f85149" }}>
            {channel.connected ? "following" : "reconnecting…"}
          </span>
        </span>
      </footer>
    </main>
  );
}
