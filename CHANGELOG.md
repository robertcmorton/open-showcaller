# Changelog

All notable changes to this project are documented here, newest first.
Format follows [Keep a Changelog](https://keepachangelog.com/); the project is not yet versioned, so everything sits under **Unreleased**.

> Maintenance rule (see CLAUDE.md): update this file in the same commit as any meaningful change. Entries are written generically — no references to external vendors or reference material.

## [Unreleased]

### Added — 2026-08-04 (Phase 7: guest pass, version history, packaging)
- **Guest pass**: create read-only share links with per-column visibility from the editor. The server sends guests a filtered projection — hidden columns are absent from the payload, and the collaborative document never reaches guest browsers. The guest page shows a last-updated stamp, refreshes to the latest version, and prints.
- **Version history**: save labeled versions from the editor, automatic snapshot the moment a show starts, and restore any version as a new copy. (In-place restore of a live collaborative document is deliberately deferred until a document-epoch mechanism lands; the API comment documents why.)
- **Self-host packaging**: Dockerfiles for the web and sync services, a compose file with Postgres, healthchecks, and a one-shot seed job, plus a README quickstart. Build-time public URL arguments documented for real deployments.
- Verified in-browser: created a guest link with Script and Production Notes hidden and confirmed at the payload level that they never leave the server; saved and restored a version as a copy; confirmed the automatic show-start snapshot.
- With this, all seven phases of the build plan are implemented; remaining work is the documented hardening list (accounts and API auth, join codes, session persistence, protocol unification).

### Added — 2026-08-04 (Phase 6: events, templates, CSV)
- **Events dashboard**: the landing page now lists events with their rundowns, creates events (name, location, dates), and creates rundowns per event — blank, from a saved template, or by pasting CSV.
- **Templates**: save any rundown as a reusable template from the editor; new rundowns created from a template carry its full content.
- **CSV import/export**: paste-CSV import maps Title/Duration/Start/Type plus department columns by header name (Start values become timing anchors; `Type=group` creates section headers); one-click CSV export from the editor with computed start times. CSV parser/serializer lives in core with unit tests.
- **JSON management API** on the sync server for events, rundowns, and templates (development-open; authentication arrives with the accounts hardening pass).
- Verified in-browser end to end: created an event, pasted a four-row CSV that rendered with a 7:00 PM anchor and correct cascade, exported it back to CSV, saved it as a template, and created a second rundown from that template.

### Added — 2026-08-04 (Phase 5: speaker timer + prompter)
- **Speaker Timer** at `/timer/[id]`: fullscreen countdown for the active cue — green on time, amber inside the final stretch, red counting up on overrun, greyed while reconnecting; double-click for fullscreen; wake lock. Built for confidence monitors and speakers' phones.
- **Prompter** at `/prompter/[id]`: script-column view with a fixed read-position caret, follow-the-caller (smooth-jumps to the active cue as the show advances), auto-scroll with adjustable speed (Space to toggle, arrows for speed), font-size controls, mirror mode, and a word-count/read-time bar.
- PWA install metadata (web manifest + app icon) so companion surfaces can be added to home screens; shared document-connection and wake-lock hooks across all surfaces; per-rundown view links on the landing page and in the editor header.
- Verified in-browser: timer counted down the live cue in the bordered display; the prompter opened on the active cue and smooth-scrolled to the next one when the console advanced the show.

### Added — 2026-08-04 (Phases 3–4: live mode + broadcast)
- **Live timing math in core** (`computeLiveTiming`): pause-aware elapsed/remaining in the active row, per-row overrun, cumulative show drift (actual vs. planned start plus current overrun), and projected end time — all computed locally from timestamps and the measured clock offset, per the protocol's no-streamed-ticks rule; unit-tested with a pluggable timezone mapping.
- **Show-channel client** for the web app: session establishment, median-of-five clock-offset sampling, sequence-guarded state updates, jittered reconnect backoff, and idempotent command ids.
- **Console live mode**: caller transport bar (Start / Pause / Resume / Prev / Next / Stop-with-confirm) with Space and Shift+Space shortcuts suppressed while typing; LIVE/PAUSED badge; active-row highlight; header readouts for item countdown (green, red count-up on overrun), cumulative show drift, and projected end.
- **Companion follower surface** at `/follow/[id]`: glanceable current cue with giant countdown, script card, next-cue strip, drift/projected-end line, and a screen wake lock — follows the caller's position live.
- Verified end to end in a real browser: console started the show, a phone-width follower ticked the countdown locally, advancing on the console moved the follower instantly, and stop returned both to idle.

### Fixed — 2026-08-04
- Render loop in the live-timing hook (effect depended on per-render objects); inputs now flow through refs with a mount-once interval.

### Added — 2026-08-04 (Phase 2 editor core)
- **Collaborative rundown editor** ([apps/web](apps/web)): spreadsheet-style grid over the Yjs document — TipTap rich-text cells (mounted per active cell, bound to each cell's shared fragment), inline Start/Duration editing with shorthand parsing, visible anchor flags with one-click reset-to-auto, drag-and-drop row reordering (dnd-kit), group-header rows with toggle, add/delete rows, add columns, row selection, and a live planned start/duration/end header driven by the timing engine. Landing page lists rundowns from the sync server's read API.
- **Document sync with persistence** ([apps/sync](apps/sync)): Hocuspocus server backed by the database — documents load from the rundown's stored state and debounce-write back on change; minimal HTTP read API for rundown listings. (Doc channel runs on its own port for now; folding onto the single-socket protocol is tracked for Phase 4.)
- Wall-clock time parsing in core (`parseTimeOfDay`), rundown metadata (name, planned start) carried inside the document, and a unified dev database location shared by seed and sync.
- Verified end to end in a real browser: seeded grid renders; a duration edit recascaded every subsequent start time and the header totals; the same edit propagated live to a second browser tab; and after stopping the servers the edit was read back from the database intact.

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
