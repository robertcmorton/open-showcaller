import { localSecondsOfDay } from "./live";

/**
 * Event-timezone time model. The EVENT's location decides its IANA timezone,
 * and that zone governs every clock on every surface — a crew member opening
 * a show from anywhere sees the venue's wall clock, not their own. All
 * conversions go through Intl, which applies the IANA database's daylight-
 * saving rules for the exact instant being converted (shows that cross a DST
 * change stay correct because each timestamp is converted independently).
 */

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat | null {
  let cached = formatterCache.get(timeZone);
  if (cached) return cached;
  try {
    cached = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return null; // unknown zone → caller falls back to device-local
  }
  formatterCache.set(timeZone, cached);
  return cached;
}

/** Is this a usable IANA timezone name? */
export function isValidTimeZone(timeZone: string): boolean {
  return formatterFor(timeZone) !== null;
}

/**
 * Seconds since midnight in `timeZone` at the instant `ms` — DST-correct.
 * Falls back to device-local time when the zone is unknown/empty.
 */
export function zoneSecondsOfDay(ms: number, timeZone: string | null | undefined): number {
  if (!timeZone) return localSecondsOfDay(ms);
  const formatter = formatterFor(timeZone);
  if (!formatter) return localSecondsOfDay(ms);
  let h = 0;
  let m = 0;
  let s = 0;
  for (const part of formatter.formatToParts(ms)) {
    if (part.type === "hour") h = parseInt(part.value, 10) % 24; // "24" at midnight in some engines
    else if (part.type === "minute") m = parseInt(part.value, 10);
    else if (part.type === "second") s = parseInt(part.value, 10);
  }
  return h * 3600 + m * 60 + s + (ms % 1000) / 1000;
}

/** Short zone name at an instant ("AEST", "AEDT", "GMT+2") — DST-aware. */
export function zoneAbbreviation(timeZone: string | null | undefined, at = Date.now()): string {
  if (!timeZone) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(at);
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}
