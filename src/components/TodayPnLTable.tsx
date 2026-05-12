import { useState } from "react";
import type { Stock, Price } from "../types";
import { formatSigned } from "../lib/format";

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

// basePriceOf 가 비교 기준 가격을 반환 — 오늘=어제종가(p.base), 전체=평단가(s.avg_price)
function computePnL(
  holdings: Stock[],
  prices: Map<string, Price>,
  basePriceOf: (s: Stock, p: Price) => number,
): TodayPnLData {
  const winners: TodayPnLRow[] = [];
  const losers: TodayPnLRow[] = [];
  for (const s of holdings) {
    if (s.shares <= 0) continue;
    const p = prices.get(s.ticker);
    if (!p) continue;
    const base = basePriceOf(s, p);
    if (base <= 0) continue;
    const amount = (p.price - base) * s.shares;
    if (amount === 0) continue;
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
  return computePnL(holdings, prices, (_, p) => p.base);
}
export function computeOverallPnL(holdings: Stock[], prices: Map<string, Price>) {
  return computePnL(holdings, prices, (s) => s.avg_price);
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
        <span>{title}</span>
        <span className="text-gray-400 text-[10px] leading-none">
          {open ? "▼" : "▲"}
        </span>
      </button>
      {open && (
        rows.length === 0 ? (
          <div className="px-2 py-2 text-gray-400 text-[11px]">없음</div>
        ) : (
          <div className="max-h-[200px] overflow-y-auto overflow-x-hidden">
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
      </div>
      {rows.length === 0 ? (
        <div className="px-2 py-2 text-gray-400 text-xs">없음</div>
      ) : (
        <div className="max-h-[28vh] overflow-y-auto overflow-x-hidden text-xs">
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
