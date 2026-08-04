import { and, eq, ne } from "drizzle-orm";
import { ulid } from "ulid";
import type { CmdAction, ShowStatePayload } from "@open-showcaller/protocol";
import { schema, type DbHandle } from "@open-showcaller/db";
import { ShowStateMachine } from "./show";

/**
 * Show-state machines with Postgres write-through: every accepted command
 * upserts `show_sessions` and appends `show_transitions` (the as-run log).
 * On first access after a restart, any non-ended session is hydrated back.
 * Writes are chained per rundown so they land in command order.
 */
export class PersistentShowStore {
  private machines = new Map<string, ShowStateMachine>();
  private loaded = new Set<string>();
  private writeChains = new Map<string, Promise<void>>();

  constructor(private handle: DbHandle) {}

  async get(rundownId: string): Promise<ShowStateMachine> {
    let machine = this.machines.get(rundownId);
    if (!machine) {
      machine = new ShowStateMachine();
      this.machines.set(rundownId, machine);
    }
    if (!this.loaded.has(rundownId)) {
      this.loaded.add(rundownId);
      const row = await this.handle.db.query.showSessions.findFirst({
        where: and(eq(schema.showSessions.rundownId, rundownId), ne(schema.showSessions.state, "ended")),
      });
      if (row) {
        machine.hydrate({
          seq: row.seq,
          state: row.state,
          sessionId: row.id,
          activeRowId: row.activeRowId,
          activeRowStartedAtMs: row.activeRowStartedAt?.getTime() ?? null,
          pausedAtMs: row.pausedAt?.getTime() ?? null,
          pausedAccumMs: row.pausedAccumMs,
          sessionStartedAtMs: row.startedAt.getTime(),
        });
      }
    }
    return machine;
  }

  /** Queue the DB write-through for an accepted command. */
  persist(rundownId: string, state: ShowStatePayload, action: CmdAction, rowId?: string): void {
    const prev = this.writeChains.get(rundownId) ?? Promise.resolve();
    const next = prev
      .then(() => this.write(rundownId, state, action, rowId))
      .catch((err) => console.error("[sync] session persist failed:", err));
    this.writeChains.set(rundownId, next);
  }

  private async write(rundownId: string, state: ShowStatePayload, action: CmdAction, rowId?: string): Promise<void> {
    const { db } = this.handle;
    if (!state.sessionId) return;
    const values = {
      id: state.sessionId,
      rundownId,
      state: state.state === "idle" ? ("ended" as const) : state.state,
      activeRowId: state.activeRowId,
      activeRowStartedAt: state.activeRowStartedAtMs != null ? new Date(state.activeRowStartedAtMs) : null,
      pausedAt: state.pausedAtMs != null ? new Date(state.pausedAtMs) : null,
      pausedAccumMs: state.pausedAccumMs,
      startedAt: new Date(state.sessionStartedAtMs ?? Date.now()),
      endedAt: state.state === "ended" ? new Date() : null,
      seq: state.seq,
    };
    await db
      .insert(schema.showSessions)
      .values(values)
      .onConflictDoUpdate({ target: schema.showSessions.id, set: values });
    await db.insert(schema.showTransitions).values({
      id: ulid(),
      sessionId: state.sessionId,
      at: new Date(),
      type: action,
      rowId: rowId ?? state.activeRowId,
    });
  }
}
