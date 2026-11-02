import { describe, it, expect } from "vitest";
import { expPhaseNow } from "./kisExpRank";

const kst = (s: string) => new Date(`${s}+09:00`);
describe("expPhaseNow", () => {
  it("평일 장전·장마감 동시호가만", () => {
    expect(expPhaseNow(kst("2026-11-02T08:24:00"))).toBe(null);
    expect(expPhaseNow(kst("2026-11-02T08:45:00"))).toBe("open");
    expect(expPhaseNow(kst("2026-11-02T09:02:59"))).toBe("open");
    expect(expPhaseNow(kst("2026-11-02T09:03:00"))).toBe(null);
    expect(expPhaseNow(kst("2026-11-02T15:25:00"))).toBe("close");
    expect(expPhaseNow(kst("2026-11-02T15:33:00"))).toBe(null);
  });
  it("주말은 없음", () => {
    expect(expPhaseNow(kst("2026-11-07T08:45:00"))).toBe(null);
  });
});
