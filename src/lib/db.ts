import Dexie, { type Table } from "dexie";
import type { Stock } from "../types";

interface Peak { ticker: string; price: number; }
interface ConfigKV { key: string; value: unknown; }

class PortfolioDB extends Dexie {
  holdings!: Table<Stock, string>;       // PK: ticker_account composite (string)
  peaks!: Table<Peak, string>;           // PK: ticker
  config!: Table<ConfigKV, string>;      // PK: key

  constructor() {
    super("portfolio_v3");
    this.version(1).stores({
      holdings: "&id, ticker, account",
      peaks: "&ticker",
      config: "&key",
    });
  }
}

export const db = new PortfolioDB();

export function holdingId(s: Stock): string {
  return `${s.ticker}__${s.account || ""}`;
}

export async function loadHoldings(): Promise<Stock[]> {
  return db.holdings.toArray();
}

export async function replaceAllHoldings(holdings: Stock[]): Promise<void> {
  // 관심ETF 는 web v3 에서 사용 안 함 (섹터 매핑은 코드 상수) — 임포트 시 제외
  const cleaned = holdings.filter(s => (s.account || "") !== "관심ETF");
  await db.transaction("rw", db.holdings, async () => {
    await db.holdings.clear();
    await db.holdings.bulkAdd(
      cleaned.map(s => ({ ...s, id: holdingId(s) } as Stock & { id: string }))
    );
  });
}

// 잔여 관심ETF 항목 일괄 삭제 (앱 로드 시 1회 청소)
export async function cleanupReservedAccounts(): Promise<number> {
  return await db.holdings.where("account").equals("관심ETF").delete();
}

export async function loadPeaks(): Promise<Map<string, number>> {
  const all = await db.peaks.toArray();
  return new Map(all.map(p => [p.ticker, p.price]));
}

export async function setPeak(ticker: string, price: number): Promise<void> {
  await db.peaks.put({ ticker, price });
}

// peaks.json {ticker: price} → IndexedDB 일괄 저장
export async function replaceAllPeaks(map: Record<string, number>): Promise<void> {
  const items: Peak[] = Object.entries(map)
    .filter(([t, p]) => /^\d{6}$/.test(t) && typeof p === "number" && p > 0)
    .map(([ticker, price]) => ({ ticker, price }));
  await db.transaction("rw", db.peaks, async () => {
    await db.peaks.clear();
    if (items.length > 0) await db.peaks.bulkAdd(items);
  });
}

// 검색에서 그룹에 종목 추가 (보유 X — 그룹 등록만)
// 동일 ticker+account 가 있으면 중복 추가하지 않음.
export async function upsertHolding(s: Stock): Promise<"added" | "exists"> {
  const id = holdingId(s);
  const existing = await db.holdings.get(id);
  if (existing) return "exists";
  await db.holdings.put({ ...s, id } as Stock & { id: string });
  return "added";
}

// 검색 다이얼로그에서 일괄 추가 — Map<group, count of new>
export interface BulkAddResult { added: number; skipped: number; }
export async function bulkAddToGroup(
  items: Stock[], group: string
): Promise<BulkAddResult> {
  let added = 0; let skipped = 0;
  await db.transaction("rw", db.holdings, async () => {
    for (const it of items) {
      const stock: Stock = { ...it, account: group };
      const id = holdingId(stock);
      const exists = await db.holdings.get(id);
      if (exists) { skipped += 1; continue; }
      await db.holdings.put({ ...stock, id } as Stock & { id: string });
      added += 1;
    }
  });
  return { added, skipped };
}

// 단건 삭제 (ticker + account 매칭)
export async function removeHolding(ticker: string, account: string): Promise<void> {
  await db.holdings.delete(holdingId({ ticker, account } as Stock));
}

// 보유 갱신 — 기존 레코드 덮어쓰기 (id 기준 put)
export async function updateHolding(s: Stock): Promise<void> {
  await db.holdings.put({ ...s, id: holdingId(s) } as Stock & { id: string });
}

// 전체 내보내기 — desktop v2 holdings.json 호환 형식 (holdings + peaks 통합)
export interface ExportPayload {
  holdings: Stock[];
  peaks: Record<string, number>;
  exported_at: string;
}
export async function exportAll(): Promise<ExportPayload> {
  const [stocks, peaks] = await Promise.all([loadHoldings(), loadPeaks()]);
  // id 필드 (내부 PK) 제거 + 관심ETF 그룹 제외 (v2 동일 — 미국증시 섹터 매핑용 내부 데이터)
  const cleanHoldings = stocks
    .filter(s => (s.account || "") !== "관심ETF")
    .map(s => {
      const { ...rest } = s as Stock & { id?: string };
      delete (rest as { id?: string }).id;
      return rest;
    });
  const peaksObj: Record<string, number> = {};
  peaks.forEach((v, k) => { peaksObj[k] = v; });
  return {
    holdings: cleanHoldings,
    peaks: peaksObj,
    exported_at: new Date().toISOString(),
  };
}

// 그룹명 변경 — 해당 그룹의 모든 holdings.account 일괄 갱신
// id (= ticker__account) 도 변경되므로 delete + put 트랜잭션
export async function renameGroup(oldName: string, newName: string): Promise<number> {
  const old = oldName.trim();
  const next = newName.trim();
  if (!next || old === next) return 0;
  let count = 0;
  await db.transaction("rw", db.holdings, async () => {
    const items = await db.holdings.where("account").equals(old).toArray();
    for (const it of items) {
      const oldId = holdingId(it as Stock);
      await db.holdings.delete(oldId);
      const updated = { ...it, account: next };
      const newId = holdingId(updated as Stock);
      await db.holdings.put({ ...updated, id: newId } as Stock & { id: string });
      count += 1;
    }
  });
  return count;
}

// 보유 데이터에서 사용자 그룹 목록 추출 (시스템 reserved 만 제외)
const SPECIAL_GROUPS = new Set(["", "관심ETF"]);
export async function getUserGroups(): Promise<string[]> {
  const all = await db.holdings.toArray();
  const set = new Set<string>();
  for (const s of all) {
    const acc = s.account || "";
    if (!SPECIAL_GROUPS.has(acc)) set.add(acc);
  }
  return Array.from(set).sort();
}

// 가격 갱신 후 호출 — 현재가 > 저장된 피크면 forward-only 업데이트
export async function updatePeaksForward(
  prices: Map<string, number>
): Promise<number> {
  const existing = await loadPeaks();
  const updates: Peak[] = [];
  for (const [ticker, cur] of prices) {
    const old = existing.get(ticker) ?? 0;
    if (cur > old) updates.push({ ticker, price: cur });
  }
  if (updates.length > 0) await db.peaks.bulkPut(updates);
  return updates.length;
}
