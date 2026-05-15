// 🔧 한국 반도체 점검 — 전문가 모드 미니멀 대시보드
// 차분한 회색 베이스 + 변동률 색만 강조 (rose/blue). 자동 진단으로 핵심만 노출.

import { useEffect } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { fetchYahooBatch, fetchYahooChart } from "../lib/api";
import { allYahooSymbols, US_PAIRS } from "../lib/usMarketData";
import { Sparkline } from "./Sparkline";
import { useAdaptiveRefreshMs } from "../lib/proxyStatus";
import { reportRefresh } from "../lib/lastRefresh";
import { getDimSleepingEnabled } from "../lib/proxyConfig";
import type { UsIndex } from "../lib/api";

function quoteUrl(symbol: string): string {
  const krMatch = /^(\d{6})(?:\.KS)?$/.exec(symbol);
  if (krMatch) return `https://tossinvest.com/stocks/A${krMatch[1]}`;
  if (symbol === "^KS11") return "https://www.tossinvest.com/indices/KGG01P";
  if (symbol === "^KQ11") return "https://www.tossinvest.com/indices/QGG01P";
  if (symbol === "^SOX")  return "https://www.tossinvest.com/indices/SOX.NAI";
  // 미국 종목은 Yahoo Finance (NASDAQ 표준 데이터와 일관)
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`;
}

type Mood = "good" | "warn" | "bad" | "neutral";

// 색 규칙: 빨강=강세/긍정 (good) / 파랑=약세·우려 (bad·warn) / 회색=보통 (neutral)
const MOOD_TEXT: Record<Mood, string> = {
  good:    "text-rose-600",
  warn:    "text-blue-600",
  bad:     "text-blue-600",
  neutral: "text-gray-600",
};
// 메인 가격과 동일 로직 — 거래 휴장 시엔 시간외 마감가, 그 외는 q.price
function effPriceOf(q?: UsIndex): number | null {
  if (!q) return null;
  const closedStates = ["POSTPOST", "PREPRE", "CLOSED"];
  if (q.marketState && closedStates.includes(q.marketState) && q.postPrice) {
    return q.postPrice;
  }
  return q.price;
}
// 어제 종가 대비 합산 변동률 — 시간외 변동도 자동 반영
function pctOf(q?: UsIndex): number | null {
  if (!q) return null;
  const p = effPriceOf(q);
  if (p == null || !Number.isFinite(p) || !Number.isFinite(q.prevClose) || q.prevClose <= 0) return null;
  return ((p - q.prevClose) / q.prevClose) * 100;
}
function fmtPct(pct: number | null): string {
  if (pct == null) return "—";
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

type Direction = "direct" | "inverse" | "neutral";

interface MiniProps {
  symbol: string;
  name: string;
  desc?: string;
  q?: UsIndex;
  chart: number[];
  direction?: Direction;
  dimEnabled?: boolean;
}
// direction === "inverse" 면 상승 = 한국 위험 → 색 반전 (상승=파랑, 하락=빨강)
function colorFor(pct: number | null, direction: Direction = "direct"): string {
  if (pct == null) return "text-gray-500";
  const isUp = pct > 0, isDown = pct < 0;
  if (direction === "inverse") {
    return isUp ? "text-blue-600" : isDown ? "text-rose-600" : "text-gray-700";
  }
  return isUp ? "text-rose-600" : isDown ? "text-blue-600" : "text-gray-700";
}
function Mini({ symbol, name, desc, q, chart, direction = "direct", dimEnabled = false }: MiniProps) {
  // 메인 가격 = 가장 최신 NASDAQ 거래 가격.
  //   REGULAR/PRE/POST: q.price (Yahoo 분기로 라이브 가격 자동 설정)
  //   POSTPOST/PREPRE/CLOSED: 거래 휴장 → 시간외 마감가(postPrice) 가 가장 최신
  const closedStates = ["POSTPOST", "PREPRE", "CLOSED"];
  const effPrice = q?.marketState && closedStates.includes(q.marketState) && q.postPrice
    ? q.postPrice
    : q?.price;
  const effBase = q?.prevClose;
  // 메인 변동률 — REGULAR 시 Yahoo raw regularPct 우선 (선물 등 base 불일치 종목 대응),
  // 그 외 (POST/POSTPOST 등) 시 시간외 포함 합산 변동률
  const pct = (q?.marketState === "REGULAR" && q.regularPct != null)
    ? q.regularPct
    : (effPrice != null && effBase != null && effBase > 0
       ? ((effPrice - effBase) / effBase) * 100
       : null);
  const cdiff = effPrice != null && effBase != null ? effPrice - effBase : 0;
  // 배경 색도 direction 따라
  const effUp = direction === "inverse" ? cdiff < 0 : cdiff > 0;
  const effDn = direction === "inverse" ? cdiff > 0 : cdiff < 0;
  const bg = effUp ? "bg-rose-50 border-rose-200"
           : effDn ? "bg-blue-50 border-blue-200"
           : "bg-white border-gray-200";
  const cls = colorFor(pct, direction);
  return (
    <div className="relative pt-2">
      {/* 책갈피 — 메인 가격이 정규장 종가와 다를 때 (정보 중복 회피).
          POSTPOST 시 메인 = 시간외 마감가, 책갈피 = 정규장 종가 → 다른 정보, 책갈피 표시
          REGULAR 시 메인 = 정규장 라이브 = regularPrice 와 동일 → 책갈피 X */}
      {q && q.regularPrice != null && effPrice !== q.regularPrice && (() => {
        const rp = q.regularPrice;
        const rpct = q.regularPct ?? null;
        const cls = rpct == null ? "text-gray-700"
          : rpct > 0 ? "text-rose-600" : rpct < 0 ? "text-blue-600" : "text-gray-700";
        const tagBg = rpct == null ? "bg-white border-gray-300"
          : rpct > 0 ? "bg-rose-100 border-rose-300"
          : rpct < 0 ? "bg-blue-100 border-blue-300"
          : "bg-white border-gray-300";
        return (
          <div className={`absolute -top-0.5 right-2 z-20 px-1.5 py-0
                          border rounded-md shadow-sm
                          text-[9px] font-medium leading-tight whitespace-nowrap ${tagBg}`}>
            <span className="text-gray-500">마감 </span>
            <span className="text-gray-800 tabular-nums">
              {rp < 1000 ? rp.toFixed(2) : Math.round(rp).toLocaleString()}
            </span>
            {rpct != null && (
              <span className={`tabular-nums ml-1 ${cls}`}>
                ({rpct >= 0 ? "+" : ""}{rpct.toFixed(2)}%)
              </span>
            )}
          </div>
        );
      })()}
    <div className={`relative overflow-hidden
                     flex flex-col gap-0.5 rounded-lg border px-3 py-1.5 ${bg}
                     ${dimEnabled && q?.marketState && closedStates.includes(q.marketState) ? "opacity-60" : ""}`}>
      <Sparkline data={chart} width={400} height={80}
                 color={chart.length > 1
                   ? (chart[chart.length - 1] > chart[0]
                       ? (direction === "inverse" ? "#2563eb" : "#dc2626")
                       : (direction === "inverse" ? "#dc2626" : "#2563eb"))
                   : undefined}
                 className="absolute inset-0 w-full h-full opacity-50
                            pointer-events-none" />
      <a href={quoteUrl(symbol)}
         target="_blank" rel="noopener noreferrer"
         title={`${name} 자세히 보기`}
         className="relative z-10 text-base font-bold text-gray-900 truncate hover:underline">
        {name}
      </a>
      {desc && (
        <div className="relative z-10 text-[11px] text-gray-500 truncate">
          {desc}
        </div>
      )}
      <div className="relative z-10 flex items-baseline mt-1">
        <span className={`flex-1 text-left text-sm tabular-nums ${cls}`}>
          {effPrice == null ? "—"
            : effPrice < 1000 ? effPrice.toFixed(2)
            : Math.round(effPrice).toLocaleString()}
        </span>
        <span className={`flex-1 text-right text-xl font-bold tabular-nums ${cls}`}>
          {pct != null && Math.abs(pct) >= 0.005 ? fmtPct(pct) : ""}
        </span>
      </div>
    </div>
    </div>
  );
}

export function SemiCheckTab() {
  const yahooSymbols = allYahooSymbols();
  // 가격 데이터: 앱 기본 폴링 주기와 동일 (UsMarketTab 과 캐시 공유)
  const REFRESH_MS = useAdaptiveRefreshMs(10_000);
  const { data: usMap, dataUpdatedAt } = useQuery({
    queryKey: ["yahoo-batch", yahooSymbols.length],
    queryFn: () => fetchYahooBatch(yahooSymbols),
    refetchInterval: REFRESH_MS,
  });
  useEffect(() => {
    if (dataUpdatedAt > 0) reportRefresh(dataUpdatedAt);
  }, [dataUpdatedAt]);

  const symbols = ["MU", "NVDA", "AMAT", "LRCX", "ASML", "^SOX", "SOX=F", "KRW=X", "DX-Y.NYB"];
  const chartQs = useQueries({
    queries: symbols.map(sym => ({
      queryKey: ["yahoo-chart", sym, "3mo"],
      queryFn: () => fetchYahooChart(sym, "3mo"),
      staleTime: 60 * 60 * 1000,
      refetchOnWindowFocus: false,
    })),
  });
  const rawChartMap = new Map(symbols.map((sym, i) => [sym, chartQs[i]?.data ?? []]));
  // sparkline fallback — Yahoo 가 historical 안 주는 심볼은 가장 가까운 현물로 대체
  const SPARKLINE_FALLBACK: Record<string, string> = { "SOX=F": "^SOX" };
  const chartMap = new Map(symbols.map(sym => {
    const own = rawChartMap.get(sym) ?? [];
    if (own.length > 1) return [sym, own];
    const fb = SPARKLINE_FALLBACK[sym];
    return [sym, fb ? (rawChartMap.get(fb) ?? own) : own];
  }));
  const nameOf = (sym: string) =>
    US_PAIRS.find(p => p.symbol === sym)?.name ?? sym;
  const descOf = (sym: string) =>
    US_PAIRS.find(p => p.symbol === sym)?.desc;
  const dimEnabled = getDimSleepingEnabled();
  const directionOf = (sym: string): Direction =>
    (US_PAIRS.find(p => p.symbol === sym)?.direction ?? "direct") as Direction;

  // ─── 자동 진단 ───
  const muPct   = pctOf(usMap?.get("MU"));
  const nvdaPct = pctOf(usMap?.get("NVDA"));
  const memoryAiMood: Mood = (() => {
    if (muPct == null || nvdaPct == null) return "neutral";
    if (muPct > 0 && nvdaPct > 0) return "good";
    if (muPct < 0 && nvdaPct < 0) return "bad";
    return "warn";
  })();
  const memoryAiDesc =
    memoryAiMood === "good" ? "마이크론(미국 메모리 반도체)과 엔비디아(AI 칩 대표)가 동반 상승. 메모리 수요와 AI 수요가 같이 살아나는 신호 — 삼성전자·SK하이닉스의 메모리 사업도 강세 가능성"
    : memoryAiMood === "bad"  ? "마이크론과 엔비디아가 동반 하락. 메모리 사이클과 AI 수요 모두 부진 — 삼성전자·SK하이닉스 메모리도 약세 가능성"
    : memoryAiMood === "warn" ? "마이크론과 엔비디아가 따로 움직임. 미국 반도체 지수가 강세여도 메모리 사이클은 부진할 수 있다는 신호 — 한국 메모리 강세라고 단정하기 어려운 상태"
    : "—";

  const equipPcts = ["AMAT", "LRCX", "ASML"].map(s => pctOf(usMap?.get(s)))
    .filter((v): v is number => v != null);
  const equipAvg = equipPcts.length ? equipPcts.reduce((a, b) => a + b, 0) / equipPcts.length : null;
  const equipMood: Mood = equipAvg == null ? "neutral"
    : equipAvg > 0.5 ? "good" : equipAvg < -0.5 ? "bad" : "neutral";
  const equipDesc =
    equipMood === "good" ? "반도체 공장 설비를 만드는 3대 회사(어플라이드머티리얼즈·램리서치·ASML)가 강세. 반도체 회사들이 새 공장과 장비에 투자를 늘리고 있다는 신호 — 6~12개월 후 삼성전자·SK하이닉스 메모리 매출 증가 가능성"
    : equipMood === "bad" ? "장비 3사가 약세. 반도체 회사들이 설비 투자를 줄이고 있다는 신호 — 6~12개월 시차로 삼성전자·SK하이닉스 메모리 매출에도 부담 가능"
    : "장비 3사 보합 — 특별한 방향성 없음";

  const soxPct    = pctOf(usMap?.get("^SOX"));
  const soxFutPct = pctOf(usMap?.get("SOX=F"));
  const soxMood: Mood = soxPct == null ? "neutral"
    : soxPct > 1 ? "good" : soxPct < -1 ? "bad" : "neutral";
  const soxStatusLine = soxFutPct != null
    ? `정규 ${fmtPct(soxPct)} · 야간 ${fmtPct(soxFutPct)}`
    : `정규 ${fmtPct(soxPct)}`;
  const soxDesc =
    soxMood === "good" ? `미국 반도체 30개사 평균(필라델피아반도체 지수)이 강세. 한국 반도체(삼성전자·SK하이닉스)도 우호적 출발 신호 — 정규장 종가 + 야간 선물: ${soxStatusLine}`
    : soxMood === "bad"  ? `미국 반도체 30개사 평균(필라델피아반도체 지수)이 약세. 한국 반도체(삼성전자·SK하이닉스)도 약세 출발 가능성 — 정규장 종가 + 야간 선물: ${soxStatusLine}`
    : `특별한 방향성 없음 — 정규장 종가 + 야간 선물: ${soxStatusLine}`;

  const krwPrice = usMap?.get("KRW=X")?.price ?? 0;
  // 원달러 ≥1,400원 = 부정 신호 → bad (파랑)
  const fxMood: Mood = krwPrice === 0 ? "neutral"
    : krwPrice >= 1400 ? "bad"
    : krwPrice >= 1350 ? "neutral"
    : "good";
  const fxDesc = krwPrice === 0 ? "—"
    : krwPrice >= 1400 ? `원달러 ${Math.round(krwPrice).toLocaleString()}원 — 외국인 매도 압력 (원화 약세로 환차손 위험, 외국인 자금 이탈 가능성)`
    : krwPrice >= 1350 ? `원달러 ${Math.round(krwPrice).toLocaleString()}원 — 중립 (강세·약세 신호 모두 약함)`
    : `원달러 ${Math.round(krwPrice).toLocaleString()}원 — 안정 (외국인 자금이 들어오기 좋은 환경)`;

  // 종합 — 메모리·AI 가중 2배
  const w: Record<Mood, number> = { good: 1, neutral: 0, warn: -0.5, bad: -1 };
  const score = w[memoryAiMood] * 2 + w[equipMood] + w[soxMood] + w[fxMood];
  const overall: Mood =
    score >= 2 ? "good" : score <= -2 ? "bad" : score < 0 ? "warn" : "neutral";
  const overallTitle =
    overall === "good" ? "한국 반도체 강세 환경"
    : overall === "bad"  ? "한국 반도체 약세 환경"
    : overall === "warn" ? "혼조 — 신호 엇갈림"
    : "특이 신호 없음";
  // ─── 4단계 신호 결과를 실제로 풀어서 종합 — JSX 로 색 부여 ───
  const partOf = (mood: Mood, goodMsg: string, warnMsg: string, badMsg: string): string => {
    if (mood === "good") return goodMsg;
    if (mood === "warn") return warnMsg;
    if (mood === "bad")  return badMsg;
    return "보합";
  };
  // ─── 한국 메모리 2사 분리 분석 — 신호 mood 조합 기반 동적 ───
  let hynixMood: Mood = "neutral";
  let hynixDesc = "특이 신호 없음";
  if (memoryAiMood === "good" && equipMood === "good") {
    hynixMood = "good";
    hynixDesc = "메모리·HBM 직격 강세 — 가장 큰 수혜 예상";
  } else if (memoryAiMood === "bad") {
    hynixMood = "bad";
    hynixDesc = "메모리·HBM 직격 약세 — 가장 직접적 영향";
  } else if (memoryAiMood === "warn" && equipMood === "good") {
    hynixMood = "warn";
    hynixDesc = "HBM 장비 우호 vs 메모리 사이클 우려 — 엇갈림 (변동성 높음)";
  } else if (memoryAiMood === "warn") {
    hynixMood = "warn";
    hynixDesc = "메모리 사이클 모호 — 신호 검증 필요";
  } else if (equipMood === "good") {
    hynixMood = "good";
    hynixDesc = "HBM 장비 capex 확장 — 중기(6~12개월) 우호";
  } else if (equipMood === "bad") {
    hynixMood = "bad";
    hynixDesc = "HBM 장비 둔화 — 중기 부담 가능";
  }

  let samsungMood: Mood = "neutral";
  let samsungDesc = "메모리 부문 보합, 비메모리·가전 별도 변수 작용";
  if (memoryAiMood === "good" && equipMood === "good") {
    samsungMood = "good";
    samsungDesc = "메모리 강세 효과 일부 (~30% 비중) — 비메모리·가전 별도 점검 필요";
  } else if (memoryAiMood === "bad") {
    samsungMood = "bad";
    samsungDesc = "메모리 약세 영향 일부, 비메모리·가전 다각화로 충격 완화 가능";
  } else if (memoryAiMood === "warn") {
    samsungMood = "warn";
    samsungDesc = "메모리 신호 모호 + 비메모리(파운드리)·가전 별도 변수";
  } else if (equipMood === "good") {
    samsungMood = "good";
    samsungDesc = "장비 강세는 메모리 OPM 기여 — 다만 영향 분산됨";
  }

  // 원달러 양사 공통
  const fxNote = fxMood === "bad"
    ? "단, 원달러 급등으로 외국인 매도 압력 (양사 공통)"
    : fxMood === "good"
      ? "원달러 안정으로 외국인 수급 우호 (양사 공통)"
      : "";

  const summaryParts: Array<{ label: string; mood: Mood; text: string }> = [
    { label: "미국 반도체 지수", mood: soxMood,
      text: partOf(soxMood, "강세", "보합", "약세") },
    { label: "메모리·AI 동조",   mood: memoryAiMood,
      text: partOf(memoryAiMood, "동반 상승", "탈동조", "동반 하락") },
    { label: "HBM 장비주",      mood: equipMood,
      text: partOf(equipMood, "강세 (6~12개월 후 한국 수혜)", "약세 (향후 부담)", "약세 (향후 부담)") },
    { label: "환율",            mood: fxMood,
      text: partOf(fxMood, "안정 (외국인 우호)", "급등 (외국인 매도 압력)", "급등") },
  ];

  interface Signal {
    title: string;
    desc: string;
    mood: Mood;
    symbols: string[];
  }
  // 분석가 동선:
  //   STEP 1 — 필반 + 선물 1차 인상
  //   STEP 2 — 메모리·AI 동조성 검증
  //   STEP 3 — HBM 장비주 추가 검증
  //   STEP 4 — 환율 외부 변수 확인
  //   → 최종 종합 판단
  interface StepSignal extends Signal {
    step: string;
    stepLabel: string;
  }
  const signals: StepSignal[] = [
    { step: "STEP 1", stepLabel: "1차 인상",  title: "필라델피아반도체",
      desc: soxDesc, mood: soxMood, symbols: ["^SOX", "SOX=F"] },
    { step: "STEP 2", stepLabel: "동조성 검증", title: "메모리·AI 동행",
      desc: memoryAiDesc, mood: memoryAiMood, symbols: ["MU", "NVDA"] },
    { step: "STEP 3", stepLabel: "선행 신호 검증", title: "HBM 장비주",
      desc: equipDesc, mood: equipMood, symbols: ["AMAT", "LRCX", "ASML"] },
    { step: "STEP 4", stepLabel: "외부 변수", title: "환율",
      desc: fxDesc, mood: fxMood, symbols: ["KRW=X", "DX-Y.NYB"] },
  ];

  return (
    <div className="space-y-2 pb-2">
      {/* ─── STEP 1~4 — 외곽 박스 없이 흐름만 ─── */}
      <div className="space-y-4">
        {signals.map(sig => (
          <section key={sig.step}>
            <header className="flex items-baseline gap-2 mb-1.5 flex-wrap">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                {sig.step}
              </span>
              <span className="text-[11px] text-gray-500">· {sig.stepLabel}</span>
              <h3 className="text-[13px] font-semibold text-gray-800">{sig.title}</h3>
            </header>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
              {sig.symbols.map(symbol => (
                <Mini key={symbol}
                      symbol={symbol}
                      name={nameOf(symbol)}
                      desc={descOf(symbol)}
                      q={usMap?.get(symbol)}
                      chart={chartMap.get(symbol) ?? []}
                      direction={directionOf(symbol)}
                      dimEnabled={dimEnabled} />
              ))}
            </div>
            <p className={`mt-2 text-sm font-bold ${MOOD_TEXT[sig.mood]}`}>
              → {sig.desc}
            </p>
          </section>
        ))}
      </div>

      {/* ─── 최종 종합 판단 ─── */}
      <section className="pt-3 border-t border-gray-200">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
            최종 판단
          </span>
          <h3 className={`text-lg font-bold ${MOOD_TEXT[overall]}`}>
            {overallTitle}
          </h3>
        </div>
        <div className="text-[13px] mt-1 leading-relaxed space-y-0.5">
          {summaryParts.map(p => (
            <div key={p.label}>
              <span className="text-gray-500">{p.label}</span>
              <span className={`font-semibold ml-1 ${MOOD_TEXT[p.mood]}`}>
                {p.text}
              </span>
            </div>
          ))}
        </div>
        {/* 한국 메모리 2사 분리 분석 — 현재 신호 조합에 따라 동적 */}
        <div className="text-[12px] text-gray-600 mt-2 leading-relaxed space-y-0.5">
          <p>
            <span className={`font-semibold ${MOOD_TEXT[hynixMood]}`}>SK하이닉스</span>
            {" — "}
            <span className={`font-semibold ${MOOD_TEXT[hynixMood]}`}>{hynixDesc}</span>
          </p>
          <p>
            <span className={`font-semibold ${MOOD_TEXT[samsungMood]}`}>삼성전자</span>
            {" — "}
            <span className={`font-semibold ${MOOD_TEXT[samsungMood]}`}>{samsungDesc}</span>
          </p>
          {fxNote && (
            <p className={`font-semibold ${MOOD_TEXT[fxMood]}`}>{fxNote}</p>
          )}
        </div>
      </section>

      <p className="text-[10px] text-gray-400 text-right">
        Yahoo Finance · 1시간 캐시 · 참고용 (투자 권유 아님)
      </p>
    </div>
  );
}
