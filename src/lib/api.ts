import type { Price } from "../types";

// Cloudflare Worker URL — env 로 오버라이드 가능
// 개발 시: http://localhost:8787
// 배포 시: https://portfolio-proxy.<sub>.workers.dev
const PROXY_URL =
  import.meta.env.VITE_PROXY_URL || "http://localhost:8787";

function viaProxy(targetUrl: string): string {
  return `${PROXY_URL}/?url=${encodeURIComponent(targetUrl)}`;
}

// KST 고정 오프셋 — Android tzdata 의존성 회피와 동일한 패턴 (모바일 v1.0.2 교훈)
function toKstDateString(iso: string): string {
  const dtUtc = new Date(iso);
  const kstMs = dtUtc.getTime() + 9 * 60 * 60 * 1000;
  const kst = new Date(kstMs);
  return kst.toISOString().slice(0, 10);  // YYYY-MM-DD
}

interface TossPriceItem {
  code: string;
  close: number;
  base: number;
  open: number;
  volume: number;
  tradeDateTime: string;
}

interface TossPriceResponse {
  result: TossPriceItem[];
}

export async function fetchTossPrices(tickers: string[]): Promise<Price[]> {
  if (tickers.length === 0) return [];
  const codes = tickers.map(t => `A${t}`).join(",");
  const target = `https://wts-info-api.tossinvest.com/api/v3/stock-prices/details?productCodes=${codes}`;
  const resp = await fetch(viaProxy(target));
  if (!resp.ok) throw new Error(`Toss fetch failed: ${resp.status}`);
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
