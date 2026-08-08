"use client";

/**
 * The sync server's address **as this device can reach it**.
 *
 * A configured URL always wins, with one exception: when it points at
 * localhost but the page itself was served from somewhere else. That is a
 * phone, tablet, or second computer opening the app over the network, where
 * "localhost" would mean the visiting device itself — nothing listens there,
 * so the show never connects (the status dots stay red). Swapping in the
 * page's own hostname makes those devices work with no configuration, and a
 * page served over https keeps a secure scheme (browsers refuse ws:// and
 * http:// from an https page).
 */
export function resolveSyncUrl(configured: string | undefined, fallback: string): string {
  const raw = configured ?? fallback;
  if (typeof window === "undefined") return raw; // server render — never used there
  try {
    const url = new URL(raw);
    const pageHost = window.location.hostname;
    const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    const pageIsLoopback = pageHost === "localhost" || pageHost === "127.0.0.1";
    if (loopback && !pageIsLoopback) {
      url.hostname = pageHost;
      if (window.location.protocol === "https:") url.protocol = url.protocol === "ws:" ? "wss:" : "https:";
    }
    // Preserve the exact shape callers append to ("…:8787" / "…:8787/doc").
    return url.pathname === "/" ? url.origin : url.origin + url.pathname.replace(/\/$/, "");
  } catch {
    return raw;
  }
}
