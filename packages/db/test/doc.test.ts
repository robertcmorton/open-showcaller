import { describe, expect, it } from "vitest";
import { computeTiming } from "@opencall/core";
import { buildRundownDoc, decodeDoc, encodeDoc, projectRundownDoc } from "../src/doc";

describe("rundown doc round-trip", () => {
  it("builds, encodes, decodes, and projects with timing intact", () => {
    const doc = buildRundownDoc([
      { type: "group", title: "Walk in", hardStartSec: 9 * 3600 },
      { type: "cue", title: "Welcome", durationSec: 90, cells: { audio: "Lav 1" } },
      { type: "cue", title: "Reel", durationSec: 180 },
    ]);
    const projected = projectRundownDoc(decodeDoc(encodeDoc(doc)));

    expect(projected.rows.map((r) => r.title)).toEqual(["Walk in", "Welcome", "Reel"]);
    expect(projected.rows[1]!.cells["audio"]).toBe("Lav 1");
    expect(projected.columns.some((c) => c.key === "script")).toBe(true);

    const timing = computeTiming(projected.rows, null);
    expect(timing.rows[1]!.startSec).toBe(9 * 3600);
    expect(timing.endSec).toBe(9 * 3600 + 270);
  });

  it("ignores dangling rowOrder ids on projection", () => {
    const doc = buildRundownDoc([{ type: "cue", title: "Only", durationSec: 60 }]);
    doc.getArray<string>("rowOrder").push(["does-not-exist"]);
    const projected = projectRundownDoc(doc);
    expect(projected.rows).toHaveLength(1);
  });
});

describe("sheet-faithful columns and outcome tags", () => {
  it("orders columns per the sheet, keeps its header names, and round-trips outcomes", () => {
    const doc = buildRundownDoc(
      [
        { type: "cue", title: "A", durationSec: 60, outcome: "win" },
        { type: "cue", title: "B", durationSec: 30 },
      ],
      { name: "Order", baseTitles: { title: "ACTIVITY", start: "TIME", duration: "DUR" } },
      [{ key: "loc", title: "LOCATION" }],
      true,
      [],
      ["start", "duration", "title", "loc"],
    );
    const projected = projectRundownDoc(decodeDoc(encodeDoc(doc)));
    expect(projected.columns.map((c) => c.key)).toEqual(["start", "duration", "title", "loc"]);
    expect(projected.columns.map((c) => c.title)).toEqual(["TIME", "DUR", "ACTIVITY", "LOCATION"]);
    expect(projected.rows[0]!.outcome).toBe("win");
    expect(projected.rows[1]!.outcome).toBeNull();
  });

  it("appends unlisted keys and ignores unknown keys in the order", () => {
    const doc = buildRundownDoc([{ type: "cue", title: "A" }], {}, [{ key: "loc", title: "LOC" }], true, [], ["duration", "ghost", "loc"]);
    const { columns } = projectRundownDoc(doc);
    expect(columns.map((c) => c.key)).toEqual(["duration", "loc", "title", "start"]);
  });
});
