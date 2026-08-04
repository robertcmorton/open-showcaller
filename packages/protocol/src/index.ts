import { z } from "zod";

/** Wire protocol version. Bumps only on breaking changes — see PROTOCOL.md. */
export const PROTOCOL_VERSION = 1;

// "admin" sits above the per-show roles: it is granted only by the server's
// ADMIN_TOKEN (never stored in share_tokens) and can act across shows.
export const Role = z.enum(["admin", "caller", "editor", "follower", "guest"]);
export type Role = z.infer<typeof Role>;

export const ShowStateName = z.enum(["idle", "running", "paused", "ended"]);
export type ShowStateName = z.infer<typeof ShowStateName>;

const envelope = { v: z.literal(PROTOCOL_VERSION) };

// ── Client → Server ────────────────────────────────────────────────────────────

export const HelloMsg = z.object({
  ...envelope,
  t: z.literal("hello"),
  auth: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("session"), token: z.string().min(1) }),
    z.object({ kind: z.literal("join"), code: z.string().min(4).max(12) }),
    z.object({ kind: z.literal("guest"), token: z.string().min(1) }),
  ]),
  device: z.enum(["console", "companion"]),
  lastSeq: z.number().int().nonnegative().optional(),
});

export const PingMsg = z.object({ ...envelope, t: z.literal("ping"), t0: z.number() });

export const CmdAction = z.enum(["start", "pause", "resume", "next", "prev", "jump", "stop"]);
export type CmdAction = z.infer<typeof CmdAction>;

export const CmdMsg = z
  .object({
    ...envelope,
    t: z.literal("cmd"),
    id: z.string().min(1),
    action: CmdAction,
    rowId: z.string().optional(),
    confirm: z.boolean().optional(),
  })
  .refine((m) => m.action !== "jump" || !!m.rowId, { message: "jump requires rowId" })
  .refine((m) => m.action !== "stop" || m.confirm === true, { message: "stop requires confirm" });

export const ClientMsg = z.union([HelloMsg, PingMsg, CmdMsg]);
export type ClientMsg = z.infer<typeof ClientMsg>;

// ── Server → Client ────────────────────────────────────────────────────────────

export const ShowStatePayload = z.object({
  seq: z.number().int().nonnegative(),
  state: ShowStateName,
  sessionId: z.string().nullable(),
  activeRowId: z.string().nullable(),
  activeRowStartedAtMs: z.number().nullable(),
  pausedAtMs: z.number().nullable(),
  pausedAccumMs: z.number().nonnegative(),
  sessionStartedAtMs: z.number().nullable(),
});
export type ShowStatePayload = z.infer<typeof ShowStatePayload>;

export const WelcomeMsg = z.object({
  ...envelope,
  t: z.literal("welcome"),
  role: Role,
  userLabel: z.string(),
  serverTimeMs: z.number(),
  show: ShowStatePayload,
  doc: z.object({ mode: z.enum(["sync", "projection"]) }),
});

export const PongMsg = z.object({ ...envelope, t: z.literal("pong"), t0: z.number(), t1: z.number() });

export const ShowStateMsg = z.object({ ...envelope, t: z.literal("show_state") }).and(ShowStatePayload);

export const CmdErrorMsg = z.object({
  ...envelope,
  t: z.literal("cmd_error"),
  id: z.string(),
  code: z.number().int(),
  msg: z.string(),
});

export const DocProjectionMsg = z.object({
  ...envelope,
  t: z.literal("doc_projection"),
  rev: z.number().int().nonnegative(),
  columns: z.array(z.object({ id: z.string(), title: z.string(), kind: z.string() })),
  rows: z.array(
    z.object({
      id: z.string(),
      type: z.enum(["cue", "group"]),
      startSec: z.number().nullable(),
      durationSec: z.number().nullable(),
      cells: z.record(z.string()),
    }),
  ),
});

export const PresenceMsg = z.object({
  ...envelope,
  t: z.literal("presence"),
  counts: z.record(Role, z.number().int().nonnegative()),
});

export const HeartbeatMsg = z.object({ ...envelope, t: z.literal("hb") });

export const ErrorMsg = z.object({
  ...envelope,
  t: z.literal("error"),
  code: z.number().int(),
  msg: z.string(),
});

export const ServerMsg = z.union([
  WelcomeMsg,
  PongMsg,
  ShowStateMsg,
  CmdErrorMsg,
  DocProjectionMsg,
  PresenceMsg,
  HeartbeatMsg,
  ErrorMsg,
]);
export type ServerMsg = z.infer<typeof ServerMsg>;

// ── Close codes (PROTOCOL.md §8) ───────────────────────────────────────────────

export const CloseCodes = {
  BAD_VERSION: 4000,
  AUTH_FAILED: 4001,
  FORBIDDEN: 4003,
  UNKNOWN_RUNDOWN: 4004,
  TOKEN_REVOKED: 4009,
  RATE_LIMITED: 4029,
} as const;

/** Parse an incoming client frame; returns undefined for unknown/invalid frames. */
export function parseClientMsg(raw: string): ClientMsg | undefined {
  try {
    const parsed = ClientMsg.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
