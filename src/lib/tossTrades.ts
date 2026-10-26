// 토스 Open API 주문 이력 → 거래 기록(3단계). 데스크톱 앱에서만(brokerGet).
//   실측(2026-10-26): `orders?status=CLOSED` 에 MTS 주문도 나온다. REJECTED(체결 0)·취소가 섞임 → 체결분(filledQuantity>0)만.
//   수량·금액 = execution.filledQuantity·filledAmount(총액), 날짜 = filledAt(KST, 없으면 orderedAt). 주문 단위(체결별 아님).
//   미국(USD)은 체결일 환율(야후 KRW=X 일봉 종가)로 원화 환산. 장전·장후 시간외 종가 주문은 Open API 가 안 준다(붙여넣기 방식으로).
//   거래 id = `tossapi_<orderId>` — 다시 가져와도 덮어쓰기만(멱등). 손으로 넣은 거래·붙여넣기 거래(toss_)는 건드리지 않고
//   '겹치는 것 같음'만 표시한다(사용자 결정 2026-10-26).
import { brokerGet, getTossAccountSeq } from "./broker";
import { linkedGroupOf, setLinkedGroup } from "./linkedGroups";
import { fetchYahooPriceHistory } from "./api";
import { loadAllTrades, loadHoldings, upsertTrades, type Trade } from "./db";
import { getTickerNames, rememberTickerNames } from "./tickerNames";

export const TOSS_TRADE_ID_PREFIX = "tossapi_";

export interface TossOrder {
  orderId: string; symbol: string; side: "BUY" | "SELL" | string; status: string;
  currency: "KRW" | "USD" | string; orderedAt: string;
  execution?: { filledQuantity?: string | null; averageFilledPrice?: string | null; filledAmount?: string | null; filledAt?: string | null; commission?: string | null; tax?: string | null };
}
interface OrdersPage { orders?: TossOrder[]; nextCursor?: string | null; hasNext?: boolean }

export interface TossTradeRow {
  id: string;                 // tossapi_<orderId>
  ticker: string; name: string;
  date: string;               // YYYY-MM-DD (KST)
  type: "buy" | "sell";
  qty: number;
  amount: number;             // 원(총액). USD 는 체결일 환율 환산
  currency: string;
  nativeAmount: number;       // 거래 통화 금액(USD 면 달러)
  fx?: number;                // 환산에 쓴 환율
  commission?: number; tax?: number;
}

const num = (s: string | number | null | undefined) => { const v = Number(s); return Number.isFinite(v) ? v : 0; };
const todayKst = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

/** 주문 → 거래 행(체결분만). 순수 함수(테스트). fxOf(date) 는 USD 환산용, 없으면 USD 행은 건너뛰고 skipped 에 센다 */
export function mapTossOrders(orders: TossOrder[], names: Record<string, string>, fxOf?: (date: string) => number | undefined)
  : { rows: TossTradeRow[]; skipped: { noFill: number; noFx: number } } {
  const rows: TossTradeRow[] = [];
  const skipped = { noFill: 0, noFx: 0 };
  for (const o of orders) {
    const qty = num(o.execution?.filledQuantity);
    if (!(qty > 0) || !o.orderId || !o.symbol) { skipped.noFill++; continue; }
    const type: "buy" | "sell" | null = o.side === "BUY" ? "buy" : o.side === "SELL" ? "sell" : null;
    if (!type) { skipped.noFill++; continue; }
    const when = (o.execution?.filledAt || o.orderedAt || "").slice(0, 10);   // ISO 에 +09:00 이 붙어 있어 앞 10자가 KST 날짜
    if (!/^\d{4}-\d{2}-\d{2}$/.test(when)) { skipped.noFill++; continue; }
    const native = num(o.execution?.filledAmount) || num(o.execution?.averageFilledPrice) * qty;
    let amount = native, fx: number | undefined;
    if (o.currency === "USD") {
      fx = fxOf?.(when);
      if (!fx) { skipped.noFx++; continue; }
      amount = Math.round(native * fx);
    } else {
      amount = Math.round(native);
    }
    const ticker = o.symbol.trim();
    rows.push({
      id: `${TOSS_TRADE_ID_PREFIX}${o.orderId}`, ticker, name: names[ticker] ?? ticker, date: when, type, qty, amount,
      currency: o.currency, nativeAmount: native, fx,
      commission: num(o.execution?.commission) || undefined, tax: num(o.execution?.tax) || undefined,
    });
  }
  return { rows, skipped };
}

/** 손으로 넣은 거래(또는 붙여넣기 toss_)와 같아 보이는 것 — 같은 종목·날짜·방향·수량, 금액 0.1% 이내 */
export function findOverlaps(rows: TossTradeRow[], existing: Trade[]): Map<string, string> {
  const out = new Map<string, string>();   // rowId → 기존 거래 id
  const manual = existing.filter(t => !t.id.startsWith(TOSS_TRADE_ID_PREFIX));
  for (const r of rows) {
    const hit = manual.find(t => t.ticker === r.ticker && t.date === r.date && t.type === r.type && t.qty === r.qty
      && Math.abs(t.amount - r.amount) <= Math.max(1, r.amount * 0.001));
    if (hit) out.set(r.id, hit.id);
  }
  return out;
}

// 환율 표 — 기간에 맞는 범위의 KRW=X 일봉. 그 날이 휴일이면 직전 거래일 종가. from 없음(전체) = max
async function fxTable(from?: string): Promise<(date: string) => number | undefined> {
  const days = from ? Math.max(1, (Date.parse(todayKst()) - Date.parse(from)) / 86400_000) : Infinity;
  const range = days <= 360 ? "1y" : days <= 720 ? "2y" : days <= 1800 ? "5y" : days <= 3600 ? "10y" : "max";
  const pts = (await fetchYahooPriceHistory("KRW=X", range)).filter(p => p.close > 0).sort((a, b) => a.date.localeCompare(b.date));
  return (date: string) => {
    let best: number | undefined;
    for (const p of pts) { if (p.date <= date) best = p.close; else break; }
    return best;
  };
}

// from/to 없음 = 전체 기간(토스 문서: "미지정 시 전체 기간")
async function fetchClosedOrders(account: string, from: string | undefined, to: string | undefined, onProgress?: (n: number) => void): Promise<TossOrder[]> {
  const out: TossOrder[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 300; page++) {   // 100건 × 300 = 3만 건 상한
    const range = from && to ? `&from=${from}&to=${to}` : "";
    const q = `status=CLOSED${range}&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const r: OrdersPage = await brokerGet<OrdersPage>("toss", `/api/v1/orders?${q}`, account);
    out.push(...(r?.orders ?? []));
    onProgress?.(out.length);
    if (!r?.hasNext || !r.nextCursor) break;
    cursor = r.nextCursor;
  }
  return out;
}

export interface TossTradesFetch { rows: TossTradeRow[]; overlaps: Map<string, string>; existingIds: Set<string>; skipped: { noFill: number; noFx: number }; group: string }

/** 기간의 체결 거래를 받아 후보로 — 저장은 하지 않는다(가져오기 대화창이 고른 뒤 저장). from/to 생략 = 전체 */
export async function fetchTossTrades(from?: string, to?: string, onProgress?: (n: number) => void): Promise<TossTradesFetch> {
  const link = linkedGroupOf("toss");
  if (!link) throw new Error("토스 연동 그룹이 없습니다 — 설정 → 증권사 연결에서 '연동 시작'을 먼저 해 주세요");
  const account = link.meta.accountSeq || getTossAccountSeq();
  const orders = await fetchClosedOrders(account, from, to, onProgress);
  const needFx = orders.some(o => o.currency === "USD" && num(o.execution?.filledQuantity) > 0);
  const fxOf = needFx ? await fxTable(from).catch(() => undefined) : undefined;
  const holdings = await loadHoldings();
  const names: Record<string, string> = { ...getTickerNames() };
  for (const h of holdings) if (h.name) names[h.ticker] = h.name;
  const { rows, skipped } = mapTossOrders(orders, names, fxOf);
  const existing = await loadAllTrades();
  const existingIds = new Set(existing.filter(t => t.id.startsWith(TOSS_TRADE_ID_PREFIX)).map(t => t.id));
  return { rows, overlaps: findOverlaps(rows, existing), existingIds, skipped, group: link.group };
}

/** 후보를 거래 기록에 저장(멱등) — 그룹은 연동 그룹 */
export async function saveTossTrades(rows: TossTradeRow[], group: string): Promise<number> {
  if (!rows.length) return 0;
  rememberTickerNames(rows.map(r => ({ ticker: r.ticker, name: r.name })));
  await upsertTrades(rows.map(r => ({ id: r.id, ticker: r.ticker, account: group, type: r.type, date: r.date, qty: r.qty, amount: r.amount })));
  return rows.length;
}

/** 자동 증분 — 보유 갱신 뒤에 부른다. 마지막 가져온 날 3일 전부터(지연 체결 대비) 오늘까지. **처음이면 전체 이력**(사용자 요청 2026-10-26) */
export async function syncTossTradesIncremental(): Promise<number> {
  const link = linkedGroupOf("toss");
  if (!link) return 0;
  const to = todayKst();
  const f = link.meta.lastTradeSyncAt
    ? await fetchTossTrades(addDays(link.meta.lastTradeSyncAt.slice(0, 10), -3), to)
    : await fetchTossTrades();   // 전체
  const fresh = f.rows.filter(r => !f.existingIds.has(r.id));
  const n = await saveTossTrades(f.rows, f.group);   // 기존 것도 덮어쓰기(수정된 값 반영) — 멱등
  const cur = linkedGroupOf("toss");
  if (cur) setLinkedGroup(cur.group, { ...cur.meta, lastTradeSyncAt: new Date().toISOString() });
  return fresh.length || (n ? 0 : 0);
}
