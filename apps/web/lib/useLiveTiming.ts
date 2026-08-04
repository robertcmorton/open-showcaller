"use client";

import { useEffect, useRef, useState } from "react";
import { computeLiveTiming, localSecondsOfDay, type LiveShowTiming, type PlanTiming } from "@open-showcaller/core";
import type { ShowChannel } from "./showChannel";

/**
 * Recomputes live countdowns locally every 250 ms from timestamps + clock offset.
 * Inputs are read through refs: `channel` and `timing` are fresh objects on every
 * render, so depending on them directly would loop setState forever.
 */
export function useLiveTiming(channel: ShowChannel, timing: PlanTiming): LiveShowTiming | null {
  const [live, setLive] = useState<LiveShowTiming | null>(null);
  const channelRef = useRef(channel);
  const timingRef = useRef(timing);
  channelRef.current = channel;
  timingRef.current = timing;

  useEffect(() => {
    const compute = () => {
      const show = channelRef.current.show;
      if (!show || show.state === "idle" || show.state === "ended" || !show.activeRowId || show.activeRowStartedAtMs == null) {
        setLive(null);
        return;
      }
      setLive(
        computeLiveTiming({
          timing: timingRef.current,
          activeRowId: show.activeRowId,
          activeRowStartedAtMs: show.activeRowStartedAtMs,
          pausedAccumMs: show.pausedAccumMs,
          pausedAtMs: show.pausedAtMs,
          nowMs: channelRef.current.serverNow(),
          toSecondsOfDay: localSecondsOfDay,
        }),
      );
    };
    compute();
    const timer = setInterval(compute, 250);
    return () => clearInterval(timer);
  }, []);

  return live;
}
