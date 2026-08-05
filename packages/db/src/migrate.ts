import { sql } from "drizzle-orm";
import type { Db } from "./client";

/**
 * Phase-1 bootstrap DDL. Replaced by generated drizzle-kit migrations once the
 * schema settles (tracked for Phase 6). Statements run one at a time — the
 * extended query protocol does not accept multi-statement strings.
 */
export async function ensureSchema(db: Db): Promise<void> {
  const ddl = `
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
  for (const statement of ddl.split(";")) {
    const trimmed = statement.trim();
    if (trimmed) await db.execute(sql.raw(trimmed));
  }
}
