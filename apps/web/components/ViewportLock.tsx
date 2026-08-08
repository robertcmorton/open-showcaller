"use client";

import { useEffect } from "react";

/**
 * Holds the layout still on phones and tablets.
 *
 * iOS Safari deliberately ignores `user-scalable=no`, so the viewport meta
 * alone is not enough: a pinch or a double-tap can leave a crew member zoomed
 * into a corner of the run sheet mid-show, with no obvious way back. These
 * listeners refuse the pinch gestures (Safari's non-standard `gesture*`
 * events) and a fast double-tap, while leaving normal scrolling — and the
 * browser's own accessibility zoom — alone.
 */
export function ViewportLock() {
  useEffect(() => {
    const stop = (e: Event) => e.preventDefault();
    // Safari-only pinch gestures.
    document.addEventListener("gesturestart", stop);
    document.addEventListener("gesturechange", stop);
    document.addEventListener("gestureend", stop);

    // Double-tap zoom: a second tap within 300ms of the last one.
    let lastTap = 0;
    const onTouchEnd = (e: TouchEvent) => {
      const now = Date.now();
      if (now - lastTap < 300) e.preventDefault();
      lastTap = now;
    };
    document.addEventListener("touchend", onTouchEnd, { passive: false });

    return () => {
      document.removeEventListener("gesturestart", stop);
      document.removeEventListener("gesturechange", stop);
      document.removeEventListener("gestureend", stop);
      document.removeEventListener("touchend", onTouchEnd);
    };
  }, []);
  return null;
}
