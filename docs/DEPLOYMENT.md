# Deployment

Everything runs on **Railway** in one project named `opencall` (consolidated 2026-08-04; an initial Vercel deployment of the web app was retired the same day to keep a single platform; renamed from the OpenCall rename on 2026-08-05).

| Service | What it runs | URL / notes |
|---|---|---|
| `opencall` | Web app (Next.js) | https://opencall-web-production.up.railway.app — domain targets port **3000** (`PORT=3000` set explicitly; the bare `opencall-production` subdomain was already taken on Railway) |
| `opencall-sync` | Sync server: HTTP API + show channel (ws `/`) + doc sync (ws `/doc`) | https://opencall-sync-production.up.railway.app — domain targets port **8080** (Railway-injected `PORT`) |
| `Postgres` | Managed PostgreSQL with volume | referenced by sync as `DATABASE_URL=${{Postgres.DATABASE_URL}}` |

Both app services build from the same GitHub repo (`main`, auto-deploy) with the Railpack builder at the repo root:

- web: build `pnpm --filter @opencall/web build`, start `pnpm --filter @opencall/web start`, watch `/apps/web/**`
- sync: build `pnpm --filter @opencall/sync build`, start `pnpm --filter @opencall/sync start`, watch `/apps/sync/**`

## Web service variables (build-time — changing them requires a rebuild)

```
NEXT_PUBLIC_SYNC_HTTP_URL=https://opencall-sync-production.up.railway.app
NEXT_PUBLIC_SYNC_WS_URL=wss://opencall-sync-production.up.railway.app
NEXT_PUBLIC_DOC_WS_URL=wss://opencall-sync-production.up.railway.app/doc
PORT=3000
```

Sync service variables: `DATABASE_URL=${{Postgres.DATABASE_URL}}` (PORT is Railway-injected). The sync server runs idempotent DDL on boot, so a fresh database initializes itself.

## Operational notes

- **Watch paths** mean changes outside `/apps/<service>/**` (e.g. `packages/*`, the root lockfile) do **not** trigger that service's rebuild — push a touch inside the service dir or redeploy manually. Railway's "Redeploy" reuses the *same commit*; it does not pick up new pushes.
- Deploys use Railway's Railpack builder (tsx runtime), not the repo Dockerfiles; the Dockerfiles remain for self-hosting via `docker-compose.yml`.
- Costs: Railway trial credit first, then roughly $5–10/mo for the three services at hobby usage.

## ⚠️ Security status

The management HTTP API and the `/doc` channel are **not yet authenticated** — anyone with the sync URL can read/write data. Join codes gate the show channel only. Treat the deployment as demo-only until API gating lands (top hardening priority). Do not store sensitive production data before then.
