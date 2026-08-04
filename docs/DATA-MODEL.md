# Data Model — Postgres schema & Yjs document shape

Status: **proposal for review** (Phase 1 gate). Nothing here is implemented yet.

Guiding principle: **the Yjs document is the source of truth for rundown *content*** (rows, columns, cells, timing inputs); **Postgres is the source of truth for everything around it** (identity, structure, sharing, show state, history). The two never overlap — Postgres stores the Yjs doc only as an opaque snapshot blob.

All ids are ULIDs (sortable, collision-safe for client-side generation inside CRDTs).

---

## 1. Postgres schema (Drizzle)

### Identity & teams

| table | key columns | notes |
|---|---|---|
| `users` | id, email (unique), name, password_hash?, image_url, created_at | password nullable — OAuth-only users |
| `teams` | id, name, slug (unique), created_at | |
| `team_members` | team_id + user_id (PK), role | role: `owner \| admin \| editor \| viewer` |
| Auth.js tables | accounts, sessions, verification_tokens | standard adapter tables |

### Events & rundowns

| table | key columns | notes |
|---|---|---|
| `events` | id, team_id, name, location?, start_date, end_date, timezone (IANA), use_24h bool, labels jsonb, branding_image_key?, owner_user_id, archived_at?, created_at, updated_at | labels = `[{text, color}]` |
| `rundowns` | id, event_id, name, description?, show_date, planned_start_sec int, doc bytea, doc_updated_at, archived_at?, created_at, updated_at | `doc` = current Yjs snapshot (see §3 persistence); `planned_start_sec` = seconds since local midnight in event tz |
| `rundown_snapshots` | id, rundown_id, doc bytea, label?, created_by, created_at | version history; auto-snapshot on show start + hourly during edit + manual |
| `templates` | id, team_id?, name, description?, doc bytea, created_at, created_by | team_id NULL = built-in starter templates |
| `event_folders` | id, event_id, parent_id?, name | |
| `event_files` | id, event_id, folder_id?, name, mime, size_bytes, storage_key, uploaded_by, created_at | files on local disk/S3-compatible store |

### Sharing & joining

| table | key columns | notes |
|---|---|---|
| `share_tokens` | id, rundown_id, kind, token (unique), join_code? (unique, 6 chars, active only), role, column_visibility jsonb?, created_by, expires_at?, revoked_at? | kind: `guest` (read-only link, column filtering) \| `join` (crew join-code/QR → role `follower`) |

### Show state (live)

| table | key columns | notes |
|---|---|---|
| `show_sessions` | id, rundown_id, state, active_row_id?, active_row_started_at?, paused_at?, paused_accum_ms, started_at, ended_at?, caller_user_id, seq bigint | state: `running \| paused \| ended`; exactly one non-ended session per rundown (partial unique index); `seq` bumps on every transition |
| `show_transitions` | id, session_id, at timestamptz, type, row_id?, actor_user_id | type: `start \| pause \| resume \| next \| prev \| jump \| stop`; durable audit + post-show "as-run" report |

Why relational show state (not in the CRDT): transport commands need a single authority, ordering, and permissions — a server-owned row with a monotonic `seq` gives us that trivially; CRDTs give us none of it. The sync server holds the hot copy in memory and writes through to Postgres.

---

## 2. Yjs document shape (one Y.Doc per rundown)

```
Y.Doc guid = rundown ULID
├─ meta:      Y.Map    { schemaVersion: 1 }            // content-level settings only
├─ columns:   Y.Array<Y.Map>                           // ordered; column defs
│               { id, key, title, kind, width?, hidden?, builtin? }
│               kind: "richtext" | "duration" | "startTime" | "title"
├─ rowOrder:  Y.Array<string>                          // ordered row ids
└─ rows:      Y.Map<rowId, Y.Map>
                { id
                , type: "cue" | "group"
                , hardStartSec?: number | null         // anchors cascade; groups usually set this
                , durationSec?: number | null
                , durationHidden?: boolean
                , durationMuted?: boolean
                , color?: string                       // row status color
                , cells: Y.Map<columnId, Y.XmlFragment> // TipTap content, incl. Title & Script
                }
```

Decisions and rationale:

- **`rowOrder` array separate from `rows` map.** Drag-reorder = one array splice; cell edits touch only that row's fragment. Concurrent edit+move never conflict.
- **Reconciliation rules** (applied in the read projection, never by mutating on read): id in `rowOrder` with no row → ignored; row missing from `rowOrder` → appended at the end; duplicate id occurrences → first wins. A periodic janitor (on save) garbage-collects both.
- **All cells are TipTap `Y.XmlFragment`s**, including Title. Duration/start-time are *not* rich text — they're plain fields on the row, because the timing engine must read numbers, not markup.
- **Times are integers** (seconds; ms where needed), never strings — formatting is a view concern (12/24h lives on the event).
- **The timing engine never reads Yjs directly.** A subscriber projects the doc into a plain `RundownPlan` object and feeds `packages/core`; the engine stays pure and testable.
- **Undo** via `Y.UndoManager` with per-user origin tracking (undo undoes *your* changes only).
- `meta.schemaVersion` gates future migrations of the doc shape.

---

## 3. Persistence & history

- Hocuspocus loads the doc from `rundowns.doc`, holds it in memory while clients are connected, debounce-writes back (2 s quiet / 30 s max).
- `rundown_snapshots` are full-state copies (cheap at rundown scale — tens of KB): manual "save version", automatic on show start, hourly while editing. Restore = load snapshot into a new doc, replace.
- Templates are just snapshots under `templates`; "create from template" = copy blob, strip show-specific values.

## 4. Explicitly out of v1 schema

Task management, content hub, chat, notifications, org dashboards, timecode pro-mode tables — designed *around* (nothing here blocks them; they'd be sibling tables keyed on `events`/`rundowns`), but not created.
