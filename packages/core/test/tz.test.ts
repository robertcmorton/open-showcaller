import { describe, expect, it } from "vitest";
import { isValidTimeZone, zoneAbbreviation, zoneSecondsOfDay } from "../src/tz";

describe("zoneSecondsOfDay", () => {
  it("converts a fixed instant into different zones", () => {
    // 2026-01-15T12:00:00Z (northern winter, southern summer).
    const ms = Date.UTC(2026, 0, 15, 12, 0, 0);
    expect(zoneSecondsOfDay(ms, "UTC")).toBe(12 * 3600);
    expect(zoneSecondsOfDay(ms, "America/New_York")).toBe(7 * 3600); // EST −5
    expect(zoneSecondsOfDay(ms, "Australia/Sydney")).toBe(23 * 3600); // AEDT +11
  });

  it("applies daylight saving on each side of a US spring-forward", () => {
    // US DST 2026 starts Mar 8, 2:00 local. 06:59Z = 01:59 EST; 07:01Z = 03:01 EDT.
    const before = Date.UTC(2026, 2, 8, 6, 59, 0);
    const after = Date.UTC(2026, 2, 8, 7, 1, 0);
    expect(zoneSecondsOfDay(before, "America/New_York")).toBe(1 * 3600 + 59 * 60);
    expect(zoneSecondsOfDay(after, "America/New_York")).toBe(3 * 3600 + 60);
  });

  it("applies daylight saving on each side of a Sydney spring-forward", () => {
    // AU DST 2026 starts Oct 4, 2:00 local (+10 → +11). 15:59Z Oct 3 = 01:59 AEST; 16:01Z = 03:01 AEDT.
    const before = Date.UTC(2026, 9, 3, 15, 59, 0);
    const after = Date.UTC(2026, 9, 3, 16, 1, 0);
    expect(zoneSecondsOfDay(before, "Australia/Sydney")).toBe(1 * 3600 + 59 * 60);
    expect(zoneSecondsOfDay(after, "Australia/Sydney")).toBe(3 * 3600 + 60);
  });

  it("falls back to device-local for unknown or missing zones", () => {
    const ms = Date.now();
    expect(zoneSecondsOfDay(ms, "Not/AZone")).toBe(zoneSecondsOfDay(ms, null));
  });
});

describe("zone helpers", () => {
  it("validates zone names", () => {
    expect(isValidTimeZone("Australia/Sydney")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
  });
  it("returns a DST-aware abbreviation", () => {
    const winter = Date.UTC(2026, 6, 15); // July: AEST
    const summer = Date.UTC(2026, 0, 15); // January: AEDT
    expect(zoneAbbreviation("Australia/Sydney", winter)).toMatch(/AEST|GMT\+10/);
    expect(zoneAbbreviation("Australia/Sydney", summer)).toMatch(/AEDT|GMT\+11/);
  });
});
