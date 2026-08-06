"use client";

import { useEffect } from "react";
import { reportClientError } from "../lib/errorReport";

/**
 * Mounted once in the root layout: journals every uncaught browser error to
 * the server, and registers the service worker (production only — a worker
 * in dev serves stale HMR chunks).
 */
export function ErrorReporter() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      reportClientError(e.message || "window error", e.error instanceof Error ? e.error.stack : `${e.filename}:${e.lineno}`);
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason as unknown;
      reportClientError(
        reason instanceof Error ? `unhandled rejection: ${reason.message}` : `unhandled rejection: ${String(reason)}`,
        reason instanceof Error ? reason.stack : undefined,
      );
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
