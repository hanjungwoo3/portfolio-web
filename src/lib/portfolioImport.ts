// 포트폴리오 데이터 import — JSON 패턴 자동 감지.
// SettingsDialog (데스크톱) + MobileSimpleView (모바일) 공통 사용.

import type { Stock, Memo } from "../types";

// 동기화 대상 설정 (exportAll.settings 와 동일 형태)
export interface ImportSettings {
  independentGroups?: boolean;
  deposits?: Record<string, number>;   // 그룹(account)별 예수금
}

export type Detected =
  | { kind: "holdings"; stocks: Stock[]; settings?: ImportSettings; memos?: Memo[] }
  | { kind: "peaks"; peaks: Record<string, number> }
  | { kind: "combined"; stocks: Stock[]; peaks: Record<string, number>; settings?: ImportSettings; memos?: Memo[] }
  | { kind: "error"; error: string }
  | null;

// obj.memos 추출 — 상세 검증은 replaceAllMemos 가 수행하므로 형태만 가볍게 확인.
// 배열이 아니면 undefined (불러오기 시 기존 메모 보존).
function parseMemos(obj: Record<string, unknown>): Memo[] | undefined {
  if (!Array.isArray(obj.memos)) return undefined;
  const out: Memo[] = [];
  for (const m of obj.memos) {
    if (m && typeof m === "object" && typeof (m as Memo).ticker === "string") {
      out.push(m as Memo);
    }
  }
  return out;
}

// obj.settings 에서 동기화 대상 설정만 안전하게 추출
function parseSettings(obj: Record<string, unknown>): ImportSettings | undefined {
  const s = obj.settings;
  if (!s || typeof s !== "object") return undefined;
  const src = s as Record<string, unknown>;
  const out: ImportSettings = {};
  if (typeof src.independentGroups === "boolean") out.independentGroups = src.independentGroups;
  if (src.deposits && typeof src.deposits === "object" && !Array.isArray(src.deposits)) {
    const dep: Record<string, number> = {};
    for (const [k, v] of Object.entries(src.deposits as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v) && v > 0) dep[k] = v;
    }
    out.deposits = dep;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

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
  // 패턴 1: holdings (+ optional peaks, settings)
  if (Array.isArray(obj.holdings)) {
    const stocks = parseHoldingsArray(obj.holdings);
    if (typeof stocks === "string") return { kind: "error", error: stocks };
    const settings = parseSettings(obj);
    const memos = parseMemos(obj);
    if (obj.peaks && typeof obj.peaks === "object" && !Array.isArray(obj.peaks)) {
      return { kind: "combined", stocks, peaks: obj.peaks as Record<string, number>, settings, memos };
    }
    return { kind: "holdings", stocks, settings, memos };
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
