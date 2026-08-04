# Build Prompt — Open-Source Rundown / Show Caller App

Copy everything below the line into a fresh Claude Code session to start building.

---

I want to build an open-source, self-hostable rundown and show-calling app for live event production — an open alternative to commercial show-calling tools. Producers build a minute-by-minute rundown of a show (corporate keynotes, conferences, broadcasts), then run the show live while the whole crew follows along in real time on their own devices. Reference screenshots and detailed product research live locally in `Images/` and `DEMO_NOTES.md` (never committed — see CLAUDE.md) — study them before writing code. The closest open-source prior art is Ontime (github.com/cpvalente/ontime); we're building something closer to a collaborative spreadsheet with a timing engine, not a copy of it.

## Core concepts

**Hierarchy:** Team → Events → Rundowns → Rows (cues). An event has a name, location, date range, timezone, 12/24-hour preference, labels (e.g. "Corporate", "On Site"), branding image, and an owner. An event contains multiple rundowns (e.g. "Day 1", "Day 2"), each created blank or from a template, with a name, description, date, and start time.

**Rundown editor** — the heart of the app. A spreadsheet-like grid deliberately mirroring Excel/Google Sheets muscle memory, where each row is a cue and columns are configurable:
- Default columns: Title, Start Time, Duration, Production Notes, Audio, Video, Lights, Images/Graphics, Script. Users can add custom columns, rename them, reorder them by drag-and-drop, and toggle visibility.
- Rows are drag-and-drop reorderable (with a "Row order updated" toast). Rows can also be group headers (e.g. "Walk in", "Development") that visually divide the show into segments and take a hard start time.
- Cells support rich text: bold/italic/underline, font size, text and highlight color, alignment, bullet lists, links, and inline images. The Script column holds long-form speaker scripts.
- Selection model like a spreadsheet: single cell, row, multi-row, with a selection indicator chip ("1 row selected").

**Timing engine** — this is what makes it more than a spreadsheet:
- Each row has a duration (mm:ss). Start times cascade: a row's start = previous row's end, recalculated automatically whenever any duration or start time changes.
- Rows can have a **hard start time** (anchored, breaking the cascade), and durations can be **hidden** or **muted** (excluded from the cascade math) via a per-cell menu.
- The header always shows Planned (start, total duration, end) and, while live, Over/Under for the current item (e.g. `-00:41` green when under) plus cumulative show drift (e.g. `Show +00:57` red when over) and a projected end time, alongside a time-of-day clock.

**Show caller (live mode):**
- A producer hits **Start**; the app goes LIVE. Controls: Pause, Previous, Next, Stop. The active row is highlighted, and per-item elapsed vs. planned duration drives the over/under readouts in real time.
- Every connected device follows the show caller's position in real time — crew members open the same rundown and see the current cue advance as the producer calls the show.

**Views** — reached from a `⋯` overflow menu containing Settings, Views, Export, Guest Pass, and History. The Views submenu lists Speaker Timer and Prompter, each with a copy-share-link icon, a pop-out icon, and a live inline preview (cue name + countdown):
- **Speaker Timer:** full-screen countdown for the current cue with its title, green while on time, turning amber/red as time runs out. Shareable so a confidence monitor or a speaker's phone can show it and speakers can see in real time how ahead or behind they are.
- **Prompter:** teleprompter that renders the Script column, headed by the active cue's number + title (e.g. "2 - Welcome & Applause") with a green cue timer and a time-of-day clock. Auto-scroll with adjustable speed, adjustable font size, mirror mode, play/pause and restart, a fixed read-position caret at the left edge, jump-to-cue list, word count and estimated read time (e.g. "464 words · 3m"), and fullscreen. Edits to the rundown script sync into the prompter instantly — no teleprompter rental hardware needed.
- **Guest Pass:** read-only share link with an access level ("anyone with the link") and per-column visibility toggles (covering custom columns too), plus Open and Copy Link actions, so stakeholders see the rundown without edit rights or sensitive columns.

**Collaboration & data:** multiple editors on the same rundown simultaneously with live cell-level sync; version history ("History" in the overflow menu); export submenu (CSV and print/PDF); rundown templates (create a rundown from "Default Rundown" or any saved template, with name, description, date, start time); events contain a mixed dashboard of rundowns, folders, uploaded files, and CSV imports (create-new menu: Rundown, Folder, File Upload, CSV Import); event-level tabs for Dashboard / Crew / Saved / Archived; team-level tabs for Upcoming / Past / Archived events, Global elements, Template library, Active users, Team admins.

## Tech stack (all open-source, self-hostable)

- **Monorepo:** pnpm workspaces + Turborepo. TypeScript everywhere, strict mode.
- **Web app:** Next.js (App Router) + React + Tailwind CSS. Dark theme by default for the editor/live surfaces (match the screenshots: near-black grid, monospace timing figures, green/red over-under), light theme for the dashboard.
- **Real-time sync:** Yjs CRDT documents over a Hocuspocus WebSocket server for the rundown grid and scripts; ephemeral awareness/broadcast (same socket) for show-caller state (current row, play state, timers). Timer math runs from shared timestamps so every client computes the same countdown locally — never stream ticks over the wire.
- **Rich text:** TipTap (it's Yjs-native) for cell and script editing.
- **Drag & drop:** dnd-kit for rows and columns.
- **Database:** PostgreSQL via Drizzle ORM — teams, users, events, rundowns (Yjs snapshots + metadata), templates, share tokens. Auth with Auth.js (credentials + OAuth providers), roles: owner / admin / editor / viewer, plus tokenized guest access.
- **Deploy story:** single `docker-compose.yml` (web + sync server + Postgres) so self-hosting is one command. MIT license.

## Build order

Work in phases; each phase must end with something runnable and demoed with seed data.

1. **Scaffold + rundown editor core:** monorepo, DB schema, auth-less single-rundown mode. Grid with default columns, row CRUD, drag-and-drop reorder, TipTap cells, group-header rows. Seed a realistic demo rundown ("Sales Kick-Off Day 1" like the screenshots: Walk in, Welcome & Applause, Highlight Reel, Announcements…).
2. **Timing engine:** durations, cascading start times, hard starts, hide/mute duration, planned start/dur/end header math. Pure, unit-tested module — this logic must be bulletproof.
3. **Live mode:** Start/Pause/Previous/Next/Stop, active-row highlight, over/under + show drift + projected end, LIVE indicator. Multi-client follow via Yjs awareness.
4. **Views:** Speaker Timer and Prompter, each with a pop-out shareable route.
5. **Accounts & structure:** teams, events dashboard (upcoming/past/archived, labels, owners, branding), create-event and create-rundown modals, templates, CSV import/export.
6. **Sharing & history:** Guest Pass links with column visibility, version history, Docker packaging, README with self-host instructions.

**Researched future scope (post-v1, do not build yet, but don't design it out):** per-event task management — task lists with reusable templates, nested subtasks, milestones, dependencies, priorities/statuses/tags/watchers, time estimates; list + Gantt + month-calendar views over the same tasks; public read-only calendar share links; a per-event content hub (rich-text notes, file uploads, links); per-event team chat with @mentions; notifications to assignees/watchers; guest users who see only their assigned tasks; an org-level dashboard with KPI tiles and a cross-event timeline. Details live in the local research notes.

Start with Phase 1. Before writing code, propose the DB schema and the Yjs document shape for a rundown (rows, columns, cells, timing fields) for my review — the sync model is the hardest thing to change later, so we get that right first.
