import { WebSocketServer, WebSocket } from "ws";
import {
  CloseCodes,
  PROTOCOL_VERSION,
  parseClientMsg,
  type Role,
  type ServerMsg,
} from "@open-showcaller/protocol";
import { ShowStateMachine } from "./show";

const PORT = Number(process.env.SYNC_PORT ?? 8787);
const HELLO_TIMEOUT_MS = 5000;
const HEARTBEAT_MS = 15000;

interface ClientCtx {
  role: Role;
  rundownId: string;
  device: "console" | "companion";
}

const shows = new Map<string, ShowStateMachine>();
const clients = new Map<WebSocket, ClientCtx>();
const seenCmdIds = new Map<string, string[]>(); // rundownId → last 100 command ids

const showFor = (rundownId: string): ShowStateMachine => {
  let machine = shows.get(rundownId);
  if (!machine) {
    machine = new ShowStateMachine();
    shows.set(rundownId, machine);
  }
  return machine;
};

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
 * Phase-1 auth stub: session tokens → caller, join codes → follower, guest
 * tokens → guest. Phase 4 replaces this with real token/share-code lookup
 * against Postgres and per-rundown routing.
 */
function resolveRole(auth: { kind: string }): { role: Role; label: string } {
  switch (auth.kind) {
    case "session":
      return { role: "caller", label: "Caller" };
    case "join":
      return { role: "follower", label: "Crew" };
    default:
      return { role: "guest", label: "Guest" };
  }
}

const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const rundownId = url.searchParams.get("rundown") ?? "";

  const helloTimer = setTimeout(() => ws.close(CloseCodes.AUTH_FAILED, "hello timeout"), HELLO_TIMEOUT_MS);

  ws.on("message", (raw) => {
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
      const { role, label } = resolveRole(msg.auth);
      clients.set(ws, { role, rundownId, device: msg.device });
      send(ws, {
        v: PROTOCOL_VERSION,
        t: "welcome",
        role,
        userLabel: label,
        serverTimeMs: Date.now(),
        show: showFor(rundownId).current,
        doc: { mode: role === "guest" ? "projection" : "sync" },
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

      const result = showFor(ctx.rundownId).apply(msg.action, msg.rowId);
      if (typeof result === "string") {
        send(ws, { v: PROTOCOL_VERSION, t: "cmd_error", id: msg.id, code: 400, msg: result });
        return;
      }
      // No fast path for the caller: everyone (including the sender) gets the broadcast.
      broadcast(ctx.rundownId, { v: PROTOCOL_VERSION, t: "show_state", ...result });
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

console.log(`[sync] listening on ws://localhost:${PORT}  (protocol v${PROTOCOL_VERSION})`);
