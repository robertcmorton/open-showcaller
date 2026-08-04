# Open Showcaller

An open-source, self-hostable rundown and show-calling app for live event production.

Producers build a minute-by-minute rundown of a show (corporate keynotes, conferences, broadcasts), then run it live while the whole crew follows along in real time on their own devices: cascading cue timing, over/under tracking, speaker timers, a synced teleprompter, and read-only guest links.

## Status

Pre-build. The full product spec and kickoff prompt live in [BUILD_PROMPT.md](BUILD_PROMPT.md). Project history is tracked in [CHANGELOG.md](CHANGELOG.md).

## Planned stack

TypeScript monorepo (pnpm + Turborepo) · Next.js + React + Tailwind · Yjs + Hocuspocus for real-time sync · TipTap rich text · PostgreSQL + Drizzle · Docker Compose for one-command self-hosting · MIT license.
