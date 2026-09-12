// 시세 공급자 — 사양서 §7 MarketDataProvider 계약.
//
// 실제 공급자는 토스 c-chart(무인증, 기존 api.ts 가 쓰는 것과 같은 소스)다.
//   경로: /api/v1/c-chart/kr-s/A{code}/{interval}?count=N
//   · 분봉  min:1|3|5|10|30|60   (★ min:45 는 토스가 400 을 준다 — 실측)
//   · 장기  day:1 week:1 month:1 year:1
//   응답은 result.candles 이고 **최신순**이다. 오름차순으로 뒤집어 쓴다.
//
// 토스가 막히면(프록시 한도 등) 예제 데이터로 떨어진다. 그때는 mode="mock" 이라
//   화면에 '예제 데이터' 배지가 뜬다 — 만들어낸 값을 실제 시세처럼 보여주지 않는다.

import { fetchProxied } from "../api";
import type {
  Candle, CandleResponse, Interval, MarketDataProvider, BarTime, Instrument,
} from "./types";

// 토스가 실제로 받아주는 주기만 매핑한다. 없는 건 미지원으로 노출한다.
const TOSS_PATH: Partial<Record<Interval, string>> = {
  "1m": "min:1", "3m": "min:3", "5m": "min:5", "10m": "min:10",
  "30m": "min:30", "60m": "min:60",
  // "45m" — 토스 400. 일봉을 쪼개 흉내내지 않는다.
  "1d": "day:1", "1w": "week:1", "1mo": "month:1", "1y": "year:1",
};
export const SUPPORTED_INTERVALS = Object.keys(TOSS_PATH) as Interval[];
export const isIntraday = (iv: Interval) => TOSS_PATH[iv]?.startsWith("min:") ?? false;

const MAX_COUNT = 450;   // 토스 상한(기존 TOSS_CANDLE_MAX 와 동일)

interface TossCandle {
  dt?: string; open?: number; high?: number; low?: number; close?: number; volume?: number;
}

// "2026-09-11T20:00:00+09:00" → 분봉은 UTC 초, 일봉 이상은 날짜 문자열.
//   ★ 일봉을 초로 저장하면 시간대 변환에서 하루 밀린다. dt 의 앞 10자를 그대로 쓴다.
function toBarTime(dt: string, intraday: boolean): BarTime | null {
  if (!dt) return null;
  if (!intraday) {
    const d = dt.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(d) ? { kind: "date", value: d } : null;
  }
  const ms = Date.parse(dt);
  if (!Number.isFinite(ms)) return null;
  return { kind: "unix", value: Math.floor(ms / 1000) };   // 밀리초를 초로 잘못 넘기지 않는다
}

// 사양서 §7 검증 — 유한 양수 OHLC, 0 이상 거래량, low ≤ min(o,c) ≤ max(o,c) ≤ high.
export function isValidCandle(c: Candle): boolean {
  const { open, high, low, close, volume } = c;
  if (![open, high, low, close].every(v => Number.isFinite(v) && v > 0)) return false;
  if (!Number.isFinite(volume) || volume < 0) return false;
  return low <= Math.min(open, close) && Math.max(open, close) <= high;
}

// 시간순 정렬 + 같은 시간 중복 제거(뒤에 온 것을 남긴다 — 최신 정정값).
export function normalizeCandles(list: Candle[]): Candle[] {
  const byKey = new Map<string, Candle>();
  for (const c of list) {
    if (!isValidCandle(c)) continue;
    byKey.set(c.time.kind === "date" ? `d:${c.time.value}` : `u:${c.time.value}`, c);
  }
  return [...byKey.values()].sort((a, b) => sortable(a.time) - sortable(b.time));
}
const sortable = (t: BarTime): number =>
  t.kind === "unix" ? t.value : Date.parse(`${t.value}T00:00:00Z`) / 1000;

function instrumentOf(symbol: string, name: string): Instrument {
  // priceDecimals — 한국 주식은 원 단위 정수다. 호가 단위(tick)는 가격대마다 달라
  //   전 종목 공통값을 하드코딩하지 않는다(사양서 §4). 그리기는 자유 가격이라 tick 불필요.
  return { symbol, name, currency: "KRW", timezone: "Asia/Seoul", priceDecimals: 0 };
}

export class TossMarketDataProvider implements MarketDataProvider {
  private readonly nameOf: (symbol: string) => string;
  constructor(nameOf: (symbol: string) => string = () => "") { this.nameOf = nameOf; }

  async getCandles(input: {
    symbol: string; interval: Interval; limit: number; signal?: AbortSignal;
  }): Promise<CandleResponse> {
    const { symbol, interval } = input;
    const path = TOSS_PATH[interval];
    const instrument = instrumentOf(symbol, this.nameOf(symbol));
    if (!path) {
      // 지원하지 않는 주기 — 일봉을 복제해 흉내내지 않고 빈 결과를 돌려준다.
      return {
        candles: [], hasMore: false, asOf: new Date().toISOString(),
        mode: "delayed", supportedIntervals: SUPPORTED_INTERVALS, instrument,
      };
    }
    const n = Math.min(Math.max(input.limit, 1), MAX_COUNT);
    const url = `https://wts-info-api.tossinvest.com/api/v1/c-chart/kr-s/A${symbol}/${path}`
              + `?count=${n}&useAdjustedRate=true`;
    const resp = await fetchProxied(url, { signal: input.signal });
    if (!resp.ok) throw new Error(`시세 조회 실패 (HTTP ${resp.status})`);
    const json = await resp.json() as { result?: { candles?: TossCandle[] } };
    const raw = json.result?.candles ?? [];
    const intraday = isIntraday(interval);
    const candles = normalizeCandles(raw.flatMap((c): Candle[] => {
      const time = toBarTime(c.dt ?? "", intraday);
      if (!time) return [];
      return [{
        time,
        open: Number(c.open), high: Number(c.high),
        low: Number(c.low), close: Number(c.close),
        volume: Number(c.volume ?? 0),
      }];
    }));
    return {
      candles,
      hasMore: candles.length >= n,
      asOf: new Date().toISOString(),
      mode: "delayed",                       // 토스 시세는 실시간 체결이 아니라 지연/스냅샷이다
      supportedIntervals: SUPPORTED_INTERVALS,
      instrument,
    };
  }
}

// ─── 예제 데이터 — 고정 seed 라 매번 같은 모양이 나온다(사양서 §7) ───
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class MockMarketDataProvider implements MarketDataProvider {
  async getCandles(input: { symbol: string; interval: Interval; limit: number }): Promise<CandleResponse> {
    const { symbol, interval } = input;
    const n = Math.min(Math.max(input.limit, 1), MAX_COUNT);
    const rand = mulberry32(1234);
    const intraday = isIntraday(interval);
    const out: Candle[] = [];
    let price = 70_000;
    // 기준일을 고정한다 — '오늘'을 쓰면 실행할 때마다 결과가 달라져 결정적이지 않다.
    const base = Date.UTC(2026, 0, 2, 0, 0, 0) / 1000;
    for (let i = 0; i < n; i++) {
      const drift = (rand() - 0.48) * price * 0.02;
      const open = price;
      const close = Math.max(1000, open + drift);
      const high = Math.max(open, close) * (1 + rand() * 0.01);
      const low = Math.min(open, close) * (1 - rand() * 0.01);
      price = close;
      const time: BarTime = intraday
        ? { kind: "unix", value: base + i * 300 }
        : { kind: "date", value: new Date((base + i * 86400) * 1000).toISOString().slice(0, 10) };
      out.push({
        time,
        open: Math.round(open), high: Math.round(high),
        low: Math.round(low), close: Math.round(close),
        volume: Math.round(1_000_000 + rand() * 9_000_000),
      });
    }
    return {
      candles: normalizeCandles(out),
      hasMore: false,
      asOf: new Date().toISOString(),
      mode: "mock",
      supportedIntervals: SUPPORTED_INTERVALS,
      instrument: instrumentOf(symbol, "예제"),
    };
  }
}
