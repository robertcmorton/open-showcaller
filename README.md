# OpenCall

An open-source, self-hostable rundown and show-calling app for live event production.

Producers build a minute-by-minute rundown of a show (corporate keynotes, conferences, sport presentation, broadcasts), then run it live while the whole crew follows along in real time on their own devices: cascading cue timing, anchored hard times, over/under tracking, per-role highlighting with a personal "you're on next" bar, speaker timers, a synced teleprompter, and read-only guest links.

## What it does today

- **Rundown editor** — collaborative real-time grid (every edit syncs live to every open screen), cascade timing with fixed start times set by double-clicking, milestones, section banners, row colours, hidden/muted durations, undo/redo over every row edit, per-user column visibility, boundary-transfer column resizing (edges stay pinned), and rename-on-double-click column headers.
- **Run sheets in** — import XLSX / XLS / CSV / **PDF** run sheets with a full-length mapping preview: columns keep the sheet's own names and order, wrapped PDF rows merge back into one row per item, roles (WHO/ROLE columns) are detected and colour-coded, alternate-ending blocks (win / lose / golden point) tag themselves from their banners, and a fix-it list repairs unparseable cells with context. "Update import" re-reads the stored sheet with the latest pipeline in one click.
- **Show calling** — start/pause/advance a live show; the active cue row grows with a CUE badge and a full-cell progress sweep, a big dead-centre timer counts the item (green/amber/red), skipped rows drop out of timing, and edits ripple: changing a duration or a start time shifts every fixed time below it (one undo reverses all of it). A timing check explains, in plain words, every place a sheet's times and durations disagree — and fixes the whole chain in one action.
- **Runs itself when it must** — server-driven clock-follow advances the show along the TIME column with every console closed (the live fail-safe); the showcaller stays in charge on the fly. A pre-show walkthrough mode steps a shared highlight through the sheet on every device before the show starts.
- **Sport-aware endings** — events can carry a sport (NRL first): at full time the console offers Win / Lose / ⚡ Golden point, golden point loops back to a final Win / Lose / Draw pick, and the chooser pulses as the decision point approaches (position-based, so stoppage time never breaks it).
- **Crew screens** — `/show` (full console), `/edit` (content only), `/view` (read-only), plus `/follow`, `/timer`, and `/prompter` companion surfaces. Everyone can pick "my role" (several at once) for personal highlights and an on-air countdown bar.
- **Access control** — admin token, per-company showcaller tokens, per-user email+password accounts with grants (admin / company / event / view-only), a self-service account page, and per-rundown join codes that carry the holder's name and revoke instantly. View grants get read-only documents, enforced server-side.
- **Operations** — event companies → events → rundowns hierarchy, archive, templates, snapshots and in-place restore, as-run show reports (CSV), guest passes with column filtering, DST-correct event-timezone clocks chosen from a worldwide dropdown, print/PDF/CSV export, and a server-kept error log reviewable from the admin dashboard.

The product spec lives in [BUILD_PROMPT.md](BUILD_PROMPT.md); the realtime protocol in [PROTOCOL.md](PROTOCOL.md); the data model in [docs/DATA-MODEL.md](docs/DATA-MODEL.md); history in [CHANGELOG.md](CHANGELOG.md).

## Layout

- `packages/core` — pure timing engine (cascade, anchor flags, back-timing, mute) + import parsing + format helpers. Zero dependencies.
- `packages/protocol` — Zod schemas for the versioned WebSocket protocol.
- `packages/db` — Drizzle schema, Postgres/PGlite client, Yjs rundown document builder/projector, seed script.
- `apps/sync` — the server: HTTP management API, WebSocket show channel (`/`), and Yjs document sync (`/doc`) on **one port**.
- `apps/web` — Next.js app (admin dashboard, console, and companion surfaces).

## Quickstart (local development)

```bash
pnpm install
pnpm test          # timing engine, import parsing, protocol, doc round-trip, show state machine
pnpm seed          # seeds a demo rundown (embedded PGlite; set DATABASE_URL for Postgres)
pnpm dev           # web on :3000, sync on :8787
```

No database service is needed for development — an embedded PGlite database lives in `.pglite/`. Without `ADMIN_TOKEN` set the server runs **dev-open** (every request is treated as admin). Never expose a dev-open server to the internet.

---

## Self-hosting

OpenCall is two services plus a database:

| Piece | What it is | Port | Health check |
|---|---|---|---|
| **web** | Next.js frontend | 3000 | `GET /` → 200 |
| **sync** | HTTP API + show WebSocket (`/`) + doc WebSocket (`/doc`) — one port | 8787 (or `PORT`) | `GET /me` → `{"role":null}` when locked |
| **PostgreSQL** | data store (versioned migrations apply automatically at boot — no manual step) | 5432 | `pg_isready` |

### Environment variables

**sync** (runtime):

| Variable | Required | Meaning |
|---|---|---|
| `DATABASE_URL` | yes in production | Postgres connection string. Unset → embedded PGlite in `.pglite/` (single machine, dev only). |
| `ADMIN_TOKEN` | **yes in production** | Locks the deployment. Any long random string (e.g. `oc_admin_$(openssl rand -hex 20)`). Unset = dev-open: **everyone is admin**. |
| `ALLOW_DEV_JOIN` | set to `0` in production | Disables the `DEV123` local-dev join code. |
| `PORT` | optional | Listen port (default 8787). |

**web** (build-time — these are baked into the browser bundle, so changing them requires a rebuild):

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SYNC_HTTP_URL` | `https://<sync-host>` — the sync server URL browsers can reach |
| `NEXT_PUBLIC_SYNC_WS_URL` | `wss://<sync-host>` |
| `NEXT_PUBLIC_DOC_WS_URL` | `wss://<sync-host>/doc` |
| `PORT` | `3000` (runtime) |

Use `https://`/`wss://` in production and make sure your proxy/host **passes WebSocket upgrades** through to the sync service.

### Option A — Docker Compose (any VPS)

```bash
git clone https://github.com/robertcmorton/opencall.git && cd opencall
# Edit docker-compose.yml: set the three NEXT_PUBLIC_* build args to the
# public URL of your sync host, and change the Postgres password. Then:
export ADMIN_TOKEN="oc_admin_$(openssl rand -hex 20)"   # save this — it is the admin login
docker compose up -d --build
docker compose run --rm seed    # optional demo data
```

Put TLS in front (Caddy, nginx, Traefik) of ports 3000 (web) and 8787 (sync, **with WebSocket upgrade enabled**).

### Option B — a PaaS (Railway, Render, Fly, …)

Create three services from this repo:

1. **PostgreSQL** — the platform's managed Postgres.
2. **sync** — build `pnpm --filter @opencall/sync build`, start `pnpm --filter @opencall/sync start`, root directory = repo root. Set `DATABASE_URL` (reference the managed Postgres), `ADMIN_TOKEN`, `ALLOW_DEV_JOIN=0`. Most platforms inject `PORT` — the server honours it. Give it a public domain.
3. **web** — build `pnpm --filter @opencall/web build`, start `pnpm --filter @opencall/web start`, root directory = repo root. Set the three `NEXT_PUBLIC_*` variables to the sync service's public domain (they must be present **at build time**) plus `PORT=3000`. Give it a public domain.

The sync server applies its bundled migrations on boot, so a fresh database initialises itself and upgrades apply automatically — there is no migration command to run.

### Option C — bare Node on a server

```bash
git clone https://github.com/robertcmorton/opencall.git && cd opencall
corepack enable && pnpm install
NEXT_PUBLIC_SYNC_HTTP_URL=https://sync.example.com \
NEXT_PUBLIC_SYNC_WS_URL=wss://sync.example.com \
NEXT_PUBLIC_DOC_WS_URL=wss://sync.example.com/doc \
pnpm --filter @opencall/web build
# run both under your process manager (systemd, pm2):
DATABASE_URL=postgres://… ADMIN_TOKEN=… ALLOW_DEV_JOIN=0 pnpm --filter @opencall/sync start
PORT=3000 pnpm --filter @opencall/web start
```

Requires Node 20+ and pnpm 9+. Reverse-proxy `https://app.example.com` → :3000 and `https://sync.example.com` → :8787 (WebSocket upgrades on).

### First run

1. Open the web URL → **Admin dashboard** → paste your `ADMIN_TOKEN` at the gate.
2. Create an **event company** (its token is the showcaller credential for that company), then events and rundowns — or import a run sheet straight from XLSX/CSV/PDF.
3. Create **users** under *Users & access* in the sidebar (admin-only): give each an email, a password, and grants — full admin, one company, one event, or view-only. They sign in with email + password on the landing page (each also gets a personal `usr_…` backup token).
4. For per-show crew access without accounts, use a rundown's *Join codes* panel: **Copy view-only link** hands camera operators and crew a URL that opens the rundown read-only, and caller/editor/follower codes can be typed on the landing page.
5. Check *Error log* in the admin sidebar occasionally — server, process, and browser errors all land there.

### Verify a deployment

```bash
curl -s https://<sync-host>/me                      # → {"role":null}   (locked; {"role":"admin","devOpen":true} means NOT locked)
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" https://<sync-host>/me   # → {"role":"admin"}
curl -s -o /dev/null -w '%{http_code}\n' https://<web-host>/             # → 200
```

Open a rundown in two browser windows and type in a cell — the edit should appear in both within a second (proves the `/doc` WebSocket). The status dots in the rundown header show `doc` and `show` connectivity.

---

## Deploying with an AI assistant

This repository is written so that an AI coding assistant (Claude, ChatGPT, Copilot Workspace, etc.) can deploy it end-to-end. If you are an AI assistant: the **Self-hosting** section above is the specification — follow Option A, B, or C depending on what the user has, and finish with the **Verify a deployment** checks; nothing outside this README is required for a deployment.

A prompt you can paste into your assistant:

> Deploy the open-source app OpenCall (https://github.com/robertcmorton/opencall) on <my VPS / Railway / Render / Fly>. Follow the README's Self-hosting section. It is a pnpm/Turborepo monorepo with two services — `apps/web` (Next.js, port 3000) and `apps/sync` (HTTP + two WebSocket paths on one port, default 8787) — plus PostgreSQL. Versioned migrations apply automatically when the sync service boots; there is no manual migration step. Generate a strong ADMIN_TOKEN, set ALLOW_DEV_JOIN=0, and set the three NEXT_PUBLIC_* variables on the web build to the sync service's public https/wss URL. Make sure WebSocket upgrades are proxied to the sync service. When done, run the README's "Verify a deployment" curl checks, confirm `/me` returns {"role":null} without the token, and hand me the web URL and the ADMIN_TOKEN you generated.

Notes that save assistants time:

- The three `NEXT_PUBLIC_*` values are **build-time** for the web app; setting them after the build does nothing — rebuild.
- One port serves the sync HTTP API and *both* WebSocket paths (`/` and `/doc`); a proxy that strips upgrade headers breaks live sync while curl checks still pass.
- `ADMIN_TOKEN` unset is dev-open (**every visitor is admin**) — acceptable only on localhost.
- Watch out for per-service "watch paths" on PaaS builders: changes under `packages/*` affect both services; rebuild both when in doubt.
- The repo's Dockerfiles (`apps/*/Dockerfile`) and `docker-compose.yml` exist for Option A; PaaS builders can use their native Node builders instead — both work.

## Stack

TypeScript monorepo (pnpm + Turborepo) · Next.js + React · Yjs + Hocuspocus for real-time sync · TipTap rich text · PostgreSQL + Drizzle (PGlite for dev) · Docker Compose self-hosting · MIT license.
