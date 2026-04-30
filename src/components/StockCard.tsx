import { useEffect, useState } from "react";
import type { Stock, Price, Investor, Consensus } from "../types";
import { formatSigned, signColor, formatVolume, isHoldingSleeping } from "../lib/format";
import { getDimSleepingEnabled } from "../lib/proxyConfig";

interface Props {
  stock: Stock;
  price?: Price;
  investor?: Investor | null;
  investorHistory?: Investor[] | null;   // 60일 수급 (신호 계산용)
  consensus?: Consensus | null;
  sector?: string;
  peak?: number;
  warning?: string;
  loading?: boolean;
  onOpenValuation?: (ticker: string) => void;
  onEdit?: (stock: Stock) => void;
  onDelete?: (stock: Stock) => void;
}

// 신호 — 최근 5거래일 + 외인비율 20일 추세
interface InvestorSignal {
  primary?: { label: string; tone: "bull" | "bear" | "warn" };
  secondary?: { label: string; tone: "up" | "down" };
}
function computeSignal(history: Investor[] | null | undefined): InvestorSignal | null {
  if (!history || history.length < 3) return null;
  const last5 = history.slice(0, Math.min(5, history.length));
  let bothBuy = 0, support = 0, bothSell = 0;
  for (const d of last5) {
    if (d.외국인 > 0 && d.기관 > 0) bothBuy += 1;
    if (d.외국인 < 0 && d.개인 > 0) support += 1;
    if (d.외국인 < 0 && d.기관 < 0) bothSell += 1;
  }
  let primary: InvestorSignal["primary"];
  if (bothBuy >= 3) primary = { label: `외인+기관 매수 ${bothBuy}일`, tone: "bull" };
  else if (support >= 3) primary = { label: `개인 떠받치기 ${support}일`, tone: "bear" };
  else if (bothSell >= 3) primary = { label: `외인+기관 매도 ${bothSell}일`, tone: "warn" };

  let secondary: InvestorSignal["secondary"];
  if (history.length >= 20) {
    const today = history[0].외국인비율;
    const past = history[19].외국인비율;
    const delta = today - past;
    if (Math.abs(delta) >= 0.3) {
      secondary = {
        label: `외인비율 ${delta > 0 ? "+" : ""}${delta.toFixed(2)}%p (20일)`,
        tone: delta > 0 ? "up" : "down",
      };
    }
  }
  if (!primary && !secondary) return null;
  return { primary, secondary };
}

const SIGNAL_TONE: Record<string, string> = {
  bull: "bg-emerald-100 text-emerald-700 border-emerald-300",
  bear: "bg-rose-100 text-rose-700 border-rose-300",
  warn: "bg-amber-100 text-amber-700 border-amber-300",
  up:   "bg-blue-50 text-blue-700 border-blue-200",
  down: "bg-orange-50 text-orange-700 border-orange-200",
};
const SIGNAL_ICON: Record<string, string> = {
  bull: "🟢", bear: "🔴", warn: "⚠️", up: "📈", down: "📉",
};

function openTossStock(ticker: string) {
  if (!/^\d{6}$/.test(ticker)) return;
  location.href = `https://tossinvest.com/stocks/A${ticker}`;
}


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

// 강조 행 (외국인/기관/연기금) — 라벨/배경/값 색은 부호에 따라 동적 결정
const HIGHLIGHT_LABELS = new Set(["외국인", "기관", "연기금"]);

// 강조 행 폰트 사이즈
const HIGHLIGHT_SIZE: Record<string, string> = {
  외국인: "text-xs font-bold",
  기관: "text-xs font-bold",
  연기금: "text-[11px] font-medium",
};

function highlightStyles(value: number): { bg: string; color: string } {
  if (value > 0) return { bg: "bg-rose-50", color: "text-rose-700" };
  if (value < 0) return { bg: "bg-blue-50", color: "text-blue-800" };
  return { bg: "", color: "text-gray-500" };
}

const WARN_BG: Record<string, string> = {
  위험: "bg-red-700",
  관리: "bg-red-700",
  정지: "bg-gray-500",
  경고: "bg-orange-600",
  공매: "bg-orange-600",
  과열: "bg-orange-600",
  환기: "bg-orange-600",
  주의: "bg-amber-500",
};

// 경고 뱃지가 있으면 pill 배경도 변경 (옅은 톤)
const WARN_PILL_BG: Record<string, string> = {
  위험: "bg-rose-200",
  관리: "bg-rose-200",
  정지: "bg-gray-300",
  경고: "bg-orange-200",
  공매: "bg-orange-200",
  과열: "bg-orange-200",
  환기: "bg-orange-200",
  주의: "bg-amber-200",
};

// 손절/트레일링 임계값 (데스크톱 v2 기본 -9.0%)
const STOP_LOSS_PCT = -9;
const TRAILING_STOP_PCT = -9;

// 직전 틱 대비 화살표 — 데스크톱 v2 동일 (첫 전환 속빈, 연속 속찬)
type TickDir = "up" | "down" | undefined;
interface TickState { lastPrice?: number; dir: TickDir; arrow: string }
const TICK_INIT: TickState = { dir: undefined, arrow: "" };

export function StockCard({
  stock, price, investor, investorHistory, consensus, sector, peak, warning, loading,
  onOpenValuation, onEdit, onDelete,
}: Props) {
  const [tick, setTick] = useState<TickState>(TICK_INIT);

  useEffect(() => {
    const cur = price?.price;
    if (!cur) return;
    setTick(prev => {
      if (prev.lastPrice === undefined) {
        return { lastPrice: cur, dir: undefined, arrow: "" };
      }
      if (cur > prev.lastPrice) {
        return {
          lastPrice: cur, dir: "up",
          arrow: prev.dir === "up" ? "▲ " : "▵ ",
        };
      }
      if (cur < prev.lastPrice) {
        return {
          lastPrice: cur, dir: "down",
          arrow: prev.dir === "down" ? "▼ " : "▽ ",
        };
      }
      return prev;  // 변동 없음 — 화살표 그대로 유지
    });
  }, [price?.price]);

  if (loading || !price) {
    return (
      <article className="rounded-lg bg-white shadow-sm p-4 animate-pulse">
        <div className="h-6 bg-gray-200 rounded w-1/3 mb-2" />
        <div className="h-8 bg-gray-200 rounded w-1/2 mb-2" />
        <div className="h-4 bg-gray-200 rounded w-2/3" />
      </article>
    );
  }

  // 보유 종목 sleeping — 데스크톱 v2 kr_session_phase 기반
  // (정규장 활성 / EXTENDED 시간 + 마지막 체결 10분 초과 → sleeping / CLOSED → sleeping)
  const sleeping = isHoldingSleeping(price.trade_dt);
  const dimmed = sleeping && getDimSleepingEnabled();

  // 어제보다 — 장마감 후에도 유효 (당일 종가 vs 어제 종가). 다음 장 시작 전까지 유지.
  const dayDiff = price.price - price.base;
  const dayPct = price.base > 0 ? (dayDiff / price.base) * 100 : 0;

  const peakPct = peak && peak > 0 ? ((price.price - peak) / peak) * 100 : 0;
  const targetPct =
    consensus?.target && price.price > 0
      ? ((consensus.target - price.price) / price.price) * 100
      : 0;

  // 전체수익 (보유 종목만 — shares > 0)
  const hasPosition = stock.shares > 0 && stock.avg_price > 0;
  const pnl = hasPosition ? Math.round((price.price - stock.avg_price) * stock.shares) : 0;
  const pnlPct = hasPosition ? ((price.price - stock.avg_price) / stock.avg_price) * 100 : 0;

  // 손절 — 매수가 대비 -10% 이하 (보유 종목만)
  const isStop = hasPosition && pnlPct <= STOP_LOSS_PCT;
  // 트레일링 — 피크가 매수가 위로 오른 적 있고, 피크 대비 -10% 이하
  const peakedAboveBuy = !!(peak && stock.avg_price && peak > stock.avg_price);
  const isPeakDrop = hasPosition && peakedAboveBuy
                       && peakPct <= TRAILING_STOP_PCT
                       && Math.abs(peakPct) >= 0.01;

  // 카드 배경색/테두리 — 보유 종목의 손익에 따라 옅은 빨/파
  // (책갈피 pill 도 동일 색 사용 — 하나처럼 보임)
  const cardBg =
    hasPosition && pnl > 0 ? "bg-rose-50/70"
    : hasPosition && pnl < 0 ? "bg-blue-50/60"
    : "bg-white";
  const cardBorder =
    hasPosition && pnl > 0 ? "border-rose-200"
    : hasPosition && pnl < 0 ? "border-blue-200"
    : "border-gray-200";

  const sig = computeSignal(investorHistory);

  return (
    <div className={`group ${dimmed ? "opacity-60" : ""}`}>
      {/* 책갈피 — 종목명 + 섹터 + 위험 (좌) / 신호 + hover 버튼 (우) — 모두 책갈피 통일 */}
      <div className="flex items-end justify-between gap-1 ml-2">
        <div className="flex items-end gap-0.5 flex-wrap min-w-0">
          <button
            type="button"
            onClick={() => openTossStock(stock.ticker)}
            title="토스에서 보기"
            className={`inline-flex items-center px-2 py-0.5 rounded-t-md
                        border-t border-l border-r ${cardBorder}
                        font-bold text-sm leading-none cursor-pointer
                        hover:brightness-95 transition
                        ${warning ? (WARN_PILL_BG[warning] ?? cardBg) : cardBg}
                        ${signColor(dayDiff || -1)}`}>
            {sleeping && <span className="text-[10px] mr-1 opacity-70">z<sup>z</sup><sup>z</sup></span>}
            {stock.name}
            {stock.shares > 0 && (
              <span className="ml-1 text-xs font-bold">
                ({stock.shares.toLocaleString()}주)
              </span>
            )}
          </button>
          {sector && (
            <span className={`inline-flex items-center px-2 py-0.5 rounded-t-md
                              border-t border-l border-r border-gray-300
                              bg-white text-xs text-gray-600 leading-none`}>
              {sector}
            </span>
          )}
          {warning && (
            <span className={`inline-flex items-center px-2 py-0.5 rounded-t-md
                              text-white text-[10px] font-bold leading-none
                              ${WARN_BG[warning] ?? "bg-gray-500"}`}>
              {warning}
            </span>
          )}
        </div>
        <div className="flex items-end gap-0.5 shrink-0">
          {/* 수급 신호 — 외인+기관 동반매수 / 개인 떠받치기 / 외인비율 추세 */}
          {sig?.primary && (
            <span className={`inline-flex items-center gap-0.5 px-2 py-0.5
                              rounded-t-md border-t border-l border-r
                              text-[10px] font-bold leading-none
                              ${SIGNAL_TONE[sig.primary.tone]}`}>
              {SIGNAL_ICON[sig.primary.tone]} {sig.primary.label}
            </span>
          )}
          {sig?.secondary && (
            <span className={`inline-flex items-center gap-0.5 px-2 py-0.5
                              rounded-t-md border-t border-l border-r
                              text-[10px] leading-none
                              ${SIGNAL_TONE[sig.secondary.tone]}`}>
              {SIGNAL_ICON[sig.secondary.tone]} {sig.secondary.label}
            </span>
          )}
          {/* hover 버튼 — 📊 ✏️ 🗑 */}
          {onOpenValuation && /^\d{6}$/.test(stock.ticker) && (
            <button
              type="button"
              onClick={() => onOpenValuation(stock.ticker)}
              title="기업가치 보기"
              className="opacity-0 group-hover:opacity-60 hover:!opacity-100
                         text-xs leading-none px-0.5 transition-opacity">
              📊
            </button>
          )}
          {onEdit && (
            <button
              type="button"
              onClick={() => onEdit(stock)}
              title="수정"
              className="opacity-0 group-hover:opacity-60 hover:!opacity-100
                         text-xs leading-none px-0.5 transition-opacity">
              ✏️
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={() => {
                if (confirm(`${stock.name} 을(를) ${stock.account || "보유"}에서 삭제할까요?`)) {
                  onDelete(stock);
                }
              }}
              title="삭제"
              className="opacity-0 group-hover:opacity-60 hover:!opacity-100
                         text-xs leading-none px-0.5 transition-opacity">
              🗑
            </button>
          )}
        </div>
      </div>

      {/* 카드 본체 — 가격박스 / 통계박스 / 투자자 그리드 */}
      <article className={`rounded-lg border shadow-sm flex flex-row gap-2
                            items-stretch px-3 py-2
                            ${cardBg} ${cardBorder}
                            transition-opacity`}>
        {/* 가격 박스 — 고/현재가/저 (3/10) */}
        <div className="border border-gray-200 rounded-md bg-gray-50/60
                        px-2 py-1 space-y-0.5 basis-[30%] min-w-0
                        flex flex-col justify-center">
          {price.high && price.high > 0 && (() => {
            const hi = price.high;
            const hiDiff = price.price - hi;
            const hiPct = (hiDiff / hi) * 100;
            return (
              <div className="text-xs text-gray-700">
                <span className="text-gray-500">고 </span>
                {hi.toLocaleString()}
                <span className={`ml-1 text-[10px] ${signColor(hiDiff)}`}>
                  ({formatSigned(hiDiff)}, {hiPct >= 0 ? "+" : ""}{hiPct.toFixed(2)}%)
                </span>
              </div>
            );
          })()}
          <div className="flex items-baseline gap-2">
            {tick.arrow && (
              <span className={`text-xl font-bold leading-tight
                                ${tick.dir === "up" ? "text-rose-600"
                                  : tick.dir === "down" ? "text-blue-600"
                                  : "text-gray-400"}`}>
                {tick.arrow.trim()}
              </span>
            )}
            <span className={`text-xl font-bold leading-tight ${signColor(dayDiff || -1)}`}>
              {price.price.toLocaleString()}원
            </span>
            {price.volume > 0 && (
              <span className="text-xs text-gray-400">
                ({formatVolume(price.volume)})
              </span>
            )}
          </div>
          {price.low && price.low > 0 && (() => {
            const lo = price.low;
            const loDiff = price.price - lo;
            const loPct = (loDiff / lo) * 100;
            return (
              <div className="text-xs text-gray-700">
                <span className="text-gray-500">저 </span>
                {lo.toLocaleString()}
                <span className={`ml-1 text-[10px] ${signColor(loDiff)}`}>
                  ({formatSigned(loDiff)}, {loPct >= 0 ? "+" : ""}{loPct.toFixed(2)}%)
                </span>
              </div>
            );
          })()}
        </div>

        {/* 통계 박스 — 매수/어제/수익 (3/10) */}
        <div className="border border-gray-200 rounded-md bg-gray-50/60
                        px-2 py-1 basis-[40%] min-w-0 space-y-0.5
                        flex flex-col justify-center">

        {/* 보유: 매수 + 피크 */}
        {hasPosition && (
          <div className="text-xs flex flex-wrap items-baseline gap-x-4">
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

        {/* 어제보다 — 변동 0이면 행 자체 숨김; 1주당 + % 강조 */}
        {dayDiff !== 0 && (
          <div className="text-xs">
            <span className="text-gray-500">어제보다 </span>
            <span className={`font-bold text-base ${signColor(dayDiff)}`}>
              {formatSigned(dayDiff)}
            </span>
            {stock.shares > 0 && (
              <span className={signColor(dayDiff)}>
                {" / "}{formatSigned(dayDiff * stock.shares)}
              </span>
            )}{" "}
            <span className={`font-bold text-base ${signColor(dayDiff)}`}>
              ({dayPct >= 0 ? "+" : ""}{dayPct.toFixed(2)}%)
            </span>
          </div>
        )}

        {/* 전체수익 (보유만) — 금액 일반, %만 bold (손절 -9% 이하 시 % 배경 강조) */}
        {hasPosition && (
          <div className="text-xs">
            <span className="text-gray-500">전체수익 </span>
            <span className={signColor(pnl)}>
              {formatSigned(pnl)}
            </span>{" "}
            <span className={signColor(pnl)}>(</span>
            <span className={`font-bold rounded px-0.5
                              ${isStop ? "bg-rose-600 text-white"
                                : signColor(pnl)}`}>
              {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%
            </span>
            <span className={signColor(pnl)}>)</span>
          </div>
        )}

        {/* 목표 */}
        {consensus?.target && (
          <div className="text-xs">
            <span className="text-gray-500">목표 </span>
            {typeof consensus.score === "number" && (
              <span className="text-gray-500">({consensus.score.toFixed(2)}) </span>
            )}
            <span className="text-gray-800">
              {consensus.target.toLocaleString()}
            </span>
            <span className={`ml-2 ${signColor(targetPct)}`}>
              ({targetPct >= 0 ? "+" : ""}{targetPct.toFixed(2)}%)
            </span>
          </div>
        )}
        </div>

      {/* ───────── 투자자 그리드 (4/10) ───────── */}
      <div className="basis-[30%] min-w-0 bg-white border border-gray-200 rounded-md
                       px-1.5 py-1 grid grid-cols-2 gap-x-2 gap-y-0
                       text-[11px]">
        {FLOW_FIELDS.map(({ label, key }) => {
          const raw = investor ? investor[key] : null;
          const isRatio = key === "외국인비율";
          const numVal = typeof raw === "number" ? raw : 0;
          const isHighlight = HIGHLIGHT_LABELS.has(label);

          // 외국인보유율 — 데이터 없거나 0이면 셀 전체 숨김 (그리드 자리는 유지)
          if (isRatio && (raw === null || raw === undefined || numVal === 0)) {
            return <div key={label} />;
          }

          // 표시값
          let value: string;
          if (raw === null || raw === undefined) {
            value = "-";
          } else if (isRatio) {
            value = `${(raw as number).toFixed(2)}%`;
          } else {
            value = formatSigned(raw as number);
          }

          // 색상/배경
          let labelColor: string;
          let valueColor: string;
          let rowBg: string;
          if (isHighlight) {
            const hs = highlightStyles(numVal);
            labelColor = hs.color;
            valueColor = hs.color;
            rowBg = hs.bg;
          } else {
            labelColor = "text-gray-600";
            valueColor =
              raw === null || raw === undefined ? "text-gray-400"
              : isRatio ? "text-gray-800"
              : signColor(raw as number);
            rowBg = "";
          }

          const sizeCls = HIGHLIGHT_SIZE[label] ?? "";
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
    </div>
  );
}
