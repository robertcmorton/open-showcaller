"use client";

import { useEffect, useRef, useState } from "react";
import type { DocStatus } from "../lib/useRundownDoc";

const VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";
const BUILD = process.env.NEXT_PUBLIC_BUILD_SHA ?? "local";

/**
 * A readout for when a screen will not load and the person holding it is
 * nowhere near a developer console — the normal case for a crew member on a
 * phone at a venue. It states, in plain words, exactly how far the connection
 * got and what stopped it, so a photo of the screen is enough to diagnose the
 * fault. It never prints a credential: only the KIND of credential in use.
 *
 * Appears by itself when the sheet has not loaded after a few seconds, and on
 * demand with ?diag=1.
 */
export function DiagnosticsBar({
  rundownId,
  doc,
  show,
}: {
  rundownId: string;
  doc: DocStatus;
  show: { connected: boolean; role: string | null; timezone: string | null };
}) {
  const [forced, setForced] = useState(false);
  const [stuck, setStuck] = useState(false);
  const [online, setOnline] = useState(true);
  const [copied, setCopied] = useState(false);
  const barRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setForced(new URLSearchParams(window.location.search).get("diag") === "1");
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  // Only nag once the wait has stopped being reasonable.
  useEffect(() => {
    if (doc.synced) {
      setStuck(false);
      return;
    }
    const t = window.setTimeout(() => setStuck(true), 6000);
    return () => window.clearTimeout(t);
  }, [doc.synced, doc.attempts]);

  // A refusal needs no waiting period — it is already final.
  const visible = forced || !!doc.blocked || (!doc.synced && stuck);

  // The bar is fixed to the bottom, so it would sit ON TOP of whatever the
  // screen is trying to say — including the message explaining the failure and
  // its sign-in button. Publishing its height lets the page keep clear of it.
  useEffect(() => {
    const root = document.documentElement;
    const el = barRef.current;
    if (!el) {
      root.style.removeProperty("--diag-h");
      return;
    }
    const measure = () => root.style.setProperty("--diag-h", `${Math.ceil(el.getBoundingClientRect().height)}px`);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--diag-h");
    };
  }, [visible]);

  if (!visible) return null;

  const lines = [
    `OpenCall ${VERSION} · ${BUILD}`,
    `sheet ${rundownId.slice(-6)} · epoch ${doc.epoch ?? "?"} · sign-in ${doc.tokenKind}`,
    `content: ${doc.phase}${doc.attempts > 1 ? ` · try ${doc.attempts}` : ""}`,
    `show channel: ${show.connected ? `connected as ${show.role ?? "?"}` : "not connected"} · device ${online ? "online" : "OFFLINE"}`,
    `server: ${doc.url}`,
    doc.blocked?.identity ? `account: ${doc.blocked.identity}` : null,
    doc.lastError ? `last error: ${doc.lastError}` : null,
  ].filter(Boolean) as string[];

  return (
    <div className="diag-bar no-print" ref={barRef}>
      <div className="diag-lines">
        {lines.map((l) => (
          <div key={l}>{l}</div>
        ))}
      </div>
      <div className="diag-actions">
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            void navigator.clipboard?.writeText(lines.join("\n")).then(
              () => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              },
              () => undefined,
            );
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" className="btn btn-sm" onClick={() => window.location.reload()}>
          Retry
        </button>
      </div>
    </div>
  );
}
