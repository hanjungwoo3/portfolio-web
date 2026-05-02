import type { Stock, Price } from "../types";
import { formatSigned, signColor, formatVolume, isHoldingSleeping } from "../lib/format";
import { getDimSleepingEnabled } from "../lib/proxyConfig";
import { Sparkline } from "./Sparkline";

// 모바일 종목 카드 — 데스크톱 StockCard 의 가격 + 통계 박스만 (투자자 동향 X)
// 폰트 모두 작게.

interface Props {
  stock: Stock;
  price?: Price;
  peak?: number;
  sector?: string;
  warning?: string;
  chart?: number[];   // 비거래일 sparkline 용 일봉 종가 시계열
  target?: number;    // 컨센서스 목표가 — sparkline 가로선용
  onEdit?: (stock: Stock) => void;
  onDelete?: (stock: Stock) => void;
}

const STOP_LOSS_PCT = -9;
const TRAILING_STOP_PCT = -9;

// 위험/관리/정지/경고/과열/환기/주의 뱃지 색상 (PC StockCard 동일)
const WARN_BG: Record<string, string> = {
  투자위험:     "bg-red-700",
  관리종목:     "bg-red-700",
  거래정지:     "bg-gray-500",
  투자경고:     "bg-orange-600",
  공매도과열:   "bg-orange-600",
  단기과열:     "bg-orange-600",
  투자주의환기: "bg-orange-600",
  투자주의:     "bg-amber-500",
};
const WARN_PILL_BG: Record<string, string> = {
  투자위험:     "bg-rose-200",
  관리종목:     "bg-rose-200",
  거래정지:     "bg-gray-300",
  투자경고:     "bg-orange-200",
  공매도과열:   "bg-orange-200",
  단기과열:     "bg-orange-200",
  투자주의환기: "bg-orange-200",
  투자주의:     "bg-amber-200",
};

function openTossStock(ticker: string) {
  if (!/^\d{6}$/.test(ticker)) return;
  const code = `A${ticker}`;
  const inner = `https://service.tossinvest.com?nextLandingUrl=/stocks/${code}`;
  const deep = `supertoss://securities?url=${encodeURIComponent(inner)}`;
  const https = `https://tossinvest.com/stocks/${code}`;

  // 모바일: 토스 앱 deeplink 우선 (Android Intent / iOS scheme),
  // 1.2초 내 visibilityState 가 그대로면 https 새 탭으로 폴백
  if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    location.href = deep;
    setTimeout(() => {
      if (document.visibilityState === "visible") {
        window.open(https, "_blank", "noopener,noreferrer");
      }
    }, 1200);
  } else {
    window.open(https, "_blank", "noopener,noreferrer");
  }
}

export function MobileStockCard({
  stock, price, peak, sector, warning, chart, target, onEdit, onDelete,
}: Props) {
  if (!price) {
    return (
      <article className="rounded-lg bg-white border border-gray-200 p-2 animate-pulse">
        <div className="h-3 bg-gray-200 rounded w-1/3 mb-1" />
        <div className="h-4 bg-gray-200 rounded w-1/2" />
      </article>
    );
  }

  const sleeping = isHoldingSleeping(price.trade_dt);
  const dimmed = sleeping && getDimSleepingEnabled();
  const dayDiff = price.price - price.base;
  const dayPct = price.base > 0 ? (dayDiff / price.base) * 100 : 0;
  // 색 결정용 — 직전 거래일 종가 대비 (장마감 기준)
  // (sparkline 색은 차트 자체 추세로 별도 자동 판정)
  const colorDiff = price.price - (price.prevClose || price.price);
  const priceColorCls =
    colorDiff > 0 ? "text-rose-600"
    : colorDiff < 0 ? "text-blue-600"
    : "text-gray-900";
  const peakPct = peak && peak > 0 ? ((price.price - peak) / peak) * 100 : 0;
  const hasPosition = stock.shares > 0 && stock.avg_price > 0;
  const pnl = hasPosition ? Math.round((price.price - stock.avg_price) * stock.shares) : 0;
  const pnlPct = hasPosition ? ((price.price - stock.avg_price) / stock.avg_price) * 100 : 0;
  const isStop = hasPosition && pnlPct <= STOP_LOSS_PCT;
  const peakedAboveBuy = !!(peak && stock.avg_price && peak > stock.avg_price);
  const isPeakDrop = hasPosition && peakedAboveBuy
                       && peakPct <= TRAILING_STOP_PCT
                       && Math.abs(peakPct) >= 0.01;

  // 카드 배경/테두리 — 손익에 따라 (책갈피 pill 도 동일 색 사용해 하나처럼 보이게)
  const cardBg =
    hasPosition && pnl > 0 ? "bg-rose-50/70"
    : hasPosition && pnl < 0 ? "bg-blue-50/60"
    : "bg-white";
  const cardBorder =
    hasPosition && pnl > 0 ? "border-rose-200"
    : hasPosition && pnl < 0 ? "border-blue-200"
    : "border-gray-200";

  return (
    <div className={dimmed ? "opacity-60" : ""}>
      {/* 책갈피 — 좌: 종목명 pill + 위험 뱃지 / 우: 수정·삭제 버튼 + 섹터 */}
      <div className="flex items-end justify-between gap-1 mx-2">
        <div className="flex items-end gap-0.5 flex-wrap min-w-0">
          {warning && (
            <span className={`inline-flex items-center px-2 py-0.5 rounded-t-md
                              text-white text-base font-bold leading-none
                              ${WARN_BG[warning] ?? "bg-gray-500"}`}>
              {warning}
            </span>
          )}
          <button onClick={() => openTossStock(stock.ticker)}
                  title="토스에서 보기"
                  className={`inline-flex items-center px-2 py-0.5 rounded-t-md
                              border-t border-l border-r ${cardBorder}
                              font-bold text-base leading-none w-fit
                              ${warning ? (WARN_PILL_BG[warning] ?? cardBg) : cardBg}
                              ${priceColorCls}`}>
            {sleeping && <span className="text-[10px] mr-0.5 opacity-70">zZ</span>}
            {stock.name}
            {stock.shares > 0 && (
              <span className="ml-1 text-sm font-bold">
                ({stock.shares.toLocaleString()}주)
              </span>
            )}
          </button>
        </div>
        <div className="flex items-end gap-1 shrink-0">
          {onEdit && (
            <button onClick={() => onEdit(stock)}
                    title="수정 / 매수 / 매도"
                    className="px-2 py-1 rounded bg-gray-100 hover:bg-gray-200
                               text-xs leading-none">
              ✏️
            </button>
          )}
          {onDelete && (
            <button onClick={() => onDelete(stock)}
                    title="삭제 (모든 그룹에서 제거)"
                    className="px-2 py-1 rounded bg-gray-100 hover:bg-rose-100
                               text-xs leading-none">
              🗑
            </button>
          )}
          {sector && (
            <span className={`inline-flex items-center px-2 py-0.5 rounded-t-md
                              border-t border-l border-r ${cardBorder}
                              ${cardBg} text-[11px] text-gray-600 leading-none`}>
              {sector}
            </span>
          )}
        </div>
      </div>

      {/* 카드 본체 — 좌우 박스 (50:50) */}
      <article className={`rounded-lg border flex flex-row gap-1.5 p-1.5 ${cardBg} ${cardBorder}`}>
      {/* 좌측 — 가격 박스 (50%). 비거래일엔 sparkline 워터마크 */}
      <div className="relative overflow-hidden basis-1/2 min-w-0 border border-gray-200
                       rounded bg-gray-50/60 px-2 py-1.5 flex flex-col justify-center
                       space-y-0.5">
        {/* 비거래일 — 3개월 추이 차트가 박스 배경. 색은 차트 자체 추세 */}
        {!price.high && chart && chart.length > 1 && (
          <Sparkline data={chart} width={300} height={70}
                     target={target}
                     avgPrice={hasPosition ? stock.avg_price : undefined}
                     className="absolute inset-0 w-full h-full opacity-50
                                pointer-events-none" />
        )}
        {/* 고가 */}
        {price.high && price.high > 0 && (() => {
          const hi = price.high;
          const hiDiff = price.price - hi;
          const hiPct = (hiDiff / hi) * 100;
          return (
            <div className="text-sm text-gray-700">
              <span className="text-gray-500">고 </span>
              {hi.toLocaleString()}
              <span className={`ml-0.5 text-xs ${signColor(hiDiff)}`}>
                ({formatSigned(hiDiff)}, {hiPct >= 0 ? "+" : ""}{hiPct.toFixed(2)}%)
              </span>
            </div>
          );
        })()}

        {/* 현재가 + 거래량 */}
        <div className="relative z-10 flex items-baseline gap-1">
          <span className={`text-xl font-bold leading-tight ${priceColorCls}`}>
            {price.price.toLocaleString()}원
          </span>
          {price.volume > 0 && (
            <span className="text-xs text-gray-400">
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
            <div className="text-sm text-gray-700">
              <span className="text-gray-500">저 </span>
              {lo.toLocaleString()}
              <span className={`ml-0.5 text-xs ${signColor(loDiff)}`}>
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
        {hasPosition && (
          <div className="text-[10px] flex flex-wrap items-baseline gap-x-2">
            <span>
              <span className="text-gray-500">매수 </span>
              <span className="text-gray-700 font-medium">
                {Math.round(stock.avg_price).toLocaleString()}원
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

        {/* 어제보다 — 1주 금액 + % (총금액 제외) */}
        {dayDiff !== 0 && (
          <div className="text-[10px]">
            <span className="text-gray-500">어제보다 </span>
            <span className={`font-bold text-sm ${signColor(dayDiff)}`}>
              {formatSigned(dayDiff)}
            </span>{" "}
            <span className={`font-bold text-base ${signColor(dayDiff)}`}>
              ({dayPct >= 0 ? "+" : ""}{dayPct.toFixed(2)}%)
            </span>
          </div>
        )}

        {/* 전체수익 — 자연 흐름 (PC 동일) */}
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
    </div>
  );
}
