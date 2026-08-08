"use client";

import { parseCsv, parseDurationShorthand, parseTimeOfDay } from "@opencall/core";
import { DEFAULT_COLUMNS, type SeedRow } from "@opencall/db/doc";
import { resolveSyncUrl } from "./syncUrl";

export const API_URL = resolveSyncUrl(process.env.NEXT_PUBLIC_SYNC_HTTP_URL, "http://localhost:8787");

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
  teamId: string;
  name: string;
  location: string | null;
  image1: string | null;
  image2: string | null;
  archivedAt: string | null;
  startDate: string;
  endDate: string;
  timezone: string;
  /** Sport code ("nrl") — drives sport-specific live flows. */
  sport: string | null;
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

// window-guarded: Node's experimental localStorage global exists during SSR
// but is not usable, so feature-detecting localStorage alone is not enough.
export const getAdminToken = (): string | null =>
  typeof window === "undefined" ? null : window.localStorage.getItem(ADMIN_TOKEN_KEY);
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
  if (!res.ok) {
    const detail = await res.text();
    // 401s are ordinary auth gating; anything else is journaled server-side.
    if (res.status !== 401 && res.status !== 404) {
      const { reportClientError } = await import("./errorReport");
      reportClientError(`API ${init?.method ?? "GET"} ${path} → ${res.status}: ${detail.slice(0, 300)}`);
    }
    throw new ApiError(`${path}: ${res.status} ${detail}`, res.status);
  }
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
  /** Who this code is for — the joiner's identity on every screen. */
  label: string | null;
}

export const api = {
  events: (includeArchived = false) => request<EventSummary[]>(`/events${includeArchived ? "?archived=1" : ""}`),
  updateMe: (body: { name?: string; email?: string }) =>
    request<{ ok: true }>("/me", { method: "PATCH", body: JSON.stringify(body) }),
  me: () =>
    request<{
      role: "admin" | "company" | "user" | null;
      devOpen?: boolean;
      teamId?: string;
      teamName?: string;
      name?: string;
      email?: string | null;
      canManage?: boolean;
      grants?: { kind: string; targetId: string }[];
    }>("/me"),
  login: (email: string, password: string) =>
    request<{ token: string; expiresAt: string; name: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<Record<string, never>>("/auth/logout", { method: "POST" }),
  changePassword: (current: string, next: string) =>
    request<Record<string, never>>("/auth/change-password", { method: "POST", body: JSON.stringify({ current, next }) }),
  setUserPassword: (id: string, password: string) =>
    request<{ id: string }>(`/users/${id}/set-password`, { method: "POST", body: JSON.stringify({ password }) }),
  users: () =>
    request<{ id: string; name: string; email: string; accessToken: string | null; hasPassword: boolean; grants: { kind: string; targetId: string }[] }[]>(
      "/users",
    ),
  createUser: (body: { name: string; email?: string; password?: string; grants: { kind: string; targetId?: string }[] }) =>
    request<{ id: string; accessToken: string }>("/users", { method: "POST", body: JSON.stringify(body) }),
  patchUser: (id: string, body: { name?: string; grants?: { kind: string; targetId?: string }[] }) =>
    request<{ id: string }>(`/users/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  rotateUserToken: (id: string) => request<{ id: string; accessToken: string }>(`/users/${id}/rotate-token`, { method: "POST" }),
  deleteUser: (id: string) => request<{ id: string }>(`/users/${id}`, { method: "DELETE" }),
  archiveEvent: (id: string, archived: boolean) =>
    request<{ id: string }>(`/events/${id}/archive`, { method: "POST", body: JSON.stringify({ archived }) }),
  archiveRundown: (id: string, archived: boolean) =>
    request<{ id: string }>(`/rundowns/${id}/archive`, { method: "POST", body: JSON.stringify({ archived }) }),
  companies: () =>
    request<{ id: string; name: string; companyToken: string | null; logo: string | null; eventCount: number }[]>(
      "/companies",
    ),
  createCompany: (name: string) =>
    request<{ id: string; companyToken: string }>("/companies", { method: "POST", body: JSON.stringify({ name }) }),
  rotateCompanyToken: (id: string) =>
    request<{ id: string; companyToken: string }>(`/companies/${id}/rotate-token`, { method: "POST" }),
  deleteCompany: (id: string) => request<{ id: string }>(`/companies/${id}`, { method: "DELETE" }),
  patchCompany: (id: string, body: { name?: string; logo?: string | null }) =>
    request<{ id: string }>(`/companies/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  createGuestPass: (body: { rundownId: string; columns?: Record<string, boolean> }) =>
    request<{ token: string }>("/guest-passes", { method: "POST", body: JSON.stringify(body) }),
  joinCodes: (rundownId: string) => request<JoinCodeSummary[]>(`/rundowns/${rundownId}/join-codes`),
  createJoinCode: (rundownId: string, role: "caller" | "editor" | "follower", label?: string) =>
    request<{ code: string; role: string; label: string | null }>(`/rundowns/${rundownId}/join-codes`, {
      method: "POST",
      body: JSON.stringify({ role, label }),
    }),
  revokeJoinCode: (rundownId: string, codeId: string) =>
    request<{ id: string }>(`/rundowns/${rundownId}/join-codes/${codeId}`, { method: "DELETE" }),
  snapshots: (rundownId: string) => request<SnapshotSummary[]>(`/rundowns/${rundownId}/snapshots`),
  createSnapshot: (rundownId: string, label?: string) =>
    request<{ id: string }>(`/rundowns/${rundownId}/snapshots`, { method: "POST", body: JSON.stringify({ label }) }),
  restoreSnapshot: (snapshotId: string, name?: string) =>
    request<{ id: string }>(`/snapshots/${snapshotId}/restore`, { method: "POST", body: JSON.stringify({ name }) }),
  restoreSnapshotInPlace: (snapshotId: string) =>
    request<{ id: string; epoch: number }>(`/snapshots/${snapshotId}/restore-in-place`, { method: "POST" }),
  createEvent: (body: { name: string; location?: string; startDate: string; endDate: string; timezone?: string; sport?: string | null; teamId?: string }) =>
    request<{ id: string }>("/events", { method: "POST", body: JSON.stringify(body) }),
  createRundown: (body: {
    eventId: string;
    name: string;
    description?: string;
    showDate?: string;
    plannedStartSec?: number | null;
    templateId?: string;
    rows?: SeedRow[];
    columns?: { key: string; title: string; width?: number }[];
    roles?: { name: string; color: string }[];
    roleColumnKey?: string | null;
    roleColumnKeys?: string[];
    sourceName?: string;
    sourceFileB64?: string;
    baseTitles?: { title?: string; start?: string; duration?: string };
    columnOrder?: string[];
  }) => request<{ id: string }>("/rundowns", { method: "POST", body: JSON.stringify(body) }),
  replaceRundownContent: (
    id: string,
    body: {
      rows: SeedRow[];
      columns?: { key: string; title: string; width?: number }[];
      roles?: { name: string; color: string }[];
      roleColumnKey?: string | null;
    roleColumnKeys?: string[];
      plannedStartSec?: number | null;
      sourceName?: string;
      sourceFileB64?: string;
      baseTitles?: { title?: string; start?: string; duration?: string };
      columnOrder?: string[];
    },
  ) => request<{ id: string; epoch: number }>(`/rundowns/${id}/replace-content`, { method: "POST", body: JSON.stringify(body) }),
  errors: (limit = 200) =>
    request<{ id: string; at: string; source: string; message: string; stack: string | null; url: string | null; userAgent: string | null }[]>(
      `/errors?limit=${limit}`,
    ),
  clearErrors: () => request<Record<string, never>>("/errors", { method: "DELETE" }),
  templates: () => request<TemplateSummary[]>("/templates"),
  saveTemplate: (body: { rundownId: string; name: string }) =>
    request<{ id: string }>("/templates", { method: "POST", body: JSON.stringify(body) }),
  // ── Landing & admin ──
  resolveCode: (code: string) =>
    request<{ role: "caller" | "editor" | "follower"; rundownId: string }>(`/codes/${encodeURIComponent(code)}`),
  live: () => request<{ rundownId: string; state: string; startedAt: string }[]>("/live"),
  patchEvent: (id: string, body: { name?: string; location?: string; timezone?: string; startDate?: string; endDate?: string; sport?: string | null; image1?: string | null; image2?: string | null }) =>
    request<{ id: string }>(`/events/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteEvent: (id: string) => request<{ id: string }>(`/events/${id}`, { method: "DELETE" }),
  patchRundown: (id: string, body: { name?: string }) =>
    request<{ id: string }>(`/rundowns/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteRundown: (id: string) => request<Record<string, never>>(`/rundowns/${id}`, { method: "DELETE" }),
  duplicateRundown: (id: string) => request<{ id: string }>(`/rundowns/${id}/duplicate`, { method: "POST" }),
};

/** The stored source sheet of a rundown, as a File — or null when none was kept. */
export async function fetchRundownSource(rundownId: string): Promise<File | null> {
  const headers: Record<string, string> = {};
  const admin = getAdminToken();
  if (admin) headers.authorization = `Bearer ${admin}`;
  const res = await fetch(`${API_URL}/rundowns/${rundownId}/source`, { headers });
  if (!res.ok) return null;
  const name = decodeURIComponent(res.headers.get("x-source-name") ?? "sheet.pdf");
  return new File([await res.blob()], name);
}

/**
 * One-click share: a view-only URL for a rundown (camera operators, crew).
 * Reuses the rundown's existing follower join code or mints one, then copies
 * `/view/<id>?code=…` to the clipboard. Anyone with the link can watch —
 * revoke by rotating join codes.
 */
export async function copyViewOnlyLink(rundownId: string): Promise<string> {
  const codes = await api.joinCodes(rundownId);
  let code = codes.find((c) => c.role === "follower")?.joinCode ?? null;
  if (!code) code = (await api.createJoinCode(rundownId, "follower")).code;
  const url = `${window.location.origin}/view/${rundownId}?code=${encodeURIComponent(code)}`;
  await navigator.clipboard.writeText(url);
  return url;
}

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
