import { useState } from "react";
import { Lightbulb } from "lucide-react";
import type { Stock, Price, Consensus, Investor, Memo } from "../types";
import { formatSigned, signColor, formatVolume, isHoldingSleeping } from "../lib/format";
import { getDimSleepingEnabled } from "../lib/proxyConfig";
import { memoTagClass } from "../lib/memoColor";
import { pickTodayInvestor } from "../lib/api";
import { Sparkline } from "./Sparkline";
import { Tooltip, ColorName } from "./Tooltip";
import { AuxIndicators } from "./AuxIndicators";

// 투자자별 매매동향 — PC StockCard 와 동일 정의 (모바일 레이어 표시용)
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
const HIGHLIGHT_LABELS = new Set(["외국인", "기관", "연기금"]);
function highlightStyles(value: number): { bg: string; color: string } {
  if (value > 0) return { bg: "bg-rose-50", color: "text-rose-700" };
  if (value < 0) return { bg: "bg-blue-50", color: "text-blue-800" };
  return { bg: "", color: "text-gray-500" };
}

// 모바일 종목 카드 — 데스크톱 StockCard 의 가격 + 통계 박스만 (투자자 동향 X)
// 폰트 모두 작게.

interface Props {
  stock: Stock;
  price?: Price;
  peak?: number;
  sector?: string;
  warning?: string;
  chart?: number[];           // 비거래일 sparkline 용 일봉 종가 시계열
  investorHistory?: Investor[] | null;   // 60일 수급 (AuxIndicators 외국인/기관/연기금)
  consensus?: Consensus | null; // 네이버 컨센서스 (목표가 + 점수)
  memo?: Memo;
  otherGroups?: string[];     // 같은 ticker 가 속한 다른 그룹 이름들 (현재 그룹 제외)
  onOpenValuation?: (ticker: string) => void;  // 📊 기업가치 모달
  onEdit?: (stock: Stock) => void;
  onDelete?: (stock: Stock) => void;
  onOpenMemo?: (ticker: string) => void;       // 📝 메모 다이얼로그
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

// 호버 툴팁 — 경고 뱃지 의미 설명
const WARN_TIPS: Record<string, string> = {
  투자위험:     "단기 급등락 등으로 거래소가 가장 강한 단계로 지정 — 매매 신중",
  관리종목:     "재무·실적 부실로 상장폐지 위험 — 신중 검토",
  거래정지:     "거래소가 매매를 일시 중단 — 호가/체결 불가",
  투자경고:     "투기적 거래 우려 — 지정 후 1일 거래정지 가능",
  공매도과열:   "공매도 비중이 비정상 — 1일간 공매도 금지",
  단기과열:     "주가·거래량 단기 급등 — 3거래일간 단일가 매매",
  투자주의환기: "관리종목 지정 가능성 — 사전 경고 단계",
  투자주의:     "이상 거래 징후 — 가장 가벼운 단계",
};

function openTossStock(ticker: string) {
  if (!/^[\dA-Za-z]{6}$/.test(ticker)) return;
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
  stock, price, peak, sector, warning, chart, investorHistory, consensus, memo, otherGroups,
  onOpenValuation, onEdit, onDelete, onOpenMemo,
}: Props) {
  // 투자자 매매동향 레이어 토글 (👥 버튼)
  const [showFlow, setShowFlow] = useState(false);
  const investor = investorHistory ? pickTodayInvestor(investorHistory) : null;

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
  const colorPct = price.prevClose > 0 ? (colorDiff / price.prevClose) * 100 : 0;
  const priceColorCls =
    colorDiff > 0 ? "text-rose-600"
    : colorDiff < 0 ? "text-blue-600"
    : "text-gray-900";
  const priceColorName = colorDiff > 0 ? "빨강" : colorDiff < 0 ? "파랑" : "검정";
  const priceTip = price.prevClose > 0
    ? `직전 거래일 종가 ${price.prevClose.toLocaleString()}원 대비 ${formatSigned(colorDiff)}원 (${colorPct >= 0 ? "+" : ""}${colorPct.toFixed(2)}%) — 현재가 금액색은 ${priceColorName} 입니다`
    : "";
  const peakPct = peak && peak > 0 ? ((price.price - peak) / peak) * 100 : 0;
  // 메모 — 목표가/손절가 도달 여부
  const memoTargetReached =
    memo?.targetPrice != null && Number.isFinite(memo.targetPrice) &&
    price.price >= memo.targetPrice;
  const memoStopReached =
    memo?.stopPrice != null && Number.isFinite(memo.stopPrice) &&
    price.price <= memo.stopPrice;
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
            <Tooltip content={
              <>
                <div className="font-bold text-amber-700 mb-1">⚠️ {warning}</div>
                <div className="mb-1">
                  <b>{stock.name}</b> 이(가) 거래소에 의해 지정되었습니다.
                </div>
                <div className="text-gray-600">{WARN_TIPS[warning] ?? warning}</div>
              </>
            }>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-t-md
                                text-white text-base leading-none cursor-help
                                ${WARN_BG[warning] ?? "bg-gray-500"}`}>
                {warning}
              </span>
            </Tooltip>
          )}
          <Tooltip content={
            <>
              <div className="font-bold mb-1">{stock.name} ({stock.ticker})</div>
              {price.prevClose > 0 && (
                <>
                  <div className="text-gray-600">직전 거래일 종가: <b className="text-gray-900">{price.prevClose.toLocaleString()}원</b></div>
                  <div className="text-gray-600">현재가: <b className="text-gray-900">{price.price.toLocaleString()}원</b></div>
                  <div className="text-gray-600">변동: <b className={colorDiff > 0 ? "text-rose-600" : colorDiff < 0 ? "text-blue-600" : "text-gray-900"}>
                    {formatSigned(colorDiff)}원 ({colorPct >= 0 ? "+" : ""}{colorPct.toFixed(2)}%)
                  </b></div>
                  <div className="mt-1 text-gray-600">→ 금액색 <ColorName name={priceColorName} /></div>
                </>
              )}
              <div className="mt-2 text-emerald-700 text-[10px]">🔗 탭 = 토스에서 보기</div>
            </>
          }>
            <button onClick={() => openTossStock(stock.ticker)}
                    className={`inline-flex items-center px-2 py-0.5 rounded-t-md
                                border-t border-l border-r ${cardBorder}
                                font-bold text-base leading-none w-fit
                                ${cardBg}
                                ${priceColorCls}`}>
              {sleeping && <span className="text-[10px] mr-0.5 opacity-70">zZ</span>}
              {stock.name}
            </button>
          </Tooltip>
          {/* 메모 태그 칩 — 태그 있을 때만 */}
          {memo?.tag && onOpenMemo && (
            <button onClick={() => onOpenMemo(stock.ticker)}
                    className={`inline-flex items-center px-2 py-0.5 rounded-t-md
                                text-[10px] leading-none w-fit
                                ${memoTagClass(memo.color)}`}>
              {memo.tag}
            </button>
          )}
        </div>
        <div className="flex items-end gap-1 shrink-0">
          {onOpenMemo && (
            <button onClick={() => onOpenMemo(stock.ticker)}
                    title={memo ? "메모 보기/수정" : "메모 추가"}
                    className={`px-2 py-1 rounded text-xs leading-none
                                bg-gray-100 hover:bg-gray-200
                                inline-flex items-center
                                ${memo
                                  ? "text-amber-400 drop-shadow-[0_0_3px_rgba(251,191,36,0.7)]"
                                  : "text-slate-400"}`}>
              <Lightbulb size={14} strokeWidth={2}
                         fill={memo ? "currentColor" : "none"} />
            </button>
          )}
          {onOpenValuation && /^[\dA-Za-z]{6}$/.test(stock.ticker) && (
            <button onClick={() => onOpenValuation(stock.ticker)}
                    title="기업가치 보기"
                    className="px-2 py-1 rounded bg-gray-100 hover:bg-gray-200
                               text-xs leading-none">
              📊
            </button>
          )}
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
      <article className={`rounded-lg border flex flex-row gap-1.5 p-1.5
                            ${!price.high ? "min-h-[90px]" : ""}
                            ${cardBg} ${cardBorder}`}>
      {/* 좌측 — 가격 박스 (50%). 비거래일엔 sparkline 워터마크.
          Tooltip 으로 감싸서 overflow-hidden 자식이라도 툴팁 영역은 잘리지 않음 */}
      <Tooltip content={
        <>
          <div className="text-gray-700 mb-1.5">
            <div className="font-bold mb-1 text-gray-900">{stock.name} ({stock.ticker})</div>
            {!hasPosition && (
              <div>관심 종목 — 카드 배경 <ColorName name="흰색" /></div>
            )}
            {hasPosition && pnl > 0 && (
              <>
                <div>매수가: <b className="text-gray-900">{Math.round(stock.avg_price).toLocaleString()}원</b> × {stock.shares.toLocaleString()}주</div>
                <div>전체수익: <b className="text-rose-600">{formatSigned(pnl)}원 ({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%)</b></div>
                <div>→ 익절 중 — 배경 <ColorName name="분홍" /></div>
              </>
            )}
            {hasPosition && pnl < 0 && (
              <>
                <div>매수가: <b className="text-gray-900">{Math.round(stock.avg_price).toLocaleString()}원</b> × {stock.shares.toLocaleString()}주</div>
                <div>전체수익: <b className="text-blue-600">{formatSigned(pnl)}원 ({pnlPct.toFixed(2)}%)</b></div>
                <div>→ 손실 중 — 배경 <ColorName name="파랑" /></div>
              </>
            )}
            {hasPosition && pnl === 0 && (
              <div>본전 — 배경 <ColorName name="흰색" /></div>
            )}
          </div>
          {priceTip && (
            <div className="text-gray-700 border-t border-gray-200 pt-1.5 mb-1">
              <div className="font-bold mb-1 text-gray-900">현재가 색</div>
              <div>직전 거래일 종가: <b className="text-gray-900">{price.prevClose.toLocaleString()}원</b></div>
              <div>변동: <b className={colorDiff > 0 ? "text-rose-600" : colorDiff < 0 ? "text-blue-600" : "text-gray-900"}>
                {formatSigned(colorDiff)}원 ({colorPct >= 0 ? "+" : ""}{colorPct.toFixed(2)}%)
              </b></div>
              <div>→ 금액색 <ColorName name={priceColorName} /></div>
            </div>
          )}
          {chart && chart.length > 1 && (
            <div className="text-gray-700 border-t border-gray-200 pt-1.5">
              <div className="font-bold mb-1 text-gray-900">3개월 추이</div>
              {(() => {
                const first = chart[0];
                const last = chart[chart.length - 1];
                const change = last - first;
                const pct = first > 0 ? (change / first) * 100 : 0;
                const colorName = change > 0 ? "빨강" : change < 0 ? "파랑" : "회색";
                return (
                  <>
                    <div>시작 → 끝: <b className="text-gray-900">{first.toLocaleString()}</b> → <b className="text-gray-900">{last.toLocaleString()}원</b></div>
                    <div>변동: <b className={change > 0 ? "text-rose-600" : change < 0 ? "text-blue-600" : "text-gray-900"}>
                      {pct >= 0 ? "+" : ""}{pct.toFixed(1)}%
                    </b></div>
                    <div>→ 그래프색 <ColorName name={colorName} /></div>
                  </>
                );
              })()}
            </div>
          )}
        </>
      } className="basis-1/2 min-w-0">
      <div className="relative w-full h-full">
      {/* 보유주수 + 거래량 — 한 줄, 가격 블록 위로 빠져나오는 박스 */}
      {(stock.shares > 0 || price.volume > 0) && (
        <div className="absolute -top-2 right-1 z-10 bg-white/70 border border-gray-200
                        rounded px-1.5 py-0.5 text-[10px] leading-tight
                        flex items-baseline gap-1">
          {stock.shares > 0 && (
            <span className="font-bold text-gray-900">
              {stock.shares.toLocaleString()}주
            </span>
          )}
          {stock.shares > 0 && price.volume > 0 && (
            <span className="text-gray-300">·</span>
          )}
          {price.volume > 0 && (
            <span className="text-gray-900">
              {formatVolume(price.volume)}
            </span>
          )}
        </div>
      )}
      <div className="relative overflow-hidden border border-gray-200
                      rounded bg-gray-50/60 px-2 py-1.5 w-full h-full
                      flex flex-col justify-center space-y-0.5">
        {/* 3개월 추이 차트 — 장 중엔 살짝 (opacity 25), 비거래일엔 진하게 (50) */}
        {chart && chart.length > 1 && (
          <Sparkline data={chart} width={300} height={70}
                     target={consensus?.target}
                     avgPrice={hasPosition ? stock.avg_price : undefined}
                     className="absolute inset-0 w-full h-full opacity-20
                                pointer-events-none" />
        )}
        {(() => {
          // 가격 행 + 목표 가격 비교 위치 동적 삽입 (PC 동일)
          const rowHigh = price.high && price.high > 0 ? (() => {
            const hi = price.high;
            const hiDiff = hi - price.price;
            const hiPct = price.price > 0 ? (hiDiff / price.price) * 100 : 0;
            return (
              <div key="high" className="text-xs text-gray-700">
                <span className="text-[10px] text-gray-500">고 </span>
                {hi.toLocaleString()}원
                <span className={`ml-0.5 text-[10px] ${signColor(hiDiff)}`}>
                  ({formatSigned(hiDiff)}원, {hiPct >= 0 ? "+" : ""}{hiPct.toFixed(2)}%)
                </span>
              </div>
            );
          })() : null;

          const rowCur = (
            <div key="cur" className="relative">
              <div className="flex items-baseline gap-1 flex-wrap">
                <span className={`text-xl font-bold leading-tight ${priceColorCls}`}>
                  {price.price.toLocaleString()}원
                </span>
                {memoTargetReached && (
                  <span title={`목표가 ${memo!.targetPrice!.toLocaleString()}원 도달`}
                        className="text-[9px] font-bold px-1 py-0.5 rounded
                                   bg-emerald-100 text-emerald-700 border border-emerald-300">
                    ▲ 목표
                  </span>
                )}
                {memoStopReached && (
                  <span title={`손절가 ${memo!.stopPrice!.toLocaleString()}원 도달`}
                        className="text-[9px] font-bold px-1 py-0.5 rounded
                                   bg-rose-100 text-rose-700 border border-rose-300">
                    ▼ 손절
                  </span>
                )}
              </div>
              <div className={`flex items-baseline gap-1 pl-2 font-bold ${signColor(dayDiff)}`}>
                <span className="text-lg leading-tight bg-yellow-100 rounded px-1">
                  {dayPct >= 0 ? "+" : ""}{dayPct.toFixed(2)}%
                </span>
                <span className="text-xs font-normal">({formatSigned(dayDiff)}원)</span>
              </div>
            </div>
          );

          const rowLow = price.low && price.low > 0 ? (() => {
            const lo = price.low;
            const loDiff = lo - price.price;
            const loPct = price.price > 0 ? (loDiff / price.price) * 100 : 0;
            return (
              <div key="low" className="text-xs text-gray-700">
                <span className="text-[10px] text-gray-500">저 </span>
                {lo.toLocaleString()}원
                <span className={`ml-0.5 text-[10px] ${signColor(loDiff)}`}>
                  ({formatSigned(loDiff)}원, {loPct >= 0 ? "+" : ""}{loPct.toFixed(2)}%)
                </span>
              </div>
            );
          })() : null;

          const rowTarget = consensus?.target && consensus.target > 0 ? (() => {
            const t = consensus.target;
            const tDiff = t - price.price;
            const tPct = price.price > 0 ? (tDiff / price.price) * 100 : 0;
            return (
              <div key="target" className="text-xs text-gray-700">
                <span className="text-[10px] text-amber-600 font-medium">목 </span>
                {t.toLocaleString()}원
                <span className={`ml-0.5 text-[10px] ${signColor(tDiff)}`}>
                  ({formatSigned(tDiff)}원, {tPct >= 0 ? "+" : ""}{tPct.toFixed(2)}%)
                </span>
              </div>
            );
          })() : null;

          // 메모 목표가 / 손절가
          const rowMemoTarget = memo?.targetPrice && memo.targetPrice > 0 ? (() => {
            const t = memo.targetPrice;
            const tDiff = t - price.price;
            const tPct = price.price > 0 ? (tDiff / price.price) * 100 : 0;
            return (
              <div key="memoTarget" className="text-xs text-gray-700">
                <span className={`text-[10px] font-bold ${memoTargetReached
                    ? "bg-emerald-100 text-emerald-700 rounded px-1 mr-0.5"
                    : "text-emerald-600 mr-0.5"}`}>
                  내목
                </span>
                {t.toLocaleString()}원
                <span className={`ml-0.5 text-[10px] ${signColor(tDiff)}`}>
                  ({formatSigned(tDiff)}원, {tPct >= 0 ? "+" : ""}{tPct.toFixed(2)}%)
                </span>
              </div>
            );
          })() : null;

          const rowMemoStop = memo?.stopPrice && memo.stopPrice > 0 ? (() => {
            const s = memo.stopPrice;
            const sDiff = s - price.price;
            const sPct = price.price > 0 ? (sDiff / price.price) * 100 : 0;
            return (
              <div key="memoStop" className="text-xs text-gray-700">
                <span className={`text-[10px] font-bold ${memoStopReached
                    ? "bg-rose-100 text-rose-700 rounded px-1 mr-0.5"
                    : "text-rose-600 mr-0.5"}`}>
                  손절
                </span>
                {s.toLocaleString()}원
                <span className={`ml-0.5 text-[10px] ${signColor(sDiff)}`}>
                  ({formatSigned(sDiff)}원, {sPct >= 0 ? "+" : ""}{sPct.toFixed(2)}%)
                </span>
              </div>
            );
          })() : null;

          // 모든 가격 행을 금액순 (높은 → 낮은) 정렬
          const allRows: { price: number; el: React.ReactElement }[] = [];
          if (rowHigh && price.high) allRows.push({ price: price.high, el: rowHigh });
          allRows.push({ price: price.price, el: rowCur });
          if (rowLow && price.low) allRows.push({ price: price.low, el: rowLow });
          if (rowTarget && consensus?.target) allRows.push({ price: consensus.target, el: rowTarget });
          if (rowMemoTarget && memo?.targetPrice) allRows.push({ price: memo.targetPrice, el: rowMemoTarget });
          if (rowMemoStop && memo?.stopPrice) allRows.push({ price: memo.stopPrice, el: rowMemoStop });
          allRows.sort((a, b) => b.price - a.price);
          return <>{allRows.map(r => r.el)}</>;
        })()}
      </div>
      </div>
      </Tooltip>

      {/* 우측 — 통계 박스 (50%) — PC 와 동일 구조: 피크/원금/현재/전체/오늘 */}
      <div className="relative basis-1/2 min-w-0 border border-gray-200 rounded
                       bg-gray-50/60 px-1.5 py-1 space-y-0.5
                       flex flex-col justify-start">
        {/* 다른 그룹 표시 — 같은 ticker 가 속한 다른 account 들 (현재 그룹 제외).
            통계 박스 우상단 외곽(-top-2)으로 — 박스 안 우상단 👥 버튼과 수직으로 안 겹침. */}
        {otherGroups && otherGroups.length > 0 && (
          <div className="absolute -top-2 right-1 z-10 flex items-baseline gap-1
                          text-[9px] leading-tight">
            {otherGroups.map(g => (
              <span key={g}
                    className="bg-gradient-to-r from-emerald-100/20 to-green-200/20
                               border border-emerald-300/20 rounded
                               px-1 py-0.5 text-emerald-800 whitespace-nowrap">
                {g}
              </span>
            ))}
          </div>
        )}
        {/* 👥 투자자 매매동향 열기 버튼 — 우상단 (닫기는 레이어 클릭) */}
        {investor && !showFlow && (
          <button onClick={() => setShowFlow(true)}
                  title="투자자 매매동향 보기"
                  className="absolute top-0.5 right-0.5 z-30 px-1 py-0 rounded
                             text-[9px] text-gray-500 bg-white/80
                             border border-gray-200 hover:bg-white">
            👥
          </button>
        )}

        {/* 피크 (보유만, 피크 > 현재가) — 보유 총액 기준 */}
        {hasPosition && peak && peak > price.price && (
          <div className="text-[10px]">
            <span className="text-[9px] text-gray-500">피크 </span>
            <span className="text-gray-700 font-medium">
              {Math.round(peak * stock.shares).toLocaleString()}원
            </span>{" "}
            (<span className={`rounded px-0.5
                               ${isPeakDrop ? "bg-blue-600 text-white font-bold" : ""}`}>
              {peakPct.toFixed(2)}%
            </span>)
          </div>
        )}

        {/* 원금 (보유만) */}
        {hasPosition && (
          <div className="text-[10px]">
            <span className="text-[9px] text-gray-500">원금 </span>
            <span className="text-gray-700">
              {Math.round(stock.avg_price * stock.shares).toLocaleString()}원
            </span>
          </div>
        )}

        {/* 현재 (보유만) — shares × current_price */}
        {hasPosition && (
          <div className="text-[10px]">
            <span className="text-[9px] text-gray-500">현재 </span>
            <span className={`font-bold ${signColor(pnl)}`}>
              {Math.round(price.price * stock.shares).toLocaleString()}원
            </span>
          </div>
        )}

        {/* 전체 — 금액 크게, % 는 원래 (손절 시 % 배경 강조) */}
        {hasPosition && (
          <div className="text-[10px]">
            <span className="text-[9px] text-gray-500">전체 </span>
            <span className={`text-sm font-bold ${signColor(pnl)}`}>
              {formatSigned(pnl)}원
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

        {/* 오늘 (보유만) — dayDiff × shares */}
        {hasPosition && (
          <div className="text-[10px]">
            <span className="text-[9px] text-gray-500">오늘 </span>
            <span className={`font-bold bg-yellow-100 rounded px-1 ${signColor(dayDiff)}`}>
              {formatSigned(dayDiff * stock.shares)}원
            </span>{" "}
            <span className={signColor(dayDiff)}>
              ({dayPct >= 0 ? "+" : ""}{dayPct.toFixed(2)}%)
            </span>
          </div>
        )}

        {/* ─── 보조 지표 — 우측 하단 네모 블럭 ──── */}
        <AuxIndicators chart={chart} investorHistory={investorHistory}
                       isTradingDay={!!price.high} textSize="10"
                       defaultOpen={!hasPosition} />

        {/* ─── 투자자 매매동향 레이어 (👥 클릭 시) ─── */}
        {showFlow && investor && (
          <div onClick={() => setShowFlow(false)}
               className="absolute inset-0 z-20 bg-white border border-gray-300 rounded
                          px-1.5 py-1 grid grid-cols-2 gap-x-1.5 gap-y-0
                          text-[10px] overflow-y-auto cursor-pointer">
            {FLOW_FIELDS.map(({ label, key }) => {
              const raw = investor[key];
              const isRatio = key === "외국인비율";
              const numVal = typeof raw === "number" ? raw : 0;
              const isHighlight = HIGHLIGHT_LABELS.has(label);

              if (isRatio && (raw === null || raw === undefined || numVal === 0)) {
                return <div key={label} />;
              }

              let value: string;
              if (raw === null || raw === undefined) value = "-";
              else if (isRatio) value = `${(raw as number).toFixed(2)}%`;
              else value = formatSigned(raw as number);

              let labelColor: string, valueColor: string, rowBg: string;
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

              const sizeCls = isHighlight ? "font-bold" : "";

              return (
                <div key={label}
                     className={`flex items-center justify-between gap-1 px-1 py-px rounded
                                 ${rowBg} ${sizeCls}`}>
                  <span className={`whitespace-nowrap shrink-0 ${labelColor}`}>{label}</span>
                  <span className={`tabular-nums whitespace-nowrap ${valueColor}`}>{value}</span>
                </div>
              );
            })}
          </div>
        )}

      </div>
      </article>
    </div>
  );
}
