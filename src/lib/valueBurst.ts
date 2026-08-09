// 거래대금이 크게 터진 날 찾기 — "최근 N거래일 중 양봉(종가>시가)이면서
// 거래대금이 기준선을 넘은 날"을 집계한다. 테마주/급등주 포착용.
//
// 거래대금은 종가 × 거래량 근사다. 국내 일봉 소스(야후·네이버) 어디에도 실제
// 거래대금 필드가 없고, KRX 전종목 시세는 로그인이 필요해 쓸 수 없다.
// TradingView 의 Value.Traded 도 같은 계산이라 그쪽 수치와는 일치한다.
// 실제 거래대금은 체결단가 가중평균이라 기준선 근처 종목은 판정이 뒤집힐 수 있다.

import type { PricePoint } from "./api";

export interface BurstDay {
  date: string;      // YYYY-MM-DD
  open: number;
  close: number;
  volume: number;
  value: number;     // 거래대금(원) = close × volume
  pct: number;       // 시가 대비 종가 상승률(%)
}

export interface BurstStat {
  days: number;              // 조건 충족 일수
  maxValue: number | null;   // 그중 최대 거래대금(원)
  maxDate: string | null;
  lastDate: string | null;   // 가장 최근 충족일
  hits: BurstDay[];          // 최신순
}

export const EMPTY_BURST: BurstStat = {
  days: 0, maxValue: null, maxDate: null, lastDate: null, hits: [],
};

// prices 는 날짜 오름차순(과거→최근) 이라고 가정 — fetchKrPriceHistory 가 그렇게 준다.
export function computeValueBurst(
  prices: PricePoint[] | undefined,
  bars: number,
  threshold: number,
): BurstStat {
  if (!prices || prices.length === 0) return EMPTY_BURST;

  const hits: BurstDay[] = [];
  for (const p of prices.slice(-bars)) {
    const { close, volume } = p;
    const open = p.open;
    // open 이 없는 소스면 양봉 판정이 불가능 — 건너뛴다(거짓 양성보다 누락이 낫다).
    if (open == null || !(open > 0) || !(close > 0) || !(volume > 0)) continue;
    if (close <= open) continue;                    // 양봉만
    const value = close * volume;
    if (value < threshold) continue;
    hits.push({ date: p.date, open, close, volume, value, pct: ((close - open) / open) * 100 });
  }
  if (hits.length === 0) return EMPTY_BURST;

  hits.reverse();                                   // 최신순
  const max = hits.reduce((a, b) => (b.value > a.value ? b : a), hits[0]);
  return {
    days: hits.length,
    maxValue: max.value,
    maxDate: max.date,
    lastDate: hits[0].date,
    hits,
  };
}

// 정렬용 — "2026-08-07" → 20260807 (없으면 null)
export function dateToNum(d: string | null): number | null {
  if (!d) return null;
  const n = Number(d.replace(/-/g, ""));
  return Number.isFinite(n) ? n : null;
}

// 원 → 억 (반올림)
export function toEok(v: number): number {
  return Math.round(v / 100_000_000);
}

// ── 기준금액 — 가치표의 선택 버튼과 차트의 거래량 강조가 같은 값을 쓰도록 공유 ──
//    표에서 기준을 바꾸면 기업가치 차트의 강조 막대도 같이 바뀐다.
export const BURST_BARS = 30;                              // 최근 N거래일
export const BURST_LEVELS = [300, 500, 1000, 2000] as const;   // 억원
export type BurstLevel = typeof BURST_LEVELS[number];

const BURST_LEVEL_KEY = "value_burst_level";
const DEFAULT_LEVEL: BurstLevel = 2000;

export function loadBurstLevel(): BurstLevel {
  try {
    const n = Number(localStorage.getItem(BURST_LEVEL_KEY));
    return (BURST_LEVELS as readonly number[]).includes(n) ? n as BurstLevel : DEFAULT_LEVEL;
  } catch { return DEFAULT_LEVEL; }
}
export function saveBurstLevel(v: BurstLevel): void {
  try { localStorage.setItem(BURST_LEVEL_KEY, String(v)); } catch { /* noop */ }
}
// 억원 단위 기준 → 원 단위 임계값
export function burstThresholdWon(level: number): number {
  return level * 100_000_000;
}
