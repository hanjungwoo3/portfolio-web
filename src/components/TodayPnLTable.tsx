import { useState } from "react";
import type { Stock, Price } from "../types";
import { formatSigned, signColor, holdingYesterdayBaseSum, isTodayKst } from "../lib/format";
import type { Trade } from "../lib/db";
import { computeRealizedByTrade } from "../lib/tradeCalc";
import { normalizeAccount } from "../lib/account";
import { getIndependentGroupsMode } from "../lib/groupMode";

// ─── 공용: 손익 계산 (오늘 / 전체) ────────────────────────────
export interface TodayPnLRow {
  ticker: string;
  name: string;
  amount: number;
}
export interface TodayPnLData {
  winners: TodayPnLRow[];
  losers: TodayPnLRow[];
  winSum: number;
  loseSum: number;
}

// amountOf 가 손익 금액을 반환 (null = 제외). 오늘/전체에 따라 기준 다름.
function computePnL(
  holdings: Stock[],
  prices: Map<string, Price>,
  amountOf: (s: Stock, p: Price) => number | null,
): TodayPnLData {
  const winners: TodayPnLRow[] = [];
  const losers: TodayPnLRow[] = [];
  for (const s of holdings) {
    if (s.shares <= 0) continue;
    const p = prices.get(s.ticker);
    if (!p) continue;
    const amount = amountOf(s, p);
    if (amount == null || amount === 0) continue;
    const row: TodayPnLRow = {
      ticker: s.ticker,
      name: s.name || s.ticker,
      amount,
    };
    if (amount > 0) winners.push(row);
    else losers.push(row);
  }
  winners.sort((a, b) => b.amount - a.amount);
  losers.sort((a, b) => a.amount - b.amount);
  return {
    winners,
    losers,
    winSum: winners.reduce((acc, r) => acc + r.amount, 0),
    loseSum: losers.reduce((acc, r) => acc + r.amount, 0),
  };
}

export function computeTodayPnL(holdings: Stock[], prices: Map<string, Price>) {
  // 오늘 손익 = 현재 평가 − 어제 기준 평가합 (오늘 매수분은 매수단가 기준, 합산은 보유분별 분리)
  return computePnL(holdings, prices, (s, p) => {
    const yBase = holdingYesterdayBaseSum(s, p);
    return yBase > 0 ? p.price * s.shares - yBase : null;
  });
}
export function computeOverallPnL(holdings: Stock[], prices: Map<string, Price>) {
  return computePnL(holdings, prices, (s, p) =>
    s.avg_price > 0 ? (p.price - s.avg_price) * s.shares : null);
}

interface Props {
  holdings: Stock[];
  prices: Map<string, Price>;
}

// ─── 데스크톱: 4개 미니 테이블 — 오늘/전체 × 수익/손해 ─────────────
export function TodayPnLTable({ holdings, prices }: Props) {
  const [open, setOpen] = useState(false);
  const today = computeTodayPnL(holdings, prices);
  const overall = computeOverallPnL(holdings, prices);
  const empty =
    today.winners.length === 0 && today.losers.length === 0 &&
    overall.winners.length === 0 && overall.losers.length === 0;
  if (empty) return null;

  const toggle = () => setOpen(o => !o);

  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {today.winners.length > 0 && (
        <MiniTable title="오늘 수익" rows={today.winners} total={today.winSum}
                   colorClass="text-rose-600" headerBg="bg-rose-50"
                   open={open} onToggle={toggle} />
      )}
      {today.losers.length > 0 && (
        <MiniTable title="오늘 손해" rows={today.losers} total={today.loseSum}
                   colorClass="text-blue-600" headerBg="bg-blue-50"
                   open={open} onToggle={toggle} />
      )}
      {overall.winners.length > 0 && (
        <MiniTable title="전체 수익" rows={overall.winners} total={overall.winSum}
                   colorClass="text-rose-600" headerBg="bg-rose-50"
                   open={open} onToggle={toggle} />
      )}
      {overall.losers.length > 0 && (
        <MiniTable title="전체 손해" rows={overall.losers} total={overall.loseSum}
                   colorClass="text-blue-600" headerBg="bg-blue-50"
                   open={open} onToggle={toggle} />
      )}
    </div>
  );
}

interface MiniProps {
  title: string;
  rows: TodayPnLRow[];
  total: number;
  colorClass: string;
  headerBg: string;
  open: boolean;
  onToggle: () => void;
}

function MiniTable({
  title, rows, total, colorClass, headerBg, open, onToggle,
}: MiniProps) {
  return (
    <div className="bg-white border border-gray-300 rounded-lg shadow-md
                    overflow-hidden w-[240px] flex flex-col">
      <button
        type="button"
        onClick={onToggle}
        title={open ? "닫기" : "펼치기"}
        className={`px-2 py-1 ${headerBg} ${colorClass} font-semibold
                    text-[11px] border-b border-gray-200 flex justify-between
                    items-center cursor-pointer hover:brightness-95`}>
        <span>
          {title}
          <span className="ml-1 text-gray-500 font-normal text-[10px]">{rows.length}종목</span>
        </span>
        <span className="text-gray-400 text-[10px] leading-none">
          {open ? "▼" : "▲"}
        </span>
      </button>
      {open && (
        rows.length === 0 ? (
          <div className="px-2 py-2 text-gray-400 text-[11px]">없음</div>
        ) : (
          <div className="max-h-[125px] overflow-y-auto overflow-x-hidden">
            {rows.map(r => (
              <div key={r.ticker}
                   className="border-b border-gray-100 last:border-0
                              flex items-center px-2 py-0.5 gap-2">
                <span className="truncate flex-1 min-w-0 text-gray-700">{r.name}</span>
                <span className={`font-medium tabular-nums shrink-0 ${colorClass}`}>
                  {formatSigned(r.amount)}
                </span>
              </div>
            ))}
          </div>
        )
      )}
      <div className="px-2 py-1 border-t border-gray-300 bg-gray-50
                      flex justify-between items-baseline">
        <span className="text-gray-500 text-[11px]">총액</span>
        <span className={`font-bold ${colorClass} tabular-nums`}>
          {formatSigned(total)}원
        </span>
      </div>
    </div>
  );
}

// ─── 모바일: TotalRow 위로 떠오르는 레이어 (오늘/전체 × 수익/손해 2x2) ──
export function MobileTodayPnLLayer({ holdings, prices }: Props) {
  const today = computeTodayPnL(holdings, prices);
  const overall = computeOverallPnL(holdings, prices);
  const empty =
    today.winners.length === 0 && today.losers.length === 0 &&
    overall.winners.length === 0 && overall.losers.length === 0;
  if (empty) return null;

  return (
    <div className="grid grid-cols-2 gap-2 w-[calc(100vw-1.5rem)] max-w-[420px]">
      {today.winners.length > 0 && (
        <MobileSection title="오늘 수익" rows={today.winners} total={today.winSum}
                       colorClass="text-rose-600" headerBg="bg-rose-50" />
      )}
      {today.losers.length > 0 && (
        <MobileSection title="오늘 손해" rows={today.losers} total={today.loseSum}
                       colorClass="text-blue-600" headerBg="bg-blue-50" />
      )}
      {overall.winners.length > 0 && (
        <MobileSection title="전체 수익" rows={overall.winners} total={overall.winSum}
                       colorClass="text-rose-600" headerBg="bg-rose-50" />
      )}
      {overall.losers.length > 0 && (
        <MobileSection title="전체 손해" rows={overall.losers} total={overall.loseSum}
                       colorClass="text-blue-600" headerBg="bg-blue-50" />
      )}
    </div>
  );
}

interface MobileSectionProps {
  title: string;
  rows: TodayPnLRow[];
  total: number;
  colorClass: string;
  headerBg: string;
}

function MobileSection({
  title, rows, total, colorClass, headerBg,
}: MobileSectionProps) {
  return (
    <div className="bg-white border border-gray-300 rounded-lg shadow-md
                    overflow-hidden flex flex-col flex-1 min-w-0">
      <div className={`px-2 py-1 ${headerBg} ${colorClass} font-semibold
                        text-xs border-b border-gray-200`}>
        {title}
        <span className="ml-1 text-gray-500 font-normal text-[10px]">{rows.length}종목</span>
      </div>
      {rows.length === 0 ? (
        <div className="px-2 py-2 text-gray-400 text-xs">없음</div>
      ) : (
        <div className="max-h-[145px] overflow-y-auto overflow-x-hidden text-xs">
          {rows.map(r => (
            <div key={r.ticker}
                 className="border-b border-gray-100 last:border-0
                            flex items-center px-2 py-1 gap-2">
              <span className="truncate flex-1 min-w-0 text-gray-700">{r.name}</span>
              <span className={`font-medium tabular-nums shrink-0 ${colorClass}`}>
                {formatSigned(r.amount)}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="px-2 py-1 border-t border-gray-300 bg-gray-50
                      flex justify-between items-baseline">
        <span className="text-gray-500 text-xs">총액</span>
        <span className={`font-bold text-sm ${colorClass} tabular-nums`}>
          {formatSigned(total)}원
        </span>
      </div>
    </div>
  );
}

// ─── 오늘 매도(실현손익) — "오늘만", 무영속·거래로그서 매번 재계산 ──────────────
//  보유분 평가손익(어제종가 기준)과 단위가 달라(전 보유기간 누적 실현) 합계에 섞지 않고
//  별도 섹션으로 분리. 내일이 되면 isTodayKst 가 false → 자동으로 빠짐.
export interface TodayRealizedRow {
  ticker: string;
  name: string;
  qty: number;       // 오늘 매도 수량
  realized: number;  // 실현손익(원)
  pct: number;       // 수익률(%) — 청산원가 가중
  sellAvg: number;   // 오늘 매도 평단가(원) = 매도금액 / 매도수량
}
export interface TodayRealizedData {
  rows: TodayRealizedRow[];
  realizedSum: number;
}

// 전체 거래로 이동평균 원가 → '오늘 매도' 건만 그룹(account)별로 추출.
//  aggregated(내주식): 모든 그룹의 오늘 매도 1회씩 합산. group: 해당 account 매도만.
//  ⚠️ 미러링(비독립) 모드라도 매도는 기록된 account 로만 집계 → 합산 중복 방지.
export function computeTodayRealized(
  trades: Trade[],
  account: string | undefined,
  aggregated: boolean | undefined,
  nameMap: Map<string, string>,
): TodayRealizedData {
  const realizedMap = computeRealizedByTrade(trades, getIndependentGroupsMode());
  const acc = normalizeAccount(account);
  const byTicker = new Map<string, TodayRealizedRow & { cost: number; sellAmt: number }>();
  for (const t of trades) {
    if (t.type !== "sell" || !isTodayKst(t.date)) continue;
    if (!aggregated && normalizeAccount(t.account) !== acc) continue;
    const info = realizedMap.get(t.id);
    if (!info) continue;   // 원가 불명 매도(보유 없이 나온 매도) → 제외
    const cur = byTicker.get(t.ticker) ?? {
      ticker: t.ticker, name: nameMap.get(t.ticker) || t.ticker,
      qty: 0, realized: 0, pct: 0, sellAvg: 0, cost: 0, sellAmt: 0,
    };
    cur.qty += t.qty;
    cur.realized += info.realized;
    cur.cost += info.cost;
    cur.sellAmt += t.amount;
    byTicker.set(t.ticker, cur);
  }
  const rows: TodayRealizedRow[] = [...byTicker.values()].map(r => ({
    ticker: r.ticker, name: r.name, qty: r.qty, realized: r.realized,
    pct: r.cost > 0 ? (r.realized / r.cost) * 100 : 0,
    sellAvg: r.qty > 0 ? r.sellAmt / r.qty : 0,
  }));
  rows.sort((a, b) => b.realized - a.realized);
  return { rows, realizedSum: rows.reduce((s, r) => s + r.realized, 0) };
}

interface RealizedProps {
  trades: Trade[];
  account?: string;
  aggregated?: boolean;
  holdings: Stock[];          // 오늘 종합(평가+실현) 라인용 — 평가는 TotalRow 와 동일 기준
  prices: Map<string, Price>;
  nameMap: Map<string, string>;
}

// ─── 데스크톱: 오늘 매도 카드 (합계 줄 옆에 떠오름) ───────────────
export function TodayRealizedCard({ trades, account, aggregated, holdings, prices, nameMap }: RealizedProps) {
  const [open, setOpen] = useState(true);
  const { rows, realizedSum } = computeTodayRealized(trades, account, aggregated, nameMap);
  if (rows.length === 0) return null;   // 오늘 매도 없으면 통째로 숨김
  const today = computeTodayPnL(holdings, prices);
  const evalSum = today.winSum + today.loseSum;   // 오늘 평가손익(보유분) — TotalRow '오늘'과 동일
  const grand = evalSum + realizedSum;

  return (
    <div className="bg-white border border-gray-300 rounded-lg shadow-md
                    overflow-hidden w-[260px] flex flex-col text-xs">
      <button type="button" onClick={() => setOpen(o => !o)}
              title={open ? "닫기" : "펼치기"}
              className="px-2 py-1 bg-amber-50 text-amber-700 font-semibold text-[11px]
                         border-b border-gray-200 flex justify-between items-center
                         cursor-pointer hover:brightness-95">
        <span>오늘 매도<span className="ml-1 text-gray-500 font-normal text-[10px]">{rows.length}종목</span></span>
        <span className="text-gray-400 text-[10px] leading-none">{open ? "▼" : "▲"}</span>
      </button>
      {open && (
        <div className="max-h-[160px] overflow-y-auto overflow-x-hidden">
          {rows.map(r => {
            const nowPrice = prices.get(r.ticker)?.price ?? 0;
            const diff = nowPrice > 0 && r.sellAvg > 0 ? (nowPrice - r.sellAvg) / r.sellAvg * 100 : null;
            return (
              <div key={r.ticker}
                   className="border-b border-gray-100 last:border-0 px-2 py-0.5">
                <div className="flex items-center gap-1.5">
                  <span className="truncate flex-1 min-w-0 text-gray-700">{r.name}</span>
                  <span className="text-gray-400 text-[10px] shrink-0 tabular-nums">{r.qty}주</span>
                  <span className={`font-medium tabular-nums shrink-0 ${signColor(r.realized)}`}>
                    {formatSigned(r.realized)} ({r.pct >= 0 ? "+" : ""}{r.pct.toFixed(1)}%)
                  </span>
                </div>
                <div className="flex items-center gap-1 text-[10px] text-gray-400 tabular-nums pl-0.5">
                  <span>매도 {Math.round(r.sellAvg).toLocaleString()}</span>
                  <span className="text-gray-300">→</span>
                  <span>현재 {nowPrice > 0 ? Math.round(nowPrice).toLocaleString() : "–"}</span>
                  {diff !== null && (
                    <span className={signColor(diff)}>({diff >= 0 ? "+" : ""}{diff.toFixed(1)}%)</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="px-2 py-1 border-t border-gray-300 bg-gray-50 flex justify-between items-baseline">
        <span className="text-gray-500 text-[11px]">오늘 실현</span>
        <span className={`font-bold tabular-nums ${signColor(realizedSum)}`}>{formatSigned(realizedSum)}원</span>
      </div>
      <div className="px-2 py-1 border-t border-gray-200 bg-amber-50/60 flex justify-between items-baseline">
        <span className="text-gray-600 text-[11px] font-medium">
          오늘 종합<span className="text-gray-400 font-normal"> 평가+실현</span>
        </span>
        <span className={`font-bold tabular-nums ${signColor(grand)}`}>{formatSigned(grand)}원</span>
      </div>
    </div>
  );
}

// ─── 모바일: 오늘 매도 카드 (오늘 손익 레이어 안에 전폭) ───────────
export function MobileTodayRealizedCard({ trades, account, aggregated, holdings, prices, nameMap }: RealizedProps) {
  const { rows, realizedSum } = computeTodayRealized(trades, account, aggregated, nameMap);
  if (rows.length === 0) return null;
  const today = computeTodayPnL(holdings, prices);
  const evalSum = today.winSum + today.loseSum;
  const grand = evalSum + realizedSum;

  return (
    <div className="bg-white border border-gray-300 rounded-lg shadow-md
                    overflow-hidden flex flex-col w-[calc(100vw-1.5rem)] max-w-[420px] text-xs">
      <div className="px-2 py-1 bg-amber-50 text-amber-700 font-semibold text-xs border-b border-gray-200">
        오늘 매도<span className="ml-1 text-gray-500 font-normal text-[10px]">{rows.length}종목</span>
      </div>
      <div className="max-h-[190px] overflow-y-auto overflow-x-hidden">
        {rows.map(r => {
          const nowPrice = prices.get(r.ticker)?.price ?? 0;
          const diff = nowPrice > 0 && r.sellAvg > 0 ? (nowPrice - r.sellAvg) / r.sellAvg * 100 : null;
          return (
            <div key={r.ticker}
                 className="border-b border-gray-100 last:border-0 px-2 py-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate flex-1 min-w-0 text-gray-700">{r.name}</span>
                <span className="text-gray-400 text-[10px] shrink-0 tabular-nums">{r.qty}주</span>
                <span className={`font-medium tabular-nums shrink-0 ${signColor(r.realized)}`}>
                  {formatSigned(r.realized)} ({r.pct >= 0 ? "+" : ""}{r.pct.toFixed(1)}%)
                </span>
              </div>
              <div className="flex items-center gap-1 text-[10px] text-gray-400 tabular-nums pl-0.5 mt-0.5">
                <span>매도 {Math.round(r.sellAvg).toLocaleString()}</span>
                <span className="text-gray-300">→</span>
                <span>현재 {nowPrice > 0 ? Math.round(nowPrice).toLocaleString() : "–"}</span>
                {diff !== null && (
                  <span className={signColor(diff)}>({diff >= 0 ? "+" : ""}{diff.toFixed(1)}%)</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="px-2 py-1 border-t border-gray-300 bg-gray-50 flex justify-between items-baseline">
        <span className="text-gray-500 text-xs">오늘 실현</span>
        <span className={`font-bold text-sm tabular-nums ${signColor(realizedSum)}`}>{formatSigned(realizedSum)}원</span>
      </div>
      <div className="px-2 py-1 border-t border-gray-200 bg-amber-50/60 flex justify-between items-baseline">
        <span className="text-gray-600 text-xs font-medium">
          오늘 종합<span className="text-gray-400 font-normal"> 평가+실현</span>
        </span>
        <span className={`font-bold text-sm tabular-nums ${signColor(grand)}`}>{formatSigned(grand)}원</span>
      </div>
    </div>
  );
}
