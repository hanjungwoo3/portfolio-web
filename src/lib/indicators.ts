// 차트 보조지표 — 종가 기준 이동평균 / 볼린저밴드.
//   워밍업 구간(period-1 개)은 값이 없으므로 아예 포인트를 만들지 않는다.
//   lightweight-charts 는 whitespace 를 허용하지만, 빈 구간을 넘기면 선이 0 에서 시작하는 것처럼 보임.

import type { PricePoint } from "./api";

// 차트 본체와 범례가 같은 값을 쓰도록 여기서 한 번만 정의한다.
// 기간을 사용자가 바꿀 수 있으므로 색은 기간이 아니라 '몇 번째 선인가'로 정한다.
// 캔들(빨강/파랑)·외인지분(violet)·목표/평단/기대(amber/emerald/violet) 와 겹치지 않게 고름.
export const MA_DEFAULT_PERIODS = [5, 20, 60];
export const MA_MAX_LINES = 5;          // 그 이상은 캔들이 안 보임
export const MA_MAX_PERIOD = 500;       // 1년치(약 245봉)를 넘겨도 입력 자체는 허용
const MA_PALETTE = [
  "#ec4899",   // pink-500
  "#0891b2",   // cyan-600
  "#737373",   // neutral-500
  "#4f46e5",   // indigo-600
  "#92400e",   // amber-800
];
export const maColor = (i: number): string => MA_PALETTE[i % MA_PALETTE.length];

// "5, 20, 60" → [5, 20, 60]. 양의 정수만, 중복 제거, 오름차순, 최대 MA_MAX_LINES 개.
// 잘못된 토큰은 조용히 버린다 — 입력 중간 상태("5,")에서도 차트가 깨지면 안 되므로.
export function parseMaPeriods(raw: string): number[] {
  const seen = new Set<number>();
  for (const tok of raw.split(/[,\s]+/)) {
    if (!/^\d+$/.test(tok)) continue;
    const n = Number(tok);
    if (n < 1 || n > MA_MAX_PERIOD) continue;
    seen.add(n);
  }
  return [...seen].sort((a, b) => a - b).slice(0, MA_MAX_LINES);
}
// 볼린저 색은 토스증권 차트에서 추출. 목표가(#f59e0b)·내평단(#10b981) 과 색이 가깝지만
// 그쪽은 가로 점선 + 라벨 칩이라 곡선 실선인 밴드와 형태로 구분된다.
export const BB_COLOR     = "#f7bf3a";   // 상단/하단 밴드 — amber
export const BB_MID_COLOR = "#34b970";   // 중심선(=MA20) — green

export interface IndicatorPoint { date: string; value: number; }
export interface BollingerBands {
  upper: IndicatorPoint[];
  middle: IndicatorPoint[];   // = SMA(period)
  lower: IndicatorPoint[];
}

// 단순이동평균 — 슬라이딩 합(O(n))
export function sma(prices: PricePoint[], period: number): IndicatorPoint[] {
  if (period < 1 || prices.length < period) return [];
  const out: IndicatorPoint[] = [];
  let sum = 0;
  for (let i = 0; i < prices.length; i++) {
    sum += prices[i].close;
    if (i >= period) sum -= prices[i - period].close;
    if (i >= period - 1) out.push({ date: prices[i].date, value: sum / period });
  }
  return out;
}

// 볼린저밴드 — 중심선 SMA(period), 밴드폭 ±mult × 모표준편차.
//   표본(n-1)이 아닌 모집단(n) 분산을 쓴다 — 볼린저 원저 및 국내 HTS 관행.
//   창마다 직접 합산(O(n·period)) — 1년치 × 20일이면 5천 회 수준이라 슬라이딩 제곱합의
//   부동소수점 상쇄 오차를 감수할 이유가 없다.
export function bollinger(prices: PricePoint[], period = 20, mult = 2): BollingerBands {
  const empty: BollingerBands = { upper: [], middle: [], lower: [] };
  if (period < 1 || prices.length < period) return empty;

  const out: BollingerBands = { upper: [], middle: [], lower: [] };
  for (let i = period - 1; i < prices.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += prices[j].close;
    const mean = sum / period;

    let sqDiff = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = prices[j].close - mean;
      sqDiff += d * d;
    }
    const sd = Math.sqrt(sqDiff / period);

    const date = prices[i].date;
    out.middle.push({ date, value: mean });
    out.upper.push({ date, value: mean + mult * sd });
    out.lower.push({ date, value: mean - mult * sd });
  }
  return out;
}
