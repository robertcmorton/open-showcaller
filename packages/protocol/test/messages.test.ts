import { describe, expect, it } from "vitest";
import { CmdMsg, HelloMsg, PROTOCOL_VERSION, ShowStateMsg, parseClientMsg } from "../src/index";

describe("protocol schemas", () => {
  it("accepts a valid hello", () => {
    const msg = {
      v: PROTOCOL_VERSION,
      t: "hello",
      auth: { kind: "join", code: "ABC123" },
      device: "companion",
    };
    expect(HelloMsg.parse(msg).auth.kind).toBe("join");
  });

  it("rejects jump without rowId and stop without confirm", () => {
    expect(CmdMsg.safeParse({ v: 1, t: "cmd", id: "x", action: "jump" }).success).toBe(false);
    expect(CmdMsg.safeParse({ v: 1, t: "cmd", id: "x", action: "stop" }).success).toBe(false);
    expect(CmdMsg.safeParse({ v: 1, t: "cmd", id: "x", action: "stop", confirm: true }).success).toBe(true);
  });

  it("round-trips a show_state frame", () => {
    const frame = {
      v: 1,
      t: "show_state",
      seq: 42,
      state: "running",
      sessionId: "01J",
      activeRowId: "01K",
      activeRowStartedAtMs: 1000,
      pausedAtMs: null,
      pausedAccumMs: 0,
      sessionStartedAtMs: 900,
    };
    expect(ShowStateMsg.parse(frame).seq).toBe(42);
  });

  it("parseClientMsg ignores garbage", () => {
    expect(parseClientMsg("not json")).toBeUndefined();
    expect(parseClientMsg('{"v":9,"t":"hello"}')).toBeUndefined();
  });
});
