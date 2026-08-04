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
