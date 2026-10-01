import { describe, it, expect } from "vitest";
import { judge } from "../closeBet";
import type { PricePoint } from "../api";

// 직전 20일: 종가 10,000 · 거래량 20만 → 평균 거래대금 20억. 마지막 봉이 오늘.
const base = (n = 21): PricePoint[] =>
  Array.from({ length: n }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, close: 10_000, volume: 200_000, open: 10_000, high: 10_100, low: 9_900 }));
const today = (o: Partial<PricePoint>): PricePoint[] => [...base(), { date: "2026-09-30", close: 10_000, volume: 200_000, open: 10_000, high: 10_000, low: 10_000, ...o }];

describe("종가배팅 판정 — 백테스트와 같은 계산", () => {
  it("종목: 고가 근처 마감 · 거래대금 3배 · +10~29% 면 걸린다", () => {
    const r = judge(today({ close: 11_500, high: 11_550, low: 10_000, volume: 600_000 }), false);
    expect(r?.kind).toBe("stock");
    expect(r!.changePct).toBeCloseTo(15);
    expect(r!.tvRatio).toBeGreaterThanOrEqual(3);
  });
  it("종목: 상한가(+29%↑)는 뺀다 — 잠기면 종가에 못 산다", () => {
    expect(judge(today({ close: 12_990, high: 12_990, low: 10_000, volume: 600_000 }), false)).toBeNull();
  });
  it("종목: 위에서 밀려 마감(위치 90% 미만)이면 안 걸린다", () => {
    expect(judge(today({ close: 11_500, high: 12_500, low: 10_000, volume: 600_000 }), false)).toBeNull();
  });
  it("ETF: +5%↑ 강한 마감 / -5%↓ 급락은 각각 걸린다", () => {
    expect(judge(today({ close: 10_600, high: 10_600, low: 10_000, volume: 700_000 }), true)?.kind).toBe("etfStrong");
    expect(judge(today({ close: 9_400, high: 10_000, low: 9_300 }), true)?.kind).toBe("etfDip");
  });
  it("평균 거래대금 10억 미만은 뺀다", () => {
    const thin = [...base().map(b => ({ ...b, volume: 50_000 })), { date: "2026-09-30", close: 11_500, volume: 500_000, open: 10_000, high: 11_500, low: 10_000 }];
    expect(judge(thin, false)).toBeNull();
  });
});
