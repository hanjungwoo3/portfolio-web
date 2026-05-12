import { useState } from "react";
import type { Stock, Price } from "../types";
import { formatSigned } from "../lib/format";

interface Props {
  holdings: Stock[];
  prices: Map<string, Price>;
}

// 오늘 손익(보유 수량 가중) 수익팀/손해팀 테이블.
// 기본 닫힘 (컴팩트 토글만), 클릭 시 토글 왼쪽으로 두 테이블 인라인 펼침.
// 같은 행에 TotalRow 와 들어가서 높이/탑 정렬이 자연스럽게 일치 (items-stretch).
export function TodayPnLTable({ holdings, prices }: Props) {
  const [open, setOpen] = useState(false);

  type Row = { ticker: string; name: string; amount: number };
  const winners: Row[] = [];
  const losers: Row[] = [];

  for (const s of holdings) {
    if (s.shares <= 0) continue;
    const p = prices.get(s.ticker);
    if (!p || p.base <= 0) continue;
    const amount = (p.price - p.base) * s.shares;
    if (amount === 0) continue;
    const row: Row = { ticker: s.ticker, name: s.name || s.ticker, amount };
    if (amount > 0) winners.push(row);
    else losers.push(row);
  }

  if (winners.length === 0 && losers.length === 0) return null;

  winners.sort((a, b) => b.amount - a.amount);
  losers.sort((a, b) => a.amount - b.amount);

  const winSum = winners.reduce((acc, r) => acc + r.amount, 0);
  const loseSum = losers.reduce((acc, r) => acc + r.amount, 0);

  return (
    <div className="flex items-stretch gap-2 text-xs">
      {open && (
        <>
          <MiniTable
            title="오늘 수익"
            rows={winners}
            total={winSum}
            colorClass="text-rose-600"
            headerBg="bg-rose-50"
          />
          <MiniTable
            title="오늘 손해"
            rows={losers}
            total={loseSum}
            colorClass="text-blue-600"
            headerBg="bg-blue-50"
          />
        </>
      )}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title={open ? "닫기" : "오늘 수익/손해 종목 보기"}
        className="bg-white border border-gray-300 rounded-lg shadow-md
                   px-3 py-2 flex flex-col items-center justify-center gap-0.5
                   hover:bg-gray-50 cursor-pointer tabular-nums whitespace-nowrap">
        <span className="text-gray-500 text-[11px] leading-tight">오늘</span>
        <div className="flex items-center gap-1 leading-tight">
          <span className="font-bold text-rose-600">{formatSigned(winSum)}</span>
          <span className="text-gray-300">/</span>
          <span className="font-bold text-blue-600">{formatSigned(loseSum)}</span>
        </div>
        <span className="text-gray-400 text-[10px] leading-none">
          {open ? "▶ 닫기" : "◀ 펼치기"}
        </span>
      </button>
    </div>
  );
}

interface MiniProps {
  title: string;
  rows: { ticker: string; name: string; amount: number }[];
  total: number;
  colorClass: string;
  headerBg: string;
}

function MiniTable({ title, rows, total, colorClass, headerBg }: MiniProps) {
  return (
    <div className="bg-white border border-gray-300 rounded-lg shadow-md
                    overflow-hidden min-w-[170px] max-w-[220px]
                    flex flex-col">
      <div className={`px-2 py-1 ${headerBg} ${colorClass} font-semibold
                        text-[11px] border-b border-gray-200 shrink-0`}>
        {title}
      </div>
      {rows.length === 0 ? (
        <div className="px-2 py-2 text-gray-400 text-[11px] flex-1">없음</div>
      ) : (
        <div className="flex-1 overflow-y-auto min-h-0">
          <table className="w-full tabular-nums">
            <tbody>
              {rows.map(r => (
                <tr key={r.ticker} className="border-b border-gray-100 last:border-0">
                  <td className="px-2 py-0.5 truncate max-w-[100px] text-gray-700">
                    {r.name}
                  </td>
                  <td className={`px-2 py-0.5 text-right font-medium ${colorClass}`}>
                    {formatSigned(r.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="px-2 py-1 border-t border-gray-300 bg-gray-50
                      flex justify-between items-baseline shrink-0">
        <span className="text-gray-500 text-[11px]">총액</span>
        <span className={`font-bold ${colorClass} tabular-nums`}>
          {formatSigned(total)}원
        </span>
      </div>
    </div>
  );
}
