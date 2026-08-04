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
  archivedAt: string | null;
}

export interface EventSummary {
  id: string;
  name: string;
  location: string | null;
  archivedAt: string | null;
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

// ── Interim client credentials ────────────────────────────────────────────────
// Admin token (localStorage) and an optional per-page join code accompany every
// API call; the server decides what they're worth. Dev-open servers ignore both.

const ADMIN_TOKEN_KEY = "oc:admintoken";
let activeJoinCode: string | null = null;

export const getAdminToken = (): string | null =>
  typeof localStorage === "undefined" ? null : localStorage.getItem(ADMIN_TOKEN_KEY);
export const setAdminToken = (token: string | null): void => {
  if (token) localStorage.setItem(ADMIN_TOKEN_KEY, token);
  else localStorage.removeItem(ADMIN_TOKEN_KEY);
};
/** Screens that carry a ?code= call this once so panel API calls inherit it. */
export const setActiveJoinCode = (code: string | null): void => {
  activeJoinCode = code;
};

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const admin = getAdminToken();
  if (admin) headers.authorization = `Bearer ${admin}`;
  if (activeJoinCode) headers["x-join-code"] = activeJoinCode;
  const res = await fetch(`${API_URL}${path}`, { headers, ...init });
  if (!res.ok) throw new ApiError(`${path}: ${res.status} ${await res.text()}`, res.status);
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
  events: (includeArchived = false) => request<EventSummary[]>(`/events${includeArchived ? "?archived=1" : ""}`),
  me: () => request<{ role: "admin" | "company" | null; devOpen?: boolean; teamId?: string; teamName?: string }>("/me"),
  archiveEvent: (id: string, archived: boolean) =>
    request<{ id: string }>(`/events/${id}/archive`, { method: "POST", body: JSON.stringify({ archived }) }),
  archiveRundown: (id: string, archived: boolean) =>
    request<{ id: string }>(`/rundowns/${id}/archive`, { method: "POST", body: JSON.stringify({ archived }) }),
  companies: () =>
    request<{ id: string; name: string; companyToken: string | null; eventCount: number }[]>("/companies"),
  createCompany: (name: string) =>
    request<{ id: string; companyToken: string }>("/companies", { method: "POST", body: JSON.stringify({ name }) }),
  rotateCompanyToken: (id: string) =>
    request<{ id: string; companyToken: string }>(`/companies/${id}/rotate-token`, { method: "POST" }),
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
    columns?: { key: string; title: string }[];
  }) => request<{ id: string }>("/rundowns", { method: "POST", body: JSON.stringify(body) }),
  templates: () => request<TemplateSummary[]>("/templates"),
  saveTemplate: (body: { rundownId: string; name: string }) =>
    request<{ id: string }>("/templates", { method: "POST", body: JSON.stringify(body) }),
  // ── Landing & admin ──
  resolveCode: (code: string) =>
    request<{ role: "caller" | "editor" | "follower"; rundownId: string }>(`/codes/${encodeURIComponent(code)}`),
  live: () => request<{ rundownId: string; state: string; startedAt: string }[]>("/live"),
  patchEvent: (id: string, body: { name?: string; location?: string }) =>
    request<{ id: string }>(`/events/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteEvent: (id: string) => request<{ id: string }>(`/events/${id}`, { method: "DELETE" }),
  patchRundown: (id: string, body: { name?: string }) =>
    request<{ id: string }>(`/rundowns/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteRundown: (id: string) => request<Record<string, never>>(`/rundowns/${id}`, { method: "DELETE" }),
  duplicateRundown: (id: string) => request<{ id: string }>(`/rundowns/${id}/duplicate`, { method: "POST" }),
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
