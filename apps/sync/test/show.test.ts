import { describe, expect, it } from "vitest";
import { ShowStateMachine } from "../src/show";

describe("ShowStateMachine", () => {
  it("runs a full start → pause → resume → jump → stop lifecycle", () => {
    const m = new ShowStateMachine();
    const started = m.apply("start", "row-1", 1000);
    expect(started).toMatchObject({ state: "running", activeRowId: "row-1", seq: 1 });

    const paused = m.apply("pause", undefined, 2000);
    expect(paused).toMatchObject({ state: "paused", pausedAtMs: 2000 });

    const resumed = m.apply("resume", undefined, 5000);
    expect(resumed).toMatchObject({ state: "running", pausedAccumMs: 3000, pausedAtMs: null });

    const jumped = m.apply("jump", "row-9", 6000);
    expect(jumped).toMatchObject({ activeRowId: "row-9", activeRowStartedAtMs: 6000, pausedAccumMs: 0 });

    const stopped = m.apply("stop", undefined, 7000);
    expect(stopped).toMatchObject({ state: "ended", activeRowId: null, seq: 5 });
  });

  it("rejects invalid transitions with reasons", () => {
    const m = new ShowStateMachine();
    expect(m.apply("pause", undefined)).toBe("not running");
    m.apply("start", "row-1");
    expect(m.apply("start", "row-1")).toBe("show already live");
  });

  it("bumps seq monotonically on every accepted command", () => {
    const m = new ShowStateMachine();
    m.apply("start", "a");
    m.apply("next", "b");
    m.apply("next", "c");
    expect(m.current.seq).toBe(3);
  });
});

describe("pre-show walkthrough", () => {
  it("moves the cursor while idle, clears on start, and refuses while live", () => {
    const m = new ShowStateMachine();
    expect(m.apply("walk", "row-3")).toMatchObject({ state: "idle", walkRowId: "row-3" });
    expect(m.apply("walk", undefined)).toMatchObject({ walkRowId: null });
    m.apply("walk", "row-5");
    expect(m.apply("start", "row-1")).toMatchObject({ state: "running", walkRowId: null });
    expect(m.apply("walk", "row-2")).toBe("show is live — use the transport");
    m.apply("stop", undefined);
    expect(m.apply("walk", "row-7")).toMatchObject({ state: "ended", walkRowId: "row-7" });
  });
});

describe("clock-follow backdating", () => {
  it("records a row as starting when the SHEET says, not when the follower noticed", () => {
    // Following the clock at 20:27 lands on a row the sheet started at 19:37.
    // Recording it as beginning now would report the show 50 minutes late and
    // put 51 minutes back on an item with 2 left.
    const m = new ShowStateMachine();
    m.apply("start", "row-1", 1_000);
    const plannedStartMs = 10_000_000;
    const noticedMs = plannedStartMs + 50 * 60 * 1000;
    const jumped = m.apply("jump", "row-408", noticedMs, plannedStartMs);
    expect(jumped).toMatchObject({ activeRowId: "row-408", activeRowStartedAtMs: plannedStartMs });
  });

  it("a person pressing Next still starts the row now", () => {
    const m = new ShowStateMachine();
    m.apply("start", "row-1", 1_000);
    expect(m.apply("next", "row-2", 5_000)).toMatchObject({ activeRowStartedAtMs: 5_000 });
  });
});
