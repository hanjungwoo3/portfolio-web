import type { Price, Investor, Consensus } from "../types";
import { reportProxySuccess, reportProxyFailure, isProxyDown } from "./proxyStatus";
import { getPersonalProxyUrl } from "./proxyConfig";
import { isKrPreOpen } from "./format";

// 공개 4-way 라운드 로빈 (Cloudflare + Vercel + Deno + Render)
const PUBLIC_PROXY_URLS: string[] = [
  import.meta.env.VITE_PROXY_URL,
  import.meta.env.VITE_PROXY_URL_2,
  import.meta.env.VITE_PROXY_URL_3,
  import.meta.env.VITE_PROXY_URL_4,
].filter(Boolean) as string[];
if (PUBLIC_PROXY_URLS.length === 0) PUBLIC_PROXY_URLS.push("http://localhost:8787");

// 런타임 — 사용자 전용 URL 있으면 그것만 사용, 없으면 공개 4-way
export function getProxyUrls(): string[] {
  const personal = getPersonalProxyUrl();
  return personal ? [personal] : PUBLIC_PROXY_URLS;
}

// 호환용 — UI/통계 표시 (현재 활성 list)
export const PROXY_URLS = new Proxy([] as string[], {
  get(_t, prop) {
    const arr = getProxyUrls();
    if (prop === "length") return arr.length;
    if (typeof prop === "string" && /^\d+$/.test(prop)) return arr[Number(prop)];
    const v = arr[prop as keyof typeof arr];
    return typeof v === "function" ? v.bind(arr) : v;
  },
});

function buildProxyUrl(base: string, targetUrl: string): string {
  return `${base}/?url=${encodeURIComponent(targetUrl)}`;
}

// 자동 fallback — 건강한 proxy 우선 + 실패 시 다른 proxy로 재시도
export async function fetchProxied(targetUrl: string): Promise<Response> {
  const urls = getProxyUrls();
  // 건강(=down 아님) 우선, down은 후순위. 그 안에서는 랜덤 (부하 분산)
  const healthy = urls.filter(u => !isProxyDown(u))
                      .sort(() => Math.random() - 0.5);
  const down = urls.filter(u => isProxyDown(u))
                   .sort(() => Math.random() - 0.5);
  const order = [...healthy, ...down];
  let lastErr: unknown;
  for (const base of order) {
    try {
      const resp = await fetch(buildProxyUrl(base, targetUrl));
      if (resp.ok) {
        reportProxySuccess(base);
        return resp;
      }
      reportProxyFailure(base);
      lastErr = new Error(`HTTP ${resp.status} from ${base}`);
    } catch (e) {
      reportProxyFailure(base);
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("All proxies failed");
}

function toKstDateString(iso: string): string {
  const dtUtc = new Date(iso);
  const kstMs = dtUtc.getTime() + 9 * 60 * 60 * 1000;
  const kst = new Date(kstMs);
  return kst.toISOString().slice(0, 10);
}

interface TossPriceItem {
  code: string;
  close: number;
  base: number;
  open: number;
  high?: number;
  low?: number;
  volume: number;
  tradeDateTime: string;
}
interface TossPriceResponse { result: TossPriceItem[]; }

export async function fetchTossPrices(tickers: string[]): Promise<Price[]> {
  if (tickers.length === 0) return [];
  const codes = tickers.map(t => `A${t}`).join(",");
  const target = `https://wts-info-api.tossinvest.com/api/v3/stock-prices/details?productCodes=${codes}`;
  const resp = await fetchProxied(target);
  if (!resp.ok) throw new Error(`Toss price fetch failed: ${resp.status}`);
  const data = await resp.json() as TossPriceResponse;
  // KST 08:00 ~ 08:59 프리장 동시호가 시간 —
  // 8시 이후 거래 시작된 종목은 어제 종가(base) 그대로 → 토스 앱과 동일 변동 표시
  // 거래 시작 안 된 종목은 base = price → 어제대비 0 (전체수익 꼬임 방지)
  const isPre = isKrPreOpen();
  let kst8amMs = 0;
  if (isPre) {
    const now = new Date();
    const kstDate = new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
    kst8amMs = new Date(`${kstDate}T08:00:00+09:00`).getTime();
  }
  return (data.result || []).map(item => {
    let base = item.base;
    if (isPre && kst8amMs > 0) {
      const tradeMs = item.tradeDateTime ? new Date(item.tradeDateTime).getTime() : 0;
      if (tradeMs < kst8amMs) base = item.close;  // 거래 시작 안 됨 → 어제대비 0
    }
    return {
      ticker: item.code.replace(/^A/, ""),
      price: item.close,
      base,
      open: item.open,
      volume: item.volume,
      trade_date: item.tradeDateTime ? toKstDateString(item.tradeDateTime) : "",
      trade_dt: item.tradeDateTime,
      high: item.high,
      low: item.low,
    };
  });
}

interface TossInvestorItem {
  baseDate: string;
  netIndividualsBuyVolume: number;
  netForeignerBuyVolume: number;
  netInstitutionBuyVolume: number;
  netPensionFundBuyVolume: number;
  netFinancialInvestmentBuyVolume: number;
  netTrustBuyVolume: number;
  netPrivateEquityFundBuyVolume: number;
  netInsuranceBuyVolume: number;
  netBankBuyVolume: number;
  netOtherFinancialInstitutionsBuyVolume: number;
  netOtherCorporationBuyVolume: number;
  foreignerRatio?: number;
}
interface TossInvestorResponse { result: { body: TossInvestorItem[] }; }

function nowKstHour(): number {
  const n = new Date();
  return new Date(n.getTime() + (9 * 60 + n.getTimezoneOffset()) * 60_000).getHours();
}


function mapInvestorItem(item: TossInvestorItem): Investor {
  return {
    date: item.baseDate,
    개인: Number(item.netIndividualsBuyVolume || 0),
    외국인: Number(item.netForeignerBuyVolume || 0),
    기관: Number(item.netInstitutionBuyVolume || 0),
    연기금: Number(item.netPensionFundBuyVolume || 0),
    금융투자: Number(item.netFinancialInvestmentBuyVolume || 0),
    투신: Number(item.netTrustBuyVolume || 0),
    사모: Number(item.netPrivateEquityFundBuyVolume || 0),
    보험: Number(item.netInsuranceBuyVolume || 0),
    은행: Number(item.netBankBuyVolume || 0),
    기타금융: Number(item.netOtherFinancialInstitutionsBuyVolume || 0),
    기타법인: Number(item.netOtherCorporationBuyVolume || 0),
    외국인비율: Number(item.foreignerRatio || 0),
  };
}

// 일별 투자자 순매수 history (최신 → 과거 순)
export async function fetchInvestorHistory(
  ticker: string, size = 60,
): Promise<Investor[]> {
  const target =
    `https://wts-info-api.tossinvest.com/api/v1/stock-infos/trade/trend/trading-trend` +
    `?productCode=A${ticker}&size=${size}`;
  const resp = await fetchProxied(target);
  if (!resp.ok) return [];
  const data = await resp.json() as TossInvestorResponse;
  const body = data.result?.body || [];
  return body.map(mapInvestorItem);
}

// 큰 size 부터 시도 → 빈 응답이면 단계적으로 작은 size 폴백.
// Toss API hard cap = 200 (실측). 그 위는 빈 응답이니 [200, 120, 60] 사용 권장.
export async function fetchInvestorHistorySafe(
  ticker: string, sizes: number[],
): Promise<Investor[]> {
  for (const s of sizes) {
    const data = await fetchInvestorHistory(ticker, s);
    if (data.length > 0) return data;
  }
  return [];
}

// 일별 가격 history (Yahoo Finance) — 한국 6자리 → KOSPI(.KS) 우선, 실패 시 KOSDAQ(.KQ)
export interface PricePoint {
  date: string;       // YYYY-MM-DD (KST)
  close: number;
  volume: number;
  open?: number;
  high?: number;
  low?: number;
}

interface YahooChartResp {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: (number | null)[];
          high?: (number | null)[];
          low?: (number | null)[];
          close?: (number | null)[];
          volume?: (number | null)[];
        }>;
      };
    }>;
  };
}

async function fetchPriceHistoryFor(
  symbol: string, range: string,
): Promise<PricePoint[]> {
  const target =
    `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}` +
    `?range=${range}&interval=1d`;
  const resp = await fetchProxied(target);
  if (!resp.ok) return [];
  const data = await resp.json() as YahooChartResp;
  const res = data.chart?.result?.[0];
  if (!res) return [];
  const ts = res.timestamp ?? [];
  const q = res.indicators?.quote?.[0] ?? {};
  const closes = q.close ?? [];
  const volumes = q.volume ?? [];
  const opens = q.open ?? [];
  const highs = q.high ?? [];
  const lows = q.low ?? [];
  const points: PricePoint[] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i];
    if (c == null) continue;  // null = 비거래일/미체결
    // KST 변환 — Asia/Seoul 시간대로 ts 를 변환
    const d = new Date(ts[i] * 1000);
    const kst = new Date(d.getTime() + (d.getTimezoneOffset() + 540) * 60_000);
    const date = kst.toISOString().slice(0, 10);
    points.push({
      date,
      close: c,
      volume: volumes[i] ?? 0,
      open: opens[i] ?? undefined,
      high: highs[i] ?? undefined,
      low: lows[i] ?? undefined,
    });
  }
  return points;
}

// 한국 6자리 → KOSPI 시도 → 실패 시 KOSDAQ
export async function fetchKrPriceHistory(
  ticker: string, range = "1y",
): Promise<PricePoint[]> {
  if (!/^\d{6}$/.test(ticker)) return [];
  const ks = await fetchPriceHistoryFor(`${ticker}.KS`, range);
  if (ks.length > 0) return ks;
  return await fetchPriceHistoryFor(`${ticker}.KQ`, range);
}

// 8시 KST 이전 + body[0] 전부 0 → body[1] 폴백 (데스크톱 v2 동일)
export function pickTodayInvestor(history: Investor[]): Investor | null {
  if (history.length === 0) return null;
  const item = history[0];
  if (nowKstHour() < 8 && history.length >= 2) {
    const isAllZero =
      item.개인 === 0 && item.외국인 === 0 && item.기관 === 0;
    if (isAllZero) return history[1];
  }
  return item;
}

export async function fetchInvestor(ticker: string): Promise<Investor | null> {
  const history = await fetchInvestorHistory(ticker, 60);
  return pickTodayInvestor(history);
}

// 토스 wts-badges — 풀네임 표시 (토스 화면과 일치)
// 우선순위: 투자위험 > 관리종목 > 거래정지 > 투자경고 > 공매도과열 > 단기과열 > 투자주의환기 > 투자주의
interface TossBadgeItem { title: string; }
interface TossBadgeResponse { result: TossBadgeItem[]; }

const WARNING_MAP: [string, string][] = [
  ["투자위험", "투자위험"],
  ["관리종목", "관리종목"],
  ["거래정지", "거래정지"],
  ["투자경고", "투자경고"],
  ["공매도", "공매도과열"],
  ["단기과열", "단기과열"],
  ["투자주의환기", "투자주의환기"],
  ["투자주의", "투자주의"],
];

export async function fetchWarning(ticker: string): Promise<string> {
  const target = `https://wts-info-api.tossinvest.com/api/v1/stock-infos/A${ticker}/wts-badges`;
  try {
    const resp = await fetchProxied(target);
    if (!resp.ok) return "";
    const data = await resp.json() as TossBadgeResponse;
    const titles = (data.result || []).map(it => it.title || "").join(" ");
    for (const [full, short] of WARNING_MAP) {
      if (titles.includes(full)) return short;
    }
  } catch {
    // ignore
  }
  return "";
}

// Yahoo Finance — 지수/심볼 가격 + 등락률
export interface UsIndex {
  symbol: string;
  name: string;
  price: number;
  prev: number;
  diff: number;
  pct: number;
  currency?: string;
  tradeDate: string;       // KST 날짜 (YYYY-MM-DD) — 마지막 거래 시각 기준
  marketState: string;     // REGULAR / PRE / POST / CLOSED / PREPRE / POSTPOST
}

// Yahoo quoteSummary v10 — yfinance Python 과 동일 데이터 소스
// Worker 가 crumb 자동 처리 (인증 우회). 데스크톱 v2 _fast_quote 와 같은 분기 적용.
interface QuoteSummaryRaw {
  raw?: number;
  fmt?: string;
}
interface QuoteSummaryPrice {
  regularMarketPrice?: QuoteSummaryRaw;
  regularMarketPreviousClose?: QuoteSummaryRaw;
  preMarketPrice?: QuoteSummaryRaw;
  postMarketPrice?: QuoteSummaryRaw;
  regularMarketTime?: number;     // unix seconds (raw)
  marketState?: string;
  currency?: string;
}
interface QuoteSummaryResponse {
  quoteSummary?: {
    result?: { price?: QuoteSummaryPrice }[] | null;
  };
}

function _val(x: QuoteSummaryRaw | undefined): number | undefined {
  if (!x || typeof x.raw !== "number") return undefined;
  return x.raw;
}
function _isValid(n: number | undefined): n is number {
  return typeof n === "number" && !Number.isNaN(n) && n !== 0;
}

export async function fetchYahooQuote(symbol: string, name: string): Promise<UsIndex | null> {
  const target = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=price`;
  try {
    const resp = await fetchProxied(target);
    if (!resp.ok) return null;
    const data = await resp.json() as QuoteSummaryResponse;
    const p = data.quoteSummary?.result?.[0]?.price;
    if (!p) return null;

    const regP = _val(p.regularMarketPrice);
    const regPrev = _val(p.regularMarketPreviousClose);
    const preP = _val(p.preMarketPrice);
    const postP = _val(p.postMarketPrice);
    const state = (p.marketState ?? "").toUpperCase();

    // 데스크톱 v2 _fast_quote 동일 분기:
    // PRE  → price=preMarketPrice,  base=regularMarketPrice (직전 정규장 종가)
    // POST → price=postMarketPrice, base=regularMarketPrice (오늘 정규장 종가)
    // 그 외 (REGULAR / CLOSED) → price=regularMarketPrice, base=regularMarketPreviousClose
    let price: number;
    let prev: number;
    if (state === "PRE" && _isValid(preP) && _isValid(regP)) {
      price = preP; prev = regP;
    } else if (state === "POST" && _isValid(postP) && _isValid(regP)) {
      price = postP; prev = regP;
    } else if (_isValid(regP)) {
      price = regP;
      prev = _isValid(regPrev) ? regPrev : regP;
    } else {
      return null;
    }

    const diff = price - prev;
    const pct = prev > 0 ? (diff / prev) * 100 : 0;

    // tradeDate (KST)
    let tradeDate = "";
    if (typeof p.regularMarketTime === "number") {
      const kstMs = p.regularMarketTime * 1000 + 9 * 3600 * 1000;
      tradeDate = new Date(kstMs).toISOString().slice(0, 10);
    }

    return {
      symbol, name, price, prev, diff, pct,
      currency: p.currency, tradeDate, marketState: state,
    };
  } catch {
    return null;
  }
}

// 다수 심볼 한꺼번에 — 병렬 fetch
export async function fetchYahooBatch(
  pairs: { symbol: string; name: string }[]
): Promise<Map<string, UsIndex>> {
  const results = await Promise.all(
    pairs.map(p => fetchYahooQuote(p.symbol, p.name))
  );
  const map = new Map<string, UsIndex>();
  for (const r of results) {
    if (r) map.set(r.symbol, r);
  }
  return map;
}

// 헤더용 핵심 6종 (deprecated: UsMarketTab 으로 통합 가능하지만 헤더 바에서도 사용)
export async function fetchUsIndices(): Promise<UsIndex[]> {
  const list: { symbol: string; name: string }[] = [
    { symbol: "^GSPC", name: "S&P 500" },
    { symbol: "^IXIC", name: "NASDAQ" },
    { symbol: "^DJI",  name: "DOW" },
    { symbol: "^KS11", name: "KOSPI" },
    { symbol: "KRW=X", name: "USD/KRW" },
    { symbol: "^VIX",  name: "VIX" },
  ];
  const map = await fetchYahooBatch(list);
  return Array.from(map.values());
}

// 네이버 금융 HTML 파싱 — 섹터 + 컨센서스 (목표주가 + 투자의견)
// 단일 페이지 fetch 후 둘 다 추출 (네트워크 1회)
export interface NaverInfo {
  sector: string;
  consensus: Consensus | null;
}

export async function fetchNaverInfo(ticker: string): Promise<NaverInfo> {
  const target = `https://finance.naver.com/item/main.naver?code=${ticker}`;
  const empty: NaverInfo = { sector: "", consensus: null };
  try {
    const resp = await fetchProxied(target);
    if (!resp.ok) return empty;
    // Naver finance 는 EUC-KR 가능 — Content-Type 체크 후 디코딩
    const buf = await resp.arrayBuffer();
    const ct = resp.headers.get("Content-Type") || "";
    const charset = /charset=([\w-]+)/i.exec(ct)?.[1]?.toLowerCase() || "euc-kr";
    let html: string;
    try {
      html = new TextDecoder(charset).decode(buf);
    } catch {
      html = new TextDecoder("euc-kr").decode(buf);
    }
    const doc = new DOMParser().parseFromString(html, "text/html");

    // 섹터 — 동일업종 링크 텍스트
    let sector = "";
    const links = doc.querySelectorAll("a[href*='sise_group_detail']");
    if (links.length > 0) sector = links[0].textContent?.trim() || "";

    // 컨센서스 — 목표주가 th 옆 td
    let consensus: Consensus | null = null;
    const ths = doc.querySelectorAll("th");
    let targetTh: Element | null = null;
    ths.forEach(th => {
      if (!targetTh && th.textContent?.includes("목표주가")) targetTh = th;
    });
    if (targetTh) {
      const td = (targetTh as Element).nextElementSibling;
      if (td) {
        // 투자의견 점수 + 텍스트 — span.f_up / f_down 안의 em
        let score: number | undefined;
        let opinion: string | undefined;
        const fSpan = td.querySelector("span[class^='f_']");
        if (fSpan) {
          const scoreEm = fSpan.querySelector("em");
          const scoreText = scoreEm?.textContent?.trim() ?? "";
          const sNum = Number(scoreText);
          if (!Number.isNaN(sNum)) score = sNum;
          opinion = (fSpan.textContent ?? "").replace(scoreText, "").trim();
        }
        // 목표주가: td 안의 em 중 span 외부에 있는 것 (데스크톱 v2 동일)
        let targetPrice: number | undefined;
        const ems = Array.from(td.querySelectorAll("em"));
        for (const em of ems) {
          if (em.closest("span")) continue;  // span 안 (= score em) 제외
          const val = (em.textContent ?? "").trim().replace(/,/g, "");
          if (/^\d+$/.test(val)) {
            const n = Number(val);
            if (n > 0) {
              targetPrice = n;
              break;
            }
          }
        }
        consensus = { target: targetPrice, score, opinion };
      }
    }
    return { sector, consensus };
  } catch {
    return empty;
  }
}

// ─── 종목 검색 — 네이버 자동완성 (KOR 6자리만) ───
export interface SearchResult {
  ticker: string;
  name: string;
  market: string;          // KOSPI / KOSDAQ
}

interface NaverACItem {
  code?: string;
  name?: string;
  typeCode?: string;
  nationCode?: string;
  category?: string;
}
interface NaverACResp {
  result?: { items?: NaverACItem[] };
}

export async function searchNaverAutoComplete(
  query: string, limit = 20
): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const url = `https://m.stock.naver.com/front-api/search/autoComplete`
            + `?query=${encodeURIComponent(q)}&target=stock`;
  try {
    const resp = await fetchProxied(url);
    if (!resp.ok) return [];
    const json = (await resp.json()) as NaverACResp;
    const items = json.result?.items ?? [];
    const out: SearchResult[] = [];
    for (const it of items) {
      const code = (it.code ?? "").trim();
      if (!/^\d{6}$/.test(code)) continue;
      if (it.nationCode && it.nationCode !== "KOR") continue;
      out.push({
        ticker: code,
        name: it.name ?? code,
        market: it.typeCode || "KOSPI",
      });
      if (out.length >= limit) break;
    }
    return out;
  } catch {
    return [];
  }
}

// 6자리 코드 → 이름 단건 조회 (네이버 메인 title)
export async function fetchStockName(ticker: string): Promise<string | null> {
  if (!/^\d{6}$/.test(ticker)) return null;
  try {
    const resp = await fetchProxied(
      `https://finance.naver.com/item/main.naver?code=${ticker}`);
    if (!resp.ok) return null;
    const buf = await resp.arrayBuffer();
    const ct = resp.headers.get("Content-Type") || "";
    const charset = /charset=([\w-]+)/i.exec(ct)?.[1]?.toLowerCase() || "euc-kr";
    let html: string;
    try { html = new TextDecoder(charset).decode(buf); }
    catch { html = new TextDecoder("euc-kr").decode(buf); }
    const doc = new DOMParser().parseFromString(html, "text/html");
    const t = doc.querySelector("div.wrap_company h2 a");
    const name = (t?.textContent ?? "").trim();
    return name || null;
  } catch {
    return null;
  }
}

