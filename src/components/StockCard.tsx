import type { Stock, Price } from "../types";
import { formatSigned, signColor, signBg, formatVolume, isEarlyMorningKst, nowKst } from "../lib/format";

interface Props {
  stock: Stock;
  price?: Price;
  loading?: boolean;
}

export function StockCard({ stock, price, loading }: Props) {
  if (loading || !price) {
    return (
      <article className="rounded-lg bg-white shadow-sm p-4 animate-pulse">
        <div className="h-6 bg-gray-200 rounded w-1/3 mb-2" />
        <div className="h-8 bg-gray-200 rounded w-1/2 mb-2" />
        <div className="h-4 bg-gray-200 rounded w-2/3" />
      </article>
    );
  }

  // 휴면 판정: trade_date != 오늘 KST → 오늘 체결 없음
  const todayKst = nowKst().toISOString().slice(0, 10);
  const sleeping = price.trade_date !== todayKst;
  const showPrev = isEarlyMorningKst();

  // 어제대비 — 새벽(00-08 KST)엔 휴면이어도 그제→어제 변동 보존
  let dayDiff = price.price - price.base;
  let dayPct = price.base > 0 ? (dayDiff / price.base) * 100 : 0;
  if (sleeping && !showPrev) {
    dayDiff = 0;
    dayPct = 0;
  }

  const totalDay = stock.shares > 0 ? dayDiff * stock.shares : 0;
  const fade = sleeping && !showPrev;  // 장마감 + 새벽 아니면 페이드

  return (
    <article
      className={`rounded-lg bg-white shadow-sm p-4 transition-opacity
                  ${fade ? "opacity-60" : ""}`}
    >
      {/* 헤더: 종목명 pill + (보유주수) */}
      <header className="flex items-center gap-2 mb-3">
        <span
          className={`px-2.5 py-1 rounded-full font-bold text-sm
                      ${signBg(dayDiff)} ${signColor(dayDiff)}`}
        >
          {sleeping ? "💤 " : ""}{stock.name}
          {stock.shares > 0 && (
            <span className="text-xs opacity-70 ml-1">
              ({stock.shares.toLocaleString()}주)
            </span>
          )}
        </span>
        <span className="text-xs text-gray-400">{stock.ticker}</span>
      </header>

      {/* 현재가 + 거래량 */}
      <div className="flex items-baseline gap-3 mb-2">
        <span className={`text-2xl font-bold ${signColor(dayDiff)}`}>
          {price.price.toLocaleString()}원
        </span>
        {price.volume > 0 && (
          <span className="text-xs text-gray-500">
            {formatVolume(price.volume)}
          </span>
        )}
      </div>

      {/* 어제보다 +per_share / +total (pct%) */}
      <div className="text-sm">
        <span className="text-gray-500">어제보다 </span>
        {dayDiff !== 0 ? (
          <>
            <span className={`font-bold ${signColor(dayDiff)}`}>
              {formatSigned(dayDiff)}
              {stock.shares > 0 && ` / ${formatSigned(totalDay)}`}
            </span>
            <span className={signColor(dayDiff)}>
              {" "}({dayPct >= 0 ? "+" : ""}{dayPct.toFixed(2)}%)
            </span>
          </>
        ) : (
          <span className="text-gray-400">—</span>
        )}
      </div>

      {/* 전일 / 시초가 (디버그용 PoC 표시) */}
      <div className="text-xs text-gray-400 mt-2">
        전일 {price.base.toLocaleString()} · 시초 {price.open.toLocaleString()} · {price.trade_date}
      </div>
    </article>
  );
}
