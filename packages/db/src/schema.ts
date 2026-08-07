import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => "bytea",
  toDriver: (value) => Buffer.from(value),
  fromDriver: (value) => new Uint8Array(value),
});

const id = (name = "id") => text(name);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// ── Identity & teams ───────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: id().primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  accessToken: text("access_token").unique(),
  passwordHash: text("password_hash"),
  imageUrl: text("image_url"),
  createdAt: createdAt(),
});

export const teams = pgTable("teams", {
  id: id().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  companyToken: text("company_token").unique(),
  logo: text("logo"),
  createdAt: createdAt(),
});

/** Password-login sessions: a `ses_…` bearer token per signed-in browser, revocable server-side. */
export const authSessions = pgTable("auth_sessions", {
  id: id().primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  token: text("token").notNull().unique(),
  createdAt: createdAt(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  userAgent: text("user_agent"),
});

export const teamRoles = ["owner", "admin", "editor", "viewer"] as const;

/** Access grants: what a user controls. kind admin | company | event | view. */
export const grantKinds = ["admin", "company", "event", "view"] as const;

export const userGrants = pgTable(
  "user_grants",
  {
    userId: text("user_id").notNull().references(() => users.id),
    kind: text("kind", { enum: grantKinds }).notNull(),
    targetId: text("target_id").notNull().default(""),
  },
  (t) => [primaryKey({ columns: [t.userId, t.kind, t.targetId] })],
);

export const teamMembers = pgTable(
  "team_members",
  {
    teamId: text("team_id").notNull().references(() => teams.id),
    userId: text("user_id").notNull().references(() => users.id),
    role: text("role", { enum: teamRoles }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.userId] })],
);

// ── Events & rundowns ──────────────────────────────────────────────────────────

export const events = pgTable("events", {
  id: id().primaryKey(),
  teamId: text("team_id").notNull().references(() => teams.id),
  name: text("name").notNull(),
  location: text("location"),
  startDate: text("start_date").notNull(), // ISO date, event-local
  endDate: text("end_date").notNull(),
  timezone: text("timezone").notNull(),
  use24h: boolean("use_24h").notNull().default(false),
  image1: text("image1"),
  image2: text("image2"),
  labels: jsonb("labels").$type<{ text: string; color: string }[]>().notNull().default([]),
  brandingImageKey: text("branding_image_key"),
  ownerUserId: text("owner_user_id").references(() => users.id),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rundowns = pgTable("rundowns", {
  id: id().primaryKey(),
  eventId: text("event_id").notNull().references(() => events.id),
  name: text("name").notNull(),
  description: text("description"),
  showDate: text("show_date"),
  plannedStartSec: integer("planned_start_sec"),
  doc: bytea("doc"),
  docUpdatedAt: timestamp("doc_updated_at", { withTimezone: true }),
  /** Bumped on in-place restore: doc connections are scoped to `<id>@<epoch>`, so stale clients can never merge old state back. */
  docEpoch: integer("doc_epoch").notNull().default(0),
  /** The imported run sheet, kept so Update import can re-read it with the current pipeline. */
  sourceName: text("source_name"),
  sourceFile: bytea("source_file"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rundownSnapshots = pgTable("rundown_snapshots", {
  id: id().primaryKey(),
  rundownId: text("rundown_id").notNull().references(() => rundowns.id),
  doc: bytea("doc").notNull(),
  label: text("label"),
  createdBy: text("created_by").references(() => users.id),
  createdAt: createdAt(),
});

export const templates = pgTable("templates", {
  id: id().primaryKey(),
  teamId: text("team_id").references(() => teams.id), // null = built-in starter template
  name: text("name").notNull(),
  description: text("description"),
  doc: bytea("doc").notNull(),
  createdBy: text("created_by").references(() => users.id),
  createdAt: createdAt(),
});

export const eventFolders = pgTable("event_folders", {
  id: id().primaryKey(),
  eventId: text("event_id").notNull().references(() => events.id),
  parentId: text("parent_id"),
  name: text("name").notNull(),
});

export const eventFiles = pgTable("event_files", {
  id: id().primaryKey(),
  eventId: text("event_id").notNull().references(() => events.id),
  folderId: text("folder_id"),
  name: text("name").notNull(),
  mime: text("mime").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  storageKey: text("storage_key").notNull(),
  uploadedBy: text("uploaded_by").references(() => users.id),
  createdAt: createdAt(),
});

// ── Sharing & joining ──────────────────────────────────────────────────────────

export const shareTokenKinds = ["guest", "join"] as const;
export const shareRoles = ["caller", "editor", "follower", "guest"] as const;

export const shareTokens = pgTable("share_tokens", {
  id: id().primaryKey(),
  rundownId: text("rundown_id").notNull().references(() => rundowns.id),
  kind: text("kind", { enum: shareTokenKinds }).notNull(),
  token: text("token").notNull().unique(),
  joinCode: text("join_code").unique(),
  role: text("role", { enum: shareRoles }).notNull(),
  columnVisibility: jsonb("column_visibility").$type<Record<string, boolean>>(),
  createdBy: text("created_by").references(() => users.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

// ── Live show state ────────────────────────────────────────────────────────────

export const showSessionStates = ["running", "paused", "ended"] as const;

export const showSessions = pgTable(
  "show_sessions",
  {
    id: id().primaryKey(),
    rundownId: text("rundown_id").notNull().references(() => rundowns.id),
    state: text("state", { enum: showSessionStates }).notNull(),
    activeRowId: text("active_row_id"),
    activeRowStartedAt: timestamp("active_row_started_at", { withTimezone: true }),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    pausedAccumMs: bigint("paused_accum_ms", { mode: "number" }).notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    callerUserId: text("caller_user_id").references(() => users.id),
    seq: bigint("seq", { mode: "number" }).notNull().default(0),
    /** Server-driven clock-follow: the scheduler advances this session along the TIME column, no console required. */
    clockFollow: boolean("clock_follow").notNull().default(false),
  },
  (t) => [
    uniqueIndex("one_live_session_per_rundown")
      .on(t.rundownId)
      .where(sql`${t.state} <> 'ended'`),
  ],
);

export const transitionTypes = ["start", "pause", "resume", "next", "prev", "jump", "stop", "fire", "clock_on", "clock_off"] as const;

export const showTransitions = pgTable("show_transitions", {
  id: id().primaryKey(),
  sessionId: text("session_id").notNull().references(() => showSessions.id),
  at: timestamp("at", { withTimezone: true }).notNull(),
  type: text("type", { enum: transitionTypes }).notNull(),
  rowId: text("row_id"),
  actorUserId: text("actor_user_id").references(() => users.id),
});

// ── Error log (server-kept; reviewed from the admin dashboard) ─────────────────

export const errorLogs = pgTable("error_logs", {
  id: id().primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  /** Where it happened: server (API), process (crash-level), client (browser). */
  source: text("source").notNull(),
  message: text("message").notNull(),
  stack: text("stack"),
  url: text("url"),
  userAgent: text("user_agent"),
  context: jsonb("context").$type<Record<string, unknown>>(),
});

// ── Per-user personalization (never in the CRDT) ───────────────────────────────

export const userRundownPrefs = pgTable(
  "user_rundown_prefs",
  {
    userId: text("user_id").notNull().references(() => users.id),
    rundownId: text("rundown_id").notNull().references(() => rundowns.id),
    columnLayout: jsonb("column_layout").$type<{ order: string[]; hidden: string[] }>(),
    theme: text("theme"),
    notes: jsonb("notes").$type<Record<string, string>>(),
    highlights: jsonb("highlights").$type<Record<string, string>>(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.rundownId] })],
);
