// 보유/관심 종목 정렬 — 7가지 옵션 + asc/desc 토글
// sleeping (장마감/거래 정지) 종목은 정렬 키에 관계없이 항상 맨 아래.

import type { Stock, Price } from "../types";
import { isHoldingSleeping } from "./format";

export type SortKey =
  | "dayChange"   // 금일 변동% (기본)
  | "volume"      // 거래량
  | "input"       // 입력 순서
  | "name"        // 이름 가나다
  | "investment"  // 투자금액
  | "sector"      // 섹터
  | "pnl"         // 수익률
  | "buyDate";    // 매수일

export type SortDirection = "asc" | "desc";

export const SORT_LABELS: Record<SortKey, string> = {
  dayChange:  "금일 변동",
  volume:     "거래량",
  input:      "입력 순서",
  name:       "이름 (가나다)",
  investment: "투자금액",
  sector:     "섹터",
  pnl:        "수익률",
  buyDate:    "매수일",
};

// 키별 적응형 방향 라벨 — 의미가 자연 언어로 직관적
export const DIRECTION_LABELS: Record<SortKey, { asc: string; desc: string }> = {
  dayChange:  { asc: "작은값부터", desc: "큰값부터" },
  volume:     { asc: "적은순",     desc: "많은순" },
  input:      { asc: "처음부터",   desc: "나중부터" },
  name:       { asc: "ㄱ → ㅎ",   desc: "ㅎ → ㄱ" },
  investment: { asc: "작은값부터", desc: "큰값부터" },
  sector:     { asc: "ㄱ → ㅎ",   desc: "ㅎ → ㄱ" },
  pnl:        { asc: "작은값부터", desc: "큰값부터" },
  buyDate:    { asc: "오래된순",   desc: "최신순" },
};

// 각 옵션의 자연스러운 default 방향
export const DEFAULT_DIR: Record<SortKey, SortDirection> = {
  dayChange:  "desc",  // 큰 % 가 위
  volume:     "desc",  // 많이 거래된 순
  input:      "asc",   // 입력순 (위에서 아래)
  name:       "asc",   // ㄱ → ㅎ
  investment: "desc",  // 큰 금액 위
  sector:     "asc",   // 알파벳/가나다
  pnl:        "desc",  // 큰 수익 위
  buyDate:    "asc",   // 오래된 순 (사용자 요청)
};

// localStorage 키
const KEY_SORT = "portfolio_sort_key";
const KEY_DIR = "portfolio_sort_dir";

export function loadSortKey(): SortKey {
  try {
    const v = localStorage.getItem(KEY_SORT) as SortKey | null;
    if (v && v in SORT_LABELS) return v;
  } catch { /* noop */ }
  return "dayChange";
}

export function loadSortDir(): SortDirection {
  try {
    const v = localStorage.getItem(KEY_DIR);
    if (v === "asc" || v === "desc") return v;
  } catch { /* noop */ }
  return "desc";
}

export function saveSortKey(k: SortKey): void {
  try { localStorage.setItem(KEY_SORT, k); } catch { /* noop */ }
}
export function saveSortDir(d: SortDirection): void {
  try { localStorage.setItem(KEY_DIR, d); } catch { /* noop */ }
}

interface SortContext {
  prices: Map<string, Price>;
  sectors: Map<string, string>;       // ticker → sector
  inputOrder: Map<string, number>;    // ticker → original index
}

// 정렬 함수 (대부분 ascending — direction 적용은 호출 측에서)
type CmpFn = (a: Stock, b: Stock, ctx: SortContext) => number;

const COMPARATORS: Record<SortKey, CmpFn> = {
  dayChange: (a, b, ctx) => {
    const pa = ctx.prices.get(a.ticker);
    const pb = ctx.prices.get(b.ticker);
    const pctA = pa && pa.base > 0 ? (pa.price - pa.base) / pa.base : 0;
    const pctB = pb && pb.base > 0 ? (pb.price - pb.base) / pb.base : 0;
    return pctA - pctB;
  },
  volume: (a, b, ctx) => {
    const va = ctx.prices.get(a.ticker)?.volume ?? 0;
    const vb = ctx.prices.get(b.ticker)?.volume ?? 0;
    return va - vb;
  },
  input: (a, b, ctx) => {
    return (ctx.inputOrder.get(a.ticker) ?? 0)
         - (ctx.inputOrder.get(b.ticker) ?? 0);
  },
  name: (a, b) => (a.name ?? "").localeCompare(b.name ?? "", "ko"),
  investment: (a, b) => (a.shares * a.avg_price) - (b.shares * b.avg_price),
  sector: (a, b, ctx) => {
    const sa = ctx.sectors.get(a.ticker) ?? "";
    const sb = ctx.sectors.get(b.ticker) ?? "";
    return sa.localeCompare(sb, "ko");
  },
  pnl: (a, b, ctx) => {
    const pa = ctx.prices.get(a.ticker);
    const pb = ctx.prices.get(b.ticker);
    const curA = pa?.price ?? a.avg_price;
    const curB = pb?.price ?? b.avg_price;
    const pctA = a.avg_price > 0 ? (curA - a.avg_price) / a.avg_price : 0;
    const pctB = b.avg_price > 0 ? (curB - b.avg_price) / b.avg_price : 0;
    return pctA - pctB;
  },
  buyDate: (a, b) => (a.buy_date ?? "").localeCompare(b.buy_date ?? ""),
};

// 메인 정렬 — sleeping 항상 맨 아래
export function sortHoldings(
  holdings: Stock[],
  prices: Map<string, Price>,
  sectors: Map<string, string>,
  sortKey: SortKey,
  sortDir: SortDirection,
): Stock[] {
  // 입력 순서 보존 (동일 키일 때 안정 정렬용)
  const inputOrder = new Map(holdings.map((s, i) => [s.ticker, i]));
  const ctx: SortContext = { prices, sectors, inputOrder };

  const cmpBase = COMPARATORS[sortKey];
  const sign = sortDir === "asc" ? 1 : -1;

  return [...holdings].sort((a, b) => {
    // sleeping 우선 (항상 맨 아래)
    const pa = prices.get(a.ticker);
    const pb = prices.get(b.ticker);
    const aSleep = !pa || pa.base <= 0 || isHoldingSleeping(pa.trade_dt);
    const bSleep = !pb || pb.base <= 0 || isHoldingSleeping(pb.trade_dt);
    if (aSleep !== bSleep) return aSleep ? 1 : -1;

    // 메인 정렬 키
    const cmp = cmpBase(a, b, ctx) * sign;
    if (cmp !== 0) return cmp;

    // tiebreak — 입력 순서
    return (inputOrder.get(a.ticker) ?? 0) - (inputOrder.get(b.ticker) ?? 0);
  });
}
