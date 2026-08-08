"use client";

import { useEffect, useState } from "react";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { API_URL } from "./api";
import { resolveSyncUrl } from "./syncUrl";

const DOC_WS_URL = resolveSyncUrl(process.env.NEXT_PUBLIC_DOC_WS_URL, "ws://localhost:8787/doc");

/**
 * Shared rundown document connection; re-renders the consumer on every doc
 * update. `joinCode` (or the stored admin token) authenticates the connection
 * on locked-down servers; follower codes get a read-only doc.
 *
 * Connections are scoped to the rundown's DOC EPOCH (`<id>@<epoch>`). An
 * in-place restore bumps the epoch and kicks every client; on auth failure
 * the hook refetches the epoch and, if it moved, reconnects with a FRESH
 * Y.Doc — pre-restore state can never merge back.
 */
/** What the document connection is doing — surfaced in the diagnostics bar. */
export interface DocStatus {
  connected: boolean;
  synced: boolean;
  /** Last thing that happened, in words a person can read out of a screenshot. */
  phase: string;
  authFailed: boolean;
  attempts: number;
  epoch: number | null;
  url: string;
  /** Kind of credential sent — never the credential itself. */
  tokenKind: string;
  lastError: string | null;
}

export function useRundownDoc(
  rundownId: string,
  joinCode?: string,
): { doc: Y.Doc; connected: boolean; synced: boolean; status: DocStatus } {
  const [epoch, setEpoch] = useState<number | null>(null);
  const [doc, setDoc] = useState(() => new Y.Doc());
  const [connected, setConnected] = useState(false);
  // The socket opening is not the same as the CONTENT arriving: a long sheet
  // over a phone connection takes a moment, and until it lands the document
  // is legitimately empty. Surfaces use this to say "loading" rather than
  // claiming the rundown has no rows.
  const [synced, setSynced] = useState(false);
  const [phase, setPhase] = useState("starting");
  const [authFailed, setAuthFailed] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [tokenKind, setTokenKind] = useState("none");
  const [, setTick] = useState(0);

  const fetchEpoch = (id: string): Promise<number> =>
    fetch(`${API_URL}/rundowns/${id}/epoch`)
      .then((r) => {
        if (!r.ok) throw new Error(`epoch HTTP ${r.status}`);
        return r.json() as Promise<{ epoch?: number }>;
      })
      .then((b) => b.epoch ?? 0)
      .catch((err) => {
        // The API being unreachable is itself the diagnosis worth showing.
        setLastError(`epoch: ${String(err?.message ?? err)}`);
        return 0;
      });

  useEffect(() => {
    let cancelled = false;
    setPhase("fetching epoch");
    void fetchEpoch(rundownId).then((e) => {
      if (!cancelled) setEpoch(e);
    });
    return () => {
      cancelled = true;
    };
  }, [rundownId]);

  useEffect(() => {
    if (epoch == null) return;
    const fresh = new Y.Doc();
    setDoc(fresh);
    setSynced(false);
    const stored = localStorage.getItem("oc:admintoken");
    const token = joinCode ?? stored ?? "dev";
    // Only ever record the KIND of credential — a screenshot must never carry
    // the credential itself.
    setTokenKind(
      joinCode
        ? "join code"
        : !stored
          ? "none (dev)"
          : stored.startsWith("ses_")
            ? "session"
            : stored.startsWith("usr_")
              ? "personal"
              : stored.startsWith("co_")
                ? "company"
                : "admin",
    );
    setPhase("connecting");
    setAttempts((n) => n + 1);
    const provider = new HocuspocusProvider({
      url: DOC_WS_URL,
      name: `${rundownId}@${epoch}`,
      document: fresh,
      token,
      onConnect: () => {
        setConnected(true);
        setPhase("connected, waiting for content");
      },
      onSynced: () => {
        setSynced(true);
        setPhase("synced");
      },
      onDisconnect: () => {
        setConnected(false);
        setPhase("disconnected, retrying");
      },
      onClose: ({ event }: { event: { code?: number; reason?: string } }) => {
        if (event?.code && event.code !== 1000) {
          setLastError(`socket closed ${event.code}${event.reason ? ` ${event.reason}` : ""}`);
        }
      },
      onAuthenticationFailed: ({ reason }: { reason?: string }) => {
        setAuthFailed(true);
        setPhase("authentication refused");
        setLastError(`auth refused${reason ? `: ${reason}` : ""}`);
        // Possibly a stale epoch after an in-place restore — follow it.
        void fetchEpoch(rundownId).then((current) => {
          if (current !== epoch) setEpoch(current);
        });
      },
    });
    const bump = () => setTick((n) => n + 1);
    fresh.on("update", bump);
    return () => {
      fresh.off("update", bump);
      provider.destroy();
    };
  }, [rundownId, joinCode, epoch]);

  return {
    doc,
    connected,
    synced,
    status: { connected, synced, phase, authFailed, attempts, epoch, url: DOC_WS_URL, tokenKind, lastError },
  };
}

/** Keeps the screen awake while the surface is visible (companion surfaces in show use). */
export function useWakeLock(): void {
  useEffect(() => {
    type WakeLockSentinel = { release: () => Promise<void> };
    let lock: WakeLockSentinel | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<WakeLockSentinel> } };
    const acquire = () => nav.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => undefined);
    void acquire();
    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release();
    };
  }, []);
}
