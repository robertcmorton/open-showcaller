# Build Prompt — Open Showcaller

Copy everything below the line into a fresh Claude Code session to start building.

---

I want to build **Open Showcaller**: an open-source, self-hostable rundown and show-calling platform for live event production. A showcaller (producer) creates an event, populates its details, and builds a minute-by-minute rundown. On show day they run the show from a console — and every crew member's device in the room or remote follows along in real time: current cue, timing, over/under, speaker timers, prompter. The closest open-source prior art is Ontime (github.com/cpvalente/ontime); we're building something closer to a collaborative spreadsheet with a timing engine and a broadcast layer. Reference screenshots and detailed product research live locally in `Images/` and `DEMO_NOTES.md` (never committed — see CLAUDE.md) — study them before writing code.

## Platform strategy — read this first, it shapes the architecture

- **v1 is one responsive web app.** Mac and PC get the full experience in any modern browser — no install. Phones and tablets open the same URL and get companion surfaces adapted to their size. Native iPhone/Android apps come later.
- **Architect for the native apps now.** All timing math, show-state logic, and the realtime protocol live in platform-agnostic TypeScript packages (`packages/core`, `packages/protocol`, `packages/api-client`) with zero DOM or React dependencies. The WebSocket protocol is versioned and documented in `PROTOCOL.md` so future Swift/Kotlin/React Native clients can be written against the spec without reading web code. If the protocol layer is clean, the native apps are thin rendering shells.
- **Two device classes, one deployment.** The app adapts by viewport and role:
  - **Console** (desktop browser, ≥1024px): the rundown editor, show-caller transport, and timing dashboard. Dense grid, mouse/keyboard, keyboard shortcuts for transport.
  - **Companion** (phone/tablet): join-a-show surfaces — live rundown follower, speaker timer, prompter. Large type, large touch targets, dark theme, and a **screen wake lock** so devices never sleep mid-show. Installable as a PWA (manifest + service worker) so it feels app-like on iOS/Android today and eases the migration story later.
- **Scaling differences to respect:** the console assumes wide screens and precision pointing (spreadsheet grid, drag-and-drop, cell selection); companions assume glanceability from a distance, one-hand use, portrait orientation, and flaky venue Wi-Fi (instant resync on reconnect, "stale" indicator when offline). Never ship a shrunken spreadsheet to a phone — companions get purpose-built views.

## Core product

**Hierarchy:** Team → Events → Rundowns → Rows (cues).

**Event setup (the showcaller's flow):** create an event — name, location, start/end dates, timezone, 12/24-hour preference, labels, branding image, owner. Inside it, create rundowns (one per day/stage) from a template or blank, each with name, description, date, and planned start time. An event also holds folders, uploaded files, and CSV imports, with Dashboard / Archived tabs and a template library at team level.

**Rundown editor** — a spreadsheet-like grid that mirrors Excel/Sheets muscle memory. Default columns: Title, Start Time, Duration, Production Notes, Audio, Video, Lights, Graphics, Script; users add/rename/reorder/hide custom columns. Rows are drag-and-drop cues; group-header rows divide the show into segments, can carry hard start times, and convert to/from normal rows. Cells are rich text (TipTap): bold/italic/underline, size, colors, highlights, lists, links, inline images. Spreadsheet-grade selection (cell, row, multi-row) with a selection chip. **Per-user personalization on the shared document:** each user can hide/reorder columns for their own view, keep private notes invisible to others, and set *personal* highlights — alongside *global* highlights everyone sees. Per-user light/dark theme.

**Timing engine** — the crown jewel, built as a pure, exhaustively unit-tested module in `packages/core`:
- Durations cascade: a row's start = previous row's end, recalculated on any change.
- Hard start times anchor rows and break the cascade; durations can be hidden or muted (excluded from math) via a per-cell menu.
- Header always shows Planned (start / total duration / end); live, it adds per-item over/under (green under, red over), cumulative show drift (e.g. `Show +00:57`), and projected end time.

**Show day — run & broadcast:**
- The showcaller hits **Start** → LIVE. Transport: Pause, Previous, Next, Stop (with confirm), with keyboard shortcuts on the console (Space = next, Shift+Space = previous). Active row highlighted on every device; follower views auto-scroll to it. Each item shows a runtime clock counting down its planned duration — green, then red counting up once it overruns; all timing readouts run live.
- **Broadcast:** every connected device follows the caller's position in real time. Crew join via a short code or QR shown on the console. Roles: **Caller** (transport + edits), **Editor** (edits, no transport), **Follower** (read-only live view), **Guest** (tokenized read-only link with per-column visibility).
- **Clock discipline:** show state is server-authoritative and tiny — active row id, state (idle/running/paused), and timestamped transitions. Clients compute every countdown locally from a measured server-clock offset; ticks are never streamed. Cue changes propagate in <300 ms; reconnects resync in one round trip; offline companions keep showing last-known state flagged as stale.
- **Companion surfaces** (each shareable to any device by link/QR): **Follow** (current + next cue, my columns), **Speaker Timer** (fullscreen countdown, green → amber → red as time runs out), **Prompter** (the active cue's script, auto-scroll with speed/size controls, mirror mode, read-position marker; edits in the rundown sync into it instantly).

**Sharing & data:** simultaneous multi-editor collaboration with cell-level sync; version history plus a live activity feed and per-cell change history (who changed this cell, when); CSV import/export, unformatted spreadsheet export, and formatted print/PDF export; rundown and event templates, plus one-click event duplication (copies rundowns and files); guest-pass links with column visibility toggles.

## Tech stack (all open-source, self-hostable)

- **Monorepo:** pnpm workspaces + Turborepo. TypeScript strict everywhere. Layout: `apps/web` (Next.js), `apps/sync` (Hocuspocus + show-state WebSocket server), `packages/core` (timing engine), `packages/protocol` (message schemas — Zod), `packages/api-client`.
- **Web:** Next.js (App Router) + React + Tailwind. Editor/live surfaces dark with monospace timing figures (green = under, red = over); dashboard surfaces light. PWA manifest, service worker, `navigator.wakeLock` on companion views.
- **Realtime:** Yjs CRDTs over Hocuspocus for the rundown document; a separate lightweight channel (same socket) for show state and presence. Documented, versioned message protocol.
- **Rich text:** TipTap (Yjs-native). **Drag & drop:** dnd-kit.
- **Data:** PostgreSQL via Drizzle ORM — teams, users, events, rundowns (Yjs snapshots + metadata), templates, share/join tokens, sessions. Auth.js with credentials + OAuth; roles owner/admin/editor/viewer plus tokenized guest and join-code access.
- **Deploy:** single `docker-compose.yml` (web + sync + Postgres). MIT license.

## Build order — each phase ends runnable with seed data

1. **Scaffold:** monorepo, DB schema, seed script (realistic "Sales Kick-Off Day 1" rundown: Walk in, Welcome & Applause, Highlight Reel, Announcements…). Propose schema + protocol before coding (see below).
2. **Editor core:** grid, default + custom columns, drag-and-drop rows/columns, TipTap cells, group headers, selection model.
3. **Timing engine:** cascade, hard starts, hide/mute, header math — pure module, 100% branch-tested.
4. **Live mode + broadcast:** show sessions, join codes + QR, roles, clock-sync handshake, console transport, phone Follow view. This phase proves the two-device-class story end to end.
5. **Companion surfaces:** Speaker Timer and Prompter, PWA install + wake lock, reconnect/stale handling.
6. **Accounts & events:** teams, event dashboard, create-event/create-rundown flows, templates, CSV import/export.
7. **Sharing & ops:** guest pass with column visibility, version history, print/PDF export, Docker packaging, `PROTOCOL.md` + self-hosting README.

**Researched future scope (post-v1 — don't build, don't design out):** per-event task management (task lists with reusable templates, nested subtasks, milestones, dependencies, tags/watchers; list + Gantt + calendar views; public calendar links; per-event content hub, team chat, notifications; guest users with task-scoped visibility; org-level KPI dashboard). And from a timecode-driven show-automation tool: a "pro mode" where a rundown item carries a frame-accurate cue timeline chased by external timecode, with typed automation tracks (camera cuts, OSC/MIDI/HTTP triggers, text) and live override verbs (skip/hold/take). Native iOS/Android companion apps consuming the same protocol. Details in local research notes.

Start with Phase 1. Before writing code, propose for my review: (a) the Postgres schema, (b) the Yjs document shape for a rundown (rows, columns, cells, timing fields), and (c) the realtime protocol message set as a `PROTOCOL.md` draft — join/auth, state sync, show transport, clock offset. The sync model and protocol are the hardest things to change later; we get those right first.
