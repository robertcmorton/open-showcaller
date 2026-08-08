"use client";

import { useEffect } from "react";

/**
 * Holds the layout still on phones and tablets.
 *
 * iOS Safari deliberately ignores `user-scalable=no`, so the viewport meta
 * alone is not enough: a stray pinch can leave a crew member zoomed into a
 * corner of the run sheet mid-show with no obvious way back. Refusing
 * Safari's non-standard pinch events closes that gap.
 *
 * Double-tap zoom is handled by `touch-action: manipulation` in CSS, NOT
 * here: cancelling `touchend` would also cancel the synthesized double-click
 * that opens a cell for editing, which is how the sheet is edited on a
 * tablet. Scrolling and the browser's own accessibility zoom are untouched.
 */
export function ViewportLock() {
  useEffect(() => {
    const stop = (e: Event) => e.preventDefault();
    document.addEventListener("gesturestart", stop);
    document.addEventListener("gesturechange", stop);
    document.addEventListener("gestureend", stop);
    return () => {
      document.removeEventListener("gesturestart", stop);
      document.removeEventListener("gesturechange", stop);
      document.removeEventListener("gestureend", stop);
    };
  }, []);
  return null;
}
