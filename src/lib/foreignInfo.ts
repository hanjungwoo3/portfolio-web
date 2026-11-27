// 🌎 해외 종목정보 — 미국·일본 종목도 국내처럼 한 창에서(사용자 2026-11-27 "미국/일본 종목들도 종목정보 창 만들 수 있지 않아?").
//   여는 쪽은 openForeignStockInfo(심볼, 이름) 하나 — 창은 App·Mobile 최상위의 ForeignStockInfoHost 가 연다(타일 팝업과 같은 방식).
//   자료(2026-11-27 실측):
//     토스 — 미국만. code-or-symbol(심볼→코드), overview(시총·기업가치·업종·분류·상장일), compositions(사업부 매출 비중), estimate(실적·추정, 원화 환산)
//     TradingView scanner — 미국·일본. PER·PBR·EPS·이익률·수익률·목표가 등. price_conversion.to_symbol=false 라야 일본이 엔화로 온다(빼면 달러)
//     야후 — 일봉(미국·일본 공통)
import { fetchProxied } from "./api";
import { openStockInfo, canStockInfo } from "./tickPopup";

export const OPEN_FOREIGN_INFO = "open-foreign-info";
export interface ForeignInfoReq { sym: string; name: string; toss?: string }

/** 해외 종목정보 열기 — sym = 미국 티커(MU) 또는 야후 일본 심볼(8035.T). 토스 코드를 알면 같이 */
export function openForeignStockInfo(sym: string, name: string, toss?: string): void {
  window.dispatchEvent(new CustomEvent<ForeignInfoReq>(OPEN_FOREIGN_INFO, { detail: { sym, name, toss } }));
}
/** 이 창으로 열 수 있는 심볼인가 — 미국 티커(대문자) · 일본(숫자4.T) */
export const isUsSym = (s: string) => /^[A-Z][A-Z.]{0,6}$/.test(s);
export const isJpSym = (s: string) => /^\d{4}[A-Z]?\.T$/.test(s);
export const canForeignInfo = (s: string) => isUsSym(s) || isJpSym(s);
/** 📊종목정보 — 국내 = 종목정보 창, 미국·일본 = 해외 종목정보 창. 카드·타일·히트맵이 같이 쓴다 */
export const canAnyStockInfo = (code: string) => canStockInfo(code) || canForeignInfo(code);
export function openAnyStockInfo(code: string, name: string): void {
  if (canStockInfo(code)) openStockInfo(code, name); else openForeignStockInfo(code, name);
}

const TOSS = "https://wts-info-api.tossinvest.com/api/v2/stock-infos";

export interface TossOverview {
  companyCode?: string; market?: string; industry?: string; tics: string[]; listDate?: string; englishName?: string;
  capUsd?: number; capKrw?: number; evUsd?: number; evKrw?: number; source?: string;
}
export async function fetchTossForeignOverview(code: string): Promise<TossOverview> {
  const r = await fetchProxied(`${TOSS}/${code}/overview`);
  if (!r.ok) throw new Error(`토스 개요 HTTP ${r.status}`);
  const j = await r.json() as { result?: {
    market?: { displayName?: string }; listDate?: string; dataSource?: string;
    marketValue?: number; marketValueKrw?: number; enterpriseValue?: number; enterpriseValueKrw?: number;
    company?: { code?: string; englishName?: string; industry?: { displayName?: string }; tics?: { title?: string; depth?: number }[] };
  } };
  const x = j.result;
  if (!x) throw new Error("토스 개요 없음");
  return {
    companyCode: x.company?.code, market: x.market?.displayName, listDate: x.listDate, source: x.dataSource, englishName: x.company?.englishName,
    industry: x.company?.industry?.displayName,
    tics: (x.company?.tics ?? []).flatMap(t => (t.title ? [t.title] : [])),
    capUsd: x.marketValue, capKrw: x.marketValueKrw, evUsd: x.enterpriseValue, evKrw: x.enterpriseValueKrw,
  };
}

export interface Segment { name: string; ratio: number }
export async function fetchTossSegments(code: string): Promise<{ items: Segment[]; endDate?: string }> {
  const r = await fetchProxied(`${TOSS}/${code}/compositions`);
  if (!r.ok) return { items: [] };
  const j = await r.json() as { result?: { endDate?: string; items?: { name?: string; ratio?: number }[] } };
  return {
    endDate: j.result?.endDate,
    items: (j.result?.items ?? []).flatMap(i => (i.name && typeof i.ratio === "number" ? [{ name: i.name, ratio: i.ratio }] : [])),
  };
}

// TradingView 지표 — 열 이름은 scanner 그대로
const TV_COLS = [
  "close", "change", "currency", "description", "logoid", "sector", "industry", "number_of_employees",
  "market_cap_basic", "price_earnings_ttm", "price_earnings_forward_fy", "price_book_fq", "earnings_per_share_diluted_ttm",
  "dividends_yield_current", "return_on_equity_fq", "gross_margin_ttm", "operating_margin_ttm", "net_margin_ttm",
  "total_revenue_ttm", "free_cash_flow_ttm", "total_debt_fq", "beta_1_year", "float_shares_percent_current",
  "Perf.W", "Perf.1M", "Perf.3M", "Perf.YTD", "Perf.Y", "price_52_week_high", "price_52_week_low",
  "recommendation_mark", "price_target_average", "price_target_high", "price_target_low", "earnings_release_next_date",
  "RSI", "SMA20", "SMA200",
] as const;
export type TvCol = (typeof TV_COLS)[number];
export type TvRow = Partial<Record<TvCol, number | string | null>> & { tvSym: string };

export async function fetchTvFundamentals(sym: string): Promise<TvRow | null> {
  const tickers = isJpSym(sym) ? [`TSE:${sym.replace(/\.T$/, "")}`] : [`NASDAQ:${sym}`, `NYSE:${sym}`, `AMEX:${sym}`, `NYSE:${sym.replace(".", "/")}`];
  const r = await fetchProxied("https://scanner.tradingview.com/global/scan", {
    method: "POST", headers: { "Content-Type": "application/json" },
    // to_symbol:false = 그 종목 통화(일본 = 엔). 빼면 일본 목표가·EPS 가 달러로 와서 주가(엔)와 안 맞는다(실측 8035: 96 vs 15,347)
    body: JSON.stringify({ symbols: { tickers }, columns: TV_COLS, price_conversion: { to_symbol: false } }),
  });
  const j = await r.json() as { error?: string; data?: { s: string; d: (number | string | null)[] }[] };
  if (typeof j.error === "string") throw new Error(j.error);
  const row = j.data?.[0];
  if (!row) return null;
  const out: TvRow = { tvSym: row.s };
  TV_COLS.forEach((c, i) => { out[c] = row.d[i] ?? null; });
  return out;
}

// ── 토스 컨센서스(목표가·투자의견 분포) — 토스 웹이 부르는 주소(2026-11-27 토스 화면 코드에서 찾음)
export interface TossConsensus {
  target?: { mean: number; median?: number; high: number; low: number; count?: number; date?: string; currency: string };
  opinion?: { strongBuy: number; buy: number; hold: number; sell: number; strongSell: number; count: number; date?: string };
  past: { date: string; price: number }[];   // 월말 종가(목표가와 견줘 보기)
}
export async function fetchTossConsensus(code: string): Promise<TossConsensus | null> {
  const r = await fetchProxied(`https://wts-info-api.tossinvest.com/api/v1/stock-infos/consensus/${code}`);
  if (!r.ok) return null;
  const j = await r.json() as { result?: {
    targetPrice?: { mean?: number; median?: number; high?: number; low?: number; announcementCount?: number; announcementDate?: string; currency?: string } | null;
    investOpinion?: { strongBuy?: number; buy?: number; hold?: number; sell?: number; strongSell?: number; announcementCount?: number; announcementDate?: string } | null;
    pastClosePrices?: { date?: string; price?: number }[];
  } };
  const x = j.result; if (!x) return null;
  const t = x.targetPrice, o = x.investOpinion;
  return {
    target: t?.mean ? { mean: t.mean, median: t.median, high: t.high ?? t.mean, low: t.low ?? t.mean, count: t.announcementCount, date: t.announcementDate, currency: t.currency ?? "USD" } : undefined,
    opinion: o ? { strongBuy: o.strongBuy ?? 0, buy: o.buy ?? 0, hold: o.hold ?? 0, sell: o.sell ?? 0, strongSell: o.strongSell ?? 0, count: o.announcementCount ?? 0, date: o.announcementDate } : undefined,
    past: (x.pastClosePrices ?? []).flatMap(p => (p.date && p.price ? [{ date: p.date, price: p.price }] : [])).reverse(),
  };
}

// ── 공시(SEC 8-K·10-Q·실적 발표) — 토스가 한국어 요약을 붙여 준다. companyCode = overview 의 company.code(NAS000…)
export interface Filing { id: string; title: string; summary: string; form: string; date: string }
export async function fetchTossFilings(companyCode: string): Promise<Filing[]> {
  const r = await fetchProxied(`https://wts-info-api.tossinvest.com/api/v1/stock-detail/companies/${companyCode}/filings?size=20`);
  if (!r.ok) return [];
  const j = await r.json() as { result?: { body?: { id?: string; title?: string; summary?: string; form?: string; createdAt?: string }[] } };
  return (j.result?.body ?? []).flatMap(f => (f.id && f.title ? [{ id: f.id, title: f.title, summary: f.summary ?? "", form: f.form ?? "", date: (f.createdAt ?? "").slice(0, 10) }] : []));
}

// ── 종목 뉴스 — 토스(벤징가 등 한국어 번역). companyCode 로 불러야 나온다(토스 코드로는 0건)
export interface News { id: string; title: string; text: string; source: string; at: string }
export async function fetchTossCompanyNews(companyCode: string): Promise<News[]> {
  const r = await fetchProxied(`https://wts-info-api.tossinvest.com/api/v2/news/companies/${companyCode}?size=20`);
  if (!r.ok) return [];
  const j = await r.json() as { result?: { body?: { id?: string; title?: string; contentText?: string; source?: { name?: string }; createdAt?: string }[] } };
  return (j.result?.body ?? []).flatMap(n => (n.id && n.title ? [{ id: n.id, title: n.title, text: n.contentText ?? "", source: n.source?.name ?? "", at: n.createdAt ?? "" }] : []));
}

/** 네이버 해외 종목 코드(로이터) — 일본은 그대로(8035.T), 미국은 거래소 꼬리(나스닥 .O · 뉴욕 .N · 아멕스 .A). 거래소는 TradingView 심볼에서 */
export function naverWorldCode(sym: string, tvSym?: string): string | null {
  if (isJpSym(sym)) return sym;
  const ex = tvSym?.split(":")[0];
  const sfx = ex === "NASDAQ" ? "O" : ex === "NYSE" ? "N" : ex === "AMEX" ? "A" : null;
  return sfx ? `${sym}.${sfx}` : null;
}

// ── 토스 투자지표(가치평가·수익·배당) — 토스 종목 화면 '투자지표' 칸과 같은 값(2026-11-28 토스 화면 코드에서 찾음)
export interface TossIndicators {
  per?: string; pbr?: string; psr?: string;          // "9.1배" 처럼 글자로 온다
  eps?: number; bps?: number; roe?: string; currency: string;
  divYield?: number; divAnnual?: number; divFreq?: string; divMonths?: number[]; exDate?: string;
}
export async function fetchTossIndicators(code: string): Promise<TossIndicators | null> {
  const r = await fetchProxied(`https://wts-info-api.tossinvest.com/api/v1/stock-detail/ui/wts/${code}/investment-indicators`);
  if (!r.ok) return null;
  const j = await r.json() as { result?: { indicatorSections?: { sectionName?: string; data?: Record<string, unknown> }[] } };
  const sec = (n: string) => j.result?.indicatorSections?.find(x => x.sectionName === n)?.data ?? {};
  const v = sec("가치평가"), e = sec("수익"), d = sec("배당");
  const str = (x: unknown) => (typeof x === "string" && x ? x : undefined), nm = (x: unknown) => (typeof x === "number" ? x : undefined);
  return {
    per: str(v.displayPer), pbr: str(v.displayPbr), psr: str(v.displayPsr),
    eps: nm(e.eps), bps: nm(e.bps), roe: str(e.roe), currency: str(d.currency) ?? "USD",
    divYield: nm(d.dividendYieldRatio), divAnnual: nm(d.annualCash), divFreq: str(d.dividendFrequency),
    divMonths: Array.isArray(d.months) ? (d.months as number[]) : undefined, exDate: str(d.exDate),
  };
}
// ── 토스 안정성 — 부채비율·유동비율·이자보상비율(%) + 업종 중간값
export interface TossStability { debt?: number; current?: number; interest?: number; median?: number; position?: string }
export async function fetchTossStability(code: string): Promise<TossStability | null> {
  const r = await fetchProxied(`https://wts-info-api.tossinvest.com/api/v2/stock-infos/stability/${code}`, { method: "POST" });
  if (!r.ok) return null;
  const j = await r.json() as { result?: { liabilityRatio?: number | null; currentRatio?: number | null; interestCoverageRatio?: number | null; median?: number | null; position?: string } };
  const x = j.result; if (!x) return null;
  return { debt: x.liabilityRatio ?? undefined, current: x.currentRatio ?? undefined, interest: x.interestCoverageRatio ?? undefined, median: x.median ?? undefined, position: x.position };
}
