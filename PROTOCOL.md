# OpenCall Realtime Protocol — v1 (draft)

Status: **proposal for review** (Phase 1 gate). This document is the contract native clients
(future iOS/Android) will be written against; the web app has no privileged access.

## 0. Transport

One WebSocket per client to the sync server: `wss://<host>/ws?rundown=<id>`.
Two logical channels are multiplexed on it:

- **`doc`** — Yjs sync + awareness for the rundown document (binary frames, standard
  y-protocols encoding, proxied by Hocuspocus). Editors/callers read-write; followers read-only
  (server drops their update messages). **Guests do not get this channel at all** (§5).
- **`show`** — JSON text frames for authentication, show state, clock sync, presence.
  Every message is a Zod-validated envelope:

```json
{ "v": 1, "t": "<type>", ... }
```

Unknown `t` → ignore (forward compatibility). Wrong `v` → server closes with code `4000`.

## 1. Session establishment

Client sends first frame within 5 s of connecting:

```json
{ "v": 1, "t": "hello",
  "auth": { "kind": "session", "token": "<cookie/jwt>" }        // signed-in user
        | { "kind": "join",    "code":  "ABC123" }              // crew join-code / QR
        | { "kind": "guest",   "token": "<guest share token>" },
  "device": "console" | "companion",
  "lastSeq": 41 }                                                // optional, on reconnect
```

Server replies:

```json
{ "v": 1, "t": "welcome",
  "role": "admin" | "caller" | "editor" | "follower" | "guest",
  "userLabel": "K. B.",
  "serverTimeMs": 1791234567890,
  "show": { ...show_state payload, see §3... },
  "doc": { "mode": "sync" | "projection" } }
```

`welcome` always carries the *full* current show state — reconnect resync is therefore a
single round trip and needs no server-side per-client memory. Auth failure → `error` + close.

## 2. Clock sync

Countdowns are computed **locally on every device from a measured server-clock offset**.
Ticks are never sent over the wire.

```json
→ { "v":1, "t":"ping", "t0": <client ms> }
← { "v":1, "t":"pong", "t0": <echoed>, "t1": <server ms> }
```

offset = t1 + rtt/2 − now, with rtt = now − t0. Clients take 5 samples at connect, keep the
median, refresh every 60 s and after every reconnect. Display rule: all times derive from
`serverNow() = Date.now() + offset`.

## 3. Show state

Single authoritative object, broadcast in full on every change (it is tiny; no deltas):

```json
{ "v": 1, "t": "show_state", "seq": 42,
  "state": "idle" | "running" | "paused" | "ended",
  "sessionId": "01J...",
  "activeRowId": "01J..." | null,
  "activeRowStartedAtMs": 1791234500000 | null,
  "pausedAtMs": null,
  "pausedAccumMs": 0,
  "sessionStartedAtMs": 1791234000000 | null }
```

- `seq` is monotonic per rundown; clients discard any `show_state` with `seq` ≤ last seen.
- Elapsed-in-row = `serverNow() − activeRowStartedAtMs − pausedAccumMs` (frozen while paused).
  Over/under and show drift come from this plus the plan (durations from the doc projection).
- `idle` is the synthetic state when no live session exists.

## 4. Transport commands (Caller only)

```json
→ { "v":1, "t":"cmd", "id":"<ulid>", 
    "action": "start" | "pause" | "resume" | "next" | "prev" | "jump" | "stop",
    "rowId": "01J..." }            // jump only
```

- Server validates role = `caller` (or `admin`), applies to the session, bumps `seq`, persists the
  transition, broadcasts `show_state` to all clients (including the sender — the sender has
  no special path; UI updates when the broadcast arrives, keeping every device identical).
- Reply to sender only on failure: `{ "t":"cmd_error", "id", "code", "msg" }`.
- `id` makes commands idempotent across reconnect retries; server keeps the last 100 ids.
- `stop` requires `{ "confirm": true }` — the UI's confirm dialog maps to a protocol field.

## 5. Guest projection (`doc.mode = "projection"`)

Guests never receive the CRDT (a Yjs update stream cannot have columns redacted — the doc is
all-or-nothing). Instead the server pushes a filtered plain-JSON projection, debounced 500 ms
after doc changes:

```json
{ "v":1, "t":"doc_projection", "rev": 7,
  "columns": [ {"id","title","kind"} ],                       // visibility-filtered
  "rows": [ {"id","type","startSec","durationSec","cells":{colId: html}} ] }
```

Followers, by contrast, are trusted crew: they get the real `doc` channel read-only.
Column *layout* preferences on companions are client-side filtering, not security.

## 6. Presence

Aggregate only on the `show` channel (detailed per-user cursors live in Yjs awareness for
editors): `{ "v":1, "t":"presence", "counts": {"caller":1,"editor":2,"follower":12,"guest":3} }`
— broadcast on join/leave, throttled to 1/s.

## 7. Reconnect & staleness contract

- Client reconnects with backoff (0.5 s → 8 s cap, jittered), re-sends `hello` with `lastSeq`.
- Any client that has not received a frame for 10 s sends `ping`; no `pong` within 3 s →
  mark UI **stale** (grey the timers, badge "reconnecting"), keep last-known state on screen.
- Server heartbeats `{ "t":"hb" }` every 15 s when otherwise silent.

## 8. Error codes

`4000` bad protocol version · `4001` auth failed · `4003` forbidden (role) ·
`4004` unknown rundown · `4009` join code revoked/expired · `4029` rate-limited.

## 9. Versioning policy

`v` bumps only on breaking changes; additive fields/messages are minor and undeclared.
Server supports current and previous `v` for one release cycle. This file is normative;
`packages/protocol` exports the Zod schemas that implement it and CI fails if they drift
(schema snapshot test).

## Interim access control (v1.1 — additive)

- **`admin` role** (added): granted only when a `session` auth token equals the server's
  `ADMIN_TOKEN` environment variable; never stored in `share_tokens`. Admin may send transport
  commands and passes every management-API check across shows.
- **Locked vs dev-open**: when `ADMIN_TOKEN` is unset the server is *dev-open* — session tokens
  resolve to `caller` and the doc channel accepts any connection. Setting `ADMIN_TOKEN` locks the
  deployment: session tokens other than the admin token are rejected (4001).
- **Doc channel auth** (locked servers): the Hocuspocus provider must send a `token` — the admin
  token or a valid join code for the document's rundown. Follower codes get a **read-only** doc
  connection; `caller`/`editor` codes may write; anything else fails authentication.
- **Management API**: `Authorization: Bearer <ADMIN_TOKEN>` for cross-show endpoints;
  `X-Join-Code` (caller/editor, scoped to the rundown) for rundown-scoped endpoints.
  `GET /codes/:code` is public — a valid code is itself the credential.

## v1.2 additions (additive)

- **Row type `milestone`**: a timed marker with no duration (doors, kick-off). Timing engines
  treat it as zero-duration; renderers show a full-width banner.
- **Cmd action `fire`** (requires `rowId`): logs an untimed pool cue into the live session's
  as-run record (`show_transitions.type = "fire"`, rowId = `pool:<title>`) without any state
  transition. Errors with 400 when no session is live.

## v1.3 additions (additive)

- **`welcome.timezone`** (optional string): the IANA timezone of the event's location. Clients
  render every clock in this zone (DST-aware via Intl); absent → device-local fallback.
