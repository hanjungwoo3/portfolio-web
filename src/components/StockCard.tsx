import type { Stock, Price, Investor, Consensus } from "../types";
import { formatSigned, signColor, formatVolume, isEarlyMorningKst, nowKst } from "../lib/format";

interface Props {
  stock: Stock;
  price?: Price;
  investor?: Investor | null;
  consensus?: Consensus | null;
  sector?: string;
  peak?: number;
  warning?: string;
  loading?: boolean;
}

const SELL_FEE_PCT = 0.2;
const FEE_MUL = 1 - SELL_FEE_PCT / 100;

const FLOW_FIELDS: { label: string; key: keyof Investor }[] = [
  { label: "외국인보유", key: "외국인비율" },
  { label: "개인", key: "개인" },
  { label: "외국인", key: "외국인" },
  { label: "기관", key: "기관" },
  { label: "연기금", key: "연기금" },
  { label: "금융투자", key: "금융투자" },
  { label: "투신", key: "투신" },
  { label: "사모", key: "사모" },
  { label: "보험", key: "보험" },
  { label: "은행", key: "은행" },
  { label: "기타금융", key: "기타금융" },
  { label: "기타법인", key: "기타법인" },
];

const HIGHLIGHT_BG: Record<string, string> = {
  외국인: "bg-blue-50",
  기관: "bg-rose-50",
  연기금: "bg-rose-50/60",
};

// 강조 행 — 라벨/값 색상 강제 (이미지 매칭)
const HIGHLIGHT_LABEL_COLOR: Record<string, string> = {
  외국인: "text-blue-900",
  기관: "text-rose-700",
  연기금: "text-rose-700",
};
// 강조 행 — 폰트 사이즈 (외국인/기관은 한 단계 위, 연기금은 동일)
const HIGHLIGHT_SIZE: Record<string, string> = {
  외국인: "text-base font-bold",
  기관: "text-base font-bold",
  연기금: "text-sm font-medium",
};

const WARN_BG: Record<string, string> = {
  위험: "bg-red-700",
  관리: "bg-red-700",
  정지: "bg-gray-500",
  경고: "bg-orange-600",
  과열: "bg-orange-600",
  환기: "bg-orange-600",
  주의: "bg-amber-500",
};

export function StockCard({
  stock, price, investor, consensus, sector, peak, warning, loading,
}: Props) {
  if (loading || !price) {
    return (
      <article className="rounded-lg bg-white shadow-sm p-4 animate-pulse">
        <div className="h-6 bg-gray-200 rounded w-1/3 mb-2" />
        <div className="h-8 bg-gray-200 rounded w-1/2 mb-2" />
        <div className="h-4 bg-gray-200 rounded w-2/3" />
      </article>
    );
  }

  const todayKst = nowKst().toISOString().slice(0, 10);
  const sleeping = price.trade_date !== todayKst;
  const showPrev = isEarlyMorningKst();

  let dayDiff = price.price - price.base;
  let dayPct = price.base > 0 ? (dayDiff / price.base) * 100 : 0;
  if (sleeping && !showPrev) { dayDiff = 0; dayPct = 0; }

  const peakPct = peak && peak > 0 ? ((price.price - peak) / peak) * 100 : 0;
  const targetPct =
    consensus?.target && price.price > 0
      ? ((consensus.target - price.price) / price.price) * 100
      : 0;

  // 전체수익 (보유 종목만 — shares > 0)
  const hasPosition = stock.shares > 0 && stock.avg_price > 0;
  const netPrice = price.price * FEE_MUL;
  const pnl = hasPosition ? Math.round((netPrice - stock.avg_price) * stock.shares) : 0;
  const pnlPct = hasPosition ? ((netPrice - stock.avg_price) / stock.avg_price) * 100 : 0;

  // 카드 배경색 — 보유 종목의 손익에 따라 옅은 빨/파
  const cardBg =
    hasPosition && pnl > 0 ? "bg-rose-50/70 border-rose-200"
    : hasPosition && pnl < 0 ? "bg-blue-50/60 border-blue-200"
    : "bg-white border-gray-200";

  return (
    <article className={`rounded-lg border shadow-sm flex flex-row gap-3 px-3 py-2
                          ${cardBg}`}>
      {/* ───────── 좌측 ───────── */}
      <div className="basis-[42%] min-w-0 flex flex-col gap-0.5">
        {/* 헤더 */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center px-2.5 py-1 rounded-md
                            bg-yellow-200 text-gray-900 font-bold text-base leading-none">
            {sleeping && <span className="text-xs mr-1 opacity-70">z<sup>z</sup><sup>z</sup></span>}
            {stock.name}
            {stock.shares > 0 && (
              <span className="ml-1.5 text-sm font-bold">
                ({stock.shares.toLocaleString()}주)
              </span>
            )}
          </span>
          {warning && (
            <span className={`px-1.5 py-0.5 rounded text-white text-xs font-bold
                              ${WARN_BG[warning] ?? "bg-gray-500"}`}>
              {warning}
            </span>
          )}
          {sector && (
            <span className="text-xs text-gray-500">{sector}</span>
          )}
          <span className="ml-auto text-gray-300 text-xs cursor-help" title="자세히">ⓘ</span>
        </div>

        {/* 가격 + 거래량 */}
        <div className="flex items-baseline gap-2">
          <span className={`text-xl font-bold leading-tight ${signColor(dayDiff || -1)}`}>
            {price.price.toLocaleString()}원
          </span>
          {price.volume > 0 && (
            <span className="text-xs text-gray-400">
              ({formatVolume(price.volume)})
            </span>
          )}
        </div>

        {/* 매수가 + 피크가 (보유만) */}
        {hasPosition && (
          <div className="text-sm flex flex-wrap items-baseline gap-x-4">
            <span>
              <span className="text-gray-500">매수 </span>
              <span className="text-gray-700 font-medium">
                {stock.avg_price.toLocaleString()}원
              </span>
            </span>
            {peak && peak > 0 && (
              <span className="font-bold text-blue-800">
                피크 {peak.toLocaleString()}원
                <span className="ml-0.5">
                  ({peakPct >= 0 ? "+" : ""}{peakPct.toFixed(2)}%)
                </span>
              </span>
            )}
          </div>
        )}

        {/* 어제보다 */}
        <div className="text-sm">
          <span className="text-gray-500">어제보다 </span>
          {dayDiff !== 0 ? (
            <>
              <span className={`font-bold ${signColor(dayDiff)}`}>
                {formatSigned(dayDiff)}
                {stock.shares > 0 && ` / ${formatSigned(dayDiff * stock.shares)}`}
              </span>
              <span className={`font-bold ${signColor(dayDiff)}`}>
                {"  "}({dayPct >= 0 ? "+" : ""}{dayPct.toFixed(2)}%)
              </span>
            </>
          ) : (
            <span className="text-gray-400">—</span>
          )}
        </div>

        {/* 전체수익 (보유만) */}
        {hasPosition && (
          <div className="text-sm">
            <span className="text-gray-500">전체수익 </span>
            <span className={`font-bold ${signColor(pnl)}`}>
              {formatSigned(pnl)}
            </span>
            <span className={`font-bold ${signColor(pnl)}`}>
              {"  "}({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%)
            </span>
          </div>
        )}

        {/* 목표 */}
        {consensus?.target && (
          <div className="text-sm">
            <span className="text-gray-500">목표 </span>
            {typeof consensus.score === "number" && (
              <span className="text-gray-500">({consensus.score.toFixed(2)}) </span>
            )}
            <span className="font-bold text-gray-800">
              {consensus.target.toLocaleString()}
            </span>
            <span className={`ml-2 font-bold ${signColor(targetPct)}`}>
              ({targetPct >= 0 ? "+" : ""}{targetPct.toFixed(2)}%)
            </span>
          </div>
        )}
      </div>

      {/* ───────── 우측: 12 항목 그리드 ───────── */}
      <div className="flex-1 min-w-0 bg-white border border-gray-200 rounded-md
                       px-1.5 py-1 grid grid-cols-2 gap-x-2 gap-y-0
                       text-xs">
        {FLOW_FIELDS.map(({ label, key }) => {
          const raw = investor ? investor[key] : null;
          const isRatio = key === "외국인비율";
          const value =
            raw === null || raw === undefined ? "-"
            : isRatio
              ? `${(raw as number).toFixed(2)}%`
              : formatSigned(raw as number);
          const valueColor =
            isRatio ? "text-gray-800"
            : (raw === null || raw === undefined) ? "text-gray-400"
            // 강조 행: 라벨 색상으로 통일 (이미지 매칭)
            : HIGHLIGHT_LABEL_COLOR[label]
              ?? signColor(raw as number);
          const labelColor = HIGHLIGHT_LABEL_COLOR[label] ?? "text-gray-600";
          const sizeCls = HIGHLIGHT_SIZE[label] ?? "";
          const rowBg = HIGHLIGHT_BG[label] ?? "";
          return (
            <div
              key={label}
              className={`flex items-center justify-between gap-1 px-1 py-px rounded
                          ${rowBg} ${sizeCls}`}
            >
              <span className={`whitespace-nowrap shrink-0 ${labelColor}`}>
                {label}
              </span>
              <span className={`tabular-nums whitespace-nowrap ${valueColor}`}>
                {value}
              </span>
            </div>
          );
        })}
      </div>
    </article>
  );
}
