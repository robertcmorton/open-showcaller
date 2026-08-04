/** Parse duration shorthand: "30m", "1m30s", "90s", "2h", "1:30", "01:02:03", bare seconds. */
export function parseDurationShorthand(input: string): number | null {
  const s = input.trim().toLowerCase();
  if (s === "") return null;

  if (/^\d+$/.test(s)) return parseInt(s, 10);

  const colon = s.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (colon) {
    const [, h, m, sec] = colon;
    return (h ? parseInt(h, 10) * 3600 : 0) + parseInt(m!, 10) * 60 + parseInt(sec!, 10);
  }

  const units = s.match(/^(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?$/);
  if (units && (units[1] || units[2] || units[3])) {
    return (
      (units[1] ? parseInt(units[1], 10) * 3600 : 0) +
      (units[2] ? parseInt(units[2], 10) * 60 : 0) +
      (units[3] ? parseInt(units[3], 10) : 0)
    );
  }
  return null;
}

/** Seconds since local midnight → "9:00:00 AM" / "21:00:00" style. */
export function formatTimeOfDay(sec: number, use24h = false): string {
  const s = ((sec % 86400) + 86400) % 86400;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const mm = String(m).padStart(2, "0");
  const sss = String(ss).padStart(2, "0");
  if (use24h) return `${String(h).padStart(2, "0")}:${mm}:${sss}`;
  const period = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mm}:${sss} ${period}`;
}

/** Parse a wall-clock time: "9", "9:30", "9:30:15", "9am", "9:30 pm", "21:05". */
export function parseTimeOfDay(input: string): number | null {
  const s = input.trim().toLowerCase();
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = parseInt(m[1]!, 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const sec = m[3] ? parseInt(m[3], 10) : 0;
  if (min > 59 || sec > 59) return null;
  if (m[4]) {
    if (h < 1 || h > 12) return null;
    if (m[4] === "pm" && h !== 12) h += 12;
    if (m[4] === "am" && h === 12) h = 0;
  } else if (h > 23) {
    return null;
  }
  return h * 3600 + min * 60 + sec;
}

/** Seconds → "MM:SS" or "H:MM:SS". */
export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${String(m).padStart(2, "0")}:${ss}`;
}
