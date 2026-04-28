import type { Price, Investor, Consensus } from "../types";

const PROXY_URL =
  import.meta.env.VITE_PROXY_URL || "http://localhost:8787";

function viaProxy(targetUrl: string): string {
  return `${PROXY_URL}/?url=${encodeURIComponent(targetUrl)}`;
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
  volume: number;
  tradeDateTime: string;
}
interface TossPriceResponse { result: TossPriceItem[]; }

export async function fetchTossPrices(tickers: string[]): Promise<Price[]> {
  if (tickers.length === 0) return [];
  const codes = tickers.map(t => `A${t}`).join(",");
  const target = `https://wts-info-api.tossinvest.com/api/v3/stock-prices/details?productCodes=${codes}`;
  const resp = await fetch(viaProxy(target));
  if (!resp.ok) throw new Error(`Toss price fetch failed: ${resp.status}`);
  const data = await resp.json() as TossPriceResponse;
  return (data.result || []).map(item => ({
    ticker: item.code.replace(/^A/, ""),
    price: item.close,
    base: item.base,
    open: item.open,
    volume: item.volume,
    trade_date: item.tradeDateTime ? toKstDateString(item.tradeDateTime) : "",
    trade_dt: item.tradeDateTime,
  }));
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

const NET_KEYS: (keyof TossInvestorItem)[] = [
  "netIndividualsBuyVolume", "netForeignerBuyVolume",
  "netInstitutionBuyVolume", "netPensionFundBuyVolume",
  "netFinancialInvestmentBuyVolume", "netTrustBuyVolume",
  "netPrivateEquityFundBuyVolume", "netInsuranceBuyVolume",
  "netBankBuyVolume", "netOtherFinancialInstitutionsBuyVolume",
  "netOtherCorporationBuyVolume",
];

function nowKstHour(): number {
  const n = new Date();
  return new Date(n.getTime() + (9 * 60 + n.getTimezoneOffset()) * 60_000).getHours();
}

function allZero(item: TossInvestorItem): boolean {
  return NET_KEYS.every(k => Number(item[k] ?? 0) === 0);
}

export async function fetchInvestor(ticker: string): Promise<Investor | null> {
  const target =
    `https://wts-info-api.tossinvest.com/api/v1/stock-infos/trade/trend/trading-trend` +
    `?productCode=A${ticker}&size=60`;
  const resp = await fetch(viaProxy(target));
  if (!resp.ok) return null;
  const data = await resp.json() as TossInvestorResponse;
  const body = data.result?.body || [];
  if (body.length === 0) return null;
  // 8시 KST 이전 + body[0] 전부 0 → body[1] 폴백 (데스크톱 v2 동일)
  let item = body[0];
  if (nowKstHour() < 8 && allZero(item) && body.length >= 2) {
    item = body[1];
  }
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

// 토스 wts-badges — 위험/관리/정지/경고/과열/환기/주의 (2글자 축약)
// 우선순위: 위험 > 관리 > 정지 > 경고 > 과열 > 환기 > 주의
interface TossBadgeItem { title: string; }
interface TossBadgeResponse { result: TossBadgeItem[]; }

const WARNING_MAP: [string, string][] = [
  ["투자위험", "위험"],
  ["관리종목", "관리"],
  ["거래정지", "정지"],
  ["투자경고", "경고"],
  ["단기과열", "과열"],
  ["투자주의환기", "환기"],
  ["투자주의", "주의"],
];

export async function fetchWarning(ticker: string): Promise<string> {
  const target = `https://wts-info-api.tossinvest.com/api/v1/stock-infos/A${ticker}/wts-badges`;
  try {
    const resp = await fetch(viaProxy(target));
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
}

interface YahooChartMeta {
  regularMarketPrice?: number;
  previousClose?: number;
  chartPreviousClose?: number;
  currency?: string;
}
interface YahooChartResponse {
  chart: { result: { meta: YahooChartMeta }[] | null };
}

export async function fetchYahooQuote(symbol: string, name: string): Promise<UsIndex | null> {
  const target = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`;
  try {
    const resp = await fetch(viaProxy(target));
    if (!resp.ok) return null;
    const data = await resp.json() as YahooChartResponse;
    const meta = data.chart?.result?.[0]?.meta;
    if (!meta || meta.regularMarketPrice === undefined) return null;
    const price = meta.regularMarketPrice;
    const prev = meta.previousClose ?? meta.chartPreviousClose ?? price;
    const diff = price - prev;
    const pct = prev > 0 ? (diff / prev) * 100 : 0;
    return {
      symbol, name, price, prev, diff, pct,
      currency: meta.currency,
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
    const resp = await fetch(viaProxy(target));
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
        const text = td.textContent || "";
        // 가격: "293,200" 같은 숫자 (콤마 제거)
        const m = text.match(/([\d,]+)\s*원?/);
        const target = m ? Number(m[1].replace(/,/g, "")) : undefined;
        // 투자의견 점수: <em>4.00</em>
        const em = td.querySelector("em");
        const score = em?.textContent ? Number(em.textContent.trim()) : undefined;
        // 투자의견 텍스트 (span.f_up / .f_down 안)
        const span = td.querySelector("span[class^='f_']");
        const opinion = span?.textContent?.replace(String(score ?? ""), "").trim();
        consensus = {
          target: target && target > 0 ? target : undefined,
          score: !Number.isNaN(score!) ? score : undefined,
          opinion,
        };
      }
    }
    return { sector, consensus };
  } catch {
    return empty;
  }
}
