# Changelog

All notable changes to this project are documented here, newest first.
Format follows [Keep a Changelog](https://keepachangelog.com/); the project is not yet versioned, so everything sits under **Unreleased**.

> Maintenance rule (see CLAUDE.md): update this file in the same commit as any meaningful change. Entries are written generically — no references to external vendors or reference material.

## [Unreleased]

### Added — 2026-08-04
- Completed a third research pass: hands-on exploration of a desktop timecode-driven show-automation reference app. Recorded in local research notes: frame-accurate cue timelines chased by external timecode, typed automation tracks (camera cuts, graphics, OSC/MIDI/HTTP/GPIO, text, playback), live-punch cue authoring, live override controls (skip/hold/take), per-cue flags/markers/auto-numbering, and companion-device pairing. Spec's future-scope section extended with a possible timecode-chase "pro mode" and live override verbs.
- Project kickoff: product spec and build prompt ([BUILD_PROMPT.md](BUILD_PROMPT.md)), README, and permanent project rules ([CLAUDE.md](CLAUDE.md)).
- Completed a detailed product-research pass for the core rundown/show-caller scope; findings captured in local research notes (kept out of the repo by design). Spec updated with: overflow-menu structure (Settings / Views / Export / Guest Pass / History), prompter behavior and controls, speaker-timer sharing, guest-pass column visibility, event content model (rundowns, folders, file uploads, CSV import), and timing-engine details (cascade recalculation, hard starts, hide/mute duration).
- Completed a second research pass covering event project management; recorded as future (post-v1) scope: task lists with reusable templates, nested subtasks, milestones, dependencies, tags and watchers; list/Gantt/calendar views; public read-only calendar links; per-event content hub (notes, files, links); per-event team chat; notification fan-out to assignees and watchers; guest users with task-scoped visibility; org-level KPI dashboard.
- This changelog.

### Changed — 2026-08-04
- Repo hygiene: all reference material moved to local-only files excluded via `.gitignore`; git history rewritten to a single clean root commit containing no reference material.
