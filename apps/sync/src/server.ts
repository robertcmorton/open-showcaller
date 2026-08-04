import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import {
  CloseCodes,
  PROTOCOL_VERSION,
  parseClientMsg,
  type Role,
  type ServerMsg,
} from "@open-showcaller/protocol";
import { createDb, schema } from "@open-showcaller/db";
import { and, eq, isNull } from "drizzle-orm";
import { ulid } from "ulid";
import { createDocServer } from "./doc-server";
import { createApiHandler } from "./api";
import { PersistentShowStore } from "./sessions";

const PORT = Number(process.env.SYNC_PORT ?? 8787);
const DOC_PORT = Number(process.env.DOC_PORT ?? 8788);
const HELLO_TIMEOUT_MS = 5000;
const HEARTBEAT_MS = 15000;

// PGlite lives at the repo root so seed + sync share one database in dev.
const dbHandle = await createDb(process.env.DATABASE_URL, fileURLToPath(new URL("../../../.pglite", import.meta.url)));

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
 * Auth: join codes and guest tokens validate against share_tokens. Session
 * tokens remain a dev stub (→ caller) until Auth.js accounts land. The
 * literal join code DEV123 stays as a local-dev fallback unless disabled
 * via ALLOW_DEV_JOIN=0.
 */
async function resolveAuth(
  auth: { kind: "session"; token: string } | { kind: "join"; code: string } | { kind: "guest"; token: string },
  rundownId: string,
): Promise<{ role: Role; label: string } | null> {
  if (auth.kind === "session") return { role: "caller", label: "Caller" };
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

// HTTP: JSON API for the web app (dev-open; real auth in the hardening pass).
const handleApi = createApiHandler(dbHandle);
const httpServer = createServer(async (req, res) => {
  const handled = await handleApi(req, res);
  if (!handled) {
    res.statusCode = 404;
    res.end("not found");
  }
});

const wss = new WebSocketServer({ server: httpServer });

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
      send(ws, {
        v: PROTOCOL_VERSION,
        t: "welcome",
        role: resolved.role,
        userLabel: resolved.label,
        serverTimeMs: Date.now(),
        show: (await showStore.get(rundownId)).current,
        doc: { mode: resolved.role === "guest" ? "projection" : "sync" },
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
      if (ctx.role !== "caller") {
        send(ws, { v: PROTOCOL_VERSION, t: "cmd_error", id: msg.id, code: CloseCodes.FORBIDDEN, msg: "caller role required" });
        return;
      }
      const seen = seenCmdIds.get(ctx.rundownId) ?? [];
      if (seen.includes(msg.id)) return; // idempotent retry
      seen.push(msg.id);
      if (seen.length > 100) seen.shift();
      seenCmdIds.set(ctx.rundownId, seen);

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
  console.log(`[sync] show channel + api on ws://localhost:${PORT}  (protocol v${PROTOCOL_VERSION})`);
});

const docServer = createDocServer(dbHandle, DOC_PORT);
void docServer.listen().then(() => {
  console.log(`[sync] doc channel on ws://localhost:${DOC_PORT}`);
});
