// 일본 구성종목 — 이름으로 JPX 심볼을 찾아 야후에서 시세를 받는다.
//
// 왜 이런 우회가 필요한가:
//   토스 ETF 구성 API 는 **일본 종목의 stockCode 를 null 로 준다**(미국은 US…/NAS… 를 준다).
//   토스증권이 일본 주식을 취급하지 않아 내부코드가 아예 없다 — 토스 검색에도 안 잡힌다.
//   그래서 시세를 물어볼 대상이 없어 카드가 전부 '—' 였다.
//
// 해결: 야후 검색(v1/finance/search)으로 이름 → JPX 심볼(6857.T) 을 풀고, 한 번 푼 건
//   localStorage 에 영구 보관한다(회사 이름↔상장코드는 변하지 않는다). 못 찾은 것도 기억해
//   같은 이름으로 매번 검색이 나가지 않게 한다.
//
// ⚠️ 이름 매칭 함정: "TOKYO ELECTRON LTD" 로 검색하면 **다른 회사** TOKYO ELECTRON DEVICE(2760.T)
//   가 걸릴 수 있다. 그래서 ① 법인 접미사를 떼고 검색하고 ② 결과 이름이 검색어로 시작하는지
//   확인한다. 그래도 틀릴 수 있으니 카드에 찾아낸 심볼을 찍어 눈에 띄게 한다.

import { fetchProxied } from "./api";
import type { Price } from "../types";

const CACHE_KEY = "jp_symbol_by_name";
const MISS = "-";                                  // 못 찾음 표식(재검색 방지)

type SymMap = Record<string, string>;

function loadMap(): SymMap {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}") as SymMap; }
  catch { return {}; }
}
function saveMap(m: SymMap): void {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(m)); } catch { /* noop */ }
}

/** 법인 접미사 제거 + 대문자 정규화 — 검색어와 비교 양쪽에 같은 함수를 쓴다. */
function coreName(s: string): string {
  return (s || "")
    .toUpperCase()
    .replace(/[.,]/g, " ")
    .replace(/\b(CO|CORP|CORPORATION|LTD|LIMITED|INC|HOLDINGS|HLDGS|GROUP|PLC|KK)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 이 이름이 일본 종목일 법한가 — 토스가 코드를 안 준 라틴문자 회사명만 시도한다. */
export function looksLikeForeignName(name: string): boolean {
  const n = (name || "").trim();
  return n.length >= 3 && /^[A-Za-z0-9&.,'()\- ]+$/.test(n);
}

interface YahooSearchResp {
  quotes?: { symbol?: string; exchange?: string; shortname?: string; longname?: string }[];
}

/** 이름 하나 → JPX 심볼. 캐시 우선, 없으면 야후 검색 1콜. */
async function resolveOne(name: string, map: SymMap): Promise<string | null> {
  const key = coreName(name);
  const hit = map[key];
  if (hit) return hit === MISS ? null : hit;

  const q = encodeURIComponent(key);
  try {
    const resp = await fetchProxied(
      `https://query1.finance.yahoo.com/v1/finance/search?q=${q}&quotesCount=8&newsCount=0`);
    if (!resp.ok) return null;                     // 실패는 캐시하지 않는다(다음에 다시 시도)
    const data = await resp.json() as YahooSearchResp;
    const jpx = (data.quotes ?? []).filter(x => x.exchange === "JPX" && x.symbol);
    // 이름이 검색어로 시작하는 것을 우선 — DEVICE 같은 파생 상호를 걸러낸다.
    const exact = jpx.find(x => coreName(x.shortname || x.longname || "").startsWith(key));
    const pick = exact ?? jpx[0];
    map[key] = pick?.symbol ?? MISS;
    saveMap(map);
    return pick?.symbol ?? null;
  } catch {
    return null;
  }
}

/** 이름 목록 → { 이름: JPX심볼 }. 캐시에 있는 건 콜이 안 나간다. */
export async function resolveJpSymbols(names: string[]): Promise<Map<string, string>> {
  const map = loadMap();
  const out = new Map<string, string>();
  for (const n of names) {
    const sym = await resolveOne(n, map);          // 순차 — 검색은 첫 1회뿐이라 느려도 된다
    if (sym) out.set(n, sym);
  }
  return out;
}

interface YahooChartMeta {
  chart?: {
    result?: {
      meta?: { regularMarketPrice?: number; chartPreviousClose?: number };
      timestamp?: number[];
      indicators?: { quote?: { close?: (number | null)[] }[] };
    }[];
  };
}

async function fetchJpyKrw(): Promise<number> {
  try {
    const resp = await fetchProxied(
      "https://query1.finance.yahoo.com/v8/finance/chart/JPYKRW=X?range=1d&interval=1d");
    if (!resp.ok) return 0;
    const d = await resp.json() as YahooChartMeta;
    return d.chart?.result?.[0]?.meta?.regularMarketPrice ?? 0;   // 1엔당 원
  } catch { return 0; }
}

/**
 * 일본 구성종목 시세 — 원화 환산 + 엔 병기.
 * @returns Price[] (ticker = 구성종목 **이름**. 코드가 없으니 이름이 곧 키다)
 */
export async function fetchJpHoldingPrices(names: string[]): Promise<Price[]> {
  if (names.length === 0) return [];
  const [syms, rate] = await Promise.all([resolveJpSymbols(names), fetchJpyKrw()]);
  if (syms.size === 0) return [];
  const out: Price[] = [];
  await Promise.all([...syms].map(async ([name, sym]) => {
    try {
      const resp = await fetchProxied(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=5d&interval=1d`);
      if (!resp.ok) return;
      const d = await resp.json() as YahooChartMeta;
      const res = d.chart?.result?.[0];
      // ⚠️ meta.chartPreviousClose 는 '전일 종가'가 아니라 **조회 범위 시작 직전**의 종가다.
      //   range=5d 로 부르면 5거래일 전 값이라 등락률이 통째로 틀린다(실측: +4.28% ↔ 실제 +4.20%).
      //   일봉 배열의 **마지막 두 봉**으로 직접 낸다.
      const ts = res?.timestamp ?? [];
      const closes = (res?.indicators?.quote?.[0]?.close ?? []);
      const bars: { date: string; close: number }[] = [];
      for (let i = 0; i < ts.length; i++) {
        const c = closes[i];
        if (c == null || !(c > 0)) continue;
        bars.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), close: c });
      }
      if (bars.length === 0) return;
      const last = bars[bars.length - 1];
      const prev = bars[bars.length - 2];
      const live = res?.meta?.regularMarketPrice ?? 0;
      // 장중이면 meta 가 마지막 봉보다 최신일 수 있다 — 더 최신 쪽을 현재가로 본다.
      const jpy = live > 0 ? live : last.close;
      const prevJpy = (live > 0 && live !== last.close) ? last.close : (prev?.close ?? 0);
      if (jpy <= 0 || prevJpy <= 0) return;
      // 환율을 못 받으면 원화로 속이지 않는다 — 엔 값을 그대로 넣고 currency 로 알린다.
      const k = rate > 0 ? rate : 1;
      // 원화는 **정수로 반올림**한다 — 환산이라 소수가 남는데(275,790.25원) 다른 원화 카드는
      //   전부 정수라 눈에 거슬린다. 등락률은 price/base 로 내므로 둘 다 반올림해야 어긋나지 않는다.
      const won = (v: number) => Math.round(v * k);
      out.push({
        ticker: name, price: won(jpy), base: won(prevJpy), prevClose: won(prevJpy),
        open: 0, volume: 0,
        // 이 값이 **언제 것인지**. 일본은 연휴가 길어(9/21~23 경로의날·국민휴일·추분) 한국 ETF 와
        //   며칠씩 어긋난다 — 화면이 날짜를 말해주지 않으면 값이 틀린 것처럼 보인다.
        trade_date: last.date,
        priceJpy: jpy, jpSymbol: sym,
        currency: rate > 0 ? "KRW" : "USD",        // USD 는 '원 아님' 표식으로만 쓴다
      });
    } catch { /* 한 종목 실패가 나머지를 막지 않는다 */ }
  }));
  return out;
}
