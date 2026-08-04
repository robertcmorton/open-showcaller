import { ulid } from "ulid";
import type { CmdAction, ShowStatePayload } from "@opencall/protocol";

/**
 * In-memory show-state machine, one per rundown. The server is the single
 * authority; every accepted command bumps `seq` (Phase 4 adds Postgres
 * write-through and transition persistence).
 */
export class ShowStateMachine {
  private state: ShowStatePayload = ShowStateMachine.idle(0);

  static idle(seq: number): ShowStatePayload {
    return {
      seq,
      state: "idle",
      sessionId: null,
      activeRowId: null,
      activeRowStartedAtMs: null,
      pausedAtMs: null,
      pausedAccumMs: 0,
      sessionStartedAtMs: null,
    };
  }

  get current(): ShowStatePayload {
    return this.state;
  }

  /** Restore a persisted session (server restart resilience). */
  hydrate(state: ShowStatePayload): void {
    this.state = state;
  }

  /** Apply a transport command. Returns the new state, or an error string. */
  apply(action: CmdAction, rowId: string | undefined, now = Date.now()): ShowStatePayload | string {
    const s = this.state;
    const next = (patch: Partial<ShowStatePayload>): ShowStatePayload => {
      this.state = { ...s, ...patch, seq: s.seq + 1 };
      return this.state;
    };

    switch (action) {
      case "start": {
        if (s.state === "running" || s.state === "paused") return "show already live";
        return next({
          state: "running",
          sessionId: ulid(),
          activeRowId: rowId ?? null,
          activeRowStartedAtMs: now,
          pausedAtMs: null,
          pausedAccumMs: 0,
          sessionStartedAtMs: now,
        });
      }
      case "pause": {
        if (s.state !== "running") return "not running";
        return next({ state: "paused", pausedAtMs: now });
      }
      case "resume": {
        if (s.state !== "paused") return "not paused";
        return next({
          state: "running",
          pausedAtMs: null,
          pausedAccumMs: s.pausedAccumMs + (now - (s.pausedAtMs ?? now)),
        });
      }
      case "next":
      case "prev":
      case "jump": {
        if (s.state !== "running" && s.state !== "paused") return "not live";
        // Row ordering lives in the doc; the caller supplies the target row id.
        return next({ activeRowId: rowId ?? s.activeRowId, activeRowStartedAtMs: now, pausedAccumMs: 0, pausedAtMs: s.state === "paused" ? now : null });
      }
      case "stop": {
        if (s.state === "idle" || s.state === "ended") return "not live";
        return next({ state: "ended", activeRowId: null, activeRowStartedAtMs: null, pausedAtMs: null });
      }
      // "fire" is handled by the server before the state machine — it logs to
      // the as-run record and never transitions state.
      case "fire":
        return "fire is not a state transition";
    }
  }
}
