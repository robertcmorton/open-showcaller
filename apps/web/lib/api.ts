"use client";

import { parseCsv, parseDurationShorthand, parseTimeOfDay } from "@opencall/core";
import { DEFAULT_COLUMNS, type SeedRow } from "@opencall/db/doc";

export const API_URL = process.env.NEXT_PUBLIC_SYNC_HTTP_URL ?? "http://localhost:8787";

export interface RundownSummary {
  id: string;
  eventId: string;
  name: string;
  description: string | null;
  showDate: string | null;
}

export interface EventSummary {
  id: string;
  name: string;
  location: string | null;
  startDate: string;
  endDate: string;
  timezone: string;
  use24h: boolean;
  rundowns: RundownSummary[];
}

export interface TemplateSummary {
  id: string;
  name: string;
  description: string | null;
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
};

export interface SnapshotSummary {
  id: string;
  label: string | null;
  createdAt: string;
}

export interface JoinCodeSummary {
  id: string;
  joinCode: string | null;
  role: string;
}

export const api = {
  events: () => request<EventSummary[]>("/events"),
  createGuestPass: (body: { rundownId: string; columns?: Record<string, boolean> }) =>
    request<{ token: string }>("/guest-passes", { method: "POST", body: JSON.stringify(body) }),
  joinCodes: (rundownId: string) => request<JoinCodeSummary[]>(`/rundowns/${rundownId}/join-codes`),
  createJoinCode: (rundownId: string, role: "caller" | "editor" | "follower") =>
    request<{ code: string; role: string }>(`/rundowns/${rundownId}/join-codes`, {
      method: "POST",
      body: JSON.stringify({ role }),
    }),
  snapshots: (rundownId: string) => request<SnapshotSummary[]>(`/rundowns/${rundownId}/snapshots`),
  createSnapshot: (rundownId: string, label?: string) =>
    request<{ id: string }>(`/rundowns/${rundownId}/snapshots`, { method: "POST", body: JSON.stringify({ label }) }),
  restoreSnapshot: (snapshotId: string, name?: string) =>
    request<{ id: string }>(`/snapshots/${snapshotId}/restore`, { method: "POST", body: JSON.stringify({ name }) }),
  createEvent: (body: { name: string; location?: string; startDate: string; endDate: string }) =>
    request<{ id: string }>("/events", { method: "POST", body: JSON.stringify(body) }),
  createRundown: (body: {
    eventId: string;
    name: string;
    description?: string;
    showDate?: string;
    plannedStartSec?: number | null;
    templateId?: string;
    rows?: SeedRow[];
  }) => request<{ id: string }>("/rundowns", { method: "POST", body: JSON.stringify(body) }),
  templates: () => request<TemplateSummary[]>("/templates"),
  saveTemplate: (body: { rundownId: string; name: string }) =>
    request<{ id: string }>("/templates", { method: "POST", body: JSON.stringify(body) }),
};

/**
 * CSV → seed rows. Header row required; "Title" and "Duration" are structural,
 * "Start" anchors a row, "Type"=group makes headers; other headers map onto the
 * default department columns by name (unknown headers are ignored).
 */
export function csvToSeedRows(text: string): { rows: SeedRow[]; skippedHeaders: string[] } {
  const grid = parseCsv(text);
  if (grid.length < 2) return { rows: [], skippedHeaders: [] };
  const headers = grid[0]!.map((h) => h.trim().toLowerCase());
  const keyByTitle = new Map(DEFAULT_COLUMNS.map((c) => [c.title.toLowerCase(), c.key]));
  const skippedHeaders: string[] = [];

  const mapping = headers.map((header) => {
    if (["title", "item", "name"].includes(header)) return { kind: "title" as const };
    if (header === "duration") return { kind: "duration" as const };
    if (["start", "start time"].includes(header)) return { kind: "start" as const };
    if (header === "type") return { kind: "type" as const };
    const key = keyByTitle.get(header);
    if (key && !["title", "start", "duration"].includes(key)) return { kind: "cell" as const, key };
    skippedHeaders.push(header);
    return { kind: "skip" as const };
  });

  const rows: SeedRow[] = [];
  for (const record of grid.slice(1)) {
    const row: SeedRow = { type: "cue", title: "", cells: {} };
    record.forEach((value, i) => {
      const m = mapping[i];
      const v = value.trim();
      if (!m || !v) return;
      if (m.kind === "title") row.title = v;
      else if (m.kind === "duration") row.durationSec = parseDurationShorthand(v);
      else if (m.kind === "start") row.hardStartSec = parseTimeOfDay(v);
      else if (m.kind === "type" && v.toLowerCase() === "group") row.type = "group";
      else if (m.kind === "cell") row.cells![m.key] = v;
    });
    if (row.title) rows.push(row);
  }
  return { rows, skippedHeaders };
}
