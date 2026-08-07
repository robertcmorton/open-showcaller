"use client";

import { useEffect } from "react";
import { reportClientError } from "../lib/errorReport";

// A redeploy invalidates old hashed chunks; browsers holding the previous
// build then fail dynamic imports ("Loading chunk …", "e[o] is not a
// function"). One guarded reload picks up the new build.
const STALE_CHUNK = /Loading chunk|ChunkLoadError|'e\[o\]'|e\[o\] is not a function|Importing a module script failed|Failed to fetch dynamically imported module/;

function recoverIfStaleChunks(message: string): void {
  if (!STALE_CHUNK.test(message)) return;
  try {
    if (sessionStorage.getItem("oc:chunk-reload")) return; // never loop
    sessionStorage.setItem("oc:chunk-reload", "1");
    window.setTimeout(() => window.location.reload(), 150); // let the report flush
  } catch {
    /* private mode etc. */
  }
}

/**
 * Mounted once in the root layout: journals every uncaught browser error to
 * the server, and registers the service worker (production only — a worker
 * in dev serves stale HMR chunks).
 */
export function ErrorReporter() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV === "production") {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    } else {
      // Dev actively evicts any worker left behind (e.g. a production Docker
      // build on this port) — a stale worker serves stale chunks forever.
      void navigator.serviceWorker
        .getRegistrations()
        .then((regs) => regs.forEach((r) => void r.unregister()))
        .catch(() => undefined);
    }
  }, []);
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      reportClientError(e.message || "window error", e.error instanceof Error ? e.error.stack : `${e.filename}:${e.lineno}`);
      recoverIfStaleChunks(e.message ?? "");
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason as unknown;
      const message = reason instanceof Error ? reason.message : String(reason);
      reportClientError(`unhandled rejection: ${message}`, reason instanceof Error ? reason.stack : undefined);
      recoverIfStaleChunks(message);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
