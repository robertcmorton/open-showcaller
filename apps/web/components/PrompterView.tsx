"use client";

import { useEffect, useRef, useState } from "react";
import { projectRundownDoc } from "@open-showcaller/db/doc";
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
  const { columns, rows } = projectRundownDoc(doc);
  const channel = useShowChannel(rundownId, "companion", joinCode);
  const show = channel.show;

  const [fontSize, setFontSize] = useState(42);
  const [mirror, setMirror] = useState(false);
  const [scrolling, setScrolling] = useState(false);
  const [speed, setSpeed] = useState(60); // px per second
  const containerRef = useRef<HTMLDivElement>(null);
  const lastActiveRef = useRef<string | null>(null);

  const scriptKey = columns.find((c) => c.key === "script")?.key ?? "script";
  const cues = rows.filter((r) => r.type === "cue");
  const wordCount = cues.reduce((n, r) => n + (r.cells[scriptKey]?.split(/\s+/).filter(Boolean).length ?? 0), 0);
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
        {cues.map((row, i) => (
          <section key={row.id} id={`prompt-${row.id}`} style={{ marginBottom: "1.2em" }}>
            <div
              style={{
                color: activeId === row.id ? "#2f81f7" : "#555",
                fontSize: "0.85rem",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: 6,
              }}
            >
              {i + 1} · {row.title}
            </div>
            {row.cells[scriptKey] && (
              <div style={{ fontSize, lineHeight: 1.45, color: "#f2f2f2", fontWeight: 500 }}>
                {row.cells[scriptKey]}
              </div>
            )}
          </section>
        ))}
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
        <button className="toolbar-btn" onClick={() => setScrolling((s) => !s)}>
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
        <button className="toolbar-btn" onClick={() => setFontSize((f) => Math.max(20, f - 4))}>
          A−
        </button>
        <button className="toolbar-btn" onClick={() => setFontSize((f) => Math.min(96, f + 4))}>
          A+
        </button>
        <button className="toolbar-btn" onClick={() => setMirror((m) => !m)}>
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
