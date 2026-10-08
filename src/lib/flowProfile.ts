// 가격대별 수급 — 외국인·기관·연기금이 **어느 가격대에서** 얼마나 사고팔았나.
//   (사용자 요청 2026-10-09: "그래프에서 일별 종가로 외국인/연기금/기관이 구매한 금액대를 계산")
//
//   토스 수급은 하루 단위 순매수 **수량**과 그날 종가만 준다(장중 체결가는 없다).
//   그래서 그날 순매수 수량 × 그날 종가를 '그 가격대에서 산 금액'으로 근사한다.
//   기관은 금융투자를 뺀다 — ETF 설정·차익·헤지 물량이 섞여 방향이 반대로 희석된다(성호전자 실측).
import type { Investor } from "../types";

export type FlowGroup = "외국인" | "기관" | "연기금";
export const FLOW_GROUPS: FlowGroup[] = ["외국인", "기관", "연기금"];
export const FLOW_GROUP_COLOR: Record<FlowGroup, string> = {
  외국인: "#7c3aed",   // violet — 차트의 외국인 지분율 선과 같은 색
  기관:   "#0891b2",   // cyan
  연기금: "#16a34a",   // green
};

export interface FlowBucket {
  lo: number; hi: number;   // 가격 구간 [lo, hi)
  net: number;              // 순매수 금액(원) — 음수 = 순매도
}
export interface FlowProfile {
  group: FlowGroup;
  buckets: FlowBucket[];
  avgBuy: number | null;    // 순매수한 날만의 평균 단가(수량 가중)
  netAmount: number;        // 기간 전체 순매수 금액(원)
  topBand: FlowBucket | null;   // 가장 많이 순매수한 가격 구간(순매수가 없으면 null)
  days: number;             // 계산에 쓴 날 수
  from?: string; to?: string;
}

/** 그날 이 투자자의 순매수 수량. 기관은 금융투자 제외. */
export function netShares(d: Investor, g: FlowGroup): number {
  if (g === "기관") return (d.기관 || 0) - (d.금융투자 || 0);
  return d[g] || 0;
}

/** investors 순서는 상관없다(토스는 최신→과거). 종가가 없는 날은 뺀다. */
export function computeFlowProfile(investors: Investor[], group: FlowGroup, bucketCount = 24): FlowProfile | null {
  const days = investors.filter(d => typeof d.종가 === "number" && d.종가 > 0);
  if (days.length < 5) return null;
  const closes = days.map(d => d.종가!);
  const min = Math.min(...closes), max = Math.max(...closes);
  const span = max - min;
  const n = span > 0 ? bucketCount : 1;
  const step = span > 0 ? span / n : 1;
  const buckets: FlowBucket[] = Array.from({ length: n }, (_, i) => ({ lo: min + i * step, hi: min + (i + 1) * step, net: 0 }));
  let buyQty = 0, buyAmt = 0, netAmount = 0;
  for (const d of days) {
    const q = netShares(d, group), px = d.종가!;
    const amt = q * px;
    const i = span > 0 ? Math.min(n - 1, Math.floor((px - min) / step)) : 0;
    buckets[i].net += amt;
    netAmount += amt;
    if (q > 0) { buyQty += q; buyAmt += amt; }
  }
  const dates = days.map(d => d.date).filter((s): s is string => !!s).sort();
  const top = buckets.reduce<FlowBucket | null>((b, x) => (x.net > 0 && (!b || x.net > b.net) ? x : b), null);
  return {
    group, buckets, netAmount, days: days.length, topBand: top,
    avgBuy: buyQty > 0 ? buyAmt / buyQty : null,
    from: dates[0], to: dates[dates.length - 1],
  };
}
