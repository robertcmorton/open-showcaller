import { describe, expect, it } from "vitest";
import { computeTiming } from "@open-showcaller/core";
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
