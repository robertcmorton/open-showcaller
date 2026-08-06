"use client";

import { useEffect, useState } from "react";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { API_URL } from "./api";

const DOC_WS_URL = process.env.NEXT_PUBLIC_DOC_WS_URL ?? "ws://localhost:8787/doc";

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
export function useRundownDoc(rundownId: string, joinCode?: string): { doc: Y.Doc; connected: boolean } {
  const [epoch, setEpoch] = useState<number | null>(null);
  const [doc, setDoc] = useState(() => new Y.Doc());
  const [connected, setConnected] = useState(false);
  const [, setTick] = useState(0);

  const fetchEpoch = (id: string): Promise<number> =>
    fetch(`${API_URL}/rundowns/${id}/epoch`)
      .then((r) => r.json() as Promise<{ epoch?: number }>)
      .then((b) => b.epoch ?? 0)
      .catch(() => 0);

  useEffect(() => {
    let cancelled = false;
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
    const token = joinCode ?? localStorage.getItem("oc:admintoken") ?? "dev";
    const provider = new HocuspocusProvider({
      url: DOC_WS_URL,
      name: `${rundownId}@${epoch}`,
      document: fresh,
      token,
      onConnect: () => setConnected(true),
      onDisconnect: () => setConnected(false),
      onAuthenticationFailed: () => {
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

  return { doc, connected };
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
