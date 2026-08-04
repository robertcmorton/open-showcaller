import type { IncomingMessage, ServerResponse } from "node:http";
import { and, eq, ne, inArray } from "drizzle-orm";
import { ulid } from "ulid";
import { authContext, bearerToken, resolveBearer, resolveJoinCode, teamIdForEvent, teamIdForRundown } from "./auth";
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
export function createApiHandler(handle: DbHandle) {
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

    /** Admin or the company that owns the event. */
    const requireEventAccess = async (eventId: string): Promise<boolean> => {
      const ctx = await authContext(handle, req);
      if (ctx?.kind === "admin") return true;
      if (ctx?.kind === "company" && (await teamIdForEvent(handle, eventId)) === ctx.teamId) return true;
      json(res, 401, { error: "company access required" });
      return false;
    };

    /** Structural rundown changes: admin or the owning company (editors change content, not structure). */
    const requireRundownManage = async (rundownId: string): Promise<boolean> => {
      const ctx = await authContext(handle, req);
      if (ctx?.kind === "admin") return true;
      if (ctx?.kind === "company" && (await teamIdForRundown(handle, rundownId)) === ctx.teamId) return true;
      json(res, 401, { error: "company access required" });
      return false;
    };

    /** Rundown-scoped panels/content: admin, owning company, or a caller/editor code. */
    const requireEditor = async (rundownId: string): Promise<boolean> => {
      const ctx = await authContext(handle, req, rundownId);
      if (ctx?.kind === "admin") return true;
      if (ctx?.kind === "company" && (await teamIdForRundown(handle, rundownId)) === ctx.teamId) return true;
      if (ctx?.kind === "code" && ctx.rundownId === rundownId && ctx.role !== "follower") return true;
      json(res, 401, { error: "editor access required" });
      return false;
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
        if (ctx?.kind !== "admin" && ctx?.kind !== "company") {
          json(res, 401, { error: "admin or company token required" });
          return true;
        }
        let sessions = await db.query.showSessions.findMany({
          where: ne(schema.showSessions.state, "ended"),
          columns: { rundownId: true, state: true, startedAt: true },
        });
        if (ctx.kind === "company") {
          const scoped: typeof sessions = [];
          for (const session of sessions)
            if ((await teamIdForRundown(handle, session.rundownId)) === ctx.teamId) scoped.push(session);
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
        else json(res, 200, { role: null });
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

      if (req.method === "PATCH" && /^\/companies\/[^/]+$/.test(pathname)) {
        if (!(await requireAdmin())) return true;
        const id = pathname.split("/")[2]!;
        const body = await readJson(req);
        if (typeof body.name === "string" && body.name.trim())
          await db.update(schema.teams).set({ name: body.name.trim() }).where(eq(schema.teams.id, id));
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
        if (ctx?.kind !== "admin" && ctx?.kind !== "company") {
          json(res, 401, { error: "admin or company token required" });
          return true;
        }
        const includeArchived = url.searchParams.get("archived") === "1";
        const events = (await db.query.events.findMany()).filter(
          (e) =>
            (ctx.kind === "admin" || e.teamId === ctx.teamId) &&
            (includeArchived || !e.archivedAt),
        );
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
          startDate: String(body.startDate ?? new Date().toISOString().slice(0, 10)),
          endDate: String(body.endDate ?? body.startDate ?? new Date().toISOString().slice(0, 10)),
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
          doc = buildRundownDoc(rows, { name, plannedStartSec, use24h: event.use24h }, extraColumns);
        }

        await db.insert(schema.rundowns).values({
          id,
          eventId,
          name,
          description: body.description ? String(body.description) : null,
          showDate: body.showDate ? String(body.showDate) : null,
          plannedStartSec,
          doc: encodeDoc(doc),
          docUpdatedAt: new Date(),
        });
        json(res, 201, { id });
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

      // Restore = copy the snapshot into a NEW rundown. In-place restore of a
      // live CRDT would merge old state back from connected clients; a fresh
      // rundown id sidesteps that entirely (in-place restore lands with the
      // doc-epoch mechanism in the hardening pass).
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
      json(res, 500, { error: String(err) });
      return true;
    }
    return false;
  };
}
