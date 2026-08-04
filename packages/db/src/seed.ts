import { ulid } from "ulid";
import { computeTiming, formatDuration, formatTimeOfDay } from "@open-showcaller/core";
import { createDb } from "./client";
import { ensureSchema } from "./migrate";
import { buildRundownDoc, decodeDoc, encodeDoc, projectRundownDoc, type SeedRow } from "./doc";
import { events, rundowns, teamMembers, teams, users } from "./schema";

const NINE_AM = 9 * 3600;

const DEMO_ROWS: SeedRow[] = [
  { type: "group", title: "Walk in", hardStartSec: NINE_AM, color: "#3d3325" },
  {
    type: "cue",
    title: "Welcome & Applause",
    durationSec: 90,
    cells: {
      audio: "Lav 1\nRoom Mic",
      video: "Welcome Loop",
      lights: "Single Presenter",
      script:
        "Good morning, everyone, and welcome to Day 1 of our Sales Kick-Off! We're so excited to have you here — whether you've traveled across the country or are tuning in virtually, thank you for making time for yourself, your team, and our shared success.",
    },
  },
  {
    type: "cue",
    title: "Acknowledge Remote Attendance",
    durationSec: 90,
    cells: {
      audio: "Lav 2",
      lights: "Single Presenter",
      script:
        "Before we dive in, a special shout-out to our teammates joining from all over the map. You are every bit as much a part of this as those in the room.",
    },
  },
  {
    type: "cue",
    title: "Highlight Reel",
    durationSec: 180,
    cells: {
      audio: "Sys Audio",
      video: "SKO_Highlights_v3.mp4",
      lights: "Stage Dark",
      script: "Before we jump into today's agenda, let's take a moment to celebrate what we accomplished together last year.",
    },
  },
  {
    type: "cue",
    title: "Announcements",
    durationSec: 120,
    cells: {
      audio: "Lav 1",
      lights: "Single Presenter",
      script: "Alright team, before we get into today's sessions, a few exciting updates from across the company.",
    },
  },
  { type: "group", title: "Development", color: "#3d3325" },
  {
    type: "cue",
    title: "Keynote: The Year Ahead",
    durationSec: 1200,
    cells: {
      audio: "Lav 3",
      video: "Keynote Deck",
      lights: "Warm Wash",
      graphics: "Lower third: CEO",
      script: "It's an exciting time to be part of this team, and today's all about equipping you with the tools, knowledge, and inspiration for your best year yet.",
    },
  },
];

async function main(): Promise<void> {
  const handle = await createDb();
  const { db } = handle;
  console.log(`Seeding via ${handle.driver}…`);
  await ensureSchema(db);

  const userId = ulid();
  const teamId = ulid();
  const eventId = ulid();
  const rundownId = ulid();

  await db
    .insert(users)
    .values({ id: userId, email: "producer@example.com", name: "Demo Producer" })
    .onConflictDoNothing();
  await db
    .insert(teams)
    .values({ id: teamId, name: "Open Showcaller Demo", slug: `demo-${teamId.slice(-6).toLowerCase()}` })
    .onConflictDoNothing();
  await db.insert(teamMembers).values({ teamId, userId, role: "owner" }).onConflictDoNothing();
  await db.insert(events).values({
    id: eventId,
    teamId,
    name: "Sales Kick-Off",
    location: "Orlando, FL",
    startDate: "2026-09-14",
    endDate: "2026-09-16",
    timezone: "America/New_York",
    labels: [
      { text: "Corporate", color: "#f5e6b8" },
      { text: "On Site", color: "#39a0e5" },
    ],
    ownerUserId: userId,
  });

  const doc = buildRundownDoc(DEMO_ROWS);
  await db.insert(rundowns).values({
    id: rundownId,
    eventId,
    name: "Sales Kick-Off | Day 1",
    description: "Main Ballroom",
    showDate: "2026-09-14",
    plannedStartSec: NINE_AM,
    doc: encodeDoc(doc),
    docUpdatedAt: new Date(),
  });

  // Round-trip proof: read the doc back, project it, run the timing engine.
  const stored = await db.query.rundowns.findFirst({ columns: { doc: true, plannedStartSec: true } });
  if (!stored?.doc) throw new Error("seed verification failed: no doc stored");
  const projected = projectRundownDoc(decodeDoc(stored.doc));
  const timing = computeTiming(projected.rows, stored.plannedStartSec);

  console.log(`\n  Sales Kick-Off | Day 1 — ${projected.rows.length} rows, ${projected.columns.length} columns`);
  console.log(`  Planned: start ${formatTimeOfDay(timing.startSec ?? 0)}  dur ${formatDuration(timing.totalDurationSec)}  end ${formatTimeOfDay(timing.endSec ?? 0)}\n`);
  for (let i = 0; i < projected.rows.length; i++) {
    const row = projected.rows[i]!;
    const t = timing.rows[i]!;
    const start = t.startSec != null ? formatTimeOfDay(t.startSec) : "—";
    const dur = row.durationSec != null ? formatDuration(row.durationSec) : "";
    const marker = row.type === "group" ? "▮" : " ";
    console.log(`  ${marker} ${String(i + 1).padStart(2)}  ${start.padEnd(12)} ${dur.padEnd(7)} ${row.title}`);
  }

  await handle.close();
  console.log("\nSeed complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
