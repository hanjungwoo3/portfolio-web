import Dexie, { type Table } from "dexie";
import type { Stock, Memo } from "../types";
import { getDeposits, getDeposit, setDeposit, replaceAllDeposits } from "./deposits";
import { getGroupFolders, setGroupFolders, type GroupFolder } from "./groupFolders";
import type { TabVisibility } from "./tabVisibility";
import {
  getDimSleepingEnabled, setDimSleepingEnabled,
  getPersonalProxyUrl, setPersonalProxyUrl,
  getPersonalProxies, setPersonalProxies, type PersonalProxy,
  getPersonalPollMs, setPersonalPollMs,
} from "./proxyConfig";

interface Peak { ticker: string; price: number; }
interface ConfigKV { key: string; value: unknown; }

// 거래 기록 — 보유수량/평단과 별개의 로그. 매수/매도 시 자동 추가되며, 로그 CRUD 는 보유에 영향 없음.
export interface Trade {
  id: string;
  ticker: string;
  account?: string;          // 어느 그룹에서의 거래인지 (참고용)
  type: "buy" | "sell";
  date: string;              // YYYY-MM-DD (KST)
  qty: number;               // 수량
  amount: number;            // 총액(원) — 단가는 amount/qty
  createdAt?: number;        // 기록 생성 시각(정렬 보조)
}

class PortfolioDB extends Dexie {
  holdings!: Table<Stock, string>;       // PK: ticker_account composite (string)
  peaks!: Table<Peak, string>;           // PK: ticker
  config!: Table<ConfigKV, string>;      // PK: key
  memos!: Table<Memo, string>;           // PK: ticker
  trades!: Table<Trade, string>;         // PK: id (거래 기록)

  constructor() {
    super("portfolio_v3");
    this.version(1).stores({
      holdings: "&id, ticker, account",
      peaks: "&ticker",
      config: "&key",
    });
    // v2: memos 테이블 추가 (기존 테이블은 그대로 유지 — 자동 마이그레이션)
    this.version(2).stores({
      holdings: "&id, ticker, account",
      peaks: "&ticker",
      config: "&key",
      memos: "&ticker",
    });
    // v3: trades 테이블 추가 (거래 기록)
    this.version(3).stores({
      holdings: "&id, ticker, account",
      peaks: "&ticker",
      config: "&key",
      memos: "&ticker",
      trades: "&id, ticker",
    });
  }
}

export const db = new PortfolioDB();

// todayShares/todayCost 는 거래로그에서 매번 새로 계산되는 파생값 — DB 에 절대 저장 금지.
//  (과거: 추가매수 등으로 in-memory 보유의 todayShares 가 holdings 로 새어 저장되면,
//   다음날 오늘거래가 없어도 그 값이 살아남아 '오늘 손익 = 전체 손익' 으로 굳던 버그)
//  쓰기 경로가 여러 곳(put 12+)이라 단일 차단점인 Dexie hook 으로 막는다.
db.holdings.hook("creating", (_pk, obj) => {
  delete (obj as Partial<Stock>).todayShares;
  delete (obj as Partial<Stock>).todayCost;
});
db.holdings.hook("updating", (mods) => {
  const m = mods as Record<string, unknown>;
  if ("todayShares" in m || "todayCost" in m) {
    return { todayShares: undefined, todayCost: undefined };
  }
  return undefined;
});

// 이미 새어 저장된 묵은 파생값을 1회 제거 — 앱 시작 시 호출.
export async function purgeDerivedHoldingFields(): Promise<number> {
  const rows = await db.holdings.toArray();
  const dirty = rows.filter(r =>
    (r as Partial<Stock>).todayShares != null || (r as Partial<Stock>).todayCost != null);
  if (dirty.length === 0) return 0;
  await db.transaction("rw", db.holdings, async () => {
    for (const r of dirty) {
      const clean = { ...r };
      delete (clean as Partial<Stock>).todayShares;
      delete (clean as Partial<Stock>).todayCost;
      await db.holdings.put({ ...clean, id: holdingId(clean) } as Stock & { id: string });
    }
  });
  return dirty.length;
}

export function holdingId(s: Stock): string {
  return `${s.ticker}__${s.account || ""}`;
}

// ───────── 거래 기록(trades) — 보유와 별개 로그 ─────────
export async function getTradesForTicker(ticker: string): Promise<Trade[]> {
  const rows = await db.trades.where("ticker").equals(ticker).toArray();
  // 날짜 내림차순(최신 먼저), 동일 날짜는 생성순 역순
  return rows.sort((a, b) =>
    b.date.localeCompare(a.date) || ((b.createdAt ?? 0) - (a.createdAt ?? 0)));
}
export async function addTrade(t: Omit<Trade, "id" | "createdAt"> & { id?: string }): Promise<string> {
  const id = t.id ?? `${t.ticker}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  await db.trades.put({ ...t, id, createdAt: Date.now() });
  return id;
}
export async function updateTrade(t: Trade): Promise<void> {
  await db.trades.put(t);
}
export async function deleteTrade(id: string): Promise<void> {
  await db.trades.delete(id);
}
export async function loadAllTrades(): Promise<Trade[]> {
  return db.trades.toArray();
}
export async function replaceAllTrades(trades: Trade[]): Promise<void> {
  await db.transaction("rw", db.trades, async () => {
    await db.trades.clear();
    if (trades.length > 0) await db.trades.bulkAdd(trades);
  });
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

// 깨진 종목명 자동 복구 — 이름에 치환문자(U+FFFD)가 든 행은 정상 출처에서 이름을 다시 받아 덮어씀.
// (인코딩 깨짐으로 저장된 종목명 복원. U+FFFD 는 정상 종목명에 절대 없으므로 오판 위험 없음.)
// fetchName 은 api.fetchStockName 을 주입 (db→api 순환 의존 회피).
export async function repairBrokenNames(
  fetchName: (ticker: string) => Promise<string | null>,
): Promise<number> {
  // 치환문자(U+FFFD) — 실제 글자 또는 HTML 엔티티(&#65533; / &#xFFFD;) 형태 모두 탐지
  const BROKEN = /�|&#65533;|&#x?fffd;/i;
  const all = await loadHoldings();
  const brokenTickers = [...new Set(
    all.filter(s => s.name && BROKEN.test(s.name)).map(s => s.ticker)
  )];
  if (brokenTickers.length === 0) return 0;
  // eslint-disable-next-line no-console
  console.log(`[repair] 깨진 종목명 ${brokenTickers.length}건 — 이름 재취득 시도:`, brokenTickers);
  const nameMap = new Map<string, string>();
  for (const ticker of brokenTickers) {
    try {
      const n = await fetchName(ticker);
      if (n && !BROKEN.test(n)) nameMap.set(ticker, n);
      else {
        // eslint-disable-next-line no-console
        console.warn(`[repair] ${ticker} 이름 재취득 실패/빈값:`, n);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[repair] ${ticker} 출처 오류:`, e);
    }
  }
  if (nameMap.size === 0) return 0;
  // ticker 인덱스로 해당 종목 모든 행의 name 갱신 (id 포맷에 의존하지 않음)
  await db.transaction("rw", db.holdings, async () => {
    for (const [ticker, name] of nameMap) {
      await db.holdings.where("ticker").equals(ticker).modify({ name });
    }
  });
  // eslint-disable-next-line no-console
  console.log(`[repair] 종목명 ${nameMap.size}건 복구 완료:`, [...nameMap.entries()]);
  return nameMap.size;
}

// 레거시 account="" 행을 일반 그룹 "보유" 로 통일 (앱 로드 시 호출, idempotent).
// 충돌(같은 ticker 의 account="보유" 행 존재) 시 우선순위로 데이터 손실 방지:
//   1) shares > 0 인 쪽 우선 (수량 있는 쪽이 의미 있는 데이터)
//   2) 둘 다 수량 있으면 buy_date 최신 쪽 우선 (가장 최근 의도)
//   3) 둘 다 동일하면 기존 "보유" 행 유지
// 반환: 처리된 빈 row 수 (0 이면 noop).
export async function migrateEmptyAccountToHolding(): Promise<number> {
  const all = await db.holdings.toArray();
  const empties = all.filter(s => (s.account ?? "") === "");
  if (empties.length === 0) return 0;

  const holdingByTicker = new Map<string, Stock & { id: string }>();
  for (const s of all) {
    if (s.account === "보유") holdingByTicker.set(s.ticker, s as Stock & { id: string });
  }

  // 빈 행 vs "보유" 행 중 어느 쪽 값을 살릴지 결정
  const pickWinner = (
    empty: Stock, hold: Stock & { id: string },
  ): Stock => {
    const eHas = empty.shares > 0 && empty.avg_price > 0;
    const hHas = hold.shares > 0 && hold.avg_price > 0;
    if (eHas && !hHas) return empty;
    if (!eHas && hHas) return hold;
    if (eHas && hHas) {
      // 둘 다 보유 — 최신 buy_date 우선
      const eDate = empty.buy_date || "";
      const hDate = hold.buy_date || "";
      return eDate > hDate ? empty : hold;
    }
    // 둘 다 관심(0주) — 기존 "보유" 행 유지
    return hold;
  };

  let processed = 0;
  await db.transaction("rw", db.holdings, async () => {
    for (const s of empties) {
      const oldId = holdingId(s);
      await db.holdings.delete(oldId);
      const existingHold = holdingByTicker.get(s.ticker);
      if (existingHold) {
        // 충돌 — winner 값을 "보유" 그룹으로 보존
        const winner = pickWinner(s, existingHold);
        const fixed = { ...winner, account: "보유" };
        await db.holdings.put({ ...fixed, id: holdingId(fixed) } as Stock & { id: string });
        holdingByTicker.set(s.ticker, { ...fixed, id: holdingId(fixed) } as Stock & { id: string });
      } else {
        const fixed = { ...s, account: "보유" };
        await db.holdings.put({ ...fixed, id: holdingId(fixed) } as Stock & { id: string });
        holdingByTicker.set(s.ticker, { ...fixed, id: holdingId(fixed) } as Stock & { id: string });
      }
      processed += 1;
    }
  });
  return processed;
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
    .filter(([t, p]) => /^[\dA-Za-z]{6}$/.test(t) && typeof p === "number" && p > 0)
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

// 단건 그룹 업서트 — 있으면 입력값으로 update, 없으면 신규 add.
// (bulkAddToGroup 의 skip 동작과 달리 항상 입력값 반영)
export async function upsertHoldingToGroup(
  s: Stock, group: string,
): Promise<"added" | "updated"> {
  const stock: Stock = { ...s, account: group };
  const id = holdingId(stock);
  const existing = await db.holdings.get(id);
  await db.holdings.put({ ...stock, id } as Stock & { id: string });
  return existing ? "updated" : "added";
}

// 같은 ticker 의 모든 그룹 row 를 동일 값으로 일괄 sync.
// 사용자 의도: "어느 그룹에서 수정해도 모든 그룹이 같은 수량/매수가/매수일을 가짐."
// shares = 0 인 row 도 함께 sync (watchlist 도 동기화).
export interface SyncTickerResult { updated: number; }
export async function syncAllRowsForTicker(
  ticker: string,
  values: {
    shares: number; avg_price: number;
    buy_date?: string; market?: string; name?: string;
  },
): Promise<SyncTickerResult> {
  let updated = 0;
  const invested = Math.round(values.shares * values.avg_price);
  await db.transaction("rw", db.holdings, async () => {
    const rows = await db.holdings.where("ticker").equals(ticker).toArray();
    for (const r of rows) {
      const next: Stock = {
        ...r,
        shares: values.shares,
        avg_price: values.avg_price,
        invested,
        buy_date: values.buy_date ?? r.buy_date,
        market: values.market ?? r.market,
        name: values.name ?? r.name,
      };
      await db.holdings.put({ ...next, id: holdingId(next) } as Stock & { id: string });
      updated += 1;
    }
  });
  return { updated };
}

// ─── 그룹별 독립 보유 모드 — 충돌 감지 / 해결 ─────────────────
// 같은 ticker 의 그룹별 row 들이 다른 값을 가질 때 = 충돌
export interface TickerConflict {
  ticker: string;
  name: string;
  rows: Array<{
    account: string;
    shares: number;
    avg_price: number;
    buy_date?: string;
  }>;
}

export async function findTickerConflicts(): Promise<TickerConflict[]> {
  const all = await db.holdings.toArray();
  const byTicker = new Map<string, Stock[]>();
  for (const s of all) {
    const arr = byTicker.get(s.ticker) ?? [];
    arr.push(s);
    byTicker.set(s.ticker, arr);
  }
  const conflicts: TickerConflict[] = [];
  for (const [ticker, rows] of byTicker) {
    if (rows.length < 2) continue;
    const ref = rows[0];
    const sameValues = rows.every(r =>
      r.shares === ref.shares
      && r.avg_price === ref.avg_price
      && (r.buy_date ?? "") === (ref.buy_date ?? "")
    );
    if (!sameValues) {
      conflicts.push({
        ticker,
        name: ref.name,
        rows: rows.map(r => ({
          account: r.account ?? "",
          shares: r.shares,
          avg_price: r.avg_price,
          buy_date: r.buy_date,
        })),
      });
    }
  }
  return conflicts;
}

// 충돌 해결 — 특정 그룹의 값으로 모든 그룹 통일
export async function resolveConflictUseGroup(
  ticker: string, sourceAccount: string,
): Promise<void> {
  await db.transaction("rw", db.holdings, async () => {
    const sourceRow = await db.holdings.get(holdingId({ ticker, account: sourceAccount } as Stock));
    if (!sourceRow) return;
    const rows = await db.holdings.where("ticker").equals(ticker).toArray();
    const invested = Math.round(sourceRow.shares * sourceRow.avg_price);
    for (const r of rows) {
      const next: Stock = {
        ...r,
        shares: sourceRow.shares,
        avg_price: sourceRow.avg_price,
        invested,
        buy_date: sourceRow.buy_date,
      };
      await db.holdings.put({ ...next, id: holdingId(next) } as Stock & { id: string });
    }
  });
}

// 충돌 해결 — 합산 (모든 그룹 수량 더하기, 평단 가중평균)
export async function resolveConflictMerge(ticker: string): Promise<void> {
  await db.transaction("rw", db.holdings, async () => {
    const rows = await db.holdings.where("ticker").equals(ticker).toArray();
    let totalShares = 0;
    let totalCost = 0;
    let earliestBuyDate = "";
    for (const r of rows) {
      totalShares += r.shares;
      totalCost += r.shares * r.avg_price;
      if (r.buy_date && (!earliestBuyDate || r.buy_date < earliestBuyDate)) {
        earliestBuyDate = r.buy_date;
      }
    }
    const avgPrice = totalShares > 0 ? totalCost / totalShares : 0;
    const invested = Math.round(totalCost);
    for (const r of rows) {
      const next: Stock = {
        ...r,
        shares: totalShares,
        avg_price: avgPrice,
        invested,
        buy_date: earliestBuyDate || r.buy_date,
      };
      await db.holdings.put({ ...next, id: holdingId(next) } as Stock & { id: string });
    }
  });
}

// 모든 그룹의 같은 ticker row 일괄 삭제 (전량 매도 / 수량 0 직접수정 시).
export async function deleteAllRowsForTicker(ticker: string): Promise<number> {
  return await db.holdings.where("ticker").equals(ticker).delete();
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

// 전체 내보내기 — desktop v2 holdings.json 호환 형식 (holdings + peaks + 설정 통합)
export interface ExportPayload {
  holdings: Stock[];
  peaks: Record<string, number>;
  memos?: Memo[];                // 종목별 메모 (optional — 구버전 portfolio.json 호환)
  trades?: Trade[];             // 거래 기록 (optional — 구버전 호환)
  exported_at: string;
  // 다기기 동기화 설정 — 설정의 모든 항목 포함
  settings?: {
    independentGroups?: boolean;
    deposits?: Record<string, number>;   // 그룹(account)별 예수금
    groupFolders?: GroupFolder[];        // 그룹 폴더 구성
    tabVisibility?: TabVisibility;       // 상단 탭 표시
    dimSleeping?: boolean;               // 장마감 흐림
    personalProxyUrl?: string | null;    // 전용 프록시 URL (레거시 — 단일, 호환용)
    personalProxies?: PersonalProxy[];   // 전용 프록시 목록 ({url, enabled})
    personalPollMs?: number;             // 폴링 주기(ms)
  };
}
export async function exportAll(): Promise<ExportPayload> {
  const [stocks, memos, trades] = await Promise.all([
    loadHoldings(), loadMemos(), loadAllTrades(),
  ]);
  // id 필드 (내부 PK) 제거 + 관심ETF 그룹 제외 (v2 동일 — 미국증시 섹터 매핑용 내부 데이터)
  const cleanHoldings = stocks
    .filter(s => (s.account || "") !== "관심ETF")
    .map(s => {
      const { ...rest } = s as Stock & { id?: string };
      delete (rest as { id?: string }).id;
      return rest;
    });
  // 피크가는 더 이상 사용 안 함 (API 고/저가로 대체) — 새 백업엔 미포함
  const peaksObj: Record<string, number> = {};
  // memos — 결정적 정렬 (ticker asc) 으로 직렬화 안정성 확보
  const memosList: Memo[] = Array.from(memos.values())
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
  // settings — 다기기 동기화 대상 (independent groups mode + 예수금)
  let independentGroups: boolean | undefined;
  try {
    independentGroups = localStorage.getItem("portfolio_independent_groups") === "1";
  } catch { /* noop */ }
  return {
    holdings: cleanHoldings,
    peaks: peaksObj,
    memos: memosList,
    trades: trades.slice().sort((a, b) => a.date.localeCompare(b.date)),
    exported_at: new Date().toISOString(),
    settings: {
      independentGroups,
      deposits: getDeposits(),
      groupFolders: getGroupFolders(),
      // tabVisibility 는 디바이스(모바일/PC) 별로 별도 저장 — 백업에 포함 안 함
      dimSleeping: getDimSleepingEnabled(),
      personalProxyUrl: getPersonalProxyUrl(),   // 레거시 호환(구버전 앱 import용)
      personalProxies: getPersonalProxies(),
      personalPollMs: getPersonalPollMs(),
    },
  };
}

// 설정 적용 — Drive 다운로드 후 호출
export function applyImportedSettings(settings?: ExportPayload["settings"]): void {
  if (!settings) return;
  if (typeof settings.independentGroups === "boolean") {
    try {
      localStorage.setItem(
        "portfolio_independent_groups",
        settings.independentGroups ? "1" : "0",
      );
    } catch { /* noop */ }
  }
  if (settings.deposits) replaceAllDeposits(settings.deposits);
  if (settings.groupFolders) setGroupFolders(settings.groupFolders);
  // tabVisibility 는 디바이스(모바일/PC) 별로 별도 관리 — 불러오기 적용 안 함
  if (typeof settings.dimSleeping === "boolean") setDimSleepingEnabled(settings.dimSleeping);
  // 전용 프록시 — 신규 목록 우선, 없으면 레거시 단일 URL 호환
  if (Array.isArray(settings.personalProxies)) setPersonalProxies(settings.personalProxies);
  else if (settings.personalProxyUrl !== undefined) setPersonalProxyUrl(settings.personalProxyUrl);
  if (typeof settings.personalPollMs === "number") setPersonalPollMs(settings.personalPollMs);
}

// 그룹 일괄 삭제 — 해당 그룹의 모든 holdings 삭제 (반환: 삭제 건수)
export async function deleteGroup(groupName: string): Promise<number> {
  const removed = await db.holdings.where("account").equals(groupName).delete();
  // 그룹 예수금도 함께 제거 — 안 그러면 고아 예수금이 '내주식' 합산(getTotalDeposits)에 계속 남음
  setDeposit(groupName, 0);
  // 그룹 폴더에서도 제거 — 삭제된 그룹이 폴더 멤버로 남지 않게
  const folders = getGroupFolders();
  let changed = false;
  for (const f of folders) {
    const before = f.groups.length;
    f.groups = f.groups.filter(g => g !== groupName);
    if (f.groups.length !== before) changed = true;
  }
  if (changed) setGroupFolders(folders);
  return removed;
}

// 일부 ticker 들을 특정 그룹에서만 제거 (검색 토글용)
export async function bulkRemoveFromGroup(
  tickers: string[], group: string
): Promise<number> {
  let count = 0;
  await db.transaction("rw", db.holdings, async () => {
    for (const t of tickers) {
      const id = holdingId({ ticker: t, account: group } as Stock);
      const existing = await db.holdings.get(id);
      if (existing) { await db.holdings.delete(id); count += 1; }
    }
  });
  return count;
}

// 그룹 per-item 토글 — 종목별 독립 (있으면 제거, 없으면 추가)
export interface BulkToggleResult { added: number; removed: number; }
export async function bulkToggleGroup(
  items: Stock[], group: string
): Promise<BulkToggleResult> {
  let added = 0; let removed = 0;
  await db.transaction("rw", db.holdings, async () => {
    for (const it of items) {
      const stock: Stock = { ...it, account: group };
      const id = holdingId(stock);
      const existing = await db.holdings.get(id);
      if (existing) {
        await db.holdings.delete(id);
        removed += 1;
      } else {
        await db.holdings.put({ ...stock, id } as Stock & { id: string });
        added += 1;
      }
    }
  });
  return { added, removed };
}

// 그룹명 변경 — 해당 그룹의 모든 holdings.account 일괄 갱신
// id (= ticker__account) 도 변경되므로 delete + put 트랜잭션
export async function renameGroup(oldName: string, newName: string): Promise<number> {
  const old = oldName.trim();
  const next = newName.trim();
  if (!next || old === next) return 0;
  let count = 0;
  await db.transaction("rw", db.holdings, db.trades, async () => {
    const items = await db.holdings.where("account").equals(old).toArray();
    for (const it of items) {
      const oldId = holdingId(it as Stock);
      await db.holdings.delete(oldId);
      const updated = { ...it, account: next };
      const newId = holdingId(updated as Stock);
      await db.holdings.put({ ...updated, id: newId } as Stock & { id: string });
      count += 1;
    }
    // 거래 기록(trades)의 그룹(account)도 갱신 — 안 하면 내거래 그룹별 보기에 옛 이름이 남음.
    //   trades 는 account 인덱스가 없어 전체 스캔 + id 불변(ticker_time_rand)이라 단순 put.
    const trs = await db.trades.toArray();
    for (const tr of trs) {
      if ((tr.account ?? "") === old) await db.trades.put({ ...tr, account: next });
    }
  });
  // 예수금 키도 새 이름으로 이전 — 안 그러면 옛 이름에 고아 예수금이 남음
  const dep = getDeposit(old);
  if (dep > 0) {
    setDeposit(next, getDeposit(next) + dep);
    setDeposit(old, 0);
  }
  // 그룹 폴더 멤버 이름도 갱신 — 안 하면 폴더에서 빠져 sub바가 사라지고 그룹이 폴더 밖으로 튕김
  const folders = getGroupFolders();
  let folderChanged = false;
  for (const f of folders) {
    if (f.groups.includes(old)) {
      f.groups = Array.from(new Set(f.groups.map(g => (g === old ? next : g))));
      folderChanged = true;
    }
  }
  if (folderChanged) setGroupFolders(folders);
  return count;
}

// 고아 예수금 정리 (부팅 1회, idempotent) — 레거시 deleteGroup/renameGroup 이 예수금을
// 안 지우던 시절의 잔여분 제거. '내주식' 합산(getTotalDeposits)이 전 키를 더하므로,
// 이미 없는 그룹의 예수금이 총자산에 계속 잡히던 문제를 전 사용자에게 자동 정리.
//
// 유효 그룹 판정 = holdings 의 account(0주 관심 row 포함) ∪ group folders 의 groups.
// (빈 그룹에 예수금을 두려면 그 그룹 탭 접근이 필요 → holding row 나 폴더 등록 중 하나엔 반드시 존재.
//  따라서 둘 다에 없는 예수금은 삭제된 그룹의 고아로 안전하게 판정 가능)
// 반환: 정리된 고아 예수금 키 수 (0 이면 noop).
export async function pruneOrphanDeposits(): Promise<number> {
  const deposits = getDeposits();
  const keys = Object.keys(deposits);
  if (keys.length === 0) return 0;
  const all = await db.holdings.toArray();
  const valid = new Set<string>(all.map(h => h.account || ""));
  for (const f of getGroupFolders()) {
    for (const g of f.groups) valid.add(g);
  }
  let pruned = 0;
  for (const group of keys) {
    if (valid.has(group)) continue;
    setDeposit(group, 0);   // 고아 — 제거
    pruned += 1;
  }
  return pruned;
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

// ─── 종목별 메모 CRUD ────────────────────────────────────────

export async function getMemo(ticker: string): Promise<Memo | undefined> {
  return await db.memos.get(ticker);
}

export async function loadMemos(): Promise<Map<string, Memo>> {
  const all = await db.memos.toArray();
  return new Map(all.map(m => [m.ticker, m]));
}

// upsert — 모든 콘텐츠 필드가 빈 값이면 자동 삭제 (빈 레코드 잔존 방지)
// priceBasis 는 "기준 메타데이터" 라 단독으론 빈 메모 판정에서 제외
// updatedAt 은 함수 내부에서 자동 설정
export async function upsertMemo(
  memo: Omit<Memo, "updatedAt">,
): Promise<"saved" | "deleted"> {
  const isEmpty =
    !memo.text?.trim() &&
    (memo.targetPrice == null || !Number.isFinite(memo.targetPrice)) &&
    (memo.stopPrice == null || !Number.isFinite(memo.stopPrice)) &&
    (memo.entryPrice == null || !Number.isFinite(memo.entryPrice)) &&
    !memo.tag?.trim() &&
    !memo.color;
  if (isEmpty) {
    await deleteMemo(memo.ticker);
    return "deleted";
  }
  // priceBasis 는 가격 경계 중 하나라도 있을 때만 의미 있음
  const hasPriceBound =
    (memo.targetPrice != null && Number.isFinite(memo.targetPrice)) ||
    (memo.stopPrice != null && Number.isFinite(memo.stopPrice)) ||
    (memo.entryPrice != null && Number.isFinite(memo.entryPrice));
  const next: Memo = {
    ticker: memo.ticker,
    text: memo.text?.trim() || undefined,
    targetPrice: memo.targetPrice ?? undefined,
    stopPrice: memo.stopPrice ?? undefined,
    entryPrice: memo.entryPrice ?? undefined,
    priceBasis: hasPriceBound ? memo.priceBasis : undefined,
    tag: memo.tag?.trim() || undefined,
    color: memo.color,
    updatedAt: new Date().toISOString(),
  };
  await db.memos.put(next);
  return "saved";
}

export async function deleteMemo(ticker: string): Promise<void> {
  await db.memos.delete(ticker);
}

// Drive 다운로드 후 호출 — 전체 교체 (holdings/peaks 와 동일 패턴)
export async function replaceAllMemos(memos: Memo[]): Promise<void> {
  await db.transaction("rw", db.memos, async () => {
    await db.memos.clear();
    if (memos.length === 0) return;
    // 유효성 필터링 — ticker 가 비어있거나 콘텐츠 없는 row 제거 (호환성 가드)
    const valid = memos.filter(m =>
      typeof m.ticker === "string" && m.ticker.length > 0 &&
      (
        (typeof m.text === "string" && m.text.trim().length > 0) ||
        (typeof m.targetPrice === "number" && Number.isFinite(m.targetPrice)) ||
        (typeof m.stopPrice === "number" && Number.isFinite(m.stopPrice)) ||
        (typeof m.tag === "string" && m.tag.trim().length > 0) ||
        m.color
      )
    );
    if (valid.length > 0) await db.memos.bulkAdd(valid);
  });
}
