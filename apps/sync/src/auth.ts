import type { IncomingMessage } from "node:http";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { ulid } from "ulid";
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

// ── Passwords & sessions ──────────────────────────────────────────────────────
// scrypt from node:crypto — no extra dependencies. Format: scrypt$salt$hash.

const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("base64url");
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString("base64url");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const candidate = scryptSync(password, salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(hash, "base64url");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export const SESSION_DAYS = 30;

/** Issues a login session for a user; the `ses_…` token is the bearer credential. */
export async function createSession(handle: DbHandle, userId: string, userAgent?: string): Promise<{ token: string; expiresAt: Date }> {
  const token = `ses_${randomBytes(24).toString("base64url")}`;
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000);
  await handle.db.insert(schema.authSessions).values({
    id: ulid(),
    userId,
    token,
    expiresAt,
    lastSeenAt: new Date(),
    userAgent: userAgent?.slice(0, 300),
  });
  return { token, expiresAt };
}

/** Revokes one session by its token (sign-out). */
export async function revokeSession(handle: DbHandle, token: string): Promise<void> {
  await handle.db
    .update(schema.authSessions)
    .set({ revokedAt: new Date() })
    .where(eq(schema.authSessions.token, token));
}

/** Revokes every session a user holds (password reset, account removal). */
export async function revokeUserSessions(handle: DbHandle, userId: string): Promise<void> {
  await handle.db
    .update(schema.authSessions)
    .set({ revokedAt: new Date() })
    .where(eq(schema.authSessions.userId, userId));
}

/** A valid, unexpired, unrevoked session → its user id. */
async function resolveSession(handle: DbHandle, token: string): Promise<string | null> {
  const session = await handle.db.query.authSessions.findFirst({ where: eq(schema.authSessions.token, token) });
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  // Rolling last-seen, throttled to once an hour to keep reads cheap.
  if (!session.lastSeenAt || Date.now() - session.lastSeenAt.getTime() > 3600_000) {
    await handle.db
      .update(schema.authSessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(schema.authSessions.id, session.id));
  }
  return session.userId;
}

export interface UserGrant {
  kind: "admin" | "company" | "event" | "view";
  targetId: string;
}

export type AuthCtx =
  // `name` is present when the admin is a signed-in ACCOUNT rather than the
  // bare ADMIN_TOKEN, so screens can say who is on the channel.
  | { kind: "admin"; name?: string }
  | { kind: "company"; teamId: string; teamName: string }
  | { kind: "user"; userId: string; name: string; grants: UserGrant[] }
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

/** Resolves a bearer token to admin, a company, or a user account (via personal token or login session). */
export async function resolveBearer(handle: DbHandle, token: string | null): Promise<AuthCtx> {
  if (!token) return null;
  if (token === adminToken()) return { kind: "admin" };
  const team = await handle.db.query.teams.findFirst({ where: eq(schema.teams.companyToken, token) });
  if (team) return { kind: "company", teamId: team.id, teamName: team.name };
  let user = null;
  if (token.startsWith("ses_")) {
    const userId = await resolveSession(handle, token);
    if (userId) user = await handle.db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  } else {
    user = await handle.db.query.users.findFirst({ where: eq(schema.users.accessToken, token) });
  }
  if (user) {
    const grants = await handle.db.query.userGrants.findMany({ where: eq(schema.userGrants.userId, user.id) });
    if (grants.some((g) => g.kind === "admin")) return { kind: "admin", name: user.name };
    return {
      kind: "user",
      userId: user.id,
      name: user.name,
      grants: grants.map((g) => ({ kind: g.kind as UserGrant["kind"], targetId: g.targetId })),
    };
  }
  return null;
}

/** Can this context CHANGE the given event (and everything below it)? */
export async function canManageEvent(handle: DbHandle, ctx: AuthCtx, eventId: string): Promise<boolean> {
  if (ctx?.kind === "admin") return true;
  if (ctx?.kind === "company") return (await teamIdForEvent(handle, eventId)) === ctx.teamId;
  if (ctx?.kind === "user") {
    if (ctx.grants.some((g) => g.kind === "event" && g.targetId === eventId)) return true;
    const teamId = await teamIdForEvent(handle, eventId);
    return teamId != null && ctx.grants.some((g) => g.kind === "company" && g.targetId === teamId);
  }
  return false;
}

/** Can this context at least SEE the given event? */
export async function canSeeEvent(handle: DbHandle, ctx: AuthCtx, eventId: string, teamId: string): Promise<boolean> {
  if (ctx?.kind === "admin") return true;
  if (ctx?.kind === "company") return teamId === ctx.teamId;
  if (ctx?.kind === "user")
    return ctx.grants.some(
      (g) =>
        (g.kind === "company" && g.targetId === teamId) ||
        ((g.kind === "event" || g.kind === "view") && g.targetId === eventId),
    );
  return false;
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
