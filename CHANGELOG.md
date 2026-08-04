# Changelog

All notable changes to this project are documented here, newest first.
Format follows [Keep a Changelog](https://keepachangelog.com/); the project is not yet versioned, so everything sits under **Unreleased**.

> Maintenance rule (see CLAUDE.md): update this file in the same commit as any meaningful change. Entries are written generically — no references to external vendors or reference material.

## [Unreleased]

### Added — 2026-08-05 (my role: personal highlight & next-item bar)
- **Every user can mark their assigned role** — BGM, Camera 1, PA, a presenter's name, anything the sheet says — regardless of their access level (admin, edit, or view-only). A "My role" picker in the toolbar suggests roles mined from the sheet itself; the choice is remembered per browser.
- **Your items highlight in teal** across the rundown the moment a role is picked.
- **A bottom bar appears while the show runs**: it names your next item and counts down to its start (planned time shifted by the live drift, amber inside the final minute). When your item goes live the bar grows into a **full-width ON-AIR banner** — "YOU'RE ON" with the item's remaining time — and when your item finishes it moves on to the next one, ending with "no more items for you" after your last cue.

### Added — 2026-08-05 (event images, company logos, big live timer)
- **Images on events**: add one image — or two for sporting fixtures (home and away team) — from the event card's Images menu; they display beside the event name. **Event companies get a logo** shown on their band. Images are picked from disk, downscaled client-side, and stored inline (no external storage needed yet).
- **A big, unmissable timer sits centre-top of every rundown screen while the show runs**: the active item countdown in large tabular figures — green on time, amber in the final stretch, red counting up on overrun, dimmed amber while paused — with the active item's name above it.

### Fixed — 2026-08-05 (import header detection & centered-header titles)
- **Header-row detection scans much deeper** (30 rows) — sheets with multi-line title blocks above the real header no longer import with the page title as column names — and the preview gains a **Header row** override so any sheet can be rescued manually.
- **Centered headers no longer orphan the title column**: when a PDF's header text sits in a different layout band than the left-aligned data below it, the data-rich neighbouring band is mapped into Title as well — a real 6-page sheet went from 37 to 411 titled rows.
- Fixed an SSR crash on the dashboard under Node's experimental localStorage, and a hydration warning from locale date formatting in the print footer. The create-rundown template picker now reads "Start blank" and hides entirely until templates exist.

### Changed — 2026-08-05 (import: full column fidelity; company rename)
- **Imported rundowns now mirror the source sheet's columns exactly**: identical names (verbatim header text, original casing), no duplicates (repeated headers get a numbered suffix), the same left-to-right order, and **proportional column widths** taken from the spreadsheet's column sizes or the PDF's layout. Built-in department columns are no longer added on import — **a column with no data simply doesn't exist** in the imported rundown.
- **Event companies can be renamed** from their band header on the dashboard.

### Fixed — 2026-08-05 (import: columns now mirror the source sheet)
- **Importing a run sheet now auto-creates columns matching the sheet's own format.** Previously, headers like TRACK, BIG SCREEN, SIDE PANEL, LED, and NOTES were folded into the nearest built-in column, and columns with a **blank header** (the cue-type column on many presentation grids) were dropped entirely — losing most of a dense sheet's content. Now every non-structural column imports as itself; untitled columns are recognized by their data (a column of VTR/PA/GFX tokens becomes **Type** — which also activates the cue-type quick chips — anything else becomes "Column N"), and mirrored row-number columns are skipped as noise.
- Milestone rows keep their department cells on import, and their banner title falls back to the first cell value when PDF extraction lands the title in a neighboring column band — pre-show schedule rows (arrivals, meetings, rehearsals) now import with their real names instead of "—".
- Verified against a 12-page real production PDF: 517 rows with every source column (Type, LOCATION, TRACK, BIG SCREEN, SIDE PANEL, LED, NOTES) present and populated, versus most of that content missing before.

### Added — 2026-08-05 (dashboard: companies own their events; drag-and-drop import)
- **Events now appear underneath their event company** on the dashboard: each company is a band with its event count, showcaller-token actions, and its own "+ New event" (events created there belong to that company). A company credential sees exactly one band — its own.
- **Companies can be deleted** (armed two-click confirm) — deletion cascades through the company's events, rundowns, sessions, tokens, snapshots, templates, and memberships.
- **The import box accepts drag-and-drop**: drop an XLSX/XLS/CSV/PDF straight onto it (highlights while dragging) — clicking to browse still works.

### Added — 2026-08-05 (event date editing & ordering rule)
- **Event dates are now editable** from the dashboard (a "Dates…" inline editor on each event card) — previously they were fixed at creation.
- **The end date can never precede the start date**, enforced in three layers: the date pickers themselves (the end input's minimum follows the start, and moving the start forward bumps the end along), the form guard, and the API — which validates the *merged* result on both create and edit, so moving just one side past the other is rejected with a clear error.

### Added — 2026-08-05 (left settings panel & navigation)
- **A persistent left panel on the dashboard and every rundown screen** holds navigation (main page, dashboard) and all the settings features for the current screen — Views (Follow/Timer/Prompter), Output (Print/PDF, CSV export), and Show settings (template, guest pass, history, join codes) on rundown screens; archived toggle and credentials on the dashboard. Collapsible, state remembered per browser, hidden in print. The old ⋯ overflow menu is gone — settings now have a home. Everything in the panel respects the access hierarchy: a company credential sees only its own data; only admin sees all.

### Added — 2026-08-05 (event-timezone time model)
- **The event's location now governs every clock.** Each event carries an IANA timezone; the show channel hands it to every connected surface, and header clocks, live drift, and projected-end all compute in the **event's wall clock** (a viewer in another country sees the venue's time, labeled with the zone — "Event time · EDT"). Daylight saving is applied per-instant from the IANA database, so shows that cross a DST change stay correct — covered by unit tests on both a US and an Australian spring-forward boundary.
- **The primary time can only change when the location changes**: the API rejects a timezone change without an accompanying location change, and the dashboard pairs the two in one "Location…" action. New events pick up the creator's timezone automatically.

### Added — 2026-08-05 (access hierarchy: event companies & archive)
- **Three-tier access**: **Admin** (top level, sees and changes everything) → **Event company** (showcaller credentials: change event details and everything below, strictly scoped to the company's own events) → **Editor** (assigned per rundown via join code: changes rundown content, never events). Admin creates companies from the dashboard and hands out per-company showcaller tokens (rotatable); company tokens also drive the show and document channels as caller-level within their own company only. Verified against a locked server: a company sees only its own events, cannot touch another company's event (401), and cannot list companies (401); admin sees all.
- **Archive** for events and rundowns (in addition to delete): archive/unarchive from the dashboard, archived items hidden by default with a "Show archived" toggle, shown dimmed with an archived chip.
- The dashboard header now reflects who you are — "admin" or your company name — and `GET /me` drives visibility.

### Added — 2026-08-05 (milestone 2 · phase 5: live polish & print)
- **The active row is unmistakable on every surface while the timer runs**: accent bar + tinted row, an inline **progress bar that drains in real time** under the active title and turns the over-color on overrun, a subtle tint + soft bar on the **next** cue, and a dimmed amber state while **paused**. Auto-scroll keeps the active row centered as the show advances, with a **Follow** toggle so a user reading elsewhere is never yanked — verified live in-browser (bar draining at the correct rate, next-up tint, paused dim).
- **Formatted print/PDF export straight from the browser** on Showcaller/Edit/View (⋯ → Print): landscape A4 with a title block (name · version label · planned/duration/end · key-times table), column headers repeated on every page, group/milestone banners and row colors preserved, screen chrome stripped, and a generated-stamp footer. The Columns menu acts as the per-user print preset — hidden columns stay hidden in print.

### Added — 2026-08-05 (milestone 2 · phase 4: rundown fidelity)
- **Milestone rows**: a first-class row type for timed markers with no duration (doors, kick-off, "team list due") rendered as a full-width amber banner; excluded from duration math; produced by the importer and the new **+ Milestone** button.
- **Row highlight colors**: multi-select rows and pick from a curated palette (or clear) in the selection bar; colors follow the row onto every surface including the guest view.
- **Key times**: labeled times for the day (doors, soundcheck, on-air…) editable from a header chip, stored in the document, shown on Showcaller/Edit/View headers and the guest page — the real-world "KEY TIMES" table.
- **ZERO countdown column**: optional per-user column showing T-minus to the next anchored time — the printed countdown convention from live sport cue sheets.
- **Version label**: a free-text chip on the rundown header ("V2", "FINAL") stored in the document and shown to guests; ready for print title blocks.
- **Cue-type quick chips**: columns titled "Type" get a one-click vocabulary (AUDIO, GFX, VTR, LED, PA, MC, PYRO…) above the cell editor — still free text underneath.
- **Untimed cue pool**: a section below the rundown for cues that live outside the timeline (stings, chants, filler). During a live show the caller **fires** a pool cue and it logs into the as-run report with a timestamp — verified end-to-end (`fire` → `pool:Goal Sting` row in the report CSV) — without moving the active row. Guest views hide it; the protocol gained an additive `fire` action.
- Guest projection now respects **Hide** on durations (hidden durations never leave the server).

### Added — 2026-08-05 (milestone 2 · phase 3: run-sheet import)
- **Upload an existing run sheet — XLSX, XLS, CSV, or PDF — from the admin dashboard** ("Import run sheet…" per event). Extraction is fully client-side: spreadsheets read as displayed text; PDFs go through text-run clustering (lines by Y, column bands by X, repeated page headers dropped) with a clear error for scanned files that have no text layer.
- **Mapping preview before anything is created**: auto-detected header row and column mapping (title/start/duration/departments, with synonym matching — VTR→Video, LX→Lights, WHO/WHAT→Production Notes…), retargetable per column, unknown headers become new custom columns; rows classified as cue / **milestone** (time, no duration) / **section** (title-only banner) / spacer; unparseable cells highlighted in red and imported empty rather than silently dropped.
- **Tolerant parsing in core** (30 unit tests, fixtures modeled on three real production house styles): durations like "3 mins", "1min 27 secs", "0:90:00" (90-minute spreadsheet leak), "08:00"; times like "5:00:00PM", "16:00:00", "4:30pm", "0900". Verified end-to-end in-browser: a synthetic spreadsheet imports with anchors, milestone rows, cascade and department cells intact; a real 8-page production PDF extracts 450+ rows with start/duration/title auto-mapped and 21 unparseable cells flagged.

### Added — 2026-08-05 (milestone 2 · phase 2: role screens & gated access)
- **Four ways into the app, each a real screen**: `/admin` (cross-show control room: every event and rundown, create/rename/delete/duplicate, live-now badges, one-click jump into any screen), `/show/[id]` (full showcaller console), `/edit/[id]` (content editing, **no transport and no share/admin panels**), `/view/[id]` (read-only grid with live position, personal column visibility, print). The old `/rundown/[id]` URL redirects to `/show`.
- **Landing page**: crew enter a join code and are routed to the screen their role allows — caller → Showcaller, editor → Edit, follower → View — with the code carried in the URL and reused by every panel and channel.
- **Server-enforced access (interim tokens, accounts still to come)**: a new `admin` role is granted only by the server's `ADMIN_TOKEN`. When that variable is set the deployment is locked: the management API requires the admin token (cross-show) or a caller/editor join code (rundown-scoped); the collaborative document channel authenticates every connection and gives follower codes a **read-only** document; dev session tokens are rejected. Unset, the server stays dev-open. Verified against a locked instance: 7/7 HTTP checks and 4/4 show-channel checks (dev token rejected, admin welcomed, follower's transport command refused, bad code closed).
- Admin endpoints: rename/delete events and rundowns (delete cascades sessions, tokens, snapshots), duplicate rundown, `GET /live` (which shows are running), `GET /codes/:code` (landing-page routing). Join-code panel now issues editor codes too and copies role-appropriate URLs.

### Changed — 2026-08-05 (rename: OpenCall)
- The project is now **OpenCall**: repo `robertcmorton/opencall`, packages `@opencall/*`, app title and PWA metadata, Docker/compose service names, hosting service names and domains (`opencall-web-production` / `opencall-sync-production` on Railway), and all docs. No functional changes; existing data is unaffected.

### Changed — 2026-08-05 (milestone 2 · phase 1: design system & UI modernization)
- **New design system** (`globals.css`): color/spacing/radius/elevation/motion tokens with semantic roles; dark theme as the primary show-surface theme and a light theme for the dashboard; Inter for UI text and JetBrains Mono with tabular figures for every timing readout (no width jitter while ticking); one shared component set (buttons, panels, menus, chips, inputs, badges, empty states, skeletons); 130–190 ms eased motion with `prefers-reduced-motion` respected; pulsing LIVE badge.
- **Editor modernized and long-parked parity features landed**: floating formatting toolbar on the active cell (bold/italic/underline/strike/highlight/link/clear); duration popover with **Hide** and **Mute** (mute verified: excluded from cascade math with struck-through display); **multi-select** rows (shift/⌘-click) with a selection bar — duplicate (deep-copies cell content), group toggle, delete; per-user **Columns** show/hide menu persisted locally; ticking time-of-day clock in the header; **⋯ menu** collecting views, export, template, and share panels; connection status dots; sticky column headers; group rows restyled as section bars.
- **Transport bar**: proper icon buttons, primary Next, and Stop now uses an in-app two-click armed confirm instead of a browser dialog.
- **Dashboard restyled** (light theme): event cards, chip links to companion views, labeled create forms, loading skeletons, empty states. Companion and guest surfaces moved onto the token system.
- All flows re-verified in-browser after the restyle: live start/advance/stop, join-code panel, column hiding persisted across navigation, formatting round-trip, duplicate/delete.

### Added — 2026-08-04 (spec: milestone 2 build prompt)
- **`BUILD_PROMPT_2.md`** — the next build milestone, specified end to end in five phases: (1) design-system foundation and full UI modernization (tokens, dark show-surface theme, tabular-figure timing type, component set, motion) folding in the parked visual-parity items; (2) role-based screens with server-enforced access — **Admin** (cross-show control room), **Showcaller** (full console), **Edit** (content-only), **View** (read-only) — plus interim token gating of the doc channel and management API; (3) the run-sheet import pipeline (XLSX/XLS/CSV/PDF upload → extract → detect → column-mapping preview) with tolerant parsers and synthetic fixtures; (4) rundown fidelity features from real-world sheets — milestone/banner rows, row colors, cue-type chips, key times, countdown-to-anchor column, version label, untimed cue pool; (5) live polish — unmistakable active-row highlighting with progress bar on every surface while the timer runs, and formatted print/PDF export with repeated headers and title block.

### Changed — 2026-08-04 (spec: real-world run sheet import)
- The import requirement in `BUILD_PROMPT.md` now covers **uploading existing run sheets as XLSX, XLS, CSV, or PDF** through a single extract → map-columns → preview pipeline, with tolerant parsing of real-world data (free-text durations, mixed time formats, milestone rows, section banners, stacked multi-cue cells, per-page repeated headers). Informed by analysis of real produced run sheets kept as local-only reference material; the print/PDF export spec gained key-times table, repeated per-page headers, and footers to match.

### Changed — 2026-08-04 (single-platform hosting)
- **Everything now runs on Railway in one project**: the web app moved from Vercel to a Railway service at `opencall-production.up.railway.app` (domain targets port 3000), alongside the existing sync server and PostgreSQL. The Vercel project was deleted. One platform, one dashboard, services reference each other's variables directly. `docs/DEPLOYMENT.md` rewritten for the consolidated topology.
- Verified post-move: the Railway-hosted web app serves the same database (existing event and rundown render), the editor connects on both realtime channels over `wss://`, and the in-progress show session carried across untouched.

### Added — 2026-08-04 (production deployment)
- **The app is live**: web at `opencall-web.vercel.app` (Vercel, auto-deploys from `main`, root directory `apps/web`) and the sync server + PostgreSQL on Railway at `opencallsync-production.up.railway.app`. Verified end to end in production: event and rundown created through the live UI, editor connected on both realtime channels over `wss://`.
- **Single public port**: the sync server now serves the HTTP API, the show channel (ws `/`), and document sync (ws `/doc`) from one listener with path-routed upgrades; `PORT` is honored for PaaS hosts. Port 8788 is retired everywhere (dev, Docker, env examples).
- Fresh databases self-initialize on server boot (idempotent DDL), so a new deployment needs no manual migration step.
- ⚠️ Known gap, tracked as the top hardening item: the management API and document channel are not yet authenticated — the deployment is suitable for demo use until API gating lands.

### Added — 2026-08-04 (hardening: durable sessions, join codes, as-run report)
- **Show sessions are now durable**: every transport command writes through to the database (session state plus a transition log), and a restarted sync server hydrates any live session back — a show in progress survives a server crash, verified by killing and restarting the server mid-show.
- **Real join codes**: generate role-scoped six-character codes (no confusable characters) per rundown from the editor's Join Codes panel; companion URLs carry `?code=`; the show channel validates codes and guest tokens against the database and rejects invalid credentials. A development fallback code remains available and can be disabled by environment variable.
- **As-run show report**: the full transition history (which rows ran, when, per session) downloads as CSV from the History panel — rehearsal timing analysis and proof-of-run in one export.

### Changed — 2026-08-04
- Session establishment on the show channel is now asynchronous (database-backed credential checks) with unchanged wire behavior.

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
