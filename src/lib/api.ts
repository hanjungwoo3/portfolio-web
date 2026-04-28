import type { Price, Investor } from "../types";

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
