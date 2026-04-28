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
  await db.transaction("rw", db.holdings, async () => {
    await db.holdings.clear();
    await db.holdings.bulkAdd(
      holdings.map(s => ({ ...s, id: holdingId(s) } as Stock & { id: string }))
    );
  });
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
