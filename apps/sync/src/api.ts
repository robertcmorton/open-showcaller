import type { IncomingMessage, ServerResponse } from "node:http";
import { and, desc, eq, ne, inArray } from "drizzle-orm";
import { ulid } from "ulid";
import {
  authContext,
  bearerToken,
  canManageEvent,
  canSeeEvent,
  createSession,
  hashPassword,
  resolveBearer,
  resolveJoinCode,
  revokeSession,
  revokeUserSessions,
  teamIdForEvent,
  teamIdForRundown,
  verifyPassword,
} from "./auth";
import { serializeCsv } from "@opencall/core";
import {
  buildRundownDoc,
  decodeDoc,
  encodeDoc,
  projectRundownDoc,
  schema,
  type DbHandle,
  type SeedRow,
} from "@opencall/db";
import * as Y from "yjs";

/**
 * Minimal JSON API for event/rundown/template management (dev-open CORS;
 * real auth arrives with the accounts hardening pass).
 */
/**
 * Fire-and-forget server error journal: everything lands in error_logs so
 * problems can be reviewed (and fixed) from the admin dashboard later.
 */
export function logServerError(
  handle: DbHandle,
  source: "server" | "process" | "client",
  err: unknown,
  extra: { url?: string; userAgent?: string; context?: Record<string, unknown> } = {},
): void {
  const message = (err instanceof Error ? err.message : String(err)).slice(0, 2000);
  const stack = err instanceof Error && err.stack ? err.stack.slice(0, 8000) : null;
  void handle.db
    .insert(schema.errorLogs)
    .values({ id: ulid(), source, message, stack, url: extra.url?.slice(0, 500), userAgent: extra.userAgent?.slice(0, 300), context: extra.context })
    .catch((e) => console.error("[sync] error-log write failed:", e));
}

// Client error reports are unauthenticated by design (view screens must be able
// to report) — a coarse budget keeps a misbehaving page from flooding the table.
let clientErrorBudget = 60;
setInterval(() => {
  clientErrorBudget = 60;
}, 60_000).unref();

// Login attempts share a coarse per-process budget to slow brute-forcing.
let loginBudget = 30;
setInterval(() => {
  loginBudget = 30;
}, 60_000).unref();

export function createApiHandler(
  handle: DbHandle,
  /** The live doc server, so in-place restore can kick stale connections. */
  docServer?: { closeConnections: (documentName?: string) => void; documents: Map<string, unknown> },
) {
  const { db } = handle;

  const readJson = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  };

  const json = (res: ServerResponse, status: number, body: unknown): void => {
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(body));
  };

  /** Dev stub: all data lives under the first team (created on demand). */
  const defaultTeamId = async (): Promise<string> => {
    const existing = await db.query.teams.findFirst();
    if (existing) return existing.id;
    const id = ulid();
    await db.insert(schema.teams).values({ id, name: "My Team", slug: `team-${id.slice(-6).toLowerCase()}` });
    return id;
  };

  return async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const { pathname } = url;
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "content-type,authorization,x-join-code");
    res.setHeader("access-control-expose-headers", "x-source-name");
    res.setHeader("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return true;
    }

    /** Admin-only routes (across every company). */
    const requireAdmin = async (): Promise<boolean> => {
      if ((await authContext(handle, req))?.kind === "admin") return true;
      json(res, 401, { error: "admin token required" });
      return false;
    };

    const eventIdForRundown = async (rundownId: string): Promise<string | null> => {
      const r = await db.query.rundowns.findFirst({ where: eq(schema.rundowns.id, rundownId), columns: { eventId: true } });
      return r?.eventId ?? null;
    };

    /** Anyone who may CHANGE this event: admin, owning company, or a user granted it. */
    const requireEventAccess = async (eventId: string): Promise<boolean> => {
      const ctx = await authContext(handle, req);
      if (await canManageEvent(handle, ctx, eventId)) return true;
      json(res, 401, { error: "management access required" });
      return false;
    };

    /** Structural rundown changes (editors change content, not structure). */
    const requireRundownManage = async (rundownId: string): Promise<boolean> => {
      const ctx = await authContext(handle, req);
      const eventId = await eventIdForRundown(rundownId);
      if (eventId && (await canManageEvent(handle, ctx, eventId))) return true;
      json(res, 401, { error: "management access required" });
      return false;
    };

    /** Rundown-scoped panels/content: managers, or a caller/editor code. */
    const requireEditor = async (rundownId: string): Promise<boolean> => {
      const ctx = await authContext(handle, req, rundownId);
      if (ctx?.kind === "code" && ctx.rundownId === rundownId && ctx.role !== "follower") return true;
      const eventId = await eventIdForRundown(rundownId);
      if (eventId && (await canManageEvent(handle, ctx, eventId))) return true;
      json(res, 401, { error: "editor access required" });
      return false;
    };

    /** The dropped run sheet, base64 in JSON (≤ ~12MB decoded) → bytes, or null. */
    const sourceFileValue = (v: unknown): Uint8Array | null => {
      if (typeof v !== "string" || v.length === 0 || v.length > 16_000_000) return null;
      try {
        return new Uint8Array(Buffer.from(v, "base64"));
      } catch {
        return null;
      }
    };

    /** Small inline image (data URL) or null to clear; anything else is rejected. */
    const imageValue = (v: unknown): string | null | undefined => {
      if (v === null) return null;
      if (typeof v === "string" && v.startsWith("data:image/") && v.length < 900_000) return v;
      return undefined;
    };

    /** Deletes a rundown and every row that references it. */
    const deleteRundown = async (rundownId: string): Promise<void> => {
      const sessions = await db.query.showSessions.findMany({
        where: eq(schema.showSessions.rundownId, rundownId),
        columns: { id: true },
      });
      if (sessions.length > 0)
        await db.delete(schema.showTransitions).where(
          inArray(schema.showTransitions.sessionId, sessions.map((s) => s.id)),
        );
      await db.delete(schema.showSessions).where(eq(schema.showSessions.rundownId, rundownId));
      await db.delete(schema.shareTokens).where(eq(schema.shareTokens.rundownId, rundownId));
      await db.delete(schema.rundownSnapshots).where(eq(schema.rundownSnapshots.rundownId, rundownId));
      await db.delete(schema.rundowns).where(eq(schema.rundowns.id, rundownId));
    };

    try {
      // ── Landing-page code resolution (public: a valid code IS the credential) ──
      if (req.method === "GET" && /^\/codes\/[^/]+$/.test(pathname)) {
        const resolved = await resolveJoinCode(handle, pathname.split("/")[2]!);
        if (!resolved) {
          json(res, 404, { error: "unknown code" });
          return true;
        }
        json(res, 200, resolved);
        return true;
      }

      // ── Cross-show endpoints (admin) ──
      if (req.method === "GET" && pathname === "/live") {
        const ctx = await authContext(handle, req);
        if (ctx?.kind !== "admin" && ctx?.kind !== "company" && ctx?.kind !== "user") {
          json(res, 401, { error: "access token required" });
          return true;
        }
        let sessions = await db.query.showSessions.findMany({
          where: ne(schema.showSessions.state, "ended"),
          columns: { rundownId: true, state: true, startedAt: true },
        });
        if (ctx.kind !== "admin") {
          const scoped: typeof sessions = [];
          for (const session of sessions) {
            const evId = await eventIdForRundown(session.rundownId);
            if (!evId) continue;
            const ev = await db.query.events.findFirst({ where: eq(schema.events.id, evId), columns: { teamId: true } });
            if (ev && (await canSeeEvent(handle, ctx, evId, ev.teamId))) scoped.push(session);
          }
          sessions = scoped;
        }
        json(res, 200, sessions.map((s) => ({ ...s, startedAt: s.startedAt.toISOString() })));
        return true;
      }

      // ── Who am I (drives the dashboard header + visibility) ──
      if (req.method === "GET" && pathname === "/me") {
        const ctx = await resolveBearer(handle, bearerToken(req));
        if (process.env.ADMIN_TOKEN == null) {
          json(res, 200, { role: "admin", devOpen: true });
          return true;
        }
        if (!ctx) json(res, 200, { role: null });
        else if (ctx.kind === "admin") json(res, 200, { role: "admin" });
        else if (ctx.kind === "company") json(res, 200, { role: "company", teamId: ctx.teamId, teamName: ctx.teamName });
        else if (ctx.kind === "user")
          json(res, 200, {
            role: "user",
            name: ctx.name,
            grants: ctx.grants,
            canManage: ctx.grants.some((g) => g.kind !== "view"),
          });
        else json(res, 200, { role: null });
        return true;
      }

      // ── Accounts: password login & sessions ──
      if (req.method === "POST" && pathname === "/auth/login") {
        if (loginBudget <= 0) {
          json(res, 429, { error: "too many attempts — wait a minute" });
          return true;
        }
        loginBudget -= 1;
        const body = await readJson(req);
        const email = String(body.email ?? "").trim().toLowerCase();
        const password = String(body.password ?? "");
        const user = email ? await db.query.users.findFirst({ where: eq(schema.users.email, email) }) : null;
        // One indistinct error for unknown email and wrong password alike.
        if (!user || !verifyPassword(password, user.passwordHash)) {
          json(res, 401, { error: "invalid email or password" });
          return true;
        }
        const session = await createSession(handle, user.id, req.headers["user-agent"]);
        json(res, 200, { token: session.token, expiresAt: session.expiresAt.toISOString(), name: user.name });
        return true;
      }

      if (req.method === "POST" && pathname === "/auth/logout") {
        const token = bearerToken(req);
        if (token?.startsWith("ses_")) await revokeSession(handle, token);
        json(res, 200, {});
        return true;
      }

      if (req.method === "POST" && pathname === "/auth/change-password") {
        const token = bearerToken(req);
        const ctx = await resolveBearer(handle, token);
        // Password changes are for signed-in ACCOUNTS (session or personal token);
        // resolveBearer folds admin-grant users into "admin", so look the user up directly.
        const body = await readJson(req);
        const current = String(body.current ?? "");
        const next = String(body.next ?? "");
        let userId: string | null = null;
        if (token?.startsWith("ses_")) {
          const session = await db.query.authSessions.findFirst({ where: eq(schema.authSessions.token, token) });
          if (session && !session.revokedAt && session.expiresAt >= new Date()) userId = session.userId;
        } else if (token && ctx) {
          const user = await db.query.users.findFirst({ where: eq(schema.users.accessToken, token) });
          userId = user?.id ?? null;
        }
        if (!userId) {
          json(res, 401, { error: "sign in first" });
          return true;
        }
        if (next.length < 8) {
          json(res, 400, { error: "new password must be at least 8 characters" });
          return true;
        }
        const user = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
        if (user?.passwordHash && !verifyPassword(current, user.passwordHash)) {
          json(res, 401, { error: "current password is wrong" });
          return true;
        }
        await db.update(schema.users).set({ passwordHash: hashPassword(next) }).where(eq(schema.users.id, userId));
        // Every other session dies with the old password; this one stays.
        if (token?.startsWith("ses_")) {
          await revokeUserSessions(handle, userId);
          await db.update(schema.authSessions).set({ revokedAt: null }).where(eq(schema.authSessions.token, token));
        } else {
          await revokeUserSessions(handle, userId);
        }
        json(res, 200, {});
        return true;
      }

      if (req.method === "POST" && /^\/users\/[^/]+\/set-password$/.test(pathname)) {
        if (!(await requireAdmin())) return true;
        const id = pathname.split("/")[2]!;
        const body = await readJson(req);
        const password = String(body.password ?? "");
        if (password.length < 8) {
          json(res, 400, { error: "password must be at least 8 characters" });
          return true;
        }
        await db.update(schema.users).set({ passwordHash: hashPassword(password) }).where(eq(schema.users.id, id));
        await revokeUserSessions(handle, id); // old sessions die with the old password
        json(res, 200, { id });
        return true;
      }

      // ── Error log ──
      // Browsers report their errors here; admins review and clear below.
      if (req.method === "POST" && pathname === "/client-errors") {
        const body = await readJson(req).catch(() => ({}) as Record<string, unknown>);
        if (clientErrorBudget > 0 && typeof body.message === "string" && body.message.trim()) {
          clientErrorBudget -= 1;
          logServerError(handle, "client", new Error(String(body.message).slice(0, 2000)), {
            url: typeof body.url === "string" ? body.url : undefined,
            userAgent: req.headers["user-agent"],
            context: typeof body.stack === "string" ? { stack: body.stack.slice(0, 8000) } : undefined,
          });
        }
        res.statusCode = 204;
        res.end();
        return true;
      }

      if (req.method === "GET" && pathname === "/errors") {
        if (!(await requireAdmin())) return true;
        const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") ?? 200)));
        const rows = await db.query.errorLogs.findMany({ orderBy: desc(schema.errorLogs.at), limit });
        json(
          res,
          200,
          rows.map((r) => ({
            id: r.id,
            at: r.at.toISOString(),
            source: r.source,
            message: r.message,
            stack: r.stack ?? (r.context as { stack?: string } | null)?.stack ?? null,
            url: r.url,
            userAgent: r.userAgent,
          })),
        );
        return true;
      }

      if (req.method === "DELETE" && pathname === "/errors") {
        if (!(await requireAdmin())) return true;
        await db.delete(schema.errorLogs);
        json(res, 200, {});
        return true;
      }

      // ── Users & access (admin only): who controls what ──
      if (req.method === "GET" && pathname === "/users") {
        if (!(await requireAdmin())) return true;
        const users = await db.query.users.findMany();
        const grants = await db.query.userGrants.findMany();
        json(
          res,
          200,
          users.map((u) => ({
            id: u.id,
            name: u.name,
            email: u.email,
            accessToken: u.accessToken,
            hasPassword: u.passwordHash != null,
            grants: grants.filter((g) => g.userId === u.id).map((g) => ({ kind: g.kind, targetId: g.targetId })),
          })),
        );
        return true;
      }

      if (req.method === "POST" && pathname === "/users") {
        if (!(await requireAdmin())) return true;
        const body = await readJson(req);
        const name = String(body.name ?? "").trim();
        if (!name) {
          json(res, 400, { error: "name required" });
          return true;
        }
        const id = ulid();
        const token = `usr_${ulid().toLowerCase()}`;
        const password = String(body.password ?? "");
        if (password && password.length < 8) {
          json(res, 400, { error: "password must be at least 8 characters" });
          return true;
        }
        await db.insert(schema.users).values({
          id,
          name,
          email: String(body.email ?? `${id.toLowerCase()}@local`).trim().toLowerCase() || `${id.toLowerCase()}@local`,
          accessToken: token,
          passwordHash: password ? hashPassword(password) : null,
        });
        const grants = Array.isArray(body.grants) ? (body.grants as { kind: string; targetId?: string }[]) : [];
        for (const g of grants) {
          if (!["admin", "company", "event", "view"].includes(g.kind)) continue;
          await db.insert(schema.userGrants).values({ userId: id, kind: g.kind as never, targetId: String(g.targetId ?? "") });
        }
        json(res, 201, { id, accessToken: token });
        return true;
      }

      if (req.method === "PATCH" && /^\/users\/[^/]+$/.test(pathname)) {
        if (!(await requireAdmin())) return true;
        const id = pathname.split("/")[2]!;
        const body = await readJson(req);
        if (typeof body.name === "string" && body.name.trim())
          await db.update(schema.users).set({ name: body.name.trim() }).where(eq(schema.users.id, id));
        if (Array.isArray(body.grants)) {
          await db.delete(schema.userGrants).where(eq(schema.userGrants.userId, id));
          for (const g of body.grants as { kind: string; targetId?: string }[]) {
            if (!["admin", "company", "event", "view"].includes(g.kind)) continue;
            await db.insert(schema.userGrants).values({ userId: id, kind: g.kind as never, targetId: String(g.targetId ?? "") });
          }
        }
        json(res, 200, { id });
        return true;
      }

      if (req.method === "POST" && /^\/users\/[^/]+\/rotate-token$/.test(pathname)) {
        if (!(await requireAdmin())) return true;
        const id = pathname.split("/")[2]!;
        const token = `usr_${ulid().toLowerCase()}`;
        await db.update(schema.users).set({ accessToken: token }).where(eq(schema.users.id, id));
        json(res, 200, { id, accessToken: token });
        return true;
      }

      if (req.method === "DELETE" && /^\/users\/[^/]+$/.test(pathname)) {
        if (!(await requireAdmin())) return true;
        const id = pathname.split("/")[2]!;
        await db.delete(schema.userGrants).where(eq(schema.userGrants.userId, id));
        await db.delete(schema.authSessions).where(eq(schema.authSessions.userId, id));
        await db.delete(schema.users).where(eq(schema.users.id, id));
        json(res, 200, { id });
        return true;
      }

      // ── Archive / unarchive (admin or owning company) ──
      if (req.method === "POST" && /^\/events\/[^/]+\/archive$/.test(pathname)) {
        const id = pathname.split("/")[2]!;
        if (!(await requireEventAccess(id))) return true;
        const body = await readJson(req);
        await db
          .update(schema.events)
          .set({ archivedAt: body.archived === false ? null : new Date() })
          .where(eq(schema.events.id, id));
        json(res, 200, { id });
        return true;
      }

      if (req.method === "POST" && /^\/rundowns\/[^/]+\/archive$/.test(pathname)) {
        const id = pathname.split("/")[2]!;
        if (!(await requireRundownManage(id))) return true;
        const body = await readJson(req);
        await db
          .update(schema.rundowns)
          .set({ archivedAt: body.archived === false ? null : new Date() })
          .where(eq(schema.rundowns.id, id));
        json(res, 200, { id });
        return true;
      }

      // ── Event companies (admin only): showcaller credentials per company ──
      if (req.method === "GET" && pathname === "/companies") {
        if (!(await requireAdmin())) return true;
        const teams = await db.query.teams.findMany();
        const events = await db.query.events.findMany({ columns: { teamId: true } });
        json(
          res,
          200,
          teams.map((t) => ({
            id: t.id,
            name: t.name,
            companyToken: t.companyToken,
            logo: t.logo ?? null,
            eventCount: events.filter((e) => e.teamId === t.id).length,
          })),
        );
        return true;
      }

      if (req.method === "POST" && pathname === "/companies") {
        if (!(await requireAdmin())) return true;
        const body = await readJson(req);
        const name = String(body.name ?? "").trim();
        if (!name) {
          json(res, 400, { error: "name required" });
          return true;
        }
        const id = ulid();
        const token = `co_${ulid().toLowerCase()}`;
        await db.insert(schema.teams).values({
          id,
          name,
          slug: `co-${id.slice(-8).toLowerCase()}`,
          companyToken: token,
        });
        json(res, 201, { id, companyToken: token });
        return true;
      }

      if (req.method === "POST" && /^\/companies\/[^/]+\/rotate-token$/.test(pathname)) {
        if (!(await requireAdmin())) return true;
        const id = pathname.split("/")[2]!;
        const token = `co_${ulid().toLowerCase()}`;
        await db.update(schema.teams).set({ companyToken: token }).where(eq(schema.teams.id, id));
        json(res, 200, { id, companyToken: token });
        return true;
      }

      if (req.method === "DELETE" && /^\/companies\/[^/]+$/.test(pathname)) {
        if (!(await requireAdmin())) return true;
        const id = pathname.split("/")[2]!;
        // Cascade: every event under the company (and everything under those),
        // the company's templates and memberships, then the company itself.
        const companyEvents = await db.query.events.findMany({
          where: eq(schema.events.teamId, id),
          columns: { id: true },
        });
        for (const event of companyEvents) {
          const rundowns = await db.query.rundowns.findMany({
            where: eq(schema.rundowns.eventId, event.id),
            columns: { id: true },
          });
          for (const r of rundowns) await deleteRundown(r.id);
          await db.delete(schema.events).where(eq(schema.events.id, event.id));
        }
        await db.delete(schema.templates).where(eq(schema.templates.teamId, id));
        await db.delete(schema.teamMembers).where(eq(schema.teamMembers.teamId, id));
        await db.delete(schema.teams).where(eq(schema.teams.id, id));
        json(res, 200, { id });
        return true;
      }

      if (req.method === "PATCH" && /^\/companies\/[^/]+$/.test(pathname)) {
        if (!(await requireAdmin())) return true;
        const id = pathname.split("/")[2]!;
        const body = await readJson(req);
        const patch: Record<string, unknown> = {};
        if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
        const logo = imageValue(body.logo);
        if (logo !== undefined) patch.logo = logo;
        if (Object.keys(patch).length > 0) await db.update(schema.teams).set(patch).where(eq(schema.teams.id, id));
        json(res, 200, { id });
        return true;
      }

      if (req.method === "PATCH" && /^\/events\/[^/]+$/.test(pathname)) {
        const id = pathname.split("/")[2]!;
        if (!(await requireEventAccess(id))) return true;
        const body = await readJson(req);
        const current = await db.query.events.findFirst({ where: eq(schema.events.id, id) });
        if (!current) {
          json(res, 404, { error: "event not found" });
          return true;
        }
        const patch: Record<string, unknown> = {};
        if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
        if (typeof body.location === "string") patch.location = body.location.trim() || null;
        const image1 = imageValue(body.image1);
        if (image1 !== undefined) patch.image1 = image1;
        const image2 = imageValue(body.image2);
        if (image2 !== undefined) patch.image2 = image2;
        const dateOk = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
        if (dateOk(body.startDate)) patch.startDate = body.startDate;
        if (dateOk(body.endDate)) patch.endDate = body.endDate;
        {
          // The ordering rule holds on the MERGED result, whichever side changed.
          const nextStart = (patch.startDate as string | undefined) ?? current.startDate;
          const nextEnd = (patch.endDate as string | undefined) ?? current.endDate;
          if (nextEnd < nextStart) {
            json(res, 400, { error: "end date cannot be before the start date" });
            return true;
          }
        }
        if (typeof body.timezone === "string" && body.timezone && body.timezone !== current.timezone) {
          // The event's primary time may only change when its LOCATION changes.
          const locationChanged =
            typeof body.location === "string" && (body.location.trim() || null) !== current.location;
          if (!locationChanged) {
            json(res, 400, { error: "timezone can only change together with the event location" });
            return true;
          }
          patch.timezone = body.timezone;
        }
        if (Object.keys(patch).length > 0) await db.update(schema.events).set(patch).where(eq(schema.events.id, id));
        json(res, 200, { id });
        return true;
      }

      if (req.method === "DELETE" && /^\/events\/[^/]+$/.test(pathname)) {
        const id = pathname.split("/")[2]!;
        if (!(await requireEventAccess(id))) return true;
        const rundowns = await db.query.rundowns.findMany({
          where: eq(schema.rundowns.eventId, id),
          columns: { id: true },
        });
        for (const r of rundowns) await deleteRundown(r.id);
        await db.delete(schema.events).where(eq(schema.events.id, id));
        json(res, 200, { id });
        return true;
      }

      if (req.method === "PATCH" && /^\/rundowns\/[^/]+$/.test(pathname)) {
        const id = pathname.split("/")[2]!;
        if (!(await requireRundownManage(id))) return true;
        const body = await readJson(req);
        if (typeof body.name === "string" && body.name.trim()) {
          const name = body.name.trim();
          const row = await db.query.rundowns.findFirst({ where: eq(schema.rundowns.id, id) });
          if (!row) {
            json(res, 404, { error: "rundown not found" });
            return true;
          }
          const patch: { name: string; doc?: Uint8Array; docUpdatedAt?: Date } = { name };
          // Keep the doc's meta name in step. (A concurrently open editor may
          // overwrite this on its next store; the row name is authoritative
          // for dashboards either way.)
          if (row.doc) {
            const doc = decodeDoc(row.doc);
            doc.getMap("meta").set("name", name);
            patch.doc = encodeDoc(doc);
            patch.docUpdatedAt = new Date();
          }
          await db.update(schema.rundowns).set(patch).where(eq(schema.rundowns.id, id));
        }
        json(res, 200, { id });
        return true;
      }

      if (req.method === "DELETE" && /^\/rundowns\/[^/]+$/.test(pathname)) {
        if (!(await requireRundownManage(pathname.split("/")[2]!))) return true;
        await deleteRundown(pathname.split("/")[2]!);
        json(res, 200, {});
        return true;
      }

      if (req.method === "POST" && /^\/rundowns\/[^/]+\/duplicate$/.test(pathname)) {
        const sourceId = pathname.split("/")[2]!;
        if (!(await requireRundownManage(sourceId))) return true;
        const source = await db.query.rundowns.findFirst({ where: eq(schema.rundowns.id, sourceId) });
        if (!source?.doc) {
          json(res, 404, { error: "rundown not found" });
          return true;
        }
        const id = ulid();
        const name = `${source.name} (copy)`;
        const doc = decodeDoc(source.doc);
        doc.getMap("meta").set("name", name);
        await db.insert(schema.rundowns).values({
          id,
          eventId: source.eventId,
          name,
          description: source.description,
          showDate: source.showDate,
          plannedStartSec: source.plannedStartSec,
          doc: encodeDoc(doc),
          docUpdatedAt: new Date(),
        });
        json(res, 201, { id });
        return true;
      }

      if (req.method === "GET" && pathname === "/events") {
        const ctx = await authContext(handle, req);
        if (ctx?.kind !== "admin" && ctx?.kind !== "company" && ctx?.kind !== "user") {
          json(res, 401, { error: "access token required" });
          return true;
        }
        const includeArchived = url.searchParams.get("archived") === "1";
        const all = await db.query.events.findMany();
        const events = [] as typeof all;
        for (const e of all) {
          if (!includeArchived && e.archivedAt) continue;
          if (await canSeeEvent(handle, ctx, e.id, e.teamId)) events.push(e);
        }
        const rundowns = await db.query.rundowns.findMany({
          columns: { id: true, eventId: true, name: true, description: true, showDate: true, archivedAt: true },
        });
        json(
          res,
          200,
          events.map((event) => ({
            ...event,
            rundowns: rundowns.filter(
              (r) => r.eventId === event.id && (includeArchived || !r.archivedAt),
            ),
          })),
        );
        return true;
      }

      if (req.method === "POST" && pathname === "/events") {
        const ctx = await authContext(handle, req);
        if (ctx?.kind !== "admin" && ctx?.kind !== "company") {
          json(res, 401, { error: "admin or company token required" });
          return true;
        }
        const body = await readJson(req);
        const createStart = String(body.startDate ?? new Date().toISOString().slice(0, 10));
        const createEnd = String(body.endDate ?? body.startDate ?? new Date().toISOString().slice(0, 10));
        if (createEnd < createStart) {
          json(res, 400, { error: "end date cannot be before the start date" });
          return true;
        }
        const id = ulid();
        const teamId =
          ctx.kind === "company"
            ? ctx.teamId
            : typeof body.teamId === "string" && body.teamId
              ? body.teamId
              : await defaultTeamId();
        await db.insert(schema.events).values({
          id,
          teamId,
          name: String(body.name ?? "Untitled Event"),
          location: body.location ? String(body.location) : null,
          startDate: createStart,
          endDate: createEnd,
          timezone: String(body.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone),
          use24h: Boolean(body.use24h ?? false),
        });
        json(res, 201, { id });
        return true;
      }

      if (req.method === "GET" && pathname === "/rundowns") {
        if (!(await requireAdmin())) return true;
        json(
          res,
          200,
          await db.query.rundowns.findMany({
            columns: { id: true, eventId: true, name: true, description: true, showDate: true },
          }),
        );
        return true;
      }

      if (req.method === "POST" && pathname === "/rundowns") {
        const body = await readJson(req);
        const eventId = String(body.eventId ?? "");
        if (!(await requireEventAccess(eventId))) return true;
        const event = await db.query.events.findFirst({ where: eq(schema.events.id, eventId) });
        if (!event) {
          json(res, 404, { error: "event not found" });
          return true;
        }

        const id = ulid();
        const name = String(body.name ?? "New Rundown");
        const plannedStartSec = typeof body.plannedStartSec === "number" ? body.plannedStartSec : 9 * 3600;

        let doc: Y.Doc;
        if (typeof body.templateId === "string" && body.templateId) {
          const template = await db.query.templates.findFirst({ where: eq(schema.templates.id, body.templateId) });
          if (!template) {
            json(res, 404, { error: "template not found" });
            return true;
          }
          doc = decodeDoc(template.doc);
          doc.getMap("meta").set("name", name);
          doc.getMap("meta").set("plannedStartSec", plannedStartSec);
        } else {
          const rows = Array.isArray(body.rows) && body.rows.length > 0
            ? (body.rows as SeedRow[])
            : ([{ type: "cue", title: "New item", durationSec: 60 }] as SeedRow[]);
          const extraColumns = Array.isArray(body.columns)
            ? (body.columns as { key: string; title: string }[]).filter(
                (c) => typeof c?.key === "string" && typeof c?.title === "string",
              )
            : [];
          const importRoles = Array.isArray(body.roles)
            ? (body.roles as { name: string; color: string }[]).filter(
                (r) => typeof r?.name === "string" && typeof r?.color === "string",
              )
            : [];
          doc = buildRundownDoc(
            rows,
            {
              name,
              plannedStartSec,
              use24h: event.use24h,
              roleColumnKey: typeof body.roleColumnKey === "string" && body.roleColumnKey ? body.roleColumnKey : null,
            },
            extraColumns,
            extraColumns.length > 0, // importer path: mirror the source sheet's columns exactly
            importRoles,
          );
        }

        const sourceFile = sourceFileValue(body.sourceFileB64);
        await db.insert(schema.rundowns).values({
          id,
          eventId,
          name,
          description: body.description ? String(body.description) : null,
          showDate: body.showDate ? String(body.showDate) : null,
          plannedStartSec,
          doc: encodeDoc(doc),
          docUpdatedAt: new Date(),
          sourceName: sourceFile && typeof body.sourceName === "string" ? body.sourceName.slice(0, 200) : null,
          sourceFile,
        });
        json(res, 201, { id });
        return true;
      }

      // The stored source sheet, for Update import to re-read with the current pipeline.
      if (req.method === "GET" && /^\/rundowns\/[^/]+\/source$/.test(pathname)) {
        const id = pathname.split("/")[2]!;
        if (!(await requireRundownManage(id))) return true;
        const row = await db.query.rundowns.findFirst({
          where: eq(schema.rundowns.id, id),
          columns: { sourceName: true, sourceFile: true },
        });
        if (!row?.sourceFile) {
          json(res, 404, { error: "no stored source sheet — drop the file again (imports now store it)" });
          return true;
        }
        res.statusCode = 200;
        res.setHeader("content-type", "application/octet-stream");
        res.setHeader("x-source-name", encodeURIComponent(row.sourceName ?? "sheet"));
        res.end(Buffer.from(row.sourceFile));
        return true;
      }

      // Update import: re-imported content replaces the SAME rundown — id,
      // links, join codes, and view links all keep working. The old content
      // is snapshotted first, and the doc-epoch bump kicks every open screen
      // onto the fresh document (identical mechanism to in-place restore).
      if (req.method === "POST" && /^\/rundowns\/[^/]+\/replace-content$/.test(pathname)) {
        const id = pathname.split("/")[2]!;
        if (!(await requireRundownManage(id))) return true;
        const body = await readJson(req);
        const rundown = await db.query.rundowns.findFirst({ where: eq(schema.rundowns.id, id) });
        if (!rundown) {
          json(res, 404, { error: "rundown not found" });
          return true;
        }
        const event = await db.query.events.findFirst({ where: eq(schema.events.id, rundown.eventId) });
        const rows = Array.isArray(body.rows) && body.rows.length > 0 ? (body.rows as SeedRow[]) : null;
        if (!rows) {
          json(res, 400, { error: "rows required" });
          return true;
        }
        const extraColumns = Array.isArray(body.columns)
          ? (body.columns as { key: string; title: string }[]).filter(
              (c) => typeof c?.key === "string" && typeof c?.title === "string",
            )
          : [];
        const importRoles = Array.isArray(body.roles)
          ? (body.roles as { name: string; color: string }[]).filter(
              (r) => typeof r?.name === "string" && typeof r?.color === "string",
            )
          : [];
        const plannedStartSec =
          typeof body.plannedStartSec === "number" ? body.plannedStartSec : rundown.plannedStartSec;
        if (rundown.doc)
          await db.insert(schema.rundownSnapshots).values({
            id: ulid(),
            rundownId: rundown.id,
            doc: rundown.doc,
            label: "Before update",
          });
        const doc = buildRundownDoc(
          rows,
          {
            name: rundown.name,
            plannedStartSec,
            use24h: event?.use24h ?? false,
            roleColumnKey: typeof body.roleColumnKey === "string" && body.roleColumnKey ? body.roleColumnKey : null,
          },
          extraColumns,
          extraColumns.length > 0,
          importRoles,
        );
        const epoch = rundown.docEpoch + 1;
        const sourceFile = sourceFileValue(body.sourceFileB64);
        await db
          .update(schema.rundowns)
          .set({
            doc: encodeDoc(doc),
            docEpoch: epoch,
            plannedStartSec,
            docUpdatedAt: new Date(),
            updatedAt: new Date(),
            // A newly dropped sheet replaces the stored source; re-reads keep it.
            ...(sourceFile
              ? { sourceFile, sourceName: typeof body.sourceName === "string" ? body.sourceName.slice(0, 200) : rundown.sourceName }
              : {}),
          })
          .where(eq(schema.rundowns.id, id));
        try {
          for (const name of docServer?.documents.keys() ?? []) {
            if (name === id || String(name).startsWith(`${id}@`)) docServer!.closeConnections(String(name));
          }
        } catch (err) {
          logServerError(handle, "server", err, { url: "replace-content closeConnections" });
        }
        json(res, 200, { id, epoch });
        return true;
      }

      if (req.method === "GET" && /^\/rundowns\/[^/]+\/join-codes$/.test(pathname)) {
        const rundownId = pathname.split("/")[2]!;
        if (!(await requireEditor(rundownId))) return true;
        const rows = await db.query.shareTokens.findMany({
          where: and(eq(schema.shareTokens.rundownId, rundownId), eq(schema.shareTokens.kind, "join")),
          columns: { id: true, joinCode: true, role: true, revokedAt: true },
        });
        json(res, 200, rows.filter((r) => !r.revokedAt).map(({ revokedAt: _r, ...rest }) => rest));
        return true;
      }

      if (req.method === "POST" && /^\/rundowns\/[^/]+\/join-codes$/.test(pathname)) {
        const rundownId = pathname.split("/")[2]!;
        if (!(await requireEditor(rundownId))) return true;
        const body = await readJson(req);
        const role = ["caller", "editor", "follower"].includes(String(body.role)) ? String(body.role) : "follower";
        // Readable code: no confusable characters.
        const alphabet = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
        const code = Array.from(
          { length: 6 },
          () => alphabet[Math.floor(Math.random() * alphabet.length)]!,
        ).join("");
        await db.insert(schema.shareTokens).values({
          id: ulid(),
          rundownId,
          kind: "join",
          token: ulid(),
          joinCode: code,
          role: role as (typeof schema.shareRoles)[number],
        });
        json(res, 201, { code, role });
        return true;
      }

      // As-run show report: sessions + transitions for a rundown (JSON or CSV).
      if (req.method === "GET" && /^\/rundowns\/[^/]+\/report/.test(pathname)) {
        const rundownId = pathname.split("/")[2]!.split("?")[0]!;
        if (!(await requireEditor(rundownId))) return true;
        const sessions = await db.query.showSessions.findMany({
          where: eq(schema.showSessions.rundownId, rundownId),
        });
        const report = [] as { session: string; startedAt: string; at: string; type: string; rowId: string | null }[];
        for (const session of sessions) {
          const transitions = await db.query.showTransitions.findMany({
            where: eq(schema.showTransitions.sessionId, session.id),
          });
          for (const t of transitions)
            report.push({
              session: session.id,
              startedAt: session.startedAt.toISOString(),
              at: t.at.toISOString(),
              type: t.type,
              rowId: t.rowId,
            });
        }
        report.sort((a, b) => a.at.localeCompare(b.at));
        if (url.searchParams.get("format") === "csv") {
          res.setHeader("content-type", "text/csv");
          res.end(
            serializeCsv([
              ["Session", "Session started", "At", "Action", "Row"],
              ...report.map((r) => [r.session, r.startedAt, r.at, r.type, r.rowId ?? ""]),
            ]),
          );
          return true;
        }
        json(res, 200, report);
        return true;
      }

      if (req.method === "POST" && pathname === "/guest-passes") {
        const body = await readJson(req);
        const rundownId = String(body.rundownId ?? "");
        if (!(await requireEditor(rundownId))) return true;
        const rundown = await db.query.rundowns.findFirst({ where: eq(schema.rundowns.id, rundownId) });
        if (!rundown) {
          json(res, 404, { error: "rundown not found" });
          return true;
        }
        const token = ulid();
        await db.insert(schema.shareTokens).values({
          id: ulid(),
          rundownId,
          kind: "guest",
          token,
          role: "guest",
          columnVisibility: (body.columns as Record<string, boolean> | undefined) ?? null,
        });
        json(res, 201, { token });
        return true;
      }

      // Guests get a server-filtered plain-JSON projection — never the CRDT.
      if (req.method === "GET" && pathname.startsWith("/guest/")) {
        const token = pathname.slice("/guest/".length);
        const pass = await db.query.shareTokens.findFirst({ where: eq(schema.shareTokens.token, token) });
        if (!pass || pass.kind !== "guest" || pass.revokedAt) {
          json(res, 404, { error: "invalid or revoked guest pass" });
          return true;
        }
        const rundown = await db.query.rundowns.findFirst({ where: eq(schema.rundowns.id, pass.rundownId) });
        if (!rundown?.doc) {
          json(res, 404, { error: "rundown not found" });
          return true;
        }
        const { meta, keyTimes, columns, rows } = projectRundownDoc(decodeDoc(rundown.doc));
        const visibility = pass.columnVisibility ?? {};
        const visibleColumns = columns.filter(
          (c) => c.kind !== "richtext" || visibility[c.key] !== false,
        );
        const visibleKeys = new Set(visibleColumns.map((c) => c.key));
        json(res, 200, {
          meta: {
            name: meta.name,
            use24h: meta.use24h,
            plannedStartSec: meta.plannedStartSec,
            versionLabel: meta.versionLabel || null,
            timezone: (await (async () => {
              const ev = await db.query.events.findFirst({
                where: eq(schema.events.id, rundown.eventId),
                columns: { timezone: true },
              });
              return ev?.timezone ?? null;
            })()),
          },
          keyTimes,
          lastUpdated: rundown.docUpdatedAt?.toISOString() ?? null,
          columns: visibleColumns,
          rows: rows.map((r) => ({
            id: r.id,
            type: r.type,
            title: r.title,
            // durationHidden means exactly this: hidden on shared views.
            durationSec: r.durationHidden ? null : r.durationSec,
            hardStartSec: r.hardStartSec,
            backtime: r.backtime ?? false,
            durationMuted: r.durationMuted ?? false,
            color: r.color ?? null,
            cells: Object.fromEntries(Object.entries(r.cells).filter(([key]) => visibleKeys.has(key))),
          })),
        });
        return true;
      }

      if (req.method === "GET" && /^\/rundowns\/[^/]+\/snapshots$/.test(pathname)) {
        const rundownId = pathname.split("/")[2]!;
        if (!(await requireEditor(rundownId))) return true;
        json(
          res,
          200,
          await db.query.rundownSnapshots.findMany({
            where: eq(schema.rundownSnapshots.rundownId, rundownId),
            columns: { id: true, label: true, createdAt: true },
          }),
        );
        return true;
      }

      if (req.method === "POST" && /^\/rundowns\/[^/]+\/snapshots$/.test(pathname)) {
        const rundownId = pathname.split("/")[2]!;
        if (!(await requireEditor(rundownId))) return true;
        const body = await readJson(req);
        const rundown = await db.query.rundowns.findFirst({ where: eq(schema.rundowns.id, rundownId) });
        if (!rundown?.doc) {
          json(res, 404, { error: "rundown not found" });
          return true;
        }
        const id = ulid();
        await db.insert(schema.rundownSnapshots).values({
          id,
          rundownId,
          doc: rundown.doc,
          label: body.label ? String(body.label) : null,
        });
        json(res, 201, { id });
        return true;
      }

      // The rundown's current doc epoch — clients scope their doc connection
      // to it (`<id>@<epoch>`); public, it's just a counter.
      if (req.method === "GET" && /^\/rundowns\/[^/]+\/epoch$/.test(pathname)) {
        const row = await db.query.rundowns.findFirst({
          where: eq(schema.rundowns.id, pathname.split("/")[2]!),
          columns: { docEpoch: true },
        });
        if (!row) {
          json(res, 404, { error: "rundown not found" });
          return true;
        }
        json(res, 200, { epoch: row.docEpoch });
        return true;
      }

      // In-place restore: replace the SAME rundown's doc with the snapshot.
      // Bumping the doc epoch invalidates every live connection, so no client
      // can merge pre-restore CRDT state back; they reconnect fresh.
      if (req.method === "POST" && /^\/snapshots\/[^/]+\/restore-in-place$/.test(pathname)) {
        const snapshotId = pathname.split("/")[2]!;
        const snapshot = await db.query.rundownSnapshots.findFirst({
          where: eq(schema.rundownSnapshots.id, snapshotId),
        });
        if (!snapshot) {
          json(res, 404, { error: "snapshot not found" });
          return true;
        }
        if (!(await requireEditor(snapshot.rundownId))) return true;
        const rundown = await db.query.rundowns.findFirst({ where: eq(schema.rundowns.id, snapshot.rundownId) });
        if (!rundown) {
          json(res, 404, { error: "rundown not found" });
          return true;
        }
        // Safety net: snapshot the pre-restore state first, so a restore is
        // itself reversible.
        if (rundown.doc)
          await db.insert(schema.rundownSnapshots).values({
            id: ulid(),
            rundownId: rundown.id,
            doc: rundown.doc,
            label: "Before restore",
          });
        const epoch = rundown.docEpoch + 1;
        await db
          .update(schema.rundowns)
          .set({ doc: snapshot.doc, docEpoch: epoch, docUpdatedAt: new Date(), updatedAt: new Date() })
          .where(eq(schema.rundowns.id, rundown.id));
        // Kick live connections on the old epoch (and legacy bare-id docs).
        try {
          for (const name of docServer?.documents.keys() ?? []) {
            if (name === rundown.id || String(name).startsWith(`${rundown.id}@`)) docServer!.closeConnections(String(name));
          }
        } catch (err) {
          logServerError(handle, "server", err, { url: "restore-in-place closeConnections" });
        }
        json(res, 200, { id: rundown.id, epoch });
        return true;
      }

      // Restore-as-copy: the snapshot becomes a NEW rundown alongside the
      // original (useful for comparing versions side by side).
      if (req.method === "POST" && /^\/snapshots\/[^/]+\/restore$/.test(pathname)) {
        const snapshotId = pathname.split("/")[2]!;
        const body = await readJson(req);
        const snapshot = await db.query.rundownSnapshots.findFirst({
          where: eq(schema.rundownSnapshots.id, snapshotId),
        });
        if (!snapshot) {
          json(res, 404, { error: "snapshot not found" });
          return true;
        }
        if (!(await requireEditor(snapshot.rundownId))) return true;
        const source = await db.query.rundowns.findFirst({ where: eq(schema.rundowns.id, snapshot.rundownId) });
        if (!source) {
          json(res, 404, { error: "source rundown not found" });
          return true;
        }
        const id = ulid();
        const name = String(body.name ?? `${source.name} (restored)`);
        const doc = decodeDoc(snapshot.doc);
        doc.getMap("meta").set("name", name);
        await db.insert(schema.rundowns).values({
          id,
          eventId: source.eventId,
          name,
          description: source.description,
          showDate: source.showDate,
          plannedStartSec: source.plannedStartSec,
          doc: encodeDoc(doc),
          docUpdatedAt: new Date(),
        });
        json(res, 201, { id });
        return true;
      }

      if (req.method === "GET" && pathname === "/templates") {
        const ctx = await authContext(handle, req);
        if (ctx?.kind !== "admin" && ctx?.kind !== "company") {
          json(res, 401, { error: "admin or company token required" });
          return true;
        }
        const all = await db.query.templates.findMany({
          columns: { id: true, name: true, description: true, teamId: true },
        });
        json(
          res,
          200,
          all
            .filter((t) => ctx.kind === "admin" || t.teamId === ctx.teamId)
            .map(({ teamId: _t, ...rest }) => rest),
        );
        return true;
      }

      if (req.method === "POST" && pathname === "/templates") {
        const body = await readJson(req);
        if (!(await requireEditor(String(body.rundownId ?? "")))) return true;
        const rundown = await db.query.rundowns.findFirst({
          where: eq(schema.rundowns.id, String(body.rundownId ?? "")),
        });
        if (!rundown?.doc) {
          json(res, 404, { error: "rundown not found" });
          return true;
        }
        const id = ulid();
        await db.insert(schema.templates).values({
          id,
          teamId: await defaultTeamId(),
          name: String(body.name ?? `${rundown.name} (template)`),
          description: body.description ? String(body.description) : null,
          doc: rundown.doc,
        });
        json(res, 201, { id });
        return true;
      }
    } catch (err) {
      logServerError(handle, "server", err, { url: `${req.method} ${pathname}` });
      json(res, 500, { error: String(err) });
      return true;
    }
    return false;
  };
}
