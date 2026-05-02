import { useEffect, useState } from "react";
import type { Stock, Price, Investor, Consensus } from "../types";
import { formatSigned, signColor, formatVolume, isHoldingSleeping } from "../lib/format";
import { getDimSleepingEnabled } from "../lib/proxyConfig";
import { Sparkline } from "./Sparkline";
import { Tooltip, ColorName } from "./Tooltip";

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
  chart?: number[];   // 비거래일 sparkline 용 일봉 종가 시계열 (3개월)
  onOpenValuation?: (ticker: string) => void;
  onEdit?: (stock: Stock) => void;
  onDelete?: (stock: Stock) => void;
}

// 신호 — 최근 5거래일 동향 + 연기금 5/20/60일 매수일 비율 (또는 외인비율 20일 fallback)
interface PensionStats {
  d5: number; d5N: number;     // 5일 매수일 / 실제 데이터 일수
  d20: number; d20N: number;   // 20일
  d60: number; d60N: number;   // 60일
}
interface InvestorSignal {
  primary?: { label: string; tone: "bull" | "bear" | "warn" };
  secondary?: { label: string; tone: "up" | "down" | "pension_buy" | "pension_sell" };
  pension?: PensionStats;      // tooltip 용 5/20/60일 breakdown
}

function pensionDays(history: Investor[], n: number): { buy: number; sell: number; days: number } {
  const slice = history.slice(0, Math.min(n, history.length));
  let buy = 0, sell = 0;
  for (const d of slice) {
    if (d.연기금 > 0) buy += 1;
    if (d.연기금 < 0) sell += 1;
  }
  return { buy, sell, days: slice.length };
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

  // 연기금 5/20/60일 매수일 집계 (장기 자금 추세)
  const p5  = pensionDays(history, 5);
  const p20 = pensionDays(history, 20);
  const p60 = pensionDays(history, 60);
  const pension: PensionStats = {
    d5: p5.buy,    d5N: p5.days,
    d20: p20.buy,  d20N: p20.days,
    d60: p60.buy,  d60N: p60.days,
  };

  // 연기금 우선 (5일 강한 신호 기준) / fallback 외인비율 20일 추세
  let secondary: InvestorSignal["secondary"];
  if (p5.buy >= 3) {
    secondary = {
      label: `연기금 ↑ ${p5.buy}/${p20.buy}/${p60.buy}`,
      tone: "pension_buy",
    };
  } else if (p5.sell >= 3) {
    secondary = {
      label: `연기금 ↓ ${p5.sell}/${p20.sell}/${p60.sell}`,
      tone: "pension_sell",
    };
  } else if (history.length >= 20) {
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
  return { primary, secondary, pension };
}

const SIGNAL_TONE: Record<string, string> = {
  bull: "bg-emerald-100 text-emerald-700 border-emerald-300",
  bear: "bg-rose-100 text-rose-700 border-rose-300",
  warn: "bg-amber-100 text-amber-700 border-amber-300",
  up:   "bg-blue-50 text-blue-700 border-blue-200",
  down: "bg-orange-50 text-orange-700 border-orange-200",
  pension_buy:  "bg-violet-100 text-violet-800 border-violet-300",
  pension_sell: "bg-pink-100 text-pink-800 border-pink-300",
};
const SIGNAL_ICON: Record<string, string> = {
  bull: "🟢", bear: "🔴", warn: "⚠️", up: "📈", down: "📉",
  pension_buy: "🏦", pension_sell: "🏦",
};

// 호버 툴팁 — 신호 뱃지 의미 설명
const SIGNAL_TIPS: Record<string, string> = {
  bull: "외국인 + 기관이 동반 매수한 일수가 최근 5거래일 중 3일 이상 — 긍정적 수급 시그널",
  bear: "외국인이 매도하는 동안 개인이 받아내는 패턴 — 외국인 이탈 신호 (보통 부정적)",
  warn: "외국인 + 기관이 동반 매도한 일수 — 약세 시그널",
  up:   "외국인 보유 비율이 20거래일 동안 상승 — 외인 유입 추세",
  down: "외국인 보유 비율이 20거래일 동안 하락 — 외인 이탈 추세",
  pension_buy:  "연기금이 최근 5거래일 중 3일 이상 순매수 — 보유 비중 증가, 장기 자금 유입 (강한 긍정 시그널)",
  pension_sell: "연기금이 최근 5거래일 중 3일 이상 순매도 — 보유 비중 축소, 장기 자금 이탈 (주의)",
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
  if (!/^\d{6}$/.test(ticker)) return;
  window.open(`https://tossinvest.com/stocks/A${ticker}`,
              "_blank", "noopener,noreferrer");
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
  투자위험:     "bg-red-700",
  관리종목:     "bg-red-700",
  거래정지:     "bg-gray-500",
  투자경고:     "bg-orange-600",
  공매도과열:   "bg-orange-600",
  단기과열:     "bg-orange-600",
  투자주의환기: "bg-orange-600",
  투자주의:     "bg-amber-500",
};

// 손절/트레일링 임계값 (데스크톱 v2 기본 -9.0%)
const STOP_LOSS_PCT = -9;
const TRAILING_STOP_PCT = -9;

// 직전 틱 대비 화살표 — 데스크톱 v2 동일 (첫 전환 속빈, 연속 속찬)
type TickDir = "up" | "down" | undefined;
interface TickState { lastPrice?: number; dir: TickDir; arrow: string }
const TICK_INIT: TickState = { dir: undefined, arrow: "" };

export function StockCard({
  stock, price, investor, investorHistory, consensus, sector, peak, warning, loading, chart,
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

  // 어제보다 — base (비거래일엔 price 와 동일) 기반. UI 표시용
  const dayDiff = price.price - price.base;
  const dayPct = price.base > 0 ? (dayDiff / price.base) * 100 : 0;
  // 색 결정용 — 직전 거래일 종가 대비 (장마감 기준).
  // 비거래일엔 dayDiff=0 이지만 색은 마지막 거래일의 실제 변화 반영.
  // (sparkline 색은 차트 자체 추세로 별도 자동 판정 — 가격 색과 분리)
  const colorDiff = price.price - (price.prevClose || price.price);
  const colorPct = price.prevClose > 0 ? (colorDiff / price.prevClose) * 100 : 0;
  const priceColorCls =
    colorDiff > 0 ? "text-rose-600"
    : colorDiff < 0 ? "text-blue-600"
    : "text-gray-900";
  // 현재가 호버 — 직전 거래일 종가 대비 현재 상태 + 결과 색
  const priceColorName = colorDiff > 0 ? "빨강" : colorDiff < 0 ? "파랑" : "검정";
  const priceTip = price.prevClose > 0
    ? `직전 거래일 종가 ${price.prevClose.toLocaleString()}원 대비 ${formatSigned(colorDiff)}원 (${colorPct >= 0 ? "+" : ""}${colorPct.toFixed(2)}%) — 현재가 금액색은 ${priceColorName} 입니다`
    : "";

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
                                text-white text-sm leading-none cursor-help
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
              <div className="mt-2 text-emerald-700 text-[10px]">🔗 클릭 = 토스에서 보기</div>
            </>
          }>
            <button
              type="button"
              onClick={() => openTossStock(stock.ticker)}
              className={`inline-flex items-center px-2 py-0.5 rounded-t-md
                          border-t border-l border-r ${cardBorder}
                          font-bold text-sm leading-none cursor-pointer
                          hover:brightness-95 transition
                          ${cardBg}
                          ${priceColorCls}`}>
              {sleeping && <span className="text-[10px] mr-1 opacity-70">z<sup>z</sup><sup>z</sup></span>}
              {stock.name}
              {stock.shares > 0 && (
                <span className="ml-1 text-xs font-bold">
                  ({stock.shares.toLocaleString()}주)
                </span>
              )}
            </button>
          </Tooltip>
          {/* 수급 신호 — 외인+기관 동반매수 / 개인 떠받치기 / 외인비율 추세 */}
          {sig?.primary && (
            <Tooltip content={
              <>
                <div className="font-bold text-emerald-700 mb-1">
                  {SIGNAL_ICON[sig.primary.tone]} {sig.primary.label}
                </div>
                <div className="text-gray-700">{SIGNAL_TIPS[sig.primary.tone]}</div>
              </>
            }>
              <span className={`inline-flex items-center gap-0.5 px-2 py-0.5
                                rounded-t-md border-t border-l border-r
                                text-[10px] font-bold leading-none cursor-help
                                ${SIGNAL_TONE[sig.primary.tone]}`}>
                {SIGNAL_ICON[sig.primary.tone]} {sig.primary.label}
              </span>
            </Tooltip>
          )}
          {sig?.secondary && (
            <Tooltip content={
              <>
                <div className={`font-bold mb-1 ${
                  sig.secondary.tone === "pension_buy" ? "text-violet-700"
                  : sig.secondary.tone === "pension_sell" ? "text-pink-700"
                  : sig.secondary.tone === "up" ? "text-blue-700"
                  : "text-orange-700"
                }`}>
                  {SIGNAL_ICON[sig.secondary.tone]} {sig.secondary.label}
                </div>
                <div className="text-gray-700">{SIGNAL_TIPS[sig.secondary.tone]}</div>
                {/* 연기금 톤일 때 — 5/20/60일 매수일 breakdown */}
                {sig.pension && (sig.secondary.tone === "pension_buy" || sig.secondary.tone === "pension_sell") && (
                  <div className="mt-1.5 pt-1.5 border-t border-gray-200 text-gray-700">
                    <div className="font-bold text-gray-900 mb-0.5">기간별 매수일</div>
                    <div>5일: <b>{sig.pension.d5}</b>/{sig.pension.d5N}
                      <span className="text-gray-500"> ({((sig.pension.d5 / Math.max(1, sig.pension.d5N)) * 100).toFixed(0)}%)</span></div>
                    <div>20일: <b>{sig.pension.d20}</b>/{sig.pension.d20N}
                      <span className="text-gray-500"> ({((sig.pension.d20 / Math.max(1, sig.pension.d20N)) * 100).toFixed(0)}%)</span></div>
                    <div>60일: <b>{sig.pension.d60}</b>/{sig.pension.d60N}
                      <span className="text-gray-500"> ({((sig.pension.d60 / Math.max(1, sig.pension.d60N)) * 100).toFixed(0)}%)</span></div>
                  </div>
                )}
              </>
            }>
              <span className={`inline-flex items-center gap-0.5 px-2 py-0.5
                                rounded-t-md border-t border-l border-r
                                text-[10px] leading-none cursor-help
                                ${SIGNAL_TONE[sig.secondary.tone]}`}>
                {SIGNAL_ICON[sig.secondary.tone]} {sig.secondary.label}
              </span>
            </Tooltip>
          )}
        </div>
        <div className="flex items-end gap-0.5 shrink-0">
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
          {/* 섹터 — 책갈피 우측 끝 (카드와 같은 색) */}
          {sector && (
            <span className={`inline-flex items-center px-2 py-0.5 rounded-t-md
                              border-t border-l border-r ${cardBorder}
                              ${cardBg} text-xs text-gray-600 leading-none`}>
              {sector}
            </span>
          )}
        </div>
      </div>

      {/* 카드 본체 — 가격박스 / 통계박스 / 투자자 그리드 */}
      <article className={`rounded-lg border shadow-sm flex flex-row gap-2
                            items-stretch px-3 py-2
                            ${cardBg} ${cardBorder}
                            transition-opacity`}>
        {/* 가격 박스 — 고/현재가/저 (3/10). 비거래일엔 sparkline 워터마크.
            Tooltip 으로 감싸서 overflow-hidden 자식이라도 툴팁 영역은 잘리지 않음 */}
        <Tooltip content={
          <>
            {/* 카드 배경색 — 보유 손익 상태 */}
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
        } className="basis-[30%] min-w-0">
        <div className="relative overflow-hidden border border-gray-200 rounded-md
                        bg-gray-50/60 px-2 py-1 space-y-0.5 w-full h-full
                        flex flex-col justify-center">
          {/* 비거래일 — 3개월 추이 차트가 박스 배경. 색은 차트 자체 추세 */}
          {!price.high && chart && chart.length > 1 && (
            <Sparkline data={chart} width={300} height={80}
                       target={consensus?.target}
                       avgPrice={hasPosition ? stock.avg_price : undefined}
                       className="absolute inset-0 w-full h-full opacity-50
                                  pointer-events-none" />
          )}
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
          <div className="relative z-10 flex items-baseline gap-2">
            {tick.arrow && (
              <span className={`text-xl font-bold leading-tight
                                ${tick.dir === "up" ? "text-rose-600"
                                  : tick.dir === "down" ? "text-blue-600"
                                  : "text-gray-400"}`}>
                {tick.arrow.trim()}
              </span>
            )}
            <span className={`text-xl font-bold leading-tight ${priceColorCls}`}>
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
        </Tooltip>

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
