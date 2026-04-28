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
