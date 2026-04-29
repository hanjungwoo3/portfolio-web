import type { Stock, Price } from "../types";
import { formatSigned, signColor, formatVolume, isHoldingSleeping } from "../lib/format";

// 모바일 종목 카드 — 데스크톱 StockCard 의 가격 + 통계 박스만 (투자자 동향 X)
// 폰트 모두 작게.

interface Props {
  stock: Stock;
  price?: Price;
  peak?: number;
  sector?: string;
}

const SELL_FEE_PCT = 0.2;
const FEE_MUL = 1 - SELL_FEE_PCT / 100;
const STOP_LOSS_PCT = -9;
const TRAILING_STOP_PCT = -9;

function openTossStock(ticker: string) {
  if (!/^\d{6}$/.test(ticker)) return;
  window.open(`https://tossinvest.com/stocks/A${ticker}`, "_blank", "noopener");
}

export function MobileStockCard({ stock, price, peak, sector }: Props) {
  if (!price) {
    return (
      <article className="rounded-lg bg-white border border-gray-200 p-2 animate-pulse">
        <div className="h-3 bg-gray-200 rounded w-1/3 mb-1" />
        <div className="h-4 bg-gray-200 rounded w-1/2" />
      </article>
    );
  }

  const sleeping = isHoldingSleeping(price.trade_dt);
  const dayDiff = price.price - price.base;
  const dayPct = price.base > 0 ? (dayDiff / price.base) * 100 : 0;
  const peakPct = peak && peak > 0 ? ((price.price - peak) / peak) * 100 : 0;
  const hasPosition = stock.shares > 0 && stock.avg_price > 0;
  const netPrice = price.price * FEE_MUL;
  const pnl = hasPosition ? Math.round((netPrice - stock.avg_price) * stock.shares) : 0;
  const pnlPct = hasPosition ? ((netPrice - stock.avg_price) / stock.avg_price) * 100 : 0;
  const isStop = hasPosition && pnlPct <= STOP_LOSS_PCT;
  const peakedAboveBuy = !!(peak && stock.avg_price && peak > stock.avg_price);
  const isPeakDrop = hasPosition && peakedAboveBuy
                       && peakPct <= TRAILING_STOP_PCT
                       && Math.abs(peakPct) >= 0.01;

  // 카드 배경 — 손익에 따라
  const cardBg =
    hasPosition && pnl > 0 ? "bg-rose-50/70 border-rose-200"
    : hasPosition && pnl < 0 ? "bg-blue-50/60 border-blue-200"
    : "bg-white border-gray-200";

  return (
    <article className={`rounded-lg border flex flex-row gap-1.5 p-1.5
                          ${cardBg} ${sleeping ? "opacity-60" : ""}`}>
      {/* 좌측 — 가격 박스 (50%) */}
      <div className="basis-1/2 min-w-0 border border-gray-200 rounded
                       bg-gray-50/60 px-1.5 py-1 flex flex-col justify-center
                       space-y-0.5">
        {/* 종목명 + 보유 수량 */}
        <button onClick={() => openTossStock(stock.ticker)}
                title="토스에서 보기"
                className={`inline-flex items-center px-1.5 py-0.5 rounded
                            font-bold text-xs leading-none w-fit
                            bg-yellow-200 ${signColor(dayDiff || -1)}`}>
          {sleeping && <span className="text-[8px] mr-0.5 opacity-70">zZ</span>}
          {stock.name}
          {stock.shares > 0 && (
            <span className="ml-1 text-[10px] font-bold">
              ({stock.shares.toLocaleString()}주)
            </span>
          )}
        </button>

        {/* 고가 */}
        {price.high && price.high > 0 && (() => {
          const hi = price.high;
          const hiDiff = price.price - hi;
          const hiPct = (hiDiff / hi) * 100;
          return (
            <div className="text-[10px] text-gray-700">
              <span className="text-gray-500">고 </span>
              {hi.toLocaleString()}
              <span className={`ml-0.5 ${signColor(hiDiff)}`}>
                ({formatSigned(hiDiff)}, {hiPct >= 0 ? "+" : ""}{hiPct.toFixed(2)}%)
              </span>
            </div>
          );
        })()}

        {/* 현재가 + 거래량 */}
        <div className="flex items-baseline gap-1">
          <span className={`text-base font-bold leading-tight ${signColor(dayDiff || -1)}`}>
            {price.price.toLocaleString()}원
          </span>
          {price.volume > 0 && (
            <span className="text-[9px] text-gray-400">
              ({formatVolume(price.volume)})
            </span>
          )}
        </div>

        {/* 저가 */}
        {price.low && price.low > 0 && (() => {
          const lo = price.low;
          const loDiff = price.price - lo;
          const loPct = (loDiff / lo) * 100;
          return (
            <div className="text-[10px] text-gray-700">
              <span className="text-gray-500">저 </span>
              {lo.toLocaleString()}
              <span className={`ml-0.5 ${signColor(loDiff)}`}>
                ({formatSigned(loDiff)}, {loPct >= 0 ? "+" : ""}{loPct.toFixed(2)}%)
              </span>
            </div>
          );
        })()}
      </div>

      {/* 우측 — 통계 박스 (50%) */}
      <div className="basis-1/2 min-w-0 border border-gray-200 rounded
                       bg-gray-50/60 px-1.5 py-1 space-y-0.5
                       flex flex-col justify-start">
        {sector && (
          <div className="text-[10px] text-gray-500 truncate">{sector}</div>
        )}

        {hasPosition && (
          <div className="text-[10px] flex flex-wrap items-baseline gap-x-2">
            <span>
              <span className="text-gray-500">매수 </span>
              <span className="text-gray-700 font-medium">
                {stock.avg_price.toLocaleString()}원
              </span>
            </span>
            {peak && peak > price.price && (
              <span className="text-gray-700 font-medium">
                <span className="text-gray-500">피크 </span>
                {peak.toLocaleString()}원{" "}
                (<span className={`rounded px-0.5
                                   ${isPeakDrop ? "bg-blue-600 text-white font-bold" : ""}`}>
                  {peakPct.toFixed(2)}%
                </span>)
              </span>
            )}
          </div>
        )}

        {/* 어제보다 */}
        {dayDiff !== 0 && (
          <div className="text-[10px]">
            <span className="text-gray-500">어제보다 </span>
            <span className={`font-bold text-xs ${signColor(dayDiff)}`}>
              {formatSigned(dayDiff)}
            </span>
            {stock.shares > 0 && (
              <span className={signColor(dayDiff)}>
                {" / "}{formatSigned(dayDiff * stock.shares)}
              </span>
            )}{" "}
            <span className={`font-bold text-xs ${signColor(dayDiff)}`}>
              ({dayPct >= 0 ? "+" : ""}{dayPct.toFixed(2)}%)
            </span>
          </div>
        )}

        {/* 전체수익 (보유 시) */}
        {hasPosition && (
          <div className="text-[10px]">
            <span className="text-gray-500">전체수익 </span>
            <span className={signColor(pnl)}>{formatSigned(pnl)}</span>{" "}
            <span className={signColor(pnl)}>(</span>
            <span className={`font-bold rounded px-0.5
                              ${isStop ? "bg-rose-600 text-white"
                                : signColor(pnl)}`}>
              {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%
            </span>
            <span className={signColor(pnl)}>)</span>
          </div>
        )}
      </div>
    </article>
  );
}
