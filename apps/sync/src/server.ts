import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import {
  CloseCodes,
  PROTOCOL_VERSION,
  parseClientMsg,
  type Role,
  type ServerMsg,
} from "@opencall/protocol";
import { createDb, ensureSchema, schema } from "@opencall/db";
import { and, eq, isNull } from "drizzle-orm";
import { ulid } from "ulid";
import { createDocServer } from "./doc-server";
import { createApiHandler, logServerError } from "./api";
import { PersistentShowStore } from "./sessions";
import * as authMod from "./auth";

// One public port for everything: HTTP API, the show channel (default ws
// path), and Yjs doc sync (ws path /doc). PORT is what PaaS hosts inject.
const PORT = Number(process.env.PORT ?? process.env.SYNC_PORT ?? 8787);
const HELLO_TIMEOUT_MS = 5000;
const HEARTBEAT_MS = 15000;

// PGlite lives at the repo root so seed + sync share one database in dev.
const dbHandle = await createDb(process.env.DATABASE_URL, fileURLToPath(new URL("../../../.pglite", import.meta.url)));
// Fresh databases self-initialize (idempotent DDL).
await ensureSchema(dbHandle.db);

interface ClientCtx {
  role: Role;
  rundownId: string;
  device: "console" | "companion";
}

const showStore = new PersistentShowStore(dbHandle);
const clients = new Map<WebSocket, ClientCtx>();
const seenCmdIds = new Map<string, string[]>(); // rundownId → last 100 command ids

const send = (ws: WebSocket, msg: ServerMsg): void => {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
};

const broadcast = (rundownId: string, msg: ServerMsg): void => {
  for (const [ws, ctx] of clients) if (ctx.rundownId === rundownId) send(ws, msg);
};

const broadcastPresence = (rundownId: string): void => {
  const counts: Partial<Record<Role, number>> = {};
  for (const ctx of clients.values())
    if (ctx.rundownId === rundownId) counts[ctx.role] = (counts[ctx.role] ?? 0) + 1;
  broadcast(rundownId, { v: PROTOCOL_VERSION, t: "presence", counts });
};

/**
 * Auth: join codes and guest tokens validate against share_tokens; the
 * ADMIN_TOKEN env var (sent as a session token) grants "admin". When
 * ADMIN_TOKEN is unset the deployment is dev-open and session tokens fall
 * back to "caller" (the pre-accounts stub). The literal join code DEV123
 * stays as a local-dev fallback unless disabled via ALLOW_DEV_JOIN=0.
 */
async function resolveAuth(
  auth: { kind: "session"; token: string } | { kind: "join"; code: string } | { kind: "guest"; token: string },
  rundownId: string,
): Promise<{ role: Role; label: string } | null> {
  if (auth.kind === "session") {
    if (auth.token && auth.token === authMod.adminToken()) return { role: "admin", label: "Admin" };
    if (authMod.isOpenAccess()) return { role: "caller", label: "Caller" };
    // Company (showcaller) tokens call shows within their own company only.
    const bearer = await authMod.resolveBearer(dbHandle, auth.token);
    if (bearer?.kind === "company" && (await authMod.teamIdForRundown(dbHandle, rundownId)) === bearer.teamId)
      return { role: "caller", label: bearer.teamName };
    // User accounts: managers call, view-grants follow.
    if (bearer?.kind === "user") {
      const rundown = await dbHandle.db.query.rundowns.findFirst({
        where: eq(schema.rundowns.id, rundownId),
        columns: { eventId: true },
      });
      if (rundown) {
        if (await authMod.canManageEvent(dbHandle, bearer, rundown.eventId))
          return { role: "caller", label: bearer.name };
        const event = await dbHandle.db.query.events.findFirst({
          where: eq(schema.events.id, rundown.eventId),
          columns: { teamId: true },
        });
        if (event && (await authMod.canSeeEvent(dbHandle, bearer, rundown.eventId, event.teamId)))
          return { role: "follower", label: bearer.name };
      }
    }
    return null;
  }
  if (auth.kind === "join") {
    const row = await dbHandle.db.query.shareTokens.findFirst({
      where: and(
        eq(schema.shareTokens.joinCode, auth.code.toUpperCase()),
        eq(schema.shareTokens.rundownId, rundownId),
        eq(schema.shareTokens.kind, "join"),
        isNull(schema.shareTokens.revokedAt),
      ),
    });
    if (row) return { role: row.role as Role, label: row.role === "caller" ? "Caller" : "Crew" };
    if (auth.code === "DEV123" && process.env.ALLOW_DEV_JOIN !== "0") return { role: "follower", label: "Crew (dev)" };
    return null;
  }
  const row = await dbHandle.db.query.shareTokens.findFirst({
    where: and(
      eq(schema.shareTokens.token, auth.token),
      eq(schema.shareTokens.kind, "guest"),
      isNull(schema.shareTokens.revokedAt),
    ),
  });
  return row && row.rundownId === rundownId ? { role: "guest", label: "Guest" } : null;
}

// Crash-level errors land in the same journal the admin dashboard reads.
process.on("uncaughtException", (err) => {
  console.error("[sync] uncaught exception:", err);
  logServerError(dbHandle, "process", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[sync] unhandled rejection:", reason);
  logServerError(dbHandle, "process", reason);
});

// HTTP: JSON API for the web app (dev-open; real auth in the hardening pass).
const handleApi = createApiHandler(dbHandle);
const httpServer = createServer(async (req, res) => {
  try {
    const handled = await handleApi(req, res);
    if (!handled) {
      res.statusCode = 404;
      res.end("not found");
    }
  } catch (err) {
    logServerError(dbHandle, "server", err, { url: `${req.method} ${req.url}` });
    if (!res.headersSent) res.statusCode = 500;
    res.end("server error");
  }
});

const docServer = createDocServer(dbHandle);
const wss = new WebSocketServer({ noServer: true });
const docWss = new WebSocketServer({ noServer: true });

httpServer.on("upgrade", (req, socket, head) => {
  const { pathname } = new URL(req.url ?? "/", "http://localhost");
  if (pathname === "/doc" || pathname.startsWith("/doc/")) {
    docWss.handleUpgrade(req, socket, head, (ws) => {
      docServer.handleConnection(ws, req);
    });
  } else {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  }
});

wss.on("connection", (ws, req) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const rundownId = url.searchParams.get("rundown") ?? "";

  const helloTimer = setTimeout(() => ws.close(CloseCodes.AUTH_FAILED, "hello timeout"), HELLO_TIMEOUT_MS);

  ws.on("message", async (raw) => {
    const msg = parseClientMsg(String(raw));
    if (!msg) return; // unknown/invalid frames are ignored (forward compatibility)

    const ctx = clients.get(ws);

    if (msg.t === "hello") {
      if (ctx) return;
      clearTimeout(helloTimer);
      if (!rundownId) {
        ws.close(CloseCodes.UNKNOWN_RUNDOWN, "missing rundown");
        return;
      }
      const resolved = await resolveAuth(msg.auth, rundownId);
      if (!resolved) {
        ws.close(CloseCodes.AUTH_FAILED, "invalid credentials");
        return;
      }
      clients.set(ws, { role: resolved.role, rundownId, device: msg.device });
      // The event's location decides the timezone every clock renders in.
      const rundownRow = await dbHandle.db.query.rundowns.findFirst({
        where: eq(schema.rundowns.id, rundownId),
        columns: { eventId: true },
      });
      const eventRow = rundownRow
        ? await dbHandle.db.query.events.findFirst({
            where: eq(schema.events.id, rundownRow.eventId),
            columns: { timezone: true },
          })
        : null;
      send(ws, {
        v: PROTOCOL_VERSION,
        t: "welcome",
        role: resolved.role,
        userLabel: resolved.label,
        serverTimeMs: Date.now(),
        show: (await showStore.get(rundownId)).current,
        doc: { mode: resolved.role === "guest" ? "projection" : "sync" },
        timezone: eventRow?.timezone,
      });
      broadcastPresence(rundownId);
      return;
    }

    if (!ctx) return; // everything else requires a completed hello

    if (msg.t === "ping") {
      send(ws, { v: PROTOCOL_VERSION, t: "pong", t0: msg.t0, t1: Date.now() });
      return;
    }

    if (msg.t === "cmd") {
      if (ctx.role !== "caller" && ctx.role !== "admin") {
        send(ws, { v: PROTOCOL_VERSION, t: "cmd_error", id: msg.id, code: CloseCodes.FORBIDDEN, msg: "caller role required" });
        return;
      }
      const seen = seenCmdIds.get(ctx.rundownId) ?? [];
      if (seen.includes(msg.id)) return; // idempotent retry
      seen.push(msg.id);
      if (seen.length > 100) seen.shift();
      seenCmdIds.set(ctx.rundownId, seen);

      // Pool-cue fire: as-run log entry only, never a state transition.
      if (msg.action === "fire") {
        const logged = await showStore.logFire(ctx.rundownId, msg.rowId!);
        if (!logged)
          send(ws, { v: PROTOCOL_VERSION, t: "cmd_error", id: msg.id, code: 400, msg: "no live session to fire into" });
        return;
      }

      const result = (await showStore.get(ctx.rundownId)).apply(msg.action, msg.rowId);
      if (typeof result === "string") {
        send(ws, { v: PROTOCOL_VERSION, t: "cmd_error", id: msg.id, code: 400, msg: result });
        return;
      }
      // No fast path for the caller: everyone (including the sender) gets the broadcast.
      broadcast(ctx.rundownId, { v: PROTOCOL_VERSION, t: "show_state", ...result });
      showStore.persist(ctx.rundownId, result, msg.action, msg.rowId);

      // Automatic safety snapshot the moment a show goes live.
      if (msg.action === "start") {
        void (async () => {
          const rundown = await dbHandle.db.query.rundowns.findFirst({
            where: eq(schema.rundowns.id, ctx.rundownId),
            columns: { doc: true },
          });
          if (rundown?.doc)
            await dbHandle.db.insert(schema.rundownSnapshots).values({
              id: ulid(),
              rundownId: ctx.rundownId,
              doc: rundown.doc,
              label: "Show start",
            });
        })().catch((err) => console.error("[sync] show-start snapshot failed:", err));
      }
    }
  });

  ws.on("close", () => {
    const ctx = clients.get(ws);
    clients.delete(ws);
    if (ctx) broadcastPresence(ctx.rundownId);
  });
});

const heartbeat = setInterval(() => {
  for (const [ws] of clients) send(ws, { v: PROTOCOL_VERSION, t: "hb" });
}, HEARTBEAT_MS);
heartbeat.unref();

httpServer.listen(PORT, () => {
  console.log(`[sync] api + show channel + /doc channel on :${PORT}  (protocol v${PROTOCOL_VERSION})`);
});
