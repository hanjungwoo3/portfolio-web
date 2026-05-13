import { useEffect, useState } from "react";
import { Lightbulb } from "lucide-react";
import type { Stock, Price, Investor, Consensus, Memo } from "../types";
import type { PricePoint } from "../lib/api";
import { formatSigned, signColor, formatVolume, isHoldingSleeping } from "../lib/format";
import { getDimSleepingEnabled } from "../lib/proxyConfig";
import { memoTagClass } from "../lib/memoColor";
import { Sparkline } from "./Sparkline";
import { AuxIndicators } from "./AuxIndicators";
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
  priceHistory?: PricePoint[];  // OHLC 포함 — 가격 박스 hover tooltip 의 1개월 캔들차트용
  longHistory?: Investor[] | null;  // 200일 long history — 그리드 행 tooltip 의 5/20/60/120/200일 누적용
  memo?: Memo;                                       // 종목별 메모 (있으면)
  onOpenValuation?: (ticker: string) => void;
  onEdit?: (stock: Stock) => void;
  onDelete?: (stock: Stock) => void;
  onOpenMemo?: (ticker: string) => void;             // 메모 아이콘 클릭
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
      label: `연기금 매수 ${p5.buy}일`,
      tone: "pension_buy",
    };
  } else if (p5.sell >= 3) {
    secondary = {
      label: `연기금 매도 ${p5.sell}일`,
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

// 긍정 신호 → 빨강 / 부정 신호 → 파랑 (한국 주식 색 관습)
const SIGNAL_TONE: Record<string, string> = {
  bull: "bg-rose-100 text-rose-700 border-rose-300",         // 외인+기관 매수 (긍정)
  bear: "bg-blue-100 text-blue-700 border-blue-300",         // 개인 떠받치기 (외인 이탈, 부정)
  warn: "bg-blue-100 text-blue-700 border-blue-300",         // 외인+기관 매도 (부정)
  up:   "bg-rose-50 text-rose-700 border-rose-200",          // 외인비율 ↑ (긍정)
  down: "bg-blue-50 text-blue-700 border-blue-200",          // 외인비율 ↓ (부정)
  pension_buy:  "bg-rose-100 text-rose-700 border-rose-300", // 연기금 매수 (긍정)
  pension_sell: "bg-blue-100 text-blue-700 border-blue-300", // 연기금 매도 (부정)
};
// 긍정 → 📈 / 부정 → 📉 / 경고 → ⚠️ / 연기금 → 🏦
// (한국 주식 색관습 — 빨강=긍정/파랑=부정 — 과 어긋나는 🟢/🔴 원 이모지 제거)
const SIGNAL_ICON: Record<string, string> = {
  bull: "📈",          // 외인+기관 매수 (긍정)
  bear: "📉",          // 개인 떠받치기 (부정 — 외인 이탈)
  warn: "⚠️",         // 외인+기관 매도 (부정)
  up:   "📈",          // 외인비율 ↑ (긍정)
  down: "📉",          // 외인비율 ↓ (부정)
  pension_buy:  "🏦",
  pension_sell: "🏦",
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
  if (!/^[\dA-Za-z]{6}$/.test(ticker)) return;
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

// 거래량 압축 라벨 — formatVolume 과 동일 (만/억) 단, 천 단위는 K
function fmtVolShort(v: number): string {
  if (v >= 100_000_000) return `${(v / 100_000_000).toFixed(1)}억`;
  if (v >= 10_000)      return `${Math.round(v / 10_000)}만`;
  if (v >= 1_000)       return `${(v / 1_000).toFixed(1)}K`;
  return `${v}`;
}

// 호버 툴팁용 미니 캔들차트 — OHLC + 거래량 + 우측 가격축 라벨 + 외인비율 라인.
// 양봉=빨강 / 음봉=파랑 (한국식). 평단가/목표가 점선 가로 기준선 옵션.
// foreignRatio: 날짜(YYYY-MM-DD) → 외인비율(%) Map. 보라 점선으로 오버레이.
function MiniCandleChart({
  prices, avgPrice, targetPrice, foreignRatio,
  width = 360, height = 150,
}: {
  prices: PricePoint[];
  avgPrice?: number;
  targetPrice?: number;
  foreignRatio?: Map<string, number>;
  width?: number;
  height?: number;
}) {
  if (prices.length < 2) {
    return <div style={{ width, height }} className="text-[10px] text-gray-400 flex items-center justify-center">차트 데이터 없음</div>;
  }
  const padX = 4, padTop = 4, padBottom = 14;  // padBottom 에 X축 월 라벨 공간 포함
  const padRight = 50;  // 우측 가격축 라벨 공간
  const innerW = width - padX - padRight;
  const innerH = height - padTop - padBottom;
  // 캔들/거래량 영역 분할 — 캔들 72% / gap 6% / 거래량 22%
  const candleH = innerH * 0.72;
  const gapH    = innerH * 0.06;
  const volumeH = innerH * 0.22;
  const candleTop = padTop;
  const candleBot = candleTop + candleH;
  const volumeTop = candleBot + gapH;
  const volumeBot = volumeTop + volumeH;
  // Y 범위 계산 — 모든 OHLC + 가로 기준선 포함
  const vals: number[] = [];
  for (const p of prices) {
    if (p.high  != null) vals.push(p.high);
    if (p.low   != null) vals.push(p.low);
    if (p.close != null) vals.push(p.close);
    if (p.open  != null) vals.push(p.open);
  }
  if (avgPrice && avgPrice > 0)       vals.push(avgPrice);
  if (targetPrice && targetPrice > 0) vals.push(targetPrice);
  if (vals.length < 2) {
    return <div style={{ width, height }} className="text-[10px] text-gray-400 flex items-center justify-center">OHLC 데이터 없음</div>;
  }
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const yFor = (v: number) => candleTop + candleH - ((v - min) / range) * candleH;
  // 거래량 Y 범위
  const maxVol = Math.max(...prices.map(p => p.volume ?? 0), 1);
  const yVolFor = (v: number) => volumeBot - (v / maxVol) * volumeH;
  const slot = innerW / prices.length;
  const bodyW = Math.max(slot * 0.65, 1);
  // 우측 가격축 라벨 — 5 tick (min, 25%, 50%, 75%, max)
  const tickCount = 5;
  const ticks = Array.from({ length: tickCount }, (_, i) => min + (range * i) / (tickCount - 1));
  const labelX = width - padRight + 2;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}
         role="img" aria-label="캔들차트 + 거래량">
      {/* 가로 그리드 + 우측 가격 라벨 */}
      {ticks.map((t, ti) => {
        const y = yFor(t);
        return (
          <g key={`tick-${ti}`}>
            <line x1={padX} x2={width - padRight} y1={y} y2={y}
                  stroke="#f3f4f6" strokeWidth="0.5" />
            <text x={labelX} y={y + 3} fontSize="9" fill="#6b7280" textAnchor="start">
              {Math.round(t).toLocaleString()}
            </text>
          </g>
        );
      })}
      {/* 목표가 — amber 점선 (그리드 위) */}
      {targetPrice && targetPrice > 0 && (() => {
        const y = yFor(targetPrice);
        return (
          <g>
            <line x1={padX} x2={width - padRight} y1={y} y2={y}
                  stroke="#f59e0b" strokeWidth="0.8" strokeDasharray="3 2" />
            <text x={width - padRight - 2} y={y - 2} fontSize="9" fill="#b45309" textAnchor="end">
              목표 {targetPrice.toLocaleString()}
            </text>
          </g>
        );
      })()}
      {/* 평단가 — emerald 점선 */}
      {avgPrice && avgPrice > 0 && (() => {
        const y = yFor(avgPrice);
        return (
          <g>
            <line x1={padX} x2={width - padRight} y1={y} y2={y}
                  stroke="#10b981" strokeWidth="0.8" strokeDasharray="3 2" />
            <text x={padX + 2} y={y - 2} fontSize="9" fill="#047857">
              내 {avgPrice.toLocaleString()}
            </text>
          </g>
        );
      })()}
      {/* 캔들 */}
      {prices.map((p, i) => {
        if (p.open == null || p.high == null || p.low == null || p.close == null) return null;
        const xCenter = padX + slot * i + slot / 2;
        const wickHi = yFor(p.high);
        const wickLo = yFor(p.low);
        const bodyTop = yFor(Math.max(p.open, p.close));
        const bodyBot = yFor(Math.min(p.open, p.close));
        const isUp = p.close >= p.open;
        const c = isUp ? "#dc2626" : "#2563eb";
        return (
          <g key={p.date}>
            <line x1={xCenter} x2={xCenter} y1={wickHi} y2={wickLo}
                  stroke={c} strokeWidth="0.8" />
            <rect x={xCenter - bodyW / 2} y={bodyTop}
                  width={bodyW} height={Math.max(bodyBot - bodyTop, 0.5)}
                  fill={c} stroke={c} strokeWidth="0.4" />
          </g>
        );
      })}
      {/* 거래량 영역 분리선 */}
      <line x1={padX} x2={width - padRight} y1={volumeTop} y2={volumeTop}
            stroke="#e5e7eb" strokeWidth="0.5" />
      {/* 거래량 바 — 양봉색은 light red / 음봉색은 light blue */}
      {prices.map((p, i) => {
        const v = p.volume ?? 0;
        if (v <= 0) return null;
        const xCenter = padX + slot * i + slot / 2;
        const y = yVolFor(v);
        const h = Math.max(volumeBot - y, 0.5);
        const isUp = p.open != null && p.close != null ? p.close >= p.open : true;
        const c = isUp ? "#fecaca" : "#bfdbfe";
        return (
          <rect key={`vol-${p.date}`}
                x={xCenter - bodyW / 2} y={y}
                width={bodyW} height={h} fill={c} />
        );
      })}
      {/* 거래량 max 라벨 (우측) */}
      <text x={labelX} y={volumeTop + 8} fontSize="9" fill="#6b7280" textAnchor="start">
        {fmtVolShort(maxVol)}
      </text>
      {/* X축 월 라벨 — 달이 바뀌는 첫 거래일에 "N월" 표시 */}
      {(() => {
        const labels: { x: number; label: string }[] = [];
        let prevMonth = "";
        prices.forEach((p, i) => {
          if (!p.date || p.date.length < 7) return;
          const mm = p.date.slice(5, 7);
          if (mm !== prevMonth) {
            const x = padX + slot * i + slot / 2;
            labels.push({ x, label: `${Number(mm)}월` });
            prevMonth = mm;
          }
        });
        // 첫 라벨이 시작 너무 가깝거나 좌측 잘리면 제거
        return labels.map((l, idx) => (
          <text key={`xl-${idx}`} x={l.x} y={height - 3}
                fontSize="9" fill="#6b7280" textAnchor="middle">
            {l.label}
          </text>
        ));
      })()}
      {/* 외인비율 라인 — 보라 점선, 별도 Y 스케일 (캔들 영역에 오버레이) */}
      {(() => {
        if (!foreignRatio || foreignRatio.size === 0) return null;
        const ratios: { i: number; r: number }[] = [];
        prices.forEach((p, i) => {
          const r = foreignRatio.get(p.date);
          if (r != null && r > 0) ratios.push({ i, r });
        });
        if (ratios.length < 2) return null;
        const rMin = Math.min(...ratios.map(x => x.r));
        const rMax = Math.max(...ratios.map(x => x.r));
        const rRange = rMax - rMin || 1;
        // 캔들 영역의 80% 만 사용 (위/아래 여유 — 캔들과 겹침 줄이기)
        const ratioTop = candleTop + candleH * 0.1;
        const ratioH   = candleH * 0.8;
        const yRatio = (r: number) => ratioTop + ratioH - ((r - rMin) / rRange) * ratioH;
        const d = ratios
          .map((x, k) => {
            const cx = padX + slot * x.i + slot / 2;
            const cy = yRatio(x.r);
            return `${k === 0 ? "M" : "L"} ${cx.toFixed(2)} ${cy.toFixed(2)}`;
          })
          .join(" ");
        const lastR = ratios[ratios.length - 1].r;
        return (
          <g>
            <path d={d} fill="none" stroke="#7c3aed" strokeWidth="1.2"
                  strokeDasharray="2.5 2" strokeLinejoin="round" strokeLinecap="round" />
            {/* 외인비율 라벨 — 좌측 상단 작게 */}
            <text x={padX + 2} y={candleTop + 9} fontSize="9" fill="#7c3aed">
              외인 {lastR.toFixed(2)}%
            </text>
          </g>
        );
      })()}
    </svg>
  );
}

// 호버 툴팁용 미니 수급 차트 — 일별 막대 (중앙 0 대칭) + 누적 라인 오버레이.
// SVG 만 사용 — lightweight-charts 는 hover tooltip 의 mount/unmount 빈도에 부적합.
// 좌측 = 과거, 우측 = 오늘. data 는 시간순(과거→현재) 으로 들어옴.
function compactShares(n: number): string {
  if (n === 0) return "0";
  const abs = Math.abs(n);
  const sign = n > 0 ? "+" : "-";
  if (abs >= 100_000_000) return `${sign}${(abs / 100_000_000).toFixed(1)}억`;
  if (abs >= 10_000)      return `${sign}${(abs / 10_000).toFixed(1)}만`;
  return `${sign}${abs.toLocaleString()}`;
}
function MiniFlowChart({
  label, daily, cumulative,
  barUpColor = "#fecaca", barDnColor = "#bfdbfe",
  lineColor,
  width = 230, height = 100,
}: {
  label: string;
  daily: number[];
  cumulative: number[];
  barUpColor?: string;
  barDnColor?: string;
  lineColor: string;
  width?: number;
  height?: number;
}) {
  if (daily.length < 2) return <div style={{ width, height }} />;
  const padX = 2, padY = 4;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const cy = padY + innerH / 2;
  // 좌측(일별) ±max — 1 이상으로 보호 (모두 0 일 때 0 division 방지)
  const dMax = Math.max(...daily.map(v => Math.abs(v)), 1);
  // 우측(누적) ±max — 부호 보존 위해 절댓값 최대
  const cMax = Math.max(...cumulative.map(v => Math.abs(v)), 1);
  const dScale = (innerH / 2) / dMax;
  const cScale = (innerH / 2) / cMax;
  const barW = innerW / daily.length;
  const last = cumulative[cumulative.length - 1] ?? 0;
  const lineD = cumulative.map((v, i) => {
    const x = padX + i * barW + barW / 2;
    const y = cy - v * cScale;
    return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
  return (
    <div className="border border-gray-200 rounded px-1.5 py-1 bg-white">
      <div className="flex items-baseline gap-1.5 text-[10px] mb-0.5">
        <span className="font-bold" style={{ color: lineColor }}>{label}</span>
        <span className="tabular-nums font-bold" style={{ color: lineColor }}>
          {compactShares(last)}주
        </span>
        <span className="text-gray-400 ml-auto text-[9px]">일별 + 누적</span>
      </div>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}
           preserveAspectRatio="none" role="img" aria-label={`${label} 수급 추세`}>
        {/* 0 기준선 */}
        <line x1={padX} x2={width - padX} y1={cy} y2={cy}
              stroke="#e5e7eb" strokeWidth="0.5" />
        {/* 일별 막대 */}
        {daily.map((v, i) => {
          const x = padX + i * barW;
          const h = Math.abs(v) * dScale;
          const y = v >= 0 ? cy - h : cy;
          const c = v >= 0 ? barUpColor : barDnColor;
          return <rect key={i} x={x} y={y}
                       width={Math.max(barW - 0.2, 0.3)} height={h}
                       fill={c} />;
        })}
        {/* 누적 라인 */}
        <path d={lineD} fill="none" stroke={lineColor} strokeWidth="1.2"
              strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  );
}

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
  stock, price, investor, investorHistory, consensus, sector, peak, warning, loading, chart, priceHistory, longHistory,
  memo, onOpenValuation, onEdit, onDelete, onOpenMemo,
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

  // 메모 — 목표가/손절가 도달 여부 (현재가 ≥ 목표가 / 현재가 ≤ 손절가)
  const memoTargetReached =
    memo?.targetPrice != null && Number.isFinite(memo.targetPrice) &&
    price.price >= memo.targetPrice;
  const memoStopReached =
    memo?.stopPrice != null && Number.isFinite(memo.stopPrice) &&
    price.price <= memo.stopPrice;

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

  // 통합 표 helper — 기간 한 열 + 그룹 헤더 + 여러 데이터 컬럼
  type Col =
    | { type: "days"; key: keyof Investor; header: string }
    | { type: "sum"; key: keyof Investor; header: string }
    | { type: "ratio"; header: string };
  type ColGroup = { group?: string; cols: Col[] };

  const unifiedTable = (groups: ColGroup[], title: string) => {
    if (!longHistory || longHistory.length === 0) return null;
    const periods: { lbl: string; n: number }[] = [
      { lbl: "5일", n: 5 },
      { lbl: "20일 (1개월)", n: 20 },
      { lbl: "60일 (3개월)", n: 60 },
      { lbl: "120일 (6개월)", n: 120 },
      { lbl: "200일 (~10개월)", n: 200 },
    ];
    const today = longHistory[0].외국인비율;
    // 모든 col 평탄화 — 셀 렌더링 시 사용
    const flatCols = groups.flatMap(g => g.cols);
    // 위계 헤더 필요 여부 — group 명시되거나 한 그룹에 여러 col 있으면 필요
    const hasHierarchy = groups.some(g => g.group || g.cols.length > 1);
    return (
      <div className="mt-1.5 pt-1.5 border-t border-gray-200">
        <div className="font-bold text-gray-900 mb-1">{title}</div>
        <table className="w-full text-[11px] border border-gray-300 rounded overflow-hidden whitespace-nowrap">
          <thead className="bg-gray-100">
            {hasHierarchy && (
              <tr>
                <th rowSpan={2} className="border-b border-r border-gray-300 px-2 py-0.5 text-left font-medium text-gray-700">
                  기간
                </th>
                {groups.map((g, gi) => {
                  const isLastGroup = gi === groups.length - 1;
                  const groupBorder = !isLastGroup ? "border-r" : "";
                  // 그룹 헤더 있으면 colspan / 없으면 단일 col 자체 헤더 rowspan=2
                  if (g.group) {
                    return (
                      <th key={gi} colSpan={g.cols.length}
                          className={`border-b border-gray-300 px-2 py-0.5 text-center font-medium text-gray-700 ${groupBorder}`}>
                        {g.group}
                      </th>
                    );
                  }
                  // 그룹 없음 → 각 col 헤더가 rowspan=2
                  return g.cols.map((c, ci) => {
                    const colLast = isLastGroup && ci === g.cols.length - 1;
                    return (
                      <th key={`${gi}-${ci}`} rowSpan={2}
                          className={`border-b border-gray-300 px-2 py-0.5 ${c.type === "days" ? "text-center" : "text-right"} font-medium text-gray-700 ${!colLast ? "border-r" : ""}`}>
                        {c.header}
                      </th>
                    );
                  });
                })}
              </tr>
            )}
            <tr>
              {!hasHierarchy && (
                <th className="border-b border-r border-gray-300 px-2 py-0.5 text-left font-medium text-gray-700">기간</th>
              )}
              {hasHierarchy
                ? groups.map((g, gi) => {
                    if (!g.group) return null;  // 이미 rowspan=2 로 위에서 처리
                    const isLastGroup = gi === groups.length - 1;
                    return g.cols.map((c, ci) => {
                      const colLast = isLastGroup && ci === g.cols.length - 1;
                      return (
                        <th key={`sub-${gi}-${ci}`}
                            className={`border-b border-gray-300 px-2 py-0.5 ${c.type === "days" ? "text-center" : "text-right"} font-medium text-gray-600 ${!colLast ? "border-r" : ""}`}>
                          {c.header}
                        </th>
                      );
                    });
                  })
                : flatCols.map((c, ci) => (
                    <th key={ci}
                        className={`border-b border-gray-300 px-2 py-0.5 ${c.type === "days" ? "text-center" : "text-right"} font-medium text-gray-700 ${ci < flatCols.length - 1 ? "border-r" : ""}`}>
                      {c.header}
                    </th>
                  ))}
            </tr>
          </thead>
          <tbody>
            {periods.map((p, ri) => {
              const slice = longHistory.slice(0, Math.min(p.n, longHistory.length));
              const days = slice.length;
              const last = ri === periods.length - 1;
              return (
                <tr key={p.lbl}>
                  <td className={`px-2 py-0.5 border-r border-gray-300 text-left text-gray-800 whitespace-nowrap ${!last ? "border-b" : ""}`}>
                    {p.lbl}
                    {days < p.n && (
                      <span className="text-[10px] text-gray-400 ml-1">(실 {days})</span>
                    )}
                  </td>
                  {flatCols.map((c, ci) => {
                    const isLastCol = ci === flatCols.length - 1;
                    const cellBorder = `${!last ? "border-b border-gray-300" : ""} ${!isLastCol ? "border-r" : ""}`;
                    if (c.type === "days") {
                      const buy  = slice.filter(d => ((d[c.key] as number) ?? 0) > 0).length;
                      const sell = slice.filter(d => ((d[c.key] as number) ?? 0) < 0).length;
                      const buyBold  = buy >= sell;
                      const sellBold = sell >= buy;
                      return (
                        <td key={ci} className={`px-2 py-0.5 text-center tabular-nums ${cellBorder}`}>
                          <span className={`text-rose-600 ${buyBold ? "font-bold" : ""}`}>{buy}</span>
                          <span className="text-gray-400">/</span>
                          <span className={`text-blue-600 ${sellBold ? "font-bold" : ""}`}>{sell}</span>
                        </td>
                      );
                    } else if (c.type === "sum") {
                      const sum = slice.reduce((a, d) => a + ((d[c.key] as number) ?? 0), 0);
                      const color = sum > 0 ? "text-rose-600" : sum < 0 ? "text-blue-600" : "text-gray-700";
                      return (
                        <td key={ci} className={`px-2 py-0.5 text-right tabular-nums font-bold ${color} ${cellBorder}`}>
                          {formatSigned(sum)}
                        </td>
                      );
                    } else {
                      const idx = Math.min(p.n - 1, longHistory.length - 1);
                      const past = longHistory[idx]?.외국인비율 ?? today;
                      const delta = today - past;
                      const color = delta > 0 ? "text-rose-600" : delta < 0 ? "text-blue-600" : "text-gray-700";
                      return (
                        <td key={ci} className={`px-2 py-0.5 text-right tabular-nums font-bold ${color} ${cellBorder}`}>
                          {delta >= 0 ? "+" : ""}{delta.toFixed(2)}%p
                        </td>
                      );
                    }
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  // 시그널 톤 → 강조할 투자자 컬럼 매핑 (뱃지 호버 시 해당 컬럼 노랑 강조)
  const highlightForTone = (tone: string | undefined): keyof Investor | undefined => {
    switch (tone) {
      case "bull":         return "외국인";       // 외인+기관 동반매수 → 외국인 강조
      case "warn":         return "외국인";       // 외인+기관 동반매도 → 외국인 강조
      case "bear":         return "개인";         // 개인 떠받치기 → 개인 강조
      case "pension_buy":
      case "pension_sell": return "연기금";       // 연기금 강조
      case "up":
      case "down":         return "외국인비율";   // 외인비율 컬럼 강조
      default:             return undefined;
    }
  };

  // 전체 투자자 매트릭스 (그리드 행 tooltip) — 누적(기간) + 일별(최근 1주일)을 한 표로.
  // 컬럼: 일자/기간 | 개인 외국인 기관 금융투자 연기금 투신 사모 보험 은행 기타금융 기타법인 | 외인비율(%)
  // 누적 행: 외인비율 = today 와 N일 전의 차이 (%p). 일별 행: 그 날의 실제 외국인비율 (%).
  // highlightKey 있으면 해당 컬럼을 노랑으로 강조 (어느 행에서 호버했는지 표시).
  const allInvestorsTable = (highlightKey?: keyof Investor) => {
    if (!longHistory || longHistory.length === 0) return null;
    const periods: { lbl: string; n: number }[] = [
      { lbl: "5일",             n: 5   },
      { lbl: "20일 (1개월)",    n: 20  },
      { lbl: "60일 (3개월)",    n: 60  },
      { lbl: "120일 (6개월)",   n: 120 },
      { lbl: "200일 (~10개월)", n: 200 },
    ];
    const investors: { label: string; key: keyof Investor }[] = [
      { label: "개인",     key: "개인" },
      { label: "외국인",   key: "외국인" },
      { label: "기관",     key: "기관" },
      { label: "금융투자", key: "금융투자" },
      { label: "연기금",   key: "연기금" },
      { label: "투신",     key: "투신" },
      { label: "사모",     key: "사모" },
      { label: "보험",     key: "보험" },
      { label: "은행",     key: "은행" },
      { label: "기타금융", key: "기타금융" },
      { label: "기타법인", key: "기타법인" },
    ];
    // 만 단위 압축 — "+27.2만" / "-1.5만" 식. 만 미만은 그대로.
    const compact = (n: number): string => {
      if (n === 0) return "0";
      const abs = Math.abs(n);
      const sign = n > 0 ? "+" : "-";
      if (abs >= 100_000_000) return `${sign}${(abs / 100_000_000).toFixed(1)}억`;
      if (abs >= 10_000)      return `${sign}${(abs / 10_000).toFixed(1)}만`;
      return `${sign}${abs.toLocaleString()}`;
    };
    const today = longHistory[0]?.외국인비율 ?? 0;
    const recentDays = longHistory.slice(0, Math.min(7, longHistory.length));
    const totalCols = investors.length + 2;  // 일자 + 투자자 + 외인비율
    const rateHl = highlightKey === "외국인비율";
    return (
      <div className="mt-1.5 pt-1.5 border-t border-gray-200">
        {/* 미니 수급 차트 — 외국인 / 기관 / 연기금 (전체 longHistory 기준, 시간순) */}
        {(() => {
          const chronological = [...longHistory].reverse();
          const foreignDaily = chronological.map(d => d.외국인 ?? 0);
          const instDaily    = chronological.map(d => d.기관 ?? 0);
          const pensionDaily = chronological.map(d => d.연기금 ?? 0);
          const cum = (xs: number[]): number[] => {
            let s = 0; return xs.map(v => (s += v));
          };
          return (
            <div className="grid grid-cols-3 gap-1.5 mb-2">
              <MiniFlowChart label="외국인" daily={foreignDaily} cumulative={cum(foreignDaily)}
                             lineColor="#6d28d9" />
              <MiniFlowChart label="기관계" daily={instDaily}    cumulative={cum(instDaily)}
                             lineColor="#047857" />
              <MiniFlowChart label="연기금" daily={pensionDaily} cumulative={cum(pensionDaily)}
                             lineColor="#c2410c" />
            </div>
          );
        })()}
        <div className="font-bold text-gray-900 mb-1">투자자별 매수/매도</div>
        <table className="w-full text-[10px] border border-gray-300 rounded overflow-hidden whitespace-nowrap">
          <thead className="bg-gray-100">
            <tr>
              <th className="border-b border-r border-gray-300 px-1.5 py-0.5 text-left font-medium text-gray-700">
                일자 / 기간
              </th>
              {investors.map(inv => {
                const hl = highlightKey === inv.key;
                return (
                  <th key={inv.key as string}
                      className={`border-b border-r border-gray-300 px-1.5 py-0.5 text-right font-medium
                                  ${hl ? "bg-amber-100 text-gray-900" : "text-gray-700"}`}>
                    {inv.label}
                  </th>
                );
              })}
              <th className={`border-b border-gray-300 px-1.5 py-0.5 text-right font-medium
                              ${rateHl ? "bg-amber-100 text-gray-900" : "text-gray-700"}`}>
                외인비율(%)
              </th>
            </tr>
          </thead>
          <tbody>
            {/* 누적 (기간) — 외인비율은 today - past delta (%p) */}
            {periods.map(p => {
              const slice = longHistory.slice(0, Math.min(p.n, longHistory.length));
              const days = slice.length;
              const idx = Math.min(p.n - 1, longHistory.length - 1);
              const past = longHistory[idx]?.외국인비율 ?? today;
              const delta = today - past;
              const deltaColor = delta > 0 ? "text-rose-600"
                               : delta < 0 ? "text-blue-600"
                               : "text-gray-400";
              return (
                <tr key={p.lbl}>
                  <td className="px-1.5 py-0.5 border-b border-r border-gray-300 text-left text-gray-800 whitespace-nowrap">
                    {p.lbl}
                    {days < p.n && (
                      <span className="text-[9px] text-gray-400 ml-0.5">({days})</span>
                    )}
                  </td>
                  {investors.map(inv => {
                    const sum = slice.reduce((a, d) => a + ((d[inv.key] as number) ?? 0), 0);
                    const color = sum > 0 ? "text-rose-600"
                                : sum < 0 ? "text-blue-600"
                                : "text-gray-400";
                    const hl = highlightKey === inv.key;
                    return (
                      <td key={inv.key as string}
                          className={`px-1.5 py-0.5 border-b border-r border-gray-300 text-right tabular-nums font-medium
                                      ${color}
                                      ${hl ? "bg-amber-50" : ""}`}>
                        {sum === 0 ? "—" : compact(sum)}
                      </td>
                    );
                  })}
                  <td className={`px-1.5 py-0.5 border-b border-gray-300 text-right tabular-nums font-medium
                                  ${deltaColor}
                                  ${rateHl ? "bg-amber-50" : ""}`}>
                    {delta === 0 ? "0.00%p" : `${delta > 0 ? "+" : ""}${delta.toFixed(2)}%p`}
                  </td>
                </tr>
              );
            })}
            {/* 일별 상세 구분선 */}
            <tr>
              <td colSpan={totalCols}
                  className="px-1.5 py-0.5 border-b border-gray-300 text-left text-gray-600 bg-gray-50">
                ▼ 일별 상세
              </td>
            </tr>
            {/* 일별 — 외인비율은 그 날의 실제 % 값 */}
            {recentDays.map((d, ri) => {
              const last = ri === recentDays.length - 1;
              const rate = d.외국인비율;
              const dayLabel = d.date && d.date.length >= 10
                ? d.date
                : ri === 0 ? "오늘" : ri === 1 ? "어제" : `${ri}일전`;
              return (
                <tr key={d.date ?? ri}>
                  <td className={`px-1.5 py-0.5 border-r border-gray-300 text-left text-gray-700 whitespace-nowrap
                                  ${!last ? "border-b" : ""}`}>
                    {dayLabel}
                  </td>
                  {investors.map(inv => {
                    const v = (d[inv.key] as number) ?? 0;
                    const color = v > 0 ? "text-rose-600"
                                : v < 0 ? "text-blue-600"
                                : "text-gray-400";
                    const hl = highlightKey === inv.key;
                    return (
                      <td key={inv.key as string}
                          className={`px-1.5 py-0.5 border-r border-gray-300 text-right tabular-nums
                                      ${color}
                                      ${hl ? "bg-amber-50" : ""}
                                      ${!last ? "border-b" : ""}`}>
                        {v === 0 ? "—" : compact(v)}
                      </td>
                    );
                  })}
                  <td className={`px-1.5 py-0.5 text-right tabular-nums text-gray-800
                                  ${rateHl ? "bg-amber-50" : ""}
                                  ${!last ? "border-b border-gray-300" : ""}`}>
                    {rate != null && rate > 0 ? rate.toFixed(2) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

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
            </button>
          </Tooltip>
          {/* 메모 태그 칩 — 태그 있을 때만, 클릭 시 메모 다이얼로그 열기 */}
          {memo?.tag && onOpenMemo && (
            <Tooltip content={
              <>
                <div className="font-bold mb-1 flex items-center gap-1">
                  <Lightbulb size={12} strokeWidth={2} fill="currentColor" className="text-amber-400" />
                  메모
                </div>
                {memo.text && (
                  <div className="text-gray-700 whitespace-pre-wrap max-w-[280px] break-words mb-1">
                    {memo.text.length > 200 ? memo.text.slice(0, 200) + "…" : memo.text}
                  </div>
                )}
                <div className="text-emerald-700 text-[10px] mt-1">🔗 클릭 = 메모 열기</div>
              </>
            }>
              <button type="button"
                      onClick={() => onOpenMemo(stock.ticker)}
                      className={`inline-flex items-center px-2 py-0.5 rounded-t-md
                                  text-[10px] leading-none cursor-pointer
                                  hover:brightness-95 transition
                                  ${memoTagClass(memo.color)}`}>
                {memo.tag}
              </button>
            </Tooltip>
          )}
          {/* 수급 신호 — 외인+기관 동반매수 / 개인 떠받치기 / 외인비율 추세
              호버 시 투자자 그리드 행과 동일한 통합 표 + 미니차트 표시 (시그널 톤별 컬럼 강조) */}
          {sig?.primary && (
            <Tooltip content={
              <>
                <div className={`font-bold mb-1 ${
                  sig.primary.tone === "bull" ? "text-rose-700" : "text-blue-700"
                }`}>
                  {SIGNAL_ICON[sig.primary.tone]} {sig.primary.label}
                </div>
                <div className="text-gray-700">{SIGNAL_TIPS[sig.primary.tone]}</div>
                {allInvestorsTable(highlightForTone(sig.primary.tone))}
              </>
            }>
              <span className={`inline-flex items-center gap-0.5 px-2 py-0.5
                                rounded-t-md border-t border-l border-r
                                text-[10px] leading-none cursor-help
                                ${SIGNAL_TONE[sig.primary.tone]}`}>
                {SIGNAL_ICON[sig.primary.tone]} {sig.primary.label}
              </span>
            </Tooltip>
          )}
          {sig?.secondary && (
            <Tooltip content={
              <>
                <div className={`font-bold mb-1 ${
                  sig.secondary.tone === "pension_buy" || sig.secondary.tone === "up"
                    ? "text-rose-700" : "text-blue-700"
                }`}>
                  {SIGNAL_ICON[sig.secondary.tone]} {sig.secondary.label}
                </div>
                <div className="text-gray-700">{SIGNAL_TIPS[sig.secondary.tone]}</div>
                {allInvestorsTable(highlightForTone(sig.secondary.tone))}
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
          {/* hover 버튼 — 카드 hover 시 빈 회색 전구, 아이콘 hover 시 노란 백열등 점등 */}
          {onOpenMemo && (
            <button
              type="button"
              onClick={() => onOpenMemo(stock.ticker)}
              title={memo ? "메모 보기/수정" : "메모 추가"}
              className="group/lb opacity-0 group-hover:opacity-100
                         px-0.5 transition inline-flex items-center
                         text-slate-400 hover:text-amber-400
                         hover:drop-shadow-[0_0_5px_rgba(251,191,36,0.95)]">
              <Lightbulb size={16} strokeWidth={2.2}
                         className="fill-none group-hover/lb:fill-current transition-colors" />
            </button>
          )}
          {onOpenValuation && /^[\dA-Za-z]{6}$/.test(stock.ticker) && (
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
            {/* 캔들차트 — 최근 ~60 거래일 OHLC (3개월), 평단가/목표가 가로 점선 + 외인비율 보라 라인 */}
            {priceHistory && priceHistory.length > 1 && (() => {
              const ratioMap = new Map<string, number>();
              if (longHistory) {
                for (const d of longHistory) {
                  if (d.date && d.외국인비율 != null && d.외국인비율 > 0) {
                    ratioMap.set(d.date, d.외국인비율);
                  }
                }
              }
              return (
                <div className="mb-1.5">
                  <div className="font-bold mb-1 text-gray-900">최근 60일 캔들</div>
                  <MiniCandleChart
                    prices={priceHistory.slice(-60)}
                    avgPrice={hasPosition ? stock.avg_price : undefined}
                    targetPrice={consensus?.target && consensus.target > 0 ? consensus.target : undefined}
                    foreignRatio={ratioMap.size > 0 ? ratioMap : undefined}
                    width={620}
                    height={240}
                  />
                </div>
              );
            })()}
            {/* 3개 정보 박스 — 가로 배치 (보유 손익 / 현재가 색 / 3개월 추이) */}
            <div className={`flex gap-1.5 ${priceHistory && priceHistory.length > 1 ? "border-t border-gray-200 pt-1.5" : ""}`}>
              {/* 박스 1 — 보유 손익 상태 */}
              <div className="flex-1 min-w-0 border border-gray-200 rounded p-1.5 text-gray-700">
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
              {/* 박스 2 — 현재가 색 */}
              {priceTip && (
                <div className="flex-1 min-w-0 border border-gray-200 rounded p-1.5 text-gray-700">
                  <div className="font-bold mb-1 text-gray-900">현재가 색</div>
                  <div>직전 거래일 종가: <b className="text-gray-900">{price.prevClose.toLocaleString()}원</b></div>
                  <div>변동: <b className={colorDiff > 0 ? "text-rose-600" : colorDiff < 0 ? "text-blue-600" : "text-gray-900"}>
                    {formatSigned(colorDiff)}원 ({colorPct >= 0 ? "+" : ""}{colorPct.toFixed(2)}%)
                  </b></div>
                  <div>→ 금액색 <ColorName name={priceColorName} /></div>
                </div>
              )}
              {/* 박스 3 — 3개월 추이 */}
              {chart && chart.length > 1 && (
                <div className="flex-1 min-w-0 border border-gray-200 rounded p-1.5 text-gray-700">
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
            </div>
          </>
        } className="basis-[30%] min-w-0">
        <div className="relative w-full h-full">
        {/* 보유주수 + 거래량 — 한 줄, 가격 블록 위로 빠져나오는 박스 */}
        {(stock.shares > 0 || price.volume > 0) && (
          <div className="absolute -top-2 right-1 z-30 bg-white/70 border border-gray-200
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
        <div className="relative overflow-hidden border border-gray-200 rounded-md
                        bg-gray-50/60 px-2 py-1 space-y-0.5 w-full h-full
                        flex flex-col justify-center">
          {/* 비거래일 — 3개월 추이 차트가 박스 배경. 색은 차트 자체 추세 */}
          {chart && chart.length > 1 && (
            <Sparkline data={chart} width={300} height={80}
                       target={consensus?.target}
                       avgPrice={hasPosition ? stock.avg_price : undefined}
                       className="absolute inset-0 w-full h-full opacity-20
                                  pointer-events-none" />
          )}
          {(() => {
            // 가격 행들을 배열로 만들고 목표를 가격 비교에 따라 적절한 위치에 삽입
            const rowHigh = price.high && price.high > 0 ? (() => {
              const hi = price.high;
              // 기준 - 현재가 → 고는 보통 + (위로 거리), 저는 - (아래 거리)
              const hiDiff = hi - price.price;
              const hiPct = price.price > 0 ? (hiDiff / price.price) * 100 : 0;
              return (
                <div key="high" className="text-xs text-gray-700">
                  <span className="text-[10px] text-gray-500">고 </span>
                  {hi.toLocaleString()}원
                  <span className={`ml-1 text-[10px] ${signColor(hiDiff)}`}>
                    ({formatSigned(hiDiff)}원, {hiPct >= 0 ? "+" : ""}{hiPct.toFixed(2)}%)
                  </span>
                </div>
              );
            })() : null;

            const rowCur = (
              <div key="cur" className="relative z-10">
                <div className="flex items-baseline gap-2">
                  <span className={`text-xl font-bold leading-tight ${
                    tick.arrow
                      ? tick.dir === "up" ? "text-rose-600"
                        : tick.dir === "down" ? "text-blue-600"
                        : "text-gray-400"
                      : "invisible"
                  }`}>
                    {tick.arrow ? tick.arrow.trim() : "▲"}
                  </span>
                  <span className={`text-xl font-bold leading-tight ${priceColorCls}`}>
                    {price.price.toLocaleString()}원
                  </span>
                  {/* 메모 — 목표가/손절가 도달 인디케이터 */}
                  {memoTargetReached && (
                    <span title={`목표가 ${memo!.targetPrice!.toLocaleString()}원 도달`}
                          className="text-[10px] font-bold px-1 py-0.5 rounded
                                     bg-emerald-100 text-emerald-700 border border-emerald-300">
                      ▲ 목표
                    </span>
                  )}
                  {memoStopReached && (
                    <span title={`손절가 ${memo!.stopPrice!.toLocaleString()}원 도달`}
                          className="text-[10px] font-bold px-1 py-0.5 rounded
                                     bg-rose-100 text-rose-700 border border-rose-300">
                      ▼ 손절
                    </span>
                  )}
                </div>
                <div className={`flex items-baseline gap-1 pl-6 font-bold ${signColor(dayDiff)}`}>
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
                  <span className={`ml-1 text-[10px] ${signColor(loDiff)}`}>
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
                  <span className={`ml-1 text-[10px] ${signColor(tDiff)}`}>
                    ({formatSigned(tDiff)}원, {tDiff >= 0 ? "+" : ""}{tPct.toFixed(2)}%)
                  </span>
                </div>
              );
            })() : null;

            // 메모 목표가 / 손절가 — 사용자 설정 (컨센서스 "목" 과 구분 — 초록/빨강 라벨)
            const rowMemoTarget = memo?.targetPrice && memo.targetPrice > 0 ? (() => {
              const t = memo.targetPrice;
              const tDiff = t - price.price;
              const tPct = price.price > 0 ? (tDiff / price.price) * 100 : 0;
              const reached = memoTargetReached;
              return (
                <div key="memoTarget" className="text-xs text-gray-700">
                  <span className={`text-[10px] font-bold ${reached
                      ? "bg-emerald-100 text-emerald-700 rounded px-1 mr-0.5"
                      : "text-emerald-600 mr-1"}`}>
                    내목
                  </span>
                  {t.toLocaleString()}원
                  <span className={`ml-1 text-[10px] ${signColor(tDiff)}`}>
                    ({formatSigned(tDiff)}원, {tDiff >= 0 ? "+" : ""}{tPct.toFixed(2)}%)
                  </span>
                </div>
              );
            })() : null;

            const rowMemoStop = memo?.stopPrice && memo.stopPrice > 0 ? (() => {
              const s = memo.stopPrice;
              const sDiff = s - price.price;
              const sPct = price.price > 0 ? (sDiff / price.price) * 100 : 0;
              const reached = memoStopReached;
              return (
                <div key="memoStop" className="text-xs text-gray-700">
                  <span className={`text-[10px] font-bold ${reached
                      ? "bg-rose-100 text-rose-700 rounded px-1 mr-0.5"
                      : "text-rose-600 mr-1"}`}>
                    손절
                  </span>
                  {s.toLocaleString()}원
                  <span className={`ml-1 text-[10px] ${signColor(sDiff)}`}>
                    ({formatSigned(sDiff)}원, {sDiff >= 0 ? "+" : ""}{sPct.toFixed(2)}%)
                  </span>
                </div>
              );
            })() : null;

            // 모든 가격 행을 금액순 (높은 → 낮은) 정렬하여 표시
            // 같은 가격이면 안정성을 위해 입력 순서 유지 (Array.sort 는 stable)
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

        {/* 통계 박스 — 피크/투자원금/보유합계/전체수익/어제대비 (3/10) */}
        <div className="relative border border-gray-200 rounded-md bg-gray-50/60
                        px-2 py-1 basis-[40%] min-w-0 space-y-0.5
                        flex flex-col justify-start">

        {/* 피크 (보유만, 피크가 현재가보다 위) — 보유 기준 총액 */}
        {hasPosition && peak && peak > price.price && (
          <div className="text-xs">
            <span className="text-[10px] text-gray-500">피크 </span>
            <span className="text-gray-700 font-medium">
              {Math.round(peak * stock.shares).toLocaleString()}원
            </span>{" "}
            (<span className={`rounded px-0.5
                               ${isPeakDrop ? "bg-blue-600 text-white font-bold" : ""}`}>
              {peakPct.toFixed(2)}%
            </span>)
          </div>
        )}

        {/* 원금 (보유만) — shares × avg_price */}
        {hasPosition && (
          <div className="text-xs">
            <span className="text-[10px] text-gray-500">원금 </span>
            <span className="text-gray-700">
              {Math.round(stock.avg_price * stock.shares).toLocaleString()}원
            </span>
          </div>
        )}

        {/* 현재 (보유만) — shares × current_price = 현재 평가금액 */}
        {hasPosition && (
          <div className="text-xs">
            <span className="text-[10px] text-gray-500">현재 </span>
            <span className={`font-bold ${signColor(pnl)}`}>
              {Math.round(price.price * stock.shares).toLocaleString()}원
            </span>
          </div>
        )}

        {/* 전체 — 금액만 크게 / % 는 원래 / 손절 시 % 배경 강조 */}
        {hasPosition && (
          <div className="text-xs">
            <span className="text-[10px] text-gray-500">전체 </span>
            <span className={`text-base font-bold ${signColor(pnl)}`}>
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

        {/* 오늘 (보유만) — 보유분 어제대비 변동 (오늘 움직인 금액) */}
        {hasPosition && (
          <div className="text-xs">
            <span className="text-[10px] text-gray-500">오늘 </span>
            <span className={`font-bold bg-yellow-100 rounded px-1 ${signColor(dayDiff)}`}>
              {formatSigned(dayDiff * stock.shares)}원
            </span>{" "}
            <span className={signColor(dayDiff)}>
              ({dayPct >= 0 ? "+" : ""}{dayPct.toFixed(2)}%)
            </span>
          </div>
        )}

        {/* ─── 보조 지표 (3개월 / 변동성 / 외인비율 추세) ─────
            거래일엔 접혀있고 비거래일엔 펼쳐있음. 클릭으로 토글 */}
        <AuxIndicators chart={chart} investorHistory={investorHistory}
                       isTradingDay={!!price.high}
                       defaultOpen={!hasPosition} />

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

          // 5/20/60/120/200일 누적 + 일별 — 모든 행에서 동일한 통합 표 표시.
          // 호버한 행에 대응하는 컬럼 강조 (외인비율 행 → 외인비율(%) 컬럼).
          const tooltipContent = (longHistory && longHistory.length > 0)
            ? allInvestorsTable(key)
            : null;

          const rowEl = (
            <div
              className={`flex items-center justify-between gap-1 px-1 py-px rounded
                          ${rowBg} ${sizeCls} ${tooltipContent ? "cursor-help" : ""}`}
            >
              <span className={`whitespace-nowrap shrink-0 ${labelColor}`}>
                {label}
              </span>
              <span className={`tabular-nums whitespace-nowrap ${valueColor}`}>
                {value}
              </span>
            </div>
          );
          return tooltipContent ? (
            <Tooltip key={label} content={tooltipContent} className="block">
              {rowEl}
            </Tooltip>
          ) : (
            <div key={label}>{rowEl}</div>
          );
        })}
      </div>
    </article>
    </div>
  );
}
