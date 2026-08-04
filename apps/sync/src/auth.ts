import type { IncomingMessage } from "node:http";
import { and, eq, isNull } from "drizzle-orm";
import { schema, type DbHandle } from "@opencall/db";

/**
 * Interim token auth (full accounts land later; this module is the seam they
 * replace). Three credentials exist, forming the access hierarchy:
 *
 * - ADMIN_TOKEN env var        → **admin**: everything, across all companies;
 * - teams.company_token        → **company** (showcaller credentials): change
 *                                 event details and below, ONLY within their
 *                                 own event company;
 * - share_tokens join codes    → per-rundown roles (caller/editor/follower) —
 *                                 an editor changes a rundown, never an event.
 *
 * When ADMIN_TOKEN is unset the deployment is DEV-OPEN: every check passes as
 * admin. Setting ADMIN_TOKEN locks the deployment down.
 */

export const adminToken = (): string | null => process.env.ADMIN_TOKEN || null;
export const isOpenAccess = (): boolean => adminToken() === null;

export type AuthCtx =
  | { kind: "admin" }
  | { kind: "company"; teamId: string; teamName: string }
  | { kind: "code"; role: "caller" | "editor" | "follower"; rundownId: string }
  | null;

export function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

/** Looks up a join code (optionally scoped to one rundown). */
export async function resolveJoinCode(
  handle: DbHandle,
  code: string,
  rundownId?: string,
): Promise<{ role: "caller" | "editor" | "follower"; rundownId: string } | null> {
  const conditions = [
    eq(schema.shareTokens.joinCode, code.toUpperCase()),
    eq(schema.shareTokens.kind, "join"),
    isNull(schema.shareTokens.revokedAt),
  ];
  if (rundownId) conditions.push(eq(schema.shareTokens.rundownId, rundownId));
  const row = await handle.db.query.shareTokens.findFirst({ where: and(...conditions) });
  if (row && row.role !== "guest") return { role: row.role as "caller" | "editor" | "follower", rundownId: row.rundownId };
  return null;
}

/** Resolves a bearer token to admin or a company (never a code). */
export async function resolveBearer(handle: DbHandle, token: string | null): Promise<AuthCtx> {
  if (!token) return null;
  if (token === adminToken()) return { kind: "admin" };
  const team = await handle.db.query.teams.findFirst({ where: eq(schema.teams.companyToken, token) });
  if (team) return { kind: "company", teamId: team.id, teamName: team.name };
  return null;
}

/** Full request auth context. `rundownId` scopes join-code checks. */
export async function authContext(handle: DbHandle, req: IncomingMessage, rundownId?: string): Promise<AuthCtx> {
  if (isOpenAccess()) return { kind: "admin" };
  const viaBearer = await resolveBearer(handle, bearerToken(req));
  if (viaBearer) return viaBearer;
  const code = req.headers["x-join-code"];
  if (typeof code === "string" && code) {
    const resolved = await resolveJoinCode(handle, code, rundownId);
    if (resolved) return { kind: "code", ...resolved };
  }
  return null;
}

/** The team that owns a rundown (via its event), or null. */
export async function teamIdForRundown(handle: DbHandle, rundownId: string): Promise<string | null> {
  const rundown = await handle.db.query.rundowns.findFirst({
    where: eq(schema.rundowns.id, rundownId),
    columns: { eventId: true },
  });
  if (!rundown) return null;
  const event = await handle.db.query.events.findFirst({
    where: eq(schema.events.id, rundown.eventId),
    columns: { teamId: true },
  });
  return event?.teamId ?? null;
}

export async function teamIdForEvent(handle: DbHandle, eventId: string): Promise<string | null> {
  const event = await handle.db.query.events.findFirst({
    where: eq(schema.events.id, eventId),
    columns: { teamId: true },
  });
  return event?.teamId ?? null;
}
