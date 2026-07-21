// 포트폴리오 데이터 import — JSON 패턴 자동 감지.
// SettingsDialog (데스크톱) + MobileSimpleView (모바일) 공통 사용.

import type { Stock, Memo } from "../types";
import type { Trade } from "./db";
import type { GroupFolder } from "./groupFolders";
import type { TabVisibility } from "./tabVisibility";
import type { PendingBuyItem } from "./deposits";

// 동기화 대상 설정 (exportAll.settings 와 동일 형태)
export interface ImportSettings {
  independentGroups?: boolean;
  deposits?: Record<string, number>;   // 그룹(account)별 예수금
  pendingBuys?: Record<string, PendingBuyItem[]>; // 그룹별 구매대기(건별 목록)
  groupFolders?: GroupFolder[];        // 그룹 폴더 구성
  tabVisibility?: TabVisibility;       // 상단 탭 표시
  dimSleeping?: boolean;               // 장마감 흐림
  personalProxyUrl?: string | null;    // 전용 프록시 URL (레거시 단일)
  personalProxies?: { url: string; enabled: boolean }[];   // 전용 프록시 목록
  personalPollMs?: number;             // 폴링 주기(ms)
}

export type Detected =
  | { kind: "holdings"; stocks: Stock[]; settings?: ImportSettings; memos?: Memo[]; trades?: Trade[] }
  | { kind: "peaks"; peaks: Record<string, number> }
  | { kind: "combined"; stocks: Stock[]; peaks: Record<string, number>; settings?: ImportSettings; memos?: Memo[]; trades?: Trade[] }
  | { kind: "error"; error: string }
  | null;

// obj.trades 추출 — 거래 기록. 형태만 가볍게 검증.
function parseTrades(obj: Record<string, unknown>): Trade[] | undefined {
  if (!Array.isArray(obj.trades)) return undefined;
  const out: Trade[] = [];
  for (const t of obj.trades) {
    if (t && typeof t === "object") {
      const x = t as Partial<Trade>;
      if (typeof x.id === "string" && typeof x.ticker === "string"
          && (x.type === "buy" || x.type === "sell")
          && typeof x.date === "string"
          && typeof x.qty === "number" && typeof x.amount === "number") {
        out.push(x as Trade);
      }
    }
  }
  return out;
}

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
  if (src.pendingBuys && typeof src.pendingBuys === "object" && !Array.isArray(src.pendingBuys)) {
    const pend: Record<string, PendingBuyItem[]> = {};
    for (const [k, v] of Object.entries(src.pendingBuys as Record<string, unknown>)) {
      if (Array.isArray(v)) {
        const items = v.filter((x): x is PendingBuyItem =>
          !!x && typeof x === "object"
          && typeof (x as PendingBuyItem).qty === "number" && (x as PendingBuyItem).qty > 0
          && typeof (x as PendingBuyItem).price === "number" && (x as PendingBuyItem).price > 0);
        if (items.length) pend[k] = items;
      } else if (typeof v === "number" && Number.isFinite(v) && v > 0) {
        pend[k] = [{ id: `legacy-${k}`, qty: 1, price: Math.round(v) }];   // 레거시 금액 → 1건
      }
    }
    out.pendingBuys = pend;
  }
  // 그룹 폴더 — [{ name, groups[] }]
  if (Array.isArray(src.groupFolders)) {
    out.groupFolders = (src.groupFolders as unknown[])
      .filter((f): f is { name: string; groups: unknown[] } =>
        !!f && typeof f === "object"
        && typeof (f as { name?: unknown }).name === "string"
        && Array.isArray((f as { groups?: unknown }).groups))
      .map(f => ({ name: f.name, groups: f.groups.filter((g): g is string => typeof g === "string") }));
  }
  // tabVisibility 는 디바이스(모바일/PC)별로 별도 관리 — 백업/불러오기 미포함
  // (옛 JSON 에 tabVisibility 키가 있어도 무시)
  if (typeof src.dimSleeping === "boolean") out.dimSleeping = src.dimSleeping;
  if (typeof src.personalProxyUrl === "string" || src.personalProxyUrl === null) {
    out.personalProxyUrl = src.personalProxyUrl as string | null;
  }
  // 전용 프록시 목록 — [{ url, enabled }]
  if (Array.isArray(src.personalProxies)) {
    out.personalProxies = (src.personalProxies as unknown[])
      .filter((p): p is { url: string; enabled?: unknown } =>
        !!p && typeof p === "object" && typeof (p as { url?: unknown }).url === "string")
      .map(p => ({ url: p.url, enabled: (p as { enabled?: unknown }).enabled !== false }));
  }
  if (typeof src.personalPollMs === "number") out.personalPollMs = src.personalPollMs;
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
    const trades = parseTrades(obj);
    if (obj.peaks && typeof obj.peaks === "object" && !Array.isArray(obj.peaks)) {
      return { kind: "combined", stocks, peaks: obj.peaks as Record<string, number>, settings, memos, trades };
    }
    return { kind: "holdings", stocks, settings, memos, trades };
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
