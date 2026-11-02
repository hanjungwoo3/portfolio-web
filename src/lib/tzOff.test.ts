import { describe, it, expect } from "vitest";
import { tzOffSec } from "./api";
describe("tzOffSec", () => {
  it("뉴욕 서머타임 전후", () => {
    expect(tzOffSec("America/New_York", Date.parse("2026-10-30T20:00:00Z") / 1000)).toBe(-4 * 3600);
    expect(tzOffSec("America/New_York", Date.parse("2026-11-02T20:00:00Z") / 1000)).toBe(-5 * 3600);
    expect(tzOffSec("Asia/Seoul", Date.parse("2026-11-02T20:00:00Z") / 1000)).toBe(9 * 3600);
  });
});
