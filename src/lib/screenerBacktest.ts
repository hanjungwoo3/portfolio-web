// 눌림목 조건 백테스트 — "이 조건이 과거에 먹혔는가" 를 숫자로 낸다.
//
// 조건이 그럴듯한 것과 돈이 되는 것은 다른 문제다. 스크리너는 "지금 무엇이 걸리나" 만 보여주므로,
//   걸린 뒤 실제로 올랐는지는 따로 재야 한다.
//
// ★ 핵심은 **같은 날 시장 평균 대비 초과수익**이다. 절대 수익률만 보면 상승장에서는 아무 조건이나
//   좋아 보인다. 신호가 난 날짜의 전 종목 평균을 빼야 "이 조건이 고른 것" 의 값어치가 남는다.
//
// ★ 매매 규칙 — **신호 다음 거래일 종가 매수 → N거래일 뒤 종가 매도**.
//   신호 난 날 종가로 사는 계산은 반칙이다. RSI·볼린저·200일선이 전부 **그날 종가로** 계산되므로,
//   종가가 확정돼야 신호를 아는데 그 확정된 종가로 산다는 건 미래를 알고 사는 것이다(look-ahead).
//   실제로는 다음 날에나 살 수 있으니 진입을 한 봉 미룬다. 시장 평균도 같은 규칙으로 계산해
//   비교가 어긋나지 않게 한다.
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

export const FWD_DAYS = [5, 10, 20] as const;
export type FwdDay = typeof FWD_DAYS[number];

export interface Stat { n: number; mean: number; median: number; winRate: number; std: number }
// 보유 기간 중 최대낙폭 — 진입가 대비 기간 내 최저 종가. "들고 있는 동안 얼마나 빠졌나".
//   평균만 보면 못 견딜 구간을 놓친다. 눌림목은 더 빠질 수 있는 자리를 사는 전략이라 이게 중요하다.
export interface DrawStat { mean: number; worst: number }
export interface HorizonResult { signal: Stat; market: Stat; excess: Stat; dd: DrawStat }
function stat(v: number[]): Stat {
  if (v.length === 0) return { n: 0, mean: 0, median: 0, winRate: 0, std: 0 };
  const s = [...v].sort((a, b) => a - b);
  const mid = s.length >> 1;
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const varr = v.reduce((a, x) => a + (x - mean) ** 2, 0) / v.length;
  return {
    n: v.length,
    mean,
    median: s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2,
    winRate: (v.filter(x => x > 0).length / v.length) * 100,
    std: Math.sqrt(varr),
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

// 한 구간의 결과. 전체·앞 절반·뒤 절반이 같은 모양이다.
export interface WindowResult {
  from: string;          // 구간 첫 신호일(평가 대상 날짜)
  to: string;            // 구간 마지막 신호일
  tradingDays: number;   // 구간 거래일 수
  signals: number;       // 조건 발동 건수(종목·날짜 조합)
  signalDays: number;    // 신호가 하루라도 난 날짜 수
  byHorizon: Record<number, HorizonResult>;
}
// 전체 구간 필드는 최상위에 그대로 둔다(패널이 그대로 읽는다). 여기에 앞/뒤 절반을 더한다.
//
// ★ 왜 반으로 나누나 — 같은 데이터로 문턱을 고르고 같은 데이터로 평가하면 **반드시** 좋은
//   숫자가 나온다(조합을 여러 개 훑으면 우연히 맞는 게 있다 = 과최적화). 앞에서 좋고 뒤에서도
//   좋아야 조건에 뭔가 있는 것이다. 실측(2026-09-30): 앞 절반 최고 조합(RSI<35·200일선+10%)이
//   +1.65%p 였는데 뒤 절반에선 -9.15%p·시장 이김 20.8% 로 뒤집혔다.
export interface BacktestResult extends WindowResult {
  ranAt: number;
  universe: number;      // 일봉을 받은 종목 수
  split: string;         // 이 날짜부터 뒤 절반
  first: WindowResult;
  second: WindowResult;
}

export function runBacktest(criteria: ScreenCriteria, bars = barsCache): BacktestResult | null {
  if (!bars || bars.length === 0) return null;
  const maxFwd = Math.max(...FWD_DAYS);
  // 날짜별로 모아 둔다 — 초과수익은 '같은 날 전 종목 평균' 을 빼야 나오고,
  //   구간을 나눌 때도 날짜로 자르면 되니 한 번만 훑고 세 번 집계한다.
  type ByH = Record<number, number[]>;
  const marketByDate = new Map<string, ByH>();
  const signalByDate = new Map<string, ByH>();
  const ddByDate = new Map<string, ByH>();
  const bucket = (m: Map<string, ByH>, d: string): ByH => {
    let b = m.get(d);
    if (!b) { b = {}; for (const h of FWD_DAYS) b[h] = []; m.set(d, b); }
    return b;
  };

  for (const b of bars) {
    const { close: cl, volume: vol, date: dt } = b;
    if (cl.length < WARMUP + maxFwd + 11) continue;
    const R = rsiSeries(cl), S = smaSeries(cl, WARMUP), B = bbLowerSeries(cl);
    // i = 신호일. 매수는 i+1(다음 거래일) 종가, 매도는 i+1+h 종가.
    for (let i = WARMUP; i < cl.length - maxFwd - 1; i++) {
      const buy = cl[i + 1];
      if (!(buy > 0)) continue;
      const mkt = bucket(marketByDate, dt[i]);
      for (const h of FWD_DAYS) mkt[h].push((cl[i + 1 + h] / buy - 1) * 100);
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
      const dd = bucket(ddByDate, dt[i]);
      for (const h of FWD_DAYS) {
        sg[h].push((cl[i + 1 + h] / buy - 1) * 100);
        // 보유 기간 중 최저 종가 — 매수일(i+1) 다음날부터 매도일(i+1+h)까지
        let low = cl[i + 2];
        for (let k = i + 3; k <= i + 1 + h; k++) low = Math.min(low, cl[k]);
        dd[h].push((low / buy - 1) * 100);
      }
    }
  }

  const allDates = [...marketByDate.keys()].sort();
  if (allDates.length === 0) return null;
  const split = allDates[Math.floor(allDates.length / 2)];

  const summarize = (inWin: (d: string) => boolean): WindowResult => {
    const dates = allDates.filter(inWin);
    const sigDates = [...signalByDate.keys()].filter(inWin);
    let signals = 0;
    for (const d of sigDates) signals += signalByDate.get(d)![FWD_DAYS[0]].length;
    const byHorizon: Record<number, HorizonResult> = {};
    for (const h of FWD_DAYS) {
      const sigAll: number[] = [], mktAll: number[] = [], excess: number[] = [], dds: number[] = [];
      for (const d of sigDates) {
        const mk = marketByDate.get(d)?.[h] ?? [];
        const base = mk.length ? mk.reduce((a, x) => a + x, 0) / mk.length : 0;
        for (const v of signalByDate.get(d)![h]) { sigAll.push(v); excess.push(v - base); }
        dds.push(...(ddByDate.get(d)?.[h] ?? []));
      }
      for (const d of dates) mktAll.push(...marketByDate.get(d)![h]);
      byHorizon[h] = {
        signal: stat(sigAll), market: stat(mktAll), excess: stat(excess),
        dd: dds.length
          ? { mean: dds.reduce((a, x) => a + x, 0) / dds.length, worst: Math.min(...dds) }
          : { mean: 0, worst: 0 },
      };
    }
    return {
      from: dates[0] ?? "", to: dates[dates.length - 1] ?? "",
      tradingDays: dates.length, signals, signalDays: sigDates.length, byHorizon,
    };
  };

  const full = summarize(() => true);
  return {
    ...full,
    ranAt: Date.now(), universe: bars.length, split,
    first: summarize(d => d < split),
    second: summarize(d => d >= split),
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
