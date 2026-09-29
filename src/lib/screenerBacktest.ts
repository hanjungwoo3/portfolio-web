// 눌림목 조건 백테스트 — "이 조건이 과거에 먹혔는가" 를 숫자로 낸다.
//
// 조건이 그럴듯한 것과 돈이 되는 것은 다른 문제다. 스크리너는 "지금 무엇이 걸리나" 만 보여주므로,
//   걸린 뒤 실제로 올랐는지는 따로 재야 한다.
//
// ★ 핵심은 **같은 날 시장 평균 대비 초과수익**이다. 절대 수익률만 보면 상승장에서는 아무 조건이나
//   좋아 보인다. 신호가 난 날짜의 전 종목 평균을 빼야 "이 조건이 고른 것" 의 값어치가 남는다.
//
// 대상: 코스피200 (스캐너 1콜 + 종목당 일봉 1콜 ≈ 200콜). 일회성이라 사용자가 눌러야 실행한다.
//
// ⚠️ 한계 세 가지 — 화면에도 그대로 적는다.
//   1) **생존 편향** — 지금의 코스피200 구성종목만 본다. 그동안 편출된 종목(대개 부진했던 쪽)이 빠졌다.
//   2) **흑자 조건 제외** — 과거 시점의 재무를 모른다. 오늘 흑자를 과거에 적용하면 미래 정보를
//      쓰는 꼴(look-ahead)이라, 가격 기반 조건만으로 돌린다.
//   3) **매매비용 미반영** — 수수료·세금·슬리피지가 빠져 있다.

import { fetchTossKrCandles, fetchKrHeatmap } from "./api";
import type { ScreenCriteria } from "./stockScreener";

export interface BarSet { code: string; close: number[]; volume: number[]; date: string[] }
// 종목별 일봉은 세션 메모리에만 둔다 — 200종 × 445봉이라 localStorage 에 넣기엔 크다.
//   조건을 바꿔 다시 계산할 때는 이 캐시로 0콜에 끝난다.
let barsCache: BarSet[] | null = null;
export function hasBacktestBars(): boolean { return barsCache !== null && barsCache.length > 0; }

export const FWD_DAYS = [5, 20] as const;
export type FwdDay = typeof FWD_DAYS[number];

export interface Stat { n: number; mean: number; median: number; winRate: number }
export interface HorizonResult { signal: Stat; market: Stat; excess: Stat }
export interface BacktestResult {
  ranAt: number;
  universe: number;      // 일봉을 받은 종목 수
  tradingDays: number;   // 평가 구간 거래일 수
  signals: number;       // 조건 발동 건수(종목·날짜 조합)
  signalDays: number;    // 신호가 하루라도 난 날짜 수
  byHorizon: Record<number, HorizonResult>;
}

function stat(v: number[]): Stat {
  if (v.length === 0) return { n: 0, mean: 0, median: 0, winRate: 0 };
  const s = [...v].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return {
    n: v.length,
    mean: v.reduce((a, b) => a + b, 0) / v.length,
    median: s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2,
    winRate: (v.filter(x => x > 0).length / v.length) * 100,
  };
}

// RSI(14) — Wilder 평활. 스캐너의 RSI 와 같은 정의.
function rsiSeries(cl: number[], n = 14): (number | null)[] {
  const out: (number | null)[] = new Array(cl.length).fill(null);
  if (cl.length <= n) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = cl[i] - cl[i - 1]; g += Math.max(d, 0); l += Math.max(-d, 0); }
  let ag = g / n, al = l / n;
  out[n] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = n + 1; i < cl.length; i++) {
    const d = cl[i] - cl[i - 1];
    ag = (ag * (n - 1) + Math.max(d, 0)) / n;
    al = (al * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
}
function smaSeries(cl: number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(cl.length).fill(null);
  let s = 0;
  for (let i = 0; i < cl.length; i++) {
    s += cl[i];
    if (i >= n) s -= cl[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}
// 볼린저 하단 — 20일 단순이평 − 2σ (모집단 표준편차). 스캐너 BB.lower 와 같은 정의.
function bbLowerSeries(cl: number[], n = 20, k = 2): (number | null)[] {
  const out: (number | null)[] = new Array(cl.length).fill(null);
  for (let i = n - 1; i < cl.length; i++) {
    let m = 0;
    for (let j = i - n + 1; j <= i; j++) m += cl[j];
    m /= n;
    let v = 0;
    for (let j = i - n + 1; j <= i; j++) v += (cl[j] - m) ** 2;
    out[i] = m - k * Math.sqrt(v / n);
  }
  return out;
}

const WARMUP = 200;   // SMA200 이 채워지는 지점
const YEAR_BARS = 252;

export function runBacktest(criteria: ScreenCriteria, bars = barsCache): BacktestResult | null {
  if (!bars || bars.length === 0) return null;
  const maxFwd = Math.max(...FWD_DAYS);
  // 날짜별로 모아 둔다 — 초과수익은 '같은 날 전 종목 평균' 을 빼야 나온다.
  const marketByDate = new Map<string, Record<number, number[]>>();
  const signalByDate = new Map<string, Record<number, number[]>>();
  let signals = 0;

  const bucket = (m: Map<string, Record<number, number[]>>, d: string) => {
    let b = m.get(d);
    if (!b) { b = {} as Record<number, number[]>; for (const h of FWD_DAYS) b[h] = []; m.set(d, b); }
    return b;
  };

  for (const b of bars) {
    const { close: cl, volume: vol, date: dt } = b;
    if (cl.length < WARMUP + maxFwd + 10) continue;
    const R = rsiSeries(cl), S = smaSeries(cl, WARMUP), B = bbLowerSeries(cl);
    for (let i = WARMUP; i < cl.length - maxFwd; i++) {
      const mkt = bucket(marketByDate, dt[i]);
      for (const h of FWD_DAYS) mkt[h].push((cl[i + h] / cl[i] - 1) * 100);
      const r = R[i], s = S[i], bb = B[i];
      if (r == null || s == null || bb == null || bb <= 0 || s <= 0) continue;
      if (!(r < criteria.rsiMax)) continue;
      if (!((cl[i] / bb - 1) * 100 <= criteria.bbGapMax)) continue;
      if (!((cl[i] / s - 1) * 100 > criteria.smaGapMin)) continue;
      if (criteria.ddMax !== 0) {
        let hi = 0;
        for (let j = Math.max(0, i - (YEAR_BARS - 1)); j <= i; j++) hi = Math.max(hi, cl[j]);
        if (!(hi > 0 && (cl[i] / hi - 1) * 100 <= criteria.ddMax)) continue;
      }
      if (!(cl[i] * vol[i] >= criteria.minValueTradedEok * 1e8)) continue;
      const sg = bucket(signalByDate, dt[i]);
      for (const h of FWD_DAYS) sg[h].push((cl[i + h] / cl[i] - 1) * 100);
      signals++;
    }
  }

  const byHorizon: Record<number, HorizonResult> = {};
  for (const h of FWD_DAYS) {
    const sigAll: number[] = [], mktAll: number[] = [], excess: number[] = [];
    for (const [d, sg] of signalByDate) {
      const mk = marketByDate.get(d)?.[h] ?? [];
      const base = mk.length ? mk.reduce((a, x) => a + x, 0) / mk.length : 0;
      for (const v of sg[h]) { sigAll.push(v); excess.push(v - base); }
    }
    for (const mk of marketByDate.values()) mktAll.push(...mk[h]);
    byHorizon[h] = { signal: stat(sigAll), market: stat(mktAll), excess: stat(excess) };
  }
  return {
    ranAt: Date.now(), universe: bars.length, tradingDays: marketByDate.size,
    signals, signalDays: signalByDate.size, byHorizon,
  };
}

// 코스피200 일봉을 받아 캐시에 담는다. onProgress(받은 수, 전체) 로 진행 상황을 올린다.
export async function loadBacktestBars(
  onProgress?: (done: number, total: number) => void,
): Promise<BarSet[]> {
  if (barsCache) return barsCache;
  const members = await fetchKrHeatmap("kospi200", 300);
  const codes = members.map(m => m.code).filter(c => /^[\dA-Za-z]{6}$/.test(c));
  const out: BarSet[] = [];
  let done = 0;
  // 동시 6개 — 한꺼번에 200개를 던지면 프록시가 막는다.
  const CONC = 6;
  const queue = [...codes];
  const worker = async () => {
    for (;;) {
      const code = queue.shift();
      if (!code) return;
      try {
        const rows = await fetchTossKrCandles(code, "day", 450);
        if (rows.length > 0) {
          out.push({
            code,
            close: rows.map(r => r.close),
            volume: rows.map(r => r.volume),
            date: rows.map(r => r.date),
          });
        }
      } catch { /* 한 종목 실패는 건너뛴다 */ }
      onProgress?.(++done, codes.length);
    }
  };
  await Promise.all(Array.from({ length: CONC }, worker));
  barsCache = out;
  return out;
}
