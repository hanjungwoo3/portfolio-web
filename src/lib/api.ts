import type { Price, Investor, Consensus } from "../types";
import { reportProxySuccess, reportProxyFailure, isProxyDown } from "./proxyStatus";
import { getPersonalProxyUrl } from "./proxyConfig";

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
// init 옵션 — POST + body 등 RequestInit 일부 전달 가능 (워커가 POST 지원)
export async function fetchProxied(
  targetUrl: string, init?: RequestInit,
): Promise<Response> {
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
      const resp = await fetch(buildProxyUrl(base, targetUrl), init);
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

// 토스 미국 종목 가격 — 24시간 ECN Overnight 포함 (Yahoo postMarketPrice 보다 최신).
// 입력: US19890516001 같은 토스 코드. 응답: close(현재가) / base(직전 정규장 종가)
export interface TossUsPrice {
  code: string;
  close: number;
  base: number;        // 직전 정규장 종가
  pct: number;         // (close - base) / base × 100
  tradeDateTime: string;
}
export async function fetchTossUsPrices(codes: string[]): Promise<Map<string, TossUsPrice>> {
  const out = new Map<string, TossUsPrice>();
  if (codes.length === 0) return out;
  const target = `https://wts-info-api.tossinvest.com/api/v3/stock-prices/details?productCodes=${codes.join(",")}`;
  try {
    const resp = await fetchProxied(target);
    if (!resp.ok) return out;
    const data = await resp.json() as {
      result?: Array<{
        code: string; close: number; base: number; tradeDateTime: string;
      }>;
    };
    for (const item of (data.result ?? [])) {
      if (!item.code || !item.close || !item.base) continue;
      const pct = item.base > 0 ? ((item.close - item.base) / item.base) * 100 : 0;
      out.set(item.code, {
        code: item.code, close: item.close, base: item.base,
        pct, tradeDateTime: item.tradeDateTime,
      });
    }
  } catch { /* network failure — return empty */ }
  return out;
}

export async function fetchTossPrices(tickers: string[]): Promise<Price[]> {
  if (tickers.length === 0) return [];
  const codes = tickers.map(t => `A${t}`).join(",");
  const target = `https://wts-info-api.tossinvest.com/api/v3/stock-prices/details?productCodes=${codes}`;
  const resp = await fetchProxied(target);
  if (!resp.ok) throw new Error(`Toss price fetch failed: ${resp.status}`);
  const data = await resp.json() as TossPriceResponse;
  // 비거래일·정규장 시작 전 처리 — base = close → 어제대비 0
  // 판정: 마지막 체결의 KST 날짜가 "오늘 KST 날짜" 와 다르면 오늘 거래가 없음
  // (주말·공휴일·노동절·정규장 시작 전 모두 이 조건에 자동 부합).
  // 휴장 캘린더 불필요 — tradeDateTime 만으로 판정.
  const todayKst = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  return (data.result || []).map(item => {
    let base = item.base;
    let high: number | undefined = item.high;
    let low: number | undefined = item.low;
    let volume = item.volume;
    if (item.tradeDateTime) {
      const tradeKst = new Date(
        new Date(item.tradeDateTime).getTime() + 9 * 3600_000
      ).toISOString().slice(0, 10);
      if (tradeKst !== todayKst) {
        // 오늘 거래 없음 → 어제대비 0 + 고/저/거래량 숨김
        // (마지막 거래일의 고/저/거래량을 "오늘 값" 처럼 잘못 보이는 문제 수정)
        base = item.close;
        high = undefined;
        low = undefined;
        volume = 0;
      }
    }
    return {
      ticker: item.code.replace(/^A/, ""),
      price: item.close,
      base,
      prevClose: item.base,  // 직전 거래일 종가 — 비거래일 보정 영향 없음 (색상용)
      open: item.open,
      volume,
      trade_date: item.tradeDateTime ? toKstDateString(item.tradeDateTime) : "",
      trade_dt: item.tradeDateTime,
      high,
      low,
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
      events?: {
        dividends?: Record<string, { date: number; amount: number }>;
        splits?: Record<string, {
          date: number;
          numerator: number;
          denominator: number;
          splitRatio?: string;
        }>;
      };
    }>;
  };
}

// 배당 이벤트 (배당락일 = ex-dividend date)
export interface DividendEvent {
  date: string;       // YYYY-MM-DD (KST)
  amount: number;     // 주당 배당금 (원 또는 USD)
}

// 액면분할/병합 이벤트
export interface SplitEvent {
  date: string;        // YYYY-MM-DD (KST)
  numerator: number;   // 분할 후 (예: 50:1 → 50)
  denominator: number; // 분할 전 (예: 50:1 → 1)
  ratio: string;       // "50:1" 형태 표시용
}

// DART 공시 (OpenDART API list.json 기반)
export interface DartDisclosure {
  date: string;        // YYYY-MM-DD (rcept_dt → KST)
  title: string;       // 보고서명 (report_nm)
  url: string;         // DART 상세 URL
  reportNm: string;    // 원본 보고서명 (filter 용)
}

// 일별 공매도 (토스 short-selling-trend API)
export interface ShortSellingPoint {
  date: string;          // YYYY-MM-DD
  avgPrice: number;      // 공매도 평균가
  shortVolume: number;   // 공매도 수량 (주)
  ratio: number;         // 거래량 대비 공매도 비율 (%)
  amountRatio: number;   // 거래대금 대비 공매도 비율 (%)
}

// 시장 매매동향 (토스 index/net-buying API) — KOSPI/KOSDAQ 일별 투자자별 순매수
//   금액 단위: 원 (1억 = 100,000,000) → UI 에서 억원으로 변환 필요
export interface MarketFlowPoint {
  date: string;
  individuals: number;        // 개인
  foreigners: number;         // 외국인
  institutions: number;       // 기관계
  // 기관 상세 (큰 단위 → 작은 단위 순)
  financialInvestment: number; // 금융투자
  pensionFund: number;         // 연기금등
  trust: number;               // 투신
  privateEquity: number;       // 사모펀드
  insurance: number;           // 보험
  bank: number;                // 은행
  otherFinancial: number;      // 기타금융
}
export const MARKET_INDEX_CODES = {
  KOSPI:  "KGG01P",
  KOSDAQ: "QGG01P",
} as const;
export type MarketIndexKey = keyof typeof MARKET_INDEX_CODES;

async function fetchPriceHistoryFor(
  symbol: string, range: string,
): Promise<PricePoint[]> {
  const r = await fetchPriceHistoryWithEventsFor(symbol, range);
  return r.prices;
}

// 가격 + 배당 + 액면분할 이벤트 통합 fetch
async function fetchPriceHistoryWithEventsFor(
  symbol: string, range: string,
): Promise<{ prices: PricePoint[]; dividends: DividendEvent[]; splits: SplitEvent[] }> {
  const target =
    `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}` +
    `?range=${range}&interval=1d&events=div%2Csplit`;
  const empty = { prices: [] as PricePoint[], dividends: [] as DividendEvent[], splits: [] as SplitEvent[] };
  const resp = await fetchProxied(target);
  if (!resp.ok) return empty;
  const data = await resp.json() as YahooChartResp;
  const res = data.chart?.result?.[0];
  if (!res) return empty;
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
    if (c == null) continue;
    const d = new Date(ts[i] * 1000);
    const kst = new Date(d.getTime() + (d.getTimezoneOffset() + 540) * 60_000);
    const date = kst.toISOString().slice(0, 10);
    points.push({
      date, close: c,
      volume: volumes[i] ?? 0,
      open: opens[i] ?? undefined,
      high: highs[i] ?? undefined,
      low: lows[i] ?? undefined,
    });
  }
  // 배당 이벤트 — KST 기준 날짜로 변환
  const dividends: DividendEvent[] = [];
  const divMap = res.events?.dividends ?? {};
  for (const v of Object.values(divMap)) {
    const d = new Date(v.date * 1000);
    const kst = new Date(d.getTime() + (d.getTimezoneOffset() + 540) * 60_000);
    dividends.push({
      date: kst.toISOString().slice(0, 10),
      amount: v.amount,
    });
  }
  dividends.sort((a, b) => a.date.localeCompare(b.date));
  // 액면분할 이벤트
  const splits: SplitEvent[] = [];
  const splitMap = res.events?.splits ?? {};
  for (const v of Object.values(splitMap)) {
    const d = new Date(v.date * 1000);
    const kst = new Date(d.getTime() + (d.getTimezoneOffset() + 540) * 60_000);
    splits.push({
      date: kst.toISOString().slice(0, 10),
      numerator: v.numerator,
      denominator: v.denominator,
      ratio: v.splitRatio || `${v.numerator}:${v.denominator}`,
    });
  }
  splits.sort((a, b) => a.date.localeCompare(b.date));
  return { prices: points, dividends, splits };
}

// 한국 6자리 → KOSPI 시도 → 실패 시 KOSDAQ
export async function fetchKrPriceHistory(
  ticker: string, range = "1y",
): Promise<PricePoint[]> {
  if (!/^[\dA-Za-z]{6}$/.test(ticker)) return [];
  const ks = await fetchPriceHistoryFor(`${ticker}.KS`, range);
  if (ks.length > 0) return ks;
  return await fetchPriceHistoryFor(`${ticker}.KQ`, range);
}

// Yahoo 임의 심볼 가격 history (^KS11, ^KQ11 등 인덱스 포함)
export async function fetchYahooPriceHistory(
  symbol: string, range = "1y",
): Promise<PricePoint[]> {
  return await fetchPriceHistoryFor(symbol, range);
}

// 한국 종목 가격 + 배당 + 액면분할 이벤트 통합 fetch
export async function fetchKrPriceHistoryWithEvents(
  ticker: string, range = "1y",
): Promise<{ prices: PricePoint[]; dividends: DividendEvent[]; splits: SplitEvent[] }> {
  const empty = { prices: [] as PricePoint[], dividends: [] as DividendEvent[], splits: [] as SplitEvent[] };
  if (!/^[\dA-Za-z]{6}$/.test(ticker)) return empty;
  const ks = await fetchPriceHistoryWithEventsFor(`${ticker}.KS`, range);
  if (ks.prices.length > 0) return ks;
  return await fetchPriceHistoryWithEventsFor(`${ticker}.KQ`, range);
}

// 공시 fetch — Naver 모바일 API (인증 불필요, m.stock.naver.com 이미 워커 화이트리스트)
//   페이지당 20건 고정 (size 파라미터 무시) → 1년치 보통 3-5페이지 병렬 fetch.
//   노이즈 필터 — 시세 모니터링·5% 보고·신탁의결권·정정 등 차트에 의미 없는 공시 제거.
const DISCLOSURE_NOISE_PATTERNS = [
  "가격제한폭",            // 자동 시세 모니터링
  "주식선물",              // 선물·옵션 거래 모니터링
  "주식옵션",
  "신탁업자",              // 신탁 의결권 행사
  "임원ㆍ주요주주",        // 5% 보고서 (대부분 미세 변동)
  "임원·주요주주",
  "임원 · 주요주주",
  "주식등의대량보유",      // 대량보유상황보고서 (마찬가지)
  "주식 등의 대량보유",
  "특정증권등소유상황",    // 특정증권 소유 보고
  "(정정)",                // 정정공시 — 원본만 표시
  "(첨부정정)",
  "(기재정정)",
];

// 공매도 fetch — 토스 wts-info-api (인증 불필요, 워커 화이트리스트 이미 등록)
//   max size 100 / 페이지당 → 1년치 위해 4페이지 순차 fetch
export async function fetchKrShortSelling(
  ticker: string, months = 12,
): Promise<ShortSellingPoint[]> {
  if (!/^\d{6}$/.test(ticker)) return [];

  const since = new Date();
  since.setMonth(since.getMonth() - months);

  const out: ShortSellingPoint[] = [];
  let key: string | null = null;

  for (let i = 0; i < 4; i++) {
    let url = `https://wts-info-api.tossinvest.com/api/v1/mds/info/short-selling-trend?stockCode=A${ticker}&size=100`;
    if (key) url += `&key=${encodeURIComponent(key)}`;
    let resp: Response;
    try { resp = await fetchProxied(url); }
    catch { break; }
    if (!resp.ok) break;
    const data = await resp.json() as {
      result?: {
        body?: Array<{
          baseDate?: string;
          shortSellingAveragePrice?: number;
          shortSellingAveragePriceLong?: number;
          shortTradingVolume?: number;
          shortSellingRatio?: number;
          shortSellingTradingAmountRatio?: number;
        }>;
        pagingParam?: { key?: string | null };
      };
    };
    const body = data.result?.body;
    if (!Array.isArray(body) || body.length === 0) break;

    let stop = false;
    for (const r of body) {
      if (!r.baseDate) continue;
      if (new Date(r.baseDate) < since) { stop = true; continue; }
      out.push({
        date: r.baseDate,
        avgPrice: r.shortSellingAveragePriceLong ?? Math.round(r.shortSellingAveragePrice ?? 0),
        shortVolume: r.shortTradingVolume ?? 0,
        ratio: r.shortSellingRatio ?? 0,
        amountRatio: r.shortSellingTradingAmountRatio ?? 0,
      });
    }
    if (stop) break;
    key = data.result?.pagingParam?.key ?? null;
    if (!key) break;
  }

  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

// ─── 컨센서스 예상치 시계열 (토스 v2 financial/estimate) ─────────────
// 분기별 발표치 vs 애널리스트 예상치 + 서프라이즈율. POST {} 호출 — 워커 POST 통과 필요.
export type EstimateMetric = "revenue" | "operating-income" | "eps";

export interface EstimatePoint {
  period: string;            // "2025-12" 형식
  actual: number | null;     // 발표치 (미래 분기는 null)
  estimate: number | null;   // 애널리스트 예상치
  surprise: number | null;   // 서프라이즈율 (%)
}

export interface EstimateSeries {
  metric: EstimateMetric;
  points: EstimatePoint[];
  /** 다음 분기 예상치의 직전 분기 발표치 대비 변동률 (%) */
  fluctuationRate: number | null;
  /** 다음 분기 예상치 위치 — "HIGH" | "MID" | "LOW" 등 토스 분류 */
  position: string | null;
}

// metric → 응답 key 매핑
const ESTIMATE_KEY: Record<EstimateMetric, { actual: string; est: string }> = {
  "revenue":          { actual: "revenue",         est: "revenueEst" },
  "operating-income": { actual: "operatingIncome", est: "operatingIncomeEst" },
  "eps":              { actual: "eps",             est: "epsEst" },
};

export async function fetchTossEstimate(
  ticker: string, metric: EstimateMetric,
): Promise<EstimateSeries | null> {
  if (!/^\d{6}$/.test(ticker)) return null;
  const target = `https://wts-info-api.tossinvest.com/api/v2/companies/A${ticker}/financial/estimate/${metric}`;
  let resp: Response;
  try {
    resp = await fetchProxied(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  } catch { return null; }
  if (!resp.ok) return null;
  const data = await resp.json() as {
    result?: {
      fluctuationRate?: number;
      position?: string;
      graphs?: Array<Record<string, unknown>>;
    };
  };
  const r = data.result;
  if (!r || !Array.isArray(r.graphs)) return null;
  const { actual, est } = ESTIMATE_KEY[metric];
  const points: EstimatePoint[] = r.graphs.map(g => ({
    period: String(g.period ?? ""),
    actual: typeof g[actual] === "number" ? (g[actual] as number) : null,
    estimate: typeof g[est] === "number" ? (g[est] as number) : null,
    surprise: typeof g.surprise === "number" ? (g.surprise as number) : null,
  })).filter(p => p.period);
  return {
    metric,
    points,
    fluctuationRate: typeof r.fluctuationRate === "number" ? r.fluctuationRate : null,
    position: typeof r.position === "string" ? r.position : null,
  };
}

// 시장 매매동향 fetch — 토스 indices net-buying daily API (인증 X)
//   KOSPI: KGG01P  / KOSDAQ: QGG01P
//   API 동작: from 은 "응답의 최신 날짜" (해당 일자부터 과거로 count 일치 반환)
//   count max 100 → desiredDays > 100 면 nextDate 로 페이지네이션
//   응답 단위: 원 (UI 에서 /1억 변환)
export async function fetchKrMarketFlow(
  indexKey: MarketIndexKey,
  desiredDays = 250,
): Promise<MarketFlowPoint[]> {
  const code = MARKET_INDEX_CODES[indexKey];
  const out: MarketFlowPoint[] = [];
  // 시작 from = 오늘 (KST) — 응답이 오늘부터 과거 100일치
  let nextFrom: string | null = new Date(Date.now() + 9 * 3600_000)
    .toISOString().slice(0, 10);
  const seen = new Set<string>();
  // 100일 페이지 × 최대 4회 → 400거래일 (~1.5년) 안전 상한
  for (let i = 0; i < 4 && out.length < desiredDays && nextFrom; i++) {
    const url = `https://wts-info-api.tossinvest.com/api/v1/stock-infos/index/net-buying/daily`
              + `?code=${code}&count=100&from=${nextFrom}`;
    let resp: Response;
    try { resp = await fetchProxied(url); }
    catch { break; }
    if (!resp.ok) break;
    const data = await resp.json() as {
      result?: {
        nextDate?: string | null;
        investorActivityAmounts?: Array<{
          dt: string;
          individualsNetBuying?: number;
          foreignersNetBuying?: number;
          institutionsNetBuying?: number;
          financialInvestmentNetBuying?: number;
          pensionFundNetBuying?: number;
          trustNetBuying?: number;
          privateEquityFundNetBuying?: number;
          insuranceNetBuying?: number;
          bankNetBuying?: number;
          otherFinancialNetBuying?: number;
        }>;
      };
    };
    const items = data.result?.investorActivityAmounts ?? [];
    if (items.length === 0) break;
    for (const r of items) {
      if (seen.has(r.dt)) continue;
      seen.add(r.dt);
      out.push({
        date: r.dt,
        individuals:         r.individualsNetBuying ?? 0,
        foreigners:          r.foreignersNetBuying ?? 0,
        institutions:        r.institutionsNetBuying ?? 0,
        financialInvestment: r.financialInvestmentNetBuying ?? 0,
        pensionFund:         r.pensionFundNetBuying ?? 0,
        trust:               r.trustNetBuying ?? 0,
        privateEquity:       r.privateEquityFundNetBuying ?? 0,
        insurance:           r.insuranceNetBuying ?? 0,
        bank:                r.bankNetBuying ?? 0,
        otherFinancial:      r.otherFinancialNetBuying ?? 0,
      });
    }
    nextFrom = data.result?.nextDate ?? null;
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export async function fetchKrDisclosures(
  ticker: string, months = 12,
): Promise<DartDisclosure[]> {
  if (!/^\d{6}$/.test(ticker)) return [];

  const since = new Date();
  since.setMonth(since.getMonth() - months);

  const requests = [1, 2, 3, 4, 5].map(page =>
    fetchProxied(`https://m.stock.naver.com/api/stock/${ticker}/disclosure?page=${page}&size=100`)
      .then(r => r.ok ? r.json() : [])
      .catch(() => [])
  );
  const pages = await Promise.all(requests);

  const seen = new Set<number>();
  const out: DartDisclosure[] = [];
  for (const items of pages) {
    if (!Array.isArray(items)) continue;
    for (const it of items as Array<{ disclosureId: number; title: string; datetime: string }>) {
      if (!it || seen.has(it.disclosureId)) continue;
      seen.add(it.disclosureId);
      const dateOnly = (it.datetime || "").slice(0, 10);
      if (!dateOnly) continue;
      if (new Date(dateOnly) < since) continue;
      const title = it.title || "";
      if (DISCLOSURE_NOISE_PATTERNS.some(p => title.includes(p))) continue;
      // 회사명 접두 제거 — 두 패턴 다 처리:
      //   "삼성전자(주) 현금배당 결정"        → "현금배당 결정"
      //   "(주)에이치제이중공업 유상증자 결정" → "유상증자 결정"
      const cleaned = title
        .replace(/^[^()\s]+\(주\)\s*/, "")
        .replace(/^\(주\)[^\s]+\s*/, "")
        .trim() || title;
      out.push({
        date: dateOnly,
        title: cleaned,
        url: `https://m.stock.naver.com/domestic/stock/${ticker}/notice/${it.disclosureId}`,
        reportNm: title,
      });
    }
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

// 8시 KST 이전 + body[0] 전부 0 → body[1] 폴백 (데스크톱 v2 동일)
// 비거래일 (마지막 데이터의 KST 날짜 ≠ 오늘) → flow 값들을 0 으로 (외국인비율은 유지).
//   가격 "어제대비 0" 과 일관 처리 — 주말/공휴일에 마지막 거래일 수급이
//   "오늘 수급" 처럼 잘못 보이는 문제 해결.
export function pickTodayInvestor(history: Investor[]): Investor | null {
  if (history.length === 0) return null;
  let item = history[0];
  if (nowKstHour() < 8 && history.length >= 2) {
    const isAllZero =
      item.개인 === 0 && item.외국인 === 0 && item.기관 === 0;
    if (isAllZero) item = history[1];
  }
  // 비거래일 보정 — 데이터 날짜가 오늘과 다르면 flow 0
  if (item.date) {
    const todayKst = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    if (item.date !== todayKst) {
      return {
        ...item,
        개인: 0, 외국인: 0, 기관: 0, 연기금: 0,
        금융투자: 0, 투신: 0, 사모: 0, 보험: 0,
        은행: 0, 기타금융: 0, 기타법인: 0,
        // 외국인비율 유지
      };
    }
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
  prev: number;            // "어제대비" 표시용 (비거래일엔 price 와 동일 = 0)
  prevClose: number;       // 직전 거래일 종가 — 색상용 (비거래일 보정 영향 없음)
  diff: number;
  pct: number;
  currency?: string;
  tradeDate: string;       // KST 날짜 (YYYY-MM-DD) — 마지막 거래 시각 기준
  marketState: string;     // REGULAR / PRE / POST / CLOSED / PREPRE / POSTPOST
  // 시간외 (after-hours) — POST 마켓 상태가 아닌 때도 직전 시간외 가격 보존
  postPrice?: number;
  postPct?: number;        // 정규 종가 대비 시간외 변동률 (%)
  // 정규장 종가 + 변동률 — marketState 무관하게 항상 유지
  regularPrice?: number;
  regularPct?: number;     // (regularPrice - prevClose) / prevClose × 100
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
  regularMarketChangePercent?: QuoteSummaryRaw;   // raw — Yahoo 페이지 표시값 (선물 등에선 prevClose 계산과 다를 수 있음)
  preMarketPrice?: QuoteSummaryRaw;
  postMarketPrice?: QuoteSummaryRaw;
  postMarketChangePercent?: QuoteSummaryRaw;
  regularMarketTime?: number;
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

    // tradeDate (KST)
    let tradeDate = "";
    if (typeof p.regularMarketTime === "number") {
      const kstMs = p.regularMarketTime * 1000 + 9 * 3600 * 1000;
      tradeDate = new Date(kstMs).toISOString().slice(0, 10);
    }

    // 색상용 prevClose 보존 — 비거래일 보정 전 원래 값
    const prevClose = prev;

    // 시간외 (after-hours) 가격 — 정규 종가(regP) 대비 변동률 계산
    let postPrice: number | undefined;
    let postPct: number | undefined;
    if (_isValid(postP) && _isValid(regP) && regP > 0 && postP !== regP) {
      postPrice = postP;
      postPct = ((postP - regP) / regP) * 100;
    }

    // 비거래일 보정 — KR(.KS/.KQ/^KS*/^KQ*) 만 적용.
    // 한국 종목/지수는 장 마감 후 새 가격이 안 들어오면 그냥 % 0 으로 가리는 게 자연스러움.
    // 미국/글로벌/선물/원자재/환율 등은 선행지수 의미가 있어 마지막 정규장 종가 기준 % 그대로 유지.
    // (저유동성 미국 ETF 의 경우 정규장 중에도 tradeDate 가 어제로 잡힐 수 있어 KR 만 보정)
    const isKr = /\.K[SQ]$|^\^K[SQ]/.test(symbol);
    if (isKr && state === "CLOSED" && tradeDate) {
      const todayKst = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
      if (tradeDate !== todayKst) {
        prev = price;  // 비거래일 → 어제대비 0
      }
    }

    const diff = price - prev;
    const pct = prev > 0 ? (diff / prev) * 100 : 0;

    // 정규장 종가/변동률 — Yahoo regularMarketPrice + raw changePercent 우선 사용
    // (선물 등 일부 종목은 prevClose 계산과 changePercent 가 일치 안 함 → raw 사용)
    let regularPrice: number | undefined;
    let regularPct: number | undefined;
    if (_isValid(regP)) {
      regularPrice = regP;
      const rawPct = _val(p.regularMarketChangePercent);
      if (_isValid(rawPct)) {
        regularPct = rawPct * 100;  // Yahoo 는 fraction (0.005552 = 0.5552%)
      } else if (_isValid(regPrev) && regPrev > 0) {
        regularPct = ((regP - regPrev) / regPrev) * 100;
      }
    }

    return {
      symbol, name, price, prev, prevClose, diff, pct,
      currency: p.currency, tradeDate, marketState: state,
      postPrice, postPct, regularPrice, regularPct,
    };
  } catch {
    return null;
  }
}

// Yahoo chart v8 — 일봉 종가 시계열 (스파크라인용)
// 예: fetchYahooChart("^GSPC", "3mo") → [7100, 7110, 7150, ...]
interface ChartResp {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: (number | null)[] }> };
    }> | null;
  };
}
export async function fetchYahooChart(
  symbol: string,
  range = "3mo",
  interval = "1d",
): Promise<number[]> {
  const target = `https://query1.finance.yahoo.com/v8/finance/chart/`
              + `${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
  try {
    const resp = await fetchProxied(target);
    if (!resp.ok) return [];
    const data = await resp.json() as ChartResp;
    const closes = data.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    // null 제거 (장 정지일·휴장 등)
    return closes.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  } catch {
    return [];
  }
}

// Yahoo ^지수 → 토스 indices 코드 매핑 (있는 것만, 없으면 Yahoo fallback)
// KOSPI 200(^KS200) / KOSDAQ 100(^KQ100) 토스 코드 미확인이라 Yahoo 그대로.
const TOSS_INDEX_CODE: Record<string, string> = {
  "^KS11": "KGG01P",   // KOSPI 종합
  "^KQ11": "QGG01P",   // KOSDAQ 종합
  "^SOX":  "SOX.NAI",  // 필라델피아 반도체 지수
};

// 토스 indices price API → UsIndex 변환
async function fetchTossIndexPrice(
  yahooSymbol: string, name: string,
): Promise<UsIndex | null> {
  const code = TOSS_INDEX_CODE[yahooSymbol];
  if (!code) return null;
  const url = `https://wts-info-api.tossinvest.com/api/v1/index-prices/${code}`;
  try {
    const resp = await fetchProxied(url);
    if (!resp.ok) return null;
    const data = await resp.json() as {
      result?: {
        close?: number;
        base?: number;     // 어제 종가 (% 기준)
        // open/high/low/volume/value/changeType/high52w/low52w/tradeTime 등 있음
      };
    };
    const r = data.result;
    if (!r || typeof r.close !== "number" || typeof r.base !== "number") return null;
    const diff = r.close - r.base;
    const pct = r.base > 0 ? (diff / r.base) * 100 : 0;
    const todayKst = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    return {
      symbol: yahooSymbol, name,
      price: r.close, prev: r.base, prevClose: r.base,
      diff, pct, currency: "KRW",
      tradeDate: todayKst, marketState: "",
    };
  } catch {
    return null;
  }
}

// 다수 심볼 한꺼번에 — 병렬 fetch
// .KS 6자리 (KODEX 등 한국 ETF) → 토스 stock-prices
// ^KS11/^KQ11 (KOSPI/KOSDAQ 종합) → 토스 index-prices
// 그 외 (^KS200/^KQ100/미국 등) → Yahoo
// 토스 우선, 실패 시 Yahoo fallback (안정성).
export async function fetchYahooBatch(
  pairs: { symbol: string; name: string }[]
): Promise<Map<string, UsIndex>> {
  const ksRegex = /^(\d{6})\.KS$/;
  const ksItems = pairs.filter(p => ksRegex.test(p.symbol));
  const tossIdxItems = pairs.filter(p => TOSS_INDEX_CODE[p.symbol]);
  const otherItems = pairs.filter(p =>
    !ksRegex.test(p.symbol) && !TOSS_INDEX_CODE[p.symbol]
  );

  const [ksMap, idxResults, yahooResults] = await Promise.all([
    ksItems.length > 0
      ? fetchTossPrices(ksItems.map(p => ksRegex.exec(p.symbol)![1]))
          .then(prices => {
            const out = new Map<string, UsIndex>();
            const metaByCode = new Map(
              ksItems.map(p => [ksRegex.exec(p.symbol)![1], p])
            );
            for (const tp of prices) {
              const m = metaByCode.get(tp.ticker);
              if (!m) continue;
              const diff = tp.price - tp.base;
              const pct = tp.base > 0 ? (diff / tp.base) * 100 : 0;
              out.set(m.symbol, {
                symbol: m.symbol, name: m.name,
                price: tp.price, prev: tp.base, prevClose: tp.prevClose,
                diff, pct, currency: "KRW",
                tradeDate: tp.trade_date, marketState: "",
              });
            }
            return out;
          })
          .catch(() => new Map<string, UsIndex>())
      : Promise.resolve(new Map<string, UsIndex>()),
    Promise.all(tossIdxItems.map(p => fetchTossIndexPrice(p.symbol, p.name))),
    Promise.all(otherItems.map(p => fetchYahooQuote(p.symbol, p.name))),
  ]);

  const merged = new Map<string, UsIndex>(ksMap);
  for (const r of idxResults) {
    if (r) merged.set(r.symbol, r);
  }
  for (const r of yahooResults) {
    if (r) merged.set(r.symbol, r);
  }

  // 토스 index 가 한 번이라도 실패하면 Yahoo 로 fallback (안정성)
  const missingIdx = tossIdxItems.filter(p => !merged.has(p.symbol));
  if (missingIdx.length > 0) {
    const fallback = await Promise.all(
      missingIdx.map(p => fetchYahooQuote(p.symbol, p.name))
    );
    for (const r of fallback) {
      if (r) merged.set(r.symbol, r);
    }
  }

  return merged;
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

// 네이버 금융 HTML 파싱 — 섹터 + 컨센서스 + 기업개요
// 단일 페이지 fetch 후 모두 추출 (네트워크 1회)
export interface NaverInfo {
  sector: string;
  consensus: Consensus | null;
  description?: string[];   // #summary_info p 들 — 사업·제품·전략 짧은 문장 (출처: 에프앤가이드)
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

    // 기업개요 — #summary_info 안의 <p> 들 (출처: 에프앤가이드)
    let description: string[] | undefined;
    const summaryEl = doc.querySelector("#summary_info");
    if (summaryEl) {
      const ps = Array.from(summaryEl.querySelectorAll("p"))
        .map(p => (p.textContent ?? "").trim())
        .filter(t => t.length > 0);
      if (ps.length > 0) description = ps;
    }

    return { sector, consensus, description };
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
      if (!/^[\dA-Za-z]{6}$/.test(code)) continue;
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
  if (!/^[\dA-Za-z]{6}$/.test(ticker)) return null;
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

