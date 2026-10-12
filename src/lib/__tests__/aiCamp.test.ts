import { describe, it, expect } from "vitest";
import { retOf, campReturn, leanOf, AI_CAMPS } from "../aiCamp";
import type { PricePoint } from "../api";

const series = (...closes: number[]): PricePoint[] => closes.map((c, i) => ({ date: `d${i}`, close: c, volume: 0 }));

describe("AI 하드웨어 vs 소프트웨어", () => {
  it("n봉 전 종가 대비 수익률, 봉이 모자라면 null", () => {
    expect(retOf(series(100, 110), 1)).toBeCloseTo(10);
    expect(retOf(series(100), 1)).toBeNull();
  });

  it("진영 평균 = 값이 있는 ETF만 동일가중 (상장이 짧은 ETF는 빠진다)", () => {
    const [a, b] = AI_CAMPS.sw.etfs;
    const m = new Map([[a.code, series(100, 110)], [b.code, series(100, 90)]]);
    expect(campReturn("sw", m, "d1")).toBeCloseTo(0);
    expect(campReturn("hw", m, "d1")).toBeNull();
  });

  it("기간 수익률은 지난 거래일 종가까지 — ETF 카드(크롤러)와 같은 기준, '오늘' 만 오늘 봉 포함", () => {
    const c: PricePoint[] = [100, 100, 100, 100, 100, 110, 121].map((close, i) => ({ date: i === 6 ? "2026-10-12" : `2026-10-0${i + 1}`, close, volume: 0 }));
    const [e] = AI_CAMPS.sw.etfs;
    const m = new Map([[e.code, c]]);
    expect(campReturn("sw", m, "w1", "2026-10-12")).toBeCloseTo(10);   // 오늘 121 은 빼고 110 vs 100
    expect(campReturn("sw", m, "d1", "2026-10-12")).toBeCloseTo(10);   // 오늘 121 vs 110
    expect(campReturn("sw", m, "w1", "2026-10-13")).toBeCloseTo(21);   // 내일이면 마지막 봉이 '지난 거래일'
  });

  it("1개월 차이 3%p 이상이면 그쪽으로 기울었다, 1주가 반대로 3%p 이상이면 전환 조짐", () => {
    expect(leanOf(5, 1)).toEqual({ lean: "hw", turning: false });
    expect(leanOf(-5, 4)).toEqual({ lean: "sw", turning: true });
    expect(leanOf(2, -10)).toEqual({ lean: "even", turning: false });
    expect(leanOf(null, null)).toEqual({ lean: "even", turning: false });
  });

  it("같은 섹터 ETF가 여럿이면 섹터 안에서 먼저 평균 — ETF 수 많은 섹터가 진영을 끌고 가지 않게", () => {
    // AI소프트웨어 ETF 셋(+10 +10 +10) + 사이버보안(−10) → ETF 평균이면 +5, 섹터 평균이면 0
    const sw = AI_CAMPS.sw.etfs;
    const aiSw = sw.filter(e => e.sector === "AI소프트웨어");
    const cyber = sw.find(e => e.short === "사이버보안")!;
    expect(aiSw).toHaveLength(3);
    const m = new Map([...aiSw.map(e => [e.code, series(100, 110)] as const), [cyber.code, series(100, 90)]]);
    expect(campReturn("sw", m, "d1")).toBeCloseTo(0);
  });

  it("카드의 크롤러 값이 있으면 그걸 평균 — 카드와 표가 어긋나지 않게(오늘 칸은 일봉)", () => {
    const [e] = AI_CAMPS.ref.etfs;
    const m = new Map([[e.code, series(100, 100, 100, 100, 100, 100, 150)]]);
    expect(campReturn("ref", m, "w1", "", { [e.code]: { w1: 7 } })).toBe(7);       // 일봉이면 +50 이지만 카드 값 7
    expect(campReturn("ref", m, "d1", "", { [e.code]: { w1: 7 } })).toBeCloseTo(50);
  });

  it("두 진영 모두 6개씩", () => {
    expect(AI_CAMPS.hw.etfs).toHaveLength(6);
    expect(AI_CAMPS.sw.etfs).toHaveLength(6);
  });

  it("진영끼리 ETF가 겹치지 않는다", () => {
    const all = Object.values(AI_CAMPS).flatMap(c => c.etfs.map(e => e.code));
    expect(new Set(all).size).toBe(all.length);
  });
});
