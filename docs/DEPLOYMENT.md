# Deployment

Current production topology (since 2026-08-04):

| Piece | Where | URL / notes |
|---|---|---|
| Web app (Next.js) | **Vercel** — project `open-showcaller-web`, Root Directory `apps/web` | https://open-showcaller-web.vercel.app — auto-deploys every push to `main` |
| Sync server (HTTP API + show ws `/` + doc ws `/doc`) | **Railway** — service `@open-showcaller/sync`, Railpack builder | https://open-showcallersync-production.up.railway.app — public domain targets **port 8080** (Railway injects `PORT`) |
| PostgreSQL | **Railway** — managed Postgres with volume | `DATABASE_URL` is set on the sync service as a reference: `${{Postgres.DATABASE_URL}}` |

## Why two platforms

Vercel is serverless: ideal for the Next.js frontend (CDN, previews, zero config) but it **cannot host long-lived WebSocket servers**, which the sync server is. Railway runs persistent processes, so the sync server and its database live there. The web app could also be consolidated onto Railway if a single platform is preferred; Vercel is used because it's free for this tier and purpose-built for Next.js.

## Configuration

Web (Vercel → Project → Environment Variables, **build-time**, so changing them requires a fresh build):

```
NEXT_PUBLIC_SYNC_HTTP_URL=https://open-showcallersync-production.up.railway.app
NEXT_PUBLIC_SYNC_WS_URL=wss://open-showcallersync-production.up.railway.app
NEXT_PUBLIC_DOC_WS_URL=wss://open-showcallersync-production.up.railway.app/doc
```

Sync (Railway → service → Variables):

```
DATABASE_URL=${{Postgres.DATABASE_URL}}
# PORT is injected by Railway (8080); the app falls back to 8787 locally.
```

The server runs idempotent DDL on boot, so a fresh database initializes itself — no manual migration step.

## Operational notes

- **Railway watch path** is `/apps/sync/**`: changes outside it (e.g. the root lockfile) do NOT trigger a rebuild — push a change under `apps/sync/` or trigger a build manually. Railway's "Redeploy" reuses the *same commit*; it does not pick up new pushes.
- Vercel rebuilds on every push; `NEXT_PUBLIC_*` values are inlined at build time.
- Deploys currently use Railway's Railpack builder (tsx runtime), not the repo Dockerfiles; the Dockerfiles remain for self-hosting via `docker-compose.yml`.

## ⚠️ Security status

The management HTTP API and the `/doc` channel are **not yet authenticated** — anyone with the sync URL can read/write data. Join codes gate the show channel only. Treat the deployment as demo-only until API gating lands (top hardening priority). Do not store sensitive production data before then.
