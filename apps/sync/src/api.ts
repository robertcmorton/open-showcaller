import type { IncomingMessage, ServerResponse } from "node:http";
import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";
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
    res.setHeader("access-control-allow-headers", "content-type");
    res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return true;
    }

    try {
      if (req.method === "GET" && pathname === "/events") {
        const events = await db.query.events.findMany();
        const rundowns = await db.query.rundowns.findMany({
          columns: { id: true, eventId: true, name: true, description: true, showDate: true },
        });
        json(
          res,
          200,
          events.map((event) => ({
            ...event,
            rundowns: rundowns.filter((r) => r.eventId === event.id),
          })),
        );
        return true;
      }

      if (req.method === "POST" && pathname === "/events") {
        const body = await readJson(req);
        const id = ulid();
        await db.insert(schema.events).values({
          id,
          teamId: await defaultTeamId(),
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
          doc = buildRundownDoc(rows, { name, plannedStartSec, use24h: event.use24h });
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
        const rows = await db.query.shareTokens.findMany({
          where: and(eq(schema.shareTokens.rundownId, rundownId), eq(schema.shareTokens.kind, "join")),
          columns: { id: true, joinCode: true, role: true, revokedAt: true },
        });
        json(res, 200, rows.filter((r) => !r.revokedAt).map(({ revokedAt: _r, ...rest }) => rest));
        return true;
      }

      if (req.method === "POST" && /^\/rundowns\/[^/]+\/join-codes$/.test(pathname)) {
        const rundownId = pathname.split("/")[2]!;
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
        const { meta, columns, rows } = projectRundownDoc(decodeDoc(rundown.doc));
        const visibility = pass.columnVisibility ?? {};
        const visibleColumns = columns.filter(
          (c) => c.kind !== "richtext" || visibility[c.key] !== false,
        );
        const visibleKeys = new Set(visibleColumns.map((c) => c.key));
        json(res, 200, {
          meta: { name: meta.name, use24h: meta.use24h, plannedStartSec: meta.plannedStartSec },
          lastUpdated: rundown.docUpdatedAt?.toISOString() ?? null,
          columns: visibleColumns,
          rows: rows.map((r) => ({
            id: r.id,
            type: r.type,
            title: r.title,
            durationSec: r.durationSec,
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
        json(
          res,
          200,
          await db.query.templates.findMany({ columns: { id: true, name: true, description: true } }),
        );
        return true;
      }

      if (req.method === "POST" && pathname === "/templates") {
        const body = await readJson(req);
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
