import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import type { Db } from "./client";

/**
 * The pre-migration bootstrap DDL (idempotent). Kept ONLY to baseline
 * databases created before generated migrations existed: it runs once to
 * bring any straggler to the schema the 0000 baseline describes, after which
 * every file in ./drizzle is marked applied and this string never runs again.
 * New schema changes are drizzle-kit migrations — do not extend this.
 */
const LEGACY_DDL = `
    CREATE TABLE IF NOT EXISTS users (
      id text PRIMARY KEY,
      email text NOT NULL UNIQUE,
      name text NOT NULL,
      password_hash text,
      image_url text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS teams (
      id text PRIMARY KEY,
      name text NOT NULL,
      slug text NOT NULL UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS team_members (
      team_id text NOT NULL REFERENCES teams(id),
      user_id text NOT NULL REFERENCES users(id),
      role text NOT NULL,
      PRIMARY KEY (team_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS events (
      id text PRIMARY KEY,
      team_id text NOT NULL REFERENCES teams(id),
      name text NOT NULL,
      location text,
      start_date text NOT NULL,
      end_date text NOT NULL,
      timezone text NOT NULL,
      use_24h boolean NOT NULL DEFAULT false,
      labels jsonb NOT NULL DEFAULT '[]',
      branding_image_key text,
      owner_user_id text REFERENCES users(id),
      archived_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS rundowns (
      id text PRIMARY KEY,
      event_id text NOT NULL REFERENCES events(id),
      name text NOT NULL,
      description text,
      show_date text,
      planned_start_sec integer,
      doc bytea,
      doc_updated_at timestamptz,
      archived_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS rundown_snapshots (
      id text PRIMARY KEY,
      rundown_id text NOT NULL REFERENCES rundowns(id),
      doc bytea NOT NULL,
      label text,
      created_by text REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS templates (
      id text PRIMARY KEY,
      team_id text REFERENCES teams(id),
      name text NOT NULL,
      description text,
      doc bytea NOT NULL,
      created_by text REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS event_folders (
      id text PRIMARY KEY,
      event_id text NOT NULL REFERENCES events(id),
      parent_id text,
      name text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS event_files (
      id text PRIMARY KEY,
      event_id text NOT NULL REFERENCES events(id),
      folder_id text,
      name text NOT NULL,
      mime text NOT NULL,
      size_bytes bigint NOT NULL,
      storage_key text NOT NULL,
      uploaded_by text REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS share_tokens (
      id text PRIMARY KEY,
      rundown_id text NOT NULL REFERENCES rundowns(id),
      kind text NOT NULL,
      token text NOT NULL UNIQUE,
      join_code text UNIQUE,
      role text NOT NULL,
      column_visibility jsonb,
      created_by text REFERENCES users(id),
      expires_at timestamptz,
      revoked_at timestamptz
    );
    CREATE TABLE IF NOT EXISTS show_sessions (
      id text PRIMARY KEY,
      rundown_id text NOT NULL REFERENCES rundowns(id),
      state text NOT NULL,
      active_row_id text,
      active_row_started_at timestamptz,
      paused_at timestamptz,
      paused_accum_ms bigint NOT NULL DEFAULT 0,
      started_at timestamptz NOT NULL,
      ended_at timestamptz,
      caller_user_id text REFERENCES users(id),
      seq bigint NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_live_session_per_rundown
      ON show_sessions (rundown_id) WHERE state <> 'ended';
    CREATE TABLE IF NOT EXISTS show_transitions (
      id text PRIMARY KEY,
      session_id text NOT NULL REFERENCES show_sessions(id),
      at timestamptz NOT NULL,
      type text NOT NULL,
      row_id text,
      actor_user_id text REFERENCES users(id)
    );
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS company_token text;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS access_token text;
    CREATE UNIQUE INDEX IF NOT EXISTS users_access_token_unique ON users (access_token);
    CREATE TABLE IF NOT EXISTS user_grants (
      user_id text NOT NULL REFERENCES users(id),
      kind text NOT NULL,
      target_id text NOT NULL DEFAULT '',
      PRIMARY KEY (user_id, kind, target_id)
    );
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS logo text;
    ALTER TABLE events ADD COLUMN IF NOT EXISTS image1 text;
    ALTER TABLE events ADD COLUMN IF NOT EXISTS image2 text;
    CREATE UNIQUE INDEX IF NOT EXISTS teams_company_token_unique ON teams (company_token);
    ALTER TABLE rundowns ADD COLUMN IF NOT EXISTS doc_epoch integer NOT NULL DEFAULT 0;
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id text PRIMARY KEY,
      user_id text NOT NULL REFERENCES users(id),
      token text NOT NULL UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      revoked_at timestamptz,
      last_seen_at timestamptz,
      user_agent text
    );
    CREATE TABLE IF NOT EXISTS error_logs (
      id text PRIMARY KEY,
      at timestamptz NOT NULL DEFAULT now(),
      source text NOT NULL,
      message text NOT NULL,
      stack text,
      url text,
      user_agent text,
      context jsonb
    );
    CREATE TABLE IF NOT EXISTS user_rundown_prefs (
      user_id text NOT NULL REFERENCES users(id),
      rundown_id text NOT NULL REFERENCES rundowns(id),
      column_layout jsonb,
      theme text,
      notes jsonb,
      highlights jsonb,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, rundown_id)
    );
  `;

const MIGRATIONS_DIR = fileURLToPath(new URL("../drizzle", import.meta.url));

/** Statements run one at a time — the extended query protocol rejects multi-statement strings. */
async function runStatements(db: Db, text: string, separator: string | RegExp): Promise<void> {
  for (const statement of text.split(separator)) {
    const trimmed = statement.trim();
    if (trimmed) await db.execute(sql.raw(trimmed));
  }
}

const rowsOf = (result: unknown): Record<string, unknown>[] =>
  (result as { rows?: Record<string, unknown>[] }).rows ?? (result as Record<string, unknown>[]);

/**
 * Applies the generated drizzle-kit migrations in ./drizzle at boot, tracked
 * in schema_migrations — a fresh database initialises itself, an up-to-date
 * one is a no-op, and there is no separate migrate command for operators.
 *
 * A database created before migrations existed (no journal, but tables
 * present) is BASELINED: the legacy idempotent DDL runs once to catch any
 * straggler up to the 0000 schema, then every current file is marked applied
 * without executing.
 *
 * Workflow for schema changes: edit src/schema.ts, run
 * `pnpm --filter @opencall/db generate`, commit the new SQL file.
 */
export async function ensureSchema(db: Db): Promise<void> {
  await db.execute(
    sql.raw(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    ),
  );
  const applied = new Set(rowsOf(await db.execute(sql.raw("SELECT name FROM schema_migrations"))).map((r) => String(r.name)));
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (applied.size === 0) {
    const probe = rowsOf(await db.execute(sql.raw("SELECT to_regclass('rundowns') AS t")));
    if (probe[0]?.t != null) {
      await runStatements(db, LEGACY_DDL, ";");
      for (const f of files) await db.execute(sql`INSERT INTO schema_migrations (name) VALUES (${f}) ON CONFLICT DO NOTHING`);
      return;
    }
  }

  for (const f of files) {
    if (applied.has(f)) continue;
    await runStatements(db, readFileSync(join(MIGRATIONS_DIR, f), "utf8"), /-->\s*statement-breakpoint/);
    await db.execute(sql`INSERT INTO schema_migrations (name) VALUES (${f})`);
  }
}
