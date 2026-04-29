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
    const resp = await fetch(viaProxy(target));
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
    const resp = await fetch(viaProxy(url));
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
    const resp = await fetch(viaProxy(
      `https://finance.naver.com/item/main.naver?code=${ticker}`));
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

