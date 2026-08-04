import type { IncomingMessage } from "node:http";
import { and, eq, isNull } from "drizzle-orm";
import { schema, type DbHandle } from "@opencall/db";

/**
 * Interim token auth (full accounts land later, and this module is the seam
 * they replace). Two credentials exist:
 *
 * - the ADMIN_TOKEN environment variable → role "admin" (cross-show);
 * - per-rundown join codes in share_tokens → their stored role.
 *
 * When ADMIN_TOKEN is unset the deployment is DEV-OPEN: every check passes
 * with role "admin". Setting ADMIN_TOKEN is what locks a deployment down.
 */

export const adminToken = (): string | null => process.env.ADMIN_TOKEN || null;
export const isOpenAccess = (): boolean => adminToken() === null;

export type ApiRole = "admin" | "caller" | "editor" | "follower" | null;

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

/**
 * Resolves the caller's role for an API request. `rundownId` scopes join-code
 * checks; admin passes everywhere.
 */
export async function apiRole(handle: DbHandle, req: IncomingMessage, rundownId?: string): Promise<ApiRole> {
  if (isOpenAccess()) return "admin";
  const token = bearerToken(req);
  if (token && token === adminToken()) return "admin";
  const code = req.headers["x-join-code"];
  if (typeof code === "string" && code) {
    const resolved = await resolveJoinCode(handle, code, rundownId);
    if (resolved) return resolved.role;
  }
  return null;
}

export const canEdit = (role: ApiRole): boolean => role === "admin" || role === "caller" || role === "editor";
