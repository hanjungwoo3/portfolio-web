import { describe, it, expect } from "vitest";
import { computeFlowProfile, netShares } from "../flowProfile";
import type { Investor } from "../../types";

const day = (date: string, 종가: number, p: Partial<Investor>): Investor => ({
  date, 종가, 개인: 0, 외국인: 0, 기관: 0, 연기금: 0, 금융투자: 0, 투신: 0, 사모: 0, 보험: 0, 은행: 0, 기타금융: 0, 기타법인: 0, 외국인비율: 0, ...p,
});

describe("가격대별 수급", () => {
  const data = [
    day("2026-10-05", 1000, { 외국인: 100 }),
    day("2026-10-06", 1000, { 외국인: 50 }),
    day("2026-10-07", 2000, { 외국인: -30 }),
    day("2026-10-08", 2000, { 외국인: 10 }),
    day("2026-10-09", 1500, { 외국인: 0 }),
  ];

  it("그날 순매수 수량 × 그날 종가를 그 가격 구간에 더한다", () => {
    const p = computeFlowProfile(data, "외국인", 2)!;
    expect(p.buckets).toHaveLength(2);
    expect(p.buckets[0].net).toBe(150 * 1000);                  // 1000원대: 100+50주
    expect(p.buckets[1].net).toBe(-30 * 2000 + 10 * 2000);      // 2000원대 (1500 도 위 구간)
    expect(p.netAmount).toBe(150_000 - 40_000);
    expect(p.topBand).toBe(p.buckets[0]);                       // 가장 많이 산 가격대 = 1000원대
  });

  it("평균 매수 단가 = 순매수한 날만, 수량 가중 (판 날은 안 섞는다)", () => {
    const p = computeFlowProfile(data, "외국인")!;
    expect(p.avgBuy).toBeCloseTo((100 * 1000 + 50 * 1000 + 10 * 2000) / 160);
  });

  it("기관은 금융투자를 뺀 값이다 (ETF·차익 물량이 방향을 뒤집는다)", () => {
    expect(netShares(day("d", 1, { 기관: 100, 금융투자: 150 }), "기관")).toBe(-50);
  });

  it("종가가 없는 날은 빼고, 날이 너무 적으면 계산하지 않는다", () => {
    expect(computeFlowProfile(data.slice(0, 3), "외국인")).toBeNull();
    const noClose = data.map(d => ({ ...d, 종가: undefined }));
    expect(computeFlowProfile(noClose, "외국인")).toBeNull();
  });

  it("기간(from~to)과 날 수를 같이 준다", () => {
    const p = computeFlowProfile(data, "연기금")!;
    expect([p.from, p.to, p.days]).toEqual(["2026-10-05", "2026-10-09", 5]);
    expect(p.avgBuy).toBeNull();   // 연기금은 산 날이 없다
  });
});
