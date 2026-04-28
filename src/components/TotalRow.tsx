import type { Stock, Price } from "../types";
import { formatSigned, signColor, isEarlyMorningKst, nowKst } from "../lib/format";

interface Props {
  holdings: Stock[];
  prices: Map<string, Price>;
}

const SELL_FEE_PCT = 0.2;
const FEE_MUL = 1 - SELL_FEE_PCT / 100;

export function TotalRow({ holdings, prices }: Props) {
  const todayKst = nowKst().toISOString().slice(0, 10);
  const showPrev = isEarlyMorningKst();

  let totalInvested = 0;
  let totalCurrent = 0;
  let totalYesterday = 0;
  let activeCount = 0;

  for (const s of holdings) {
    if (s.shares <= 0) continue;
    const p = prices.get(s.ticker);
    if (!p) continue;
    const cur = p.price || s.avg_price;
    let base = p.base || cur;
    const sleeping = p.trade_date !== todayKst;
    if (sleeping && !showPrev) base = cur;  // 휴면 시 합계 기여 0 (새벽 제외)
    const net = cur * FEE_MUL;
    totalInvested += s.shares * s.avg_price;
    totalCurrent += Math.round(net * s.shares);
    totalYesterday += Math.round(base * FEE_MUL * s.shares);
    activeCount++;
  }

  if (activeCount === 0) return null;

  const pnl = totalCurrent - totalInvested;
  const pnlPct = totalInvested > 0 ? (pnl / totalInvested) * 100 : 0;
  const dayDiff = totalCurrent - totalYesterday;
  const dayPct = totalYesterday > 0 ? (dayDiff / totalYesterday) * 100 : 0;

  return (
    <div className="sticky bottom-0 mt-3 bg-white border border-gray-300
                     rounded-lg shadow-md p-4 grid grid-cols-2 gap-y-1
                     text-sm">
      {/* 좌: 매수가 / 현재가 */}
      <div>
        <span className="text-gray-500">매수가 </span>
        <span className="font-bold text-gray-900">
          {totalInvested.toLocaleString()}
        </span>
      </div>
      {/* 우: 어제보다 */}
      <div className="text-right">
        <span className="text-gray-500">어제보다 </span>
        <span className={`font-bold ${signColor(dayDiff)}`}>
          {formatSigned(dayDiff)}
        </span>
        <span className={signColor(dayDiff)}>
          {" "}({dayPct >= 0 ? "+" : ""}{dayPct.toFixed(2)}%)
        </span>
      </div>

      <div>
        <span className="text-gray-500">현재가 </span>
        <span className="font-bold text-gray-900">
          {totalCurrent.toLocaleString()}
        </span>
      </div>
      <div className="text-right">
        <span className="text-gray-500">전체수익 </span>
        <span className={`font-bold ${signColor(pnl)}`}>
          {formatSigned(pnl)}
        </span>
        <span className={signColor(pnl)}>
          {" "}({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%)
        </span>
      </div>
    </div>
  );
}
