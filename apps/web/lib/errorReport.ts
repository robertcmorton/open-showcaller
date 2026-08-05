"use client";

import { API_URL } from "./api";

// Everything that breaks in a browser gets journaled on the server so it can
// be reviewed (and fixed) from the admin dashboard's Error log. Reporting is
// best-effort and deduplicated — it must never cause errors of its own.

const seen = new Set<string>();
let budget = 20; // per page load

export function reportClientError(message: string, stack?: string | null): void {
  try {
    const key = message.slice(0, 200);
    if (budget <= 0 || seen.has(key)) return;
    seen.add(key);
    budget -= 1;
    void fetch(`${API_URL}/client-errors`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: message.slice(0, 2000),
        stack: stack?.slice(0, 8000),
        url: typeof window === "undefined" ? undefined : window.location.href,
      }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* never throw from the reporter */
  }
}
