# OpenCall

An open-source, self-hostable rundown and show-calling app for live event production.

Producers build a minute-by-minute rundown of a show (corporate keynotes, conferences, broadcasts), then run it live while the whole crew follows along in real time on their own devices: cascading cue timing, over/under tracking, speaker timers, a synced teleprompter, and read-only guest links.

## Status

**Phase 1 scaffold complete.** The monorepo builds, tests pass, the seed round-trips a rundown document through the database and timing engine, and the sync server passes a two-client protocol smoke test. The full product spec lives in [BUILD_PROMPT.md](BUILD_PROMPT.md); the realtime protocol in [PROTOCOL.md](PROTOCOL.md); the data model in [docs/DATA-MODEL.md](docs/DATA-MODEL.md); history in [CHANGELOG.md](CHANGELOG.md).

## Layout

- `packages/core` — pure timing engine (cascade, anchor flags, back-timing, mute) + format helpers. Zero dependencies.
- `packages/protocol` — Zod schemas for the versioned WebSocket protocol.
- `packages/db` — Drizzle schema, Postgres/PGlite client, Yjs rundown document builder/projector, seed script.
- `apps/sync` — WebSocket show-state server (authoritative state machine, roles, idempotent commands, presence, heartbeats).
- `apps/web` — Next.js app (console + companion surfaces; Phase 2 builds the grid editor).

## Quickstart

```bash
pnpm install
pnpm test          # timing engine, protocol, doc round-trip, show state machine
pnpm seed          # seeds a demo rundown (embedded PGlite; set DATABASE_URL for Postgres)
pnpm dev           # web on :3000, sync on :8787
```

## Self-hosting

```bash
docker compose up -d            # postgres + sync + web
docker compose run --rm seed    # optional demo data
```

Then open http://localhost:3000. For a public deployment, set the three `NEXT_PUBLIC_*` build args in `docker-compose.yml` to the host browsers will reach (e.g. `https://show.example.com`), and terminate TLS in front of ports 3000/8787/8788. For development without Docker, `pnpm seed && pnpm dev` uses an embedded database — no services required.

## Stack

TypeScript monorepo (pnpm + Turborepo) · Next.js + React · Yjs (+ Hocuspocus, Phase 2) for real-time sync · TipTap rich text · PostgreSQL + Drizzle (PGlite for dev) · Docker Compose self-hosting · MIT license.
