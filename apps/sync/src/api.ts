import type { IncomingMessage, ServerResponse } from "node:http";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import {
  buildRundownDoc,
  decodeDoc,
  encodeDoc,
  schema,
  type DbHandle,
  type SeedRow,
} from "@open-showcaller/db";
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
