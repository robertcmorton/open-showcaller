"use client";

import { useEffect, useState } from "react";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";

const DOC_WS_URL = process.env.NEXT_PUBLIC_DOC_WS_URL ?? "ws://localhost:8788";

/** Shared rundown document connection; re-renders the consumer on every doc update. */
export function useRundownDoc(rundownId: string): { doc: Y.Doc; connected: boolean } {
  const [doc] = useState(() => new Y.Doc());
  const [connected, setConnected] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    const provider = new HocuspocusProvider({
      url: DOC_WS_URL,
      name: rundownId,
      document: doc,
      onConnect: () => setConnected(true),
      onDisconnect: () => setConnected(false),
    });
    const bump = () => setTick((n) => n + 1);
    doc.on("update", bump);
    return () => {
      doc.off("update", bump);
      provider.destroy();
    };
  }, [doc, rundownId]);

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
