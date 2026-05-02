// 포트폴리오 데이터 import — JSON 패턴 자동 감지.
// SettingsDialog (데스크톱) + MobileSimpleView (모바일) 공통 사용.

import type { Stock } from "../types";

export type Detected =
  | { kind: "holdings"; stocks: Stock[] }
  | { kind: "peaks"; peaks: Record<string, number> }
  | { kind: "combined"; stocks: Stock[]; peaks: Record<string, number> }
  | { kind: "error"; error: string }
  | null;

export function detectPortfolioJson(raw: string): Detected {
  if (!raw.trim()) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch (e) {
    return { kind: "error", error: e instanceof Error ? e.message : "JSON 파싱 실패" };
  }
  if (!parsed || typeof parsed !== "object")
    return { kind: "error", error: "JSON 객체가 아님" };
  const obj = parsed as Record<string, unknown>;
  // 패턴 1: holdings (+ optional peaks)
  if (Array.isArray(obj.holdings)) {
    const stocks = parseHoldingsArray(obj.holdings);
    if (typeof stocks === "string") return { kind: "error", error: stocks };
    if (obj.peaks && typeof obj.peaks === "object" && !Array.isArray(obj.peaks)) {
      return { kind: "combined", stocks, peaks: obj.peaks as Record<string, number> };
    }
    return { kind: "holdings", stocks };
  }
  // 패턴 2: peaks 단독 (모든 키 6자리, 값 number)
  const entries = Object.entries(obj);
  if (entries.length > 0 && entries.every(([k, v]) =>
        /^[\dA-Za-z]{6}$/.test(k) && typeof v === "number" && v > 0)) {
    return { kind: "peaks", peaks: obj as Record<string, number> };
  }
  return { kind: "error", error: "알 수 없는 JSON — holdings.json / peaks.json / combined" };
}

function parseHoldingsArray(arr: unknown[]): Stock[] | string {
  const stocks: Stock[] = [];
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    if (!item || typeof item !== "object") return `${i}번 항목이 객체가 아님`;
    const s = item as Record<string, unknown>;
    if (typeof s.ticker !== "string" || s.ticker.length === 0)
      return `${i}번 항목 ticker 누락`;
    stocks.push({
      ticker: s.ticker,
      name: typeof s.name === "string" ? s.name : s.ticker,
      shares: typeof s.shares === "number" ? s.shares : 0,
      avg_price: typeof s.avg_price === "number" ? s.avg_price : 0,
      invested: typeof s.invested === "number" ? s.invested : undefined,
      buy_date: typeof s.buy_date === "string" ? s.buy_date : undefined,
      market: typeof s.market === "string" ? s.market : undefined,
      account: typeof s.account === "string" ? s.account : "",
    });
  }
  return stocks;
}
