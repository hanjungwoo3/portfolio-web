import type { Stock, Price } from "../types";
import { formatSigned, signColor, isEarlyMorningKst, isHoldingSleeping } from "../lib/format";

interface Props {
  holdings: Stock[];
  prices: Map<string, Price>;
}

// 합계는 매도 수수료 미적용 (raw 가격 × 주수). 데스크톱 v2 와 동일.
// 카드 개별 "전체수익" 은 FEE 적용 (매도 시 실수령액 추정) — 의도적 비대칭.

export function TotalRow({ holdings, prices }: Props) {
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
    const sleeping = isHoldingSleeping(p.trade_dt);
    if (sleeping && !showPrev) base = cur;
    totalInvested += s.shares * s.avg_price;
    totalCurrent += cur * s.shares;
    totalYesterday += base * s.shares;
    activeCount++;
  }

  if (activeCount === 0) return null;

  const pnl = totalCurrent - totalInvested;
  const pnlPct = totalInvested > 0 ? (pnl / totalInvested) * 100 : 0;
  const dayDiff = totalCurrent - totalYesterday;
  const dayPct = totalYesterday > 0 ? (dayDiff / totalYesterday) * 100 : 0;

  const totalColor = signColor(pnl) || "text-rose-700";

  return (
    <div className="sticky bottom-0 mt-3 w-fit bg-white border border-gray-300
                     rounded-lg shadow-md px-5 py-3
                     grid grid-cols-[auto_auto] gap-x-8 gap-y-1
                     text-sm leading-tight">
      {/* Row 1: 투자원금 (좌)  /  보유 합계 (우, 큰 빨강) */}
      <div className="text-gray-500">
        투자원금{" "}
        <span className="text-gray-800">
          {totalInvested.toLocaleString()}원
        </span>
      </div>
      <div className="text-right">
        <span className="text-gray-500 mr-2">보유 합계</span>
        <span className={`font-bold text-xl ${totalColor}`}>
          {totalCurrent.toLocaleString()}원
        </span>
      </div>

      {/* Row 2: 전체수익 (좌 라벨)  /  값+% (우) */}
      <div className="text-gray-500">전체수익</div>
      <div className={`text-right font-bold ${signColor(pnl)}`}>
        {formatSigned(pnl)} ({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%)
      </div>

      {/* Row 3: 어제대비 (좌 라벨)  /  값+% (우) */}
      <div className="text-gray-500">어제대비</div>
      <div className={`text-right font-bold ${signColor(dayDiff)}`}>
        {formatSigned(dayDiff)} ({dayPct >= 0 ? "+" : ""}{dayPct.toFixed(2)}%)
      </div>
    </div>
  );
}
