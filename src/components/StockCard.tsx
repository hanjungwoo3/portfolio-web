import type { Stock, Price, Investor, Consensus } from "../types";
import { formatSigned, signColor, formatVolume, isEarlyMorningKst, nowKst } from "../lib/format";

interface Props {
  stock: Stock;
  price?: Price;
  investor?: Investor | null;
  consensus?: Consensus | null;
  sector?: string;
  peak?: number;
  loading?: boolean;
}

// 우측 12 항목 그리드 (데스크톱 v2 RIGHT_FIELDS 동일 순서)
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
  외국인: "bg-blue-50",      // 음수든 양수든 외국인 행은 옅은 파랑
  기관: "bg-rose-50",        // 기관 행은 옅은 빨강
  연기금: "bg-rose-50/60",   // 연기금은 더 옅은 빨강
};

const HIGHLIGHT_BOLD = new Set(["외국인", "기관"]);

export function StockCard({
  stock, price, investor, consensus, sector, peak, loading,
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

  return (
    <article className="rounded-lg bg-white border border-gray-200 shadow-sm
                         flex flex-row gap-3 p-4 min-h-[180px]">
      {/* ───────── 좌측: 메인 정보 ───────── */}
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        {/* 헤더: pill + 섹터 + info */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center px-2.5 py-1 rounded-md
                            bg-yellow-200 text-gray-900 font-bold text-base leading-none">
            {sleeping && <span className="text-xs mr-1 opacity-70">z<sup>z</sup><sup>z</sup></span>}
            {stock.name}
          </span>
          {sector && (
            <span className="text-xs text-gray-500">{sector}</span>
          )}
          <span className="ml-auto text-gray-300 text-xs cursor-help" title="자세히">ⓘ</span>
        </div>

        {/* 가격 + 거래량 */}
        <div className="flex items-baseline gap-2 mt-1">
          <span className={`text-2xl font-bold ${signColor(dayDiff || -1)}`}>
            {price.price.toLocaleString()}원
          </span>
          {price.volume > 0 && (
            <span className="text-xs text-gray-400">
              ({formatVolume(price.volume)})
            </span>
          )}
        </div>

        {/* 피크가 (보유 종목만) */}
        {peak && peak > 0 && stock.shares > 0 && (
          <div className="text-sm font-bold text-blue-800">
            피크 {peak.toLocaleString()}원
            <span className="ml-1">
              ({peakPct >= 0 ? "+" : ""}{peakPct.toFixed(2)}%)
            </span>
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
              <span className={signColor(dayDiff)}>
                {"  "}({dayPct >= 0 ? "+" : ""}{dayPct.toFixed(2)}%)
              </span>
            </>
          ) : (
            <span className="text-gray-400">—</span>
          )}
        </div>

        {/* 목표 */}
        {consensus?.target && (
          <div className="text-sm mt-1">
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
      <div className="w-[52%] border border-gray-200 rounded-md p-2 grid grid-cols-2 gap-x-1 text-sm">
        {FLOW_FIELDS.map(({ label, key }) => {
          const raw = investor ? investor[key] : null;
          const isRatio = key === "외국인비율";
          const value =
            raw === null || raw === undefined ? "-"
            : isRatio
              ? `${(raw as number).toFixed(2)}%`
              : formatSigned(raw as number);
          const numColor =
            isRatio ? "text-gray-700"
            : (raw === null || raw === undefined) ? "text-gray-400"
            : signColor(raw as number);
          const bold = HIGHLIGHT_BOLD.has(label);
          const rowBg = HIGHLIGHT_BG[label] ?? "";
          return (
            <div
              key={label}
              className={`flex items-center justify-between px-1.5 py-0.5 rounded
                          ${rowBg} ${bold ? "font-bold" : ""}`}
            >
              <span className="text-gray-600 text-xs">{label}</span>
              <span className={`tabular-nums ${numColor} ${bold ? "text-base" : "text-sm"}`}>
                {value}
              </span>
            </div>
          );
        })}
      </div>
    </article>
  );
}
