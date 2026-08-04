import { describe, expect, it } from "vitest";
import { parseCsv, serializeCsv } from "../src/index";

describe("csv", () => {
  it("parses quoted fields, escaped quotes, and mixed line endings", () => {
    const text = 'Title,Duration,Notes\r\n"Welcome, everyone",1m30s,"He said ""go"""\nReel,3m,\n';
    expect(parseCsv(text)).toEqual([
      ["Title", "Duration", "Notes"],
      ["Welcome, everyone", "1m30s", 'He said "go"'],
      ["Reel", "3m", ""],
    ]);
  });

  it("round-trips through serialize", () => {
    const rows = [
      ["Title", "Script"],
      ["Walk in", 'Line one\nLine "two"'],
    ];
    expect(parseCsv(serializeCsv(rows))).toEqual(rows);
  });

  it("ignores trailing blank lines", () => {
    expect(parseCsv("a,b\n\n")).toEqual([["a", "b"]]);
  });
});
