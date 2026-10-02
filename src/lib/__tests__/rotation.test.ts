import { describe, it, expect, vi, beforeEach } from "vitest";

// 가짜 일봉 — 평일 200일. LATE 코드는 뒤쪽 50일만 있다(최근 상장 ETF 흉내).
const LATE = "0080G0";
const LATE_ONLY = "0219B0";   // 광통신 — 카드 ETF 하나뿐(최근 상장), 이전은 history 종목이 채워야 한다
const days: string[] = [];
for (let d = new Date(Date.UTC(2026, 0, 5)); days.length < 200; d.setUTCDate(d.getUTCDate() + 1)) {
  const wd = d.getUTCDay();
  if (wd !== 0 && wd !== 6) days.push(d.toISOString().slice(0, 10));
}
vi.mock("../api", () => ({
  fetchTossKrCandles: vi.fn(async (code: string) => {
    const ds = code === LATE || code === LATE_ONLY ? days.slice(-50) : days;
    return ds.map((date, i) => ({ date, close: 100 + i + (code.charCodeAt(0) % 7) }));
  }),
  fetchYahooPriceHistory: vi.fn(async () => days.map((date, i) => ({ date, close: 50 + i }))),
}));

import { fetchRotation, ALL_GROUPS, STAGES } from "../rotation";

describe("fetchRotation 집계", () => {
  beforeEach(() => { try { localStorage.clear(); } catch { /* 없음 */ } });

  it("최근 상장 종목 하나가 전체 기간을 자르지 않는다 (그 주에 값 있는 종목끼리 평균)", async () => {
    const d = await fetchRotation();
    // 200 거래일 ≈ 40주 — 늦게 들어온 LATE(50일 ≈ 10주)에 맞춰 잘리면 안 된다
    expect(d.weeks.length).toBeGreaterThan(35);
    expect(d.days.length).toBeGreaterThan(100);
    for (const g of ALL_GROUPS) {
      expect(d.weekly[g.key]).toHaveLength(d.weeks.length - 1);
      expect(d.daily[g.key]).toHaveLength(d.days.length);
      expect(d.weekly[g.key].every(Number.isFinite)).toBe(true);
      expect(d.daily[g.key].every(Number.isFinite)).toBe(true);
    }
  });

  it("ETF 하나뿐인 단계(광통신)는 상장 전 기간을 history 종목이 채운다 — 전체 기간이 잘리지 않는다", async () => {
    const d = await fetchRotation();
    expect(d.weeks.length).toBeGreaterThan(35);
    expect(d.weekly.optic[0]).toBeGreaterThan(0);
  });

  it("방산 단계는 LATE 가 없는 앞쪽 주에도 나머지 종목으로 값이 있다", async () => {
    const d = await fetchRotation();
    const def = STAGES.find(s => s.key === "defense")!;
    expect(def.members.some(m => m.code === LATE)).toBe(true);
    expect(d.weekly.defense[0]).toBeGreaterThan(0);   // 가짜 종가는 매일 오른다
  });
});
