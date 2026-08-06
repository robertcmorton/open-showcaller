CREATE TABLE "auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"user_agent" text,
	CONSTRAINT "auth_sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "error_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"message" text NOT NULL,
	"stack" text,
	"url" text,
	"user_agent" text,
	"context" jsonb
);
--> statement-breakpoint
CREATE TABLE "event_files" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"folder_id" text,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"storage_key" text NOT NULL,
	"uploaded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_folders" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"parent_id" text,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"name" text NOT NULL,
	"location" text,
	"start_date" text NOT NULL,
	"end_date" text NOT NULL,
	"timezone" text NOT NULL,
	"use_24h" boolean DEFAULT false NOT NULL,
	"image1" text,
	"image2" text,
	"labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"branding_image_key" text,
	"owner_user_id" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rundown_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"rundown_id" text NOT NULL,
	"doc" "bytea" NOT NULL,
	"label" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rundowns" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"show_date" text,
	"planned_start_sec" integer,
	"doc" "bytea",
	"doc_updated_at" timestamp with time zone,
	"doc_epoch" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "share_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"rundown_id" text NOT NULL,
	"kind" text NOT NULL,
	"token" text NOT NULL,
	"join_code" text,
	"role" text NOT NULL,
	"column_visibility" jsonb,
	"created_by" text,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "share_tokens_token_unique" UNIQUE("token"),
	CONSTRAINT "share_tokens_join_code_unique" UNIQUE("join_code")
);
--> statement-breakpoint
CREATE TABLE "show_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"rundown_id" text NOT NULL,
	"state" text NOT NULL,
	"active_row_id" text,
	"active_row_started_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"paused_accum_ms" bigint DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"caller_user_id" text,
	"seq" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "show_transitions" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"type" text NOT NULL,
	"row_id" text,
	"actor_user_id" text
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"team_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "team_members_team_id_user_id_pk" PRIMARY KEY("team_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"company_token" text,
	"logo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_slug_unique" UNIQUE("slug"),
	CONSTRAINT "teams_company_token_unique" UNIQUE("company_token")
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text,
	"name" text NOT NULL,
	"description" text,
	"doc" "bytea" NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_grants" (
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"target_id" text DEFAULT '' NOT NULL,
	CONSTRAINT "user_grants_user_id_kind_target_id_pk" PRIMARY KEY("user_id","kind","target_id")
);
--> statement-breakpoint
CREATE TABLE "user_rundown_prefs" (
	"user_id" text NOT NULL,
	"rundown_id" text NOT NULL,
	"column_layout" jsonb,
	"theme" text,
	"notes" jsonb,
	"highlights" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_rundown_prefs_user_id_rundown_id_pk" PRIMARY KEY("user_id","rundown_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"access_token" text,
	"password_hash" text,
	"image_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_access_token_unique" UNIQUE("access_token")
);
--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_files" ADD CONSTRAINT "event_files_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_files" ADD CONSTRAINT "event_files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_folders" ADD CONSTRAINT "event_folders_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rundown_snapshots" ADD CONSTRAINT "rundown_snapshots_rundown_id_rundowns_id_fk" FOREIGN KEY ("rundown_id") REFERENCES "public"."rundowns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rundown_snapshots" ADD CONSTRAINT "rundown_snapshots_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rundowns" ADD CONSTRAINT "rundowns_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_tokens" ADD CONSTRAINT "share_tokens_rundown_id_rundowns_id_fk" FOREIGN KEY ("rundown_id") REFERENCES "public"."rundowns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_tokens" ADD CONSTRAINT "share_tokens_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "show_sessions" ADD CONSTRAINT "show_sessions_rundown_id_rundowns_id_fk" FOREIGN KEY ("rundown_id") REFERENCES "public"."rundowns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "show_sessions" ADD CONSTRAINT "show_sessions_caller_user_id_users_id_fk" FOREIGN KEY ("caller_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "show_transitions" ADD CONSTRAINT "show_transitions_session_id_show_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."show_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "show_transitions" ADD CONSTRAINT "show_transitions_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_grants" ADD CONSTRAINT "user_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_rundown_prefs" ADD CONSTRAINT "user_rundown_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_rundown_prefs" ADD CONSTRAINT "user_rundown_prefs_rundown_id_rundowns_id_fk" FOREIGN KEY ("rundown_id") REFERENCES "public"."rundowns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "one_live_session_per_rundown" ON "show_sessions" USING btree ("rundown_id") WHERE "show_sessions"."state" <> 'ended';