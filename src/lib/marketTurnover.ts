// 시장 거래대금 표시 헬퍼 — 카드(MarketTurnoverCard)와 차트(MarketTurnoverChart)가 공유.
//   컴포넌트 파일에서 함수를 export 하면 fast-refresh 가 깨져 lib 으로 분리.

import type { MarketTurnoverPoint } from "./api";

export const MA_DAYS = 20;

// 원 → 조/억. 1조 미만은 억으로.
export function fmtAmount(won: number): string {
  const jo = won / 1e12;
  if (jo >= 1) return `${jo.toFixed(2)}조`;
  return `${Math.round(won / 1e8).toLocaleString()}억`;
}

// 20일 이동평균 (trailing, 앞쪽 부족분은 있는 만큼 평균)
export function movingAvg(points: MarketTurnoverPoint[], days = MA_DAYS): number[] {
  return points.map((_, i) => {
    const win = points.slice(Math.max(0, i - (days - 1)), i + 1);
    return win.reduce((a, p) => a + p.amount, 0) / win.length;
  });
}
