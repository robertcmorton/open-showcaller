# Changelog

All notable changes to this project are documented here, newest first.
Format follows [Keep a Changelog](https://keepachangelog.com/); the project is not yet versioned, so everything sits under **Unreleased**.

> Maintenance rule (see CLAUDE.md): update this file in the same commit as any meaningful change. Entries are written generically — no references to external vendors or reference material.

## [Unreleased]

### Added — 2026-08-04 (Phase 1 scaffold)
- Monorepo scaffold (pnpm + Turborepo, strict TypeScript): `packages/core`, `packages/protocol`, `packages/db`, `apps/web`, `apps/sync`, plus root Docker Compose (Postgres) and `.env.example`.
- **Timing engine** (`packages/core`): cascade with anchor flags (last-anchor-wins), back-timing, muted/hidden durations, duration-shorthand parsing, time formatting — pure functions, unit-tested.
- **Protocol package** (`packages/protocol`): Zod schemas for every PROTOCOL.md message, close codes, and a safe client-frame parser, with schema tests.
- **Database package** (`packages/db`): full Drizzle schema per the data model, bootstrap DDL, Postgres/embedded-PGlite dual driver, Yjs rundown-document builder/projector with reconciliation rules, and a seed script that round-trips the demo rundown through the database and prints its computed timing.
- **Sync server** (`apps/sync`): WebSocket server implementing session establishment, roles, clock-sync ping/pong, idempotent caller transport commands over an authoritative show-state machine (monotonic `seq`), presence, and heartbeats — verified by a two-client smoke test (caller + follower receive identical state sequences; follower commands rejected).
- **Web app** (`apps/web`): minimal Next.js shell rendering the demo rundown through the shared timing engine; grid editor arrives in Phase 2.
- 18 unit tests across four workspaces; `pnpm build`, `pnpm test`, and `pnpm seed` all green.

### Added — 2026-08-04 (video research, second pass)
- Transcribed and analyzed ten training videos (two webinar series, a basics webinar, and six short feature clips) covering the reference rundown product in depth. Spec updated with the resulting v1 features: visible manual-override anchor flags with reset-to-auto and last-anchor-wins cascade semantics; back-timing (calculate-upward rows); a segment-budget countdown column; duration shorthand entry; advance-and-retime transport shortcut; jump-to-row while live; as-run timestamp column with repeat counts, notes, and show-report export; per-row over/under offset trail with running total, projected end, and rehearsal reset; multiple simultaneous callers with per-follower caller picker and passive follow mode; fullscreen item timer; Featured and Display companion views (caller-controlled column); remote-controlled prompter links; per-cell content restore; export presets with branding and page breaks; event-scope guest landing pages; event file storage with export-live file links; templates that carry default crew.

### Added — 2026-08-04 (video research)
- Fourth research pass: full transcript of a 2016 walkthrough video of the first-generation web rundown product our reference platform grew from (recorded in local research notes). Spec updated with newly confirmed v1 features: per-user column layout, private notes, personal vs. global highlights, per-user theme, per-cell change history and activity feed, event duplication, formatted PDF export, Space/Shift+Space show-caller shortcuts, follower auto-scroll, and item runtime clocks that count down then turn red counting up on overrun. The video also validated the web-first Mac/PC + phone/tablet companion strategy.

### Added — 2026-08-04 (Phase 1 start)
- Phase 1 design proposals for review, per the build prompt's gate: [docs/DATA-MODEL.md](docs/DATA-MODEL.md) (Postgres schema for identity/teams/events/rundowns/sharing/show-state, plus the Yjs rundown document shape with reconciliation rules and persistence strategy) and [PROTOCOL.md](PROTOCOL.md) (versioned WebSocket protocol: session establishment for signed-in/join-code/guest clients, NTP-style clock sync, server-authoritative show state with monotonic sequence numbers, caller transport commands, guest JSON projection, presence, reconnect/staleness contract, error codes).

### Changed — 2026-08-04 (later)
- Rewrote [BUILD_PROMPT.md](BUILD_PROMPT.md) as the definitive kickoff prompt: added the showcaller event-creation flow, the show-day multi-device broadcast model (join codes/QR, roles, server-authoritative show state with client-side clock-offset countdowns, reconnect/stale handling), and a cross-platform strategy — one responsive web app for Mac/PC browsers plus phone/tablet companion surfaces (PWA, wake lock) in v1, with timing/protocol logic isolated in platform-agnostic packages and a versioned documented WebSocket protocol so native iPhone/Android apps can be added later without a rewrite. Build order expanded to seven phases ending with protocol docs and self-hosting packaging.

### Added — 2026-08-04
- Completed a third research pass: hands-on exploration of a desktop timecode-driven show-automation reference app. Recorded in local research notes: frame-accurate cue timelines chased by external timecode, typed automation tracks (camera cuts, graphics, OSC/MIDI/HTTP/GPIO, text, playback), live-punch cue authoring, live override controls (skip/hold/take), per-cue flags/markers/auto-numbering, and companion-device pairing. Spec's future-scope section extended with a possible timecode-chase "pro mode" and live override verbs.
- Project kickoff: product spec and build prompt ([BUILD_PROMPT.md](BUILD_PROMPT.md)), README, and permanent project rules ([CLAUDE.md](CLAUDE.md)).
- Completed a detailed product-research pass for the core rundown/show-caller scope; findings captured in local research notes (kept out of the repo by design). Spec updated with: overflow-menu structure (Settings / Views / Export / Guest Pass / History), prompter behavior and controls, speaker-timer sharing, guest-pass column visibility, event content model (rundowns, folders, file uploads, CSV import), and timing-engine details (cascade recalculation, hard starts, hide/mute duration).
- Completed a second research pass covering event project management; recorded as future (post-v1) scope: task lists with reusable templates, nested subtasks, milestones, dependencies, tags and watchers; list/Gantt/calendar views; public read-only calendar links; per-event content hub (notes, files, links); per-event team chat; notification fan-out to assignees and watchers; guest users with task-scoped visibility; org-level KPI dashboard.
- This changelog.

### Changed — 2026-08-04
- Repo hygiene: all reference material moved to local-only files excluded via `.gitignore`; git history rewritten to a single clean root commit containing no reference material.
