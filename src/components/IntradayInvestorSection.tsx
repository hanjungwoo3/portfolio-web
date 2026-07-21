// 증시탭 — 투자자 순매수. 코스피·선물·코스닥 3개를 한 줄에, 공통 투자자 토글로 제어.
//   [당일] 시간별 누적(네이버 intraday) / [일별] 기간별 누적(네이버 daily) 토글.
//   일별은 기간 선택 + 기간 합계(헤더)를 표시. 데이터: 네이버 investorDealTrend*(로그인 불필요).

import { useState, useMemo, useCallback, lazy, Suspense, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchKrIntradayInvestorFlow, fetchKrDailyInvestorFlow, fetchYahooIntraday, fetchYahooPriceHistory, fetchKrFuturesDaily, fetchLeverageDailyFlow, fetchKrPriceHistory, LEVERAGE_BASKETS } from "../lib/api";
import type { IntradayMarket, LeverageBasket } from "../lib/api";
import { INTRADAY_SERIES, type IntradayKey } from "../lib/intradayInvestor";
import { useCrosshairSync, type SyncRegistrar } from "../lib/useCrosshairSync";
import type { FlowSeriesPoint } from "./IntradayInvestorChart";
import type { UTCTimestamp } from "lightweight-charts";

const IntradayInvestorChart = lazy(() => import("./IntradayInvestorChart"));

const MARKETS: { key: IntradayMarket; label: string }[] = [
  { key: "kospi",   label: "코스피" },
  { key: "futures", label: "선물" },
  { key: "kosdaq",  label: "코스닥" },
];
const PERIODS: { label: string; days: number }[] = [
  { label: "1주",   days: 5 },
  { label: "1개월", days: 22 },
  { label: "3개월", days: 66 },
  { label: "6개월", days: 132 },
];
const KEYS: IntradayKey[] = INTRADAY_SERIES.map(s => s.key);
const OPEN_KEY = "intraday_investor_open";
const CARDS_KEY = "intraday_investor_cards";   // 카드 숨김/보임 (체크한 카드만 렌더)

// 보이는 카드 수에 맞춰 그리드 컬럼(빈 칸 없이 폭 채움). Tailwind 정적 클래스 매핑.
function gridColsClass(n: number, max: number): string {
  const c = Math.min(Math.max(n, 1), max);
  return ({
    1: "grid-cols-1",
    2: "grid-cols-1 sm:grid-cols-2",
    3: "grid-cols-1 sm:grid-cols-3",
    4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
  } as Record<number, string>)[c] ?? "grid-cols-1";
}

function pick(p: Record<IntradayKey, number>): Record<IntradayKey, number> {
  const o = {} as Record<IntradayKey, number>;
  for (const k of KEYS) o[k] = p[k];
  return o;
}
function todayKST(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}
function shiftDate(d: string, delta: number): string {
  const dt = new Date(`${d}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}
function hmToTime(hm: string): UTCTimestamp {
  const [h, m] = hm.split(":").map(Number);
  return (Date.UTC(2000, 0, 1, h, m) / 1000) as UTCTimestamp;
}
function dateToTime(d: string): UTCTimestamp {
  const [y, mo, day] = d.split("-").map(Number);
  return (Date.UTC(y, mo - 1, day) / 1000) as UTCTimestamp;
}
// 배경 지수 — 코스피(^KS11)·코스닥(^KQ11)·선물(^KS200=코스피200 스팟, 일중 형태용 — 레벨은 실선물로 보정).
const YAHOO_SYM: Partial<Record<IntradayMarket, string>> = { kospi: "^KS11", kosdaq: "^KQ11", futures: "^KS200" };
const INDEX_LABEL: Partial<Record<IntradayMarket, string>> = { kospi: "코스피", kosdaq: "코스닥", futures: "K200선물" };
// Yahoo intraday 봉(UTC epoch초) → KST 날짜 + 당일 시간축 타임스탬프.
function kstFromEpoch(sec: number): { date: string; t: UTCTimestamp } {
  const d = new Date((sec + 9 * 3600) * 1000);
  return {
    date: d.toISOString().slice(0, 10),
    t: (Date.UTC(2000, 0, 1, d.getUTCHours(), d.getUTCMinutes()) / 1000) as UTCTimestamp,
  };
}

function MarketBlock({ market, label, enabled, mode, days, bizdate, on, onReady, onToggle, refFirstT, refLastT }: {
  market: IntradayMarket; label: string; enabled: Record<string, boolean>;
  mode: "intraday" | "daily"; days: number; bizdate: string; on: boolean; onReady: SyncRegistrar;
  onToggle: (k: IntradayKey) => void;
  refFirstT?: UTCTimestamp; refLastT?: UTCTimestamp;   // 기준 시간범위(코스피·코스닥)
}) {
  const intra = useQuery({
    queryKey: ["market-flow-intraday", market, bizdate],
    queryFn: () => fetchKrIntradayInvestorFlow(market, bizdate.replace(/-/g, "")),
    enabled: on && mode === "intraday",
    staleTime: 60_000, refetchOnWindowFocus: false,
  });
  const daily = useQuery({
    queryKey: ["market-flow-daily", market, days],
    queryFn: () => fetchKrDailyInvestorFlow(market, days),
    enabled: on && mode === "daily",
    staleTime: 5 * 60_000, refetchOnWindowFocus: false,
  });

  // 배경 지수(코스피/코스닥) — 당일=Yahoo 분봉, 일별=Yahoo 일봉.
  const ysym = YAHOO_SYM[market];
  const idxIntra = useQuery({
    queryKey: ["idx-intra", ysym, bizdate],
    queryFn: () => fetchYahooIntraday(ysym!, "5d", "5m"),
    enabled: on && mode === "intraday" && !!ysym,
    staleTime: 60_000, refetchOnWindowFocus: false,
  });
  const idxDaily = useQuery({
    queryKey: ["idx-daily", ysym],
    queryFn: () => fetchYahooPriceHistory(ysym!, "1y"),
    enabled: on && mode === "daily" && !!ysym,
    staleTime: 5 * 60_000, refetchOnWindowFocus: false,
  });
  // 선물 전용 — 네이버 실선물(FUT). 일별=실선물 일봉을 배경으로 직접 사용,
  //  일중=야후 ^KS200(스팟) 형태를 이 실선물가 레벨로 베이시스-시프트(+기준선=실선물 전일종가).
  const fut = useQuery({
    queryKey: ["kr-futures-daily"],
    queryFn: () => fetchKrFuturesDaily(60),
    enabled: on && market === "futures",
    staleTime: 60_000, refetchOnWindowFocus: false,
  });

  const q = mode === "intraday" ? intra : daily;

  const shell = (inner: ReactNode) => (
    <div className="h-[240px] flex flex-col items-center justify-center text-xs text-gray-400 border border-gray-200 rounded gap-0.5">
      <span className="font-bold text-green-600">{label}</span>{inner}
    </div>
  );
  if (q.isLoading) return shell(<span>불러오는 중…</span>);

  let series: FlowSeriesPoint[] = [];
  let summary = {} as Record<IntradayKey, number>;
  let unit = market === "futures" ? "계약" : "억원";
  let indexSeries: { t: UTCTimestamp; value: number }[] | undefined;
  let indexBaseline: number | undefined;   // 전일 종가(기준가)

  if (mode === "intraday") {
    const pts = intra.data?.points ?? [];
    if (pts.length < 2) return shell(<span>당일 데이터 없음 <span className="text-[10px]">(장 시작 전/집계 전)</span></span>);
    unit = intra.data!.unit;
    series = pts.map(p => ({ t: hmToTime(p.time), label: p.time, values: pick(p) }));
    summary = pick(pts[pts.length - 1]);   // 당일 누적 최신
    if (ysym && idxIntra.data) {
      const withKst = idxIntra.data.map(b => ({ ...kstFromEpoch(b.t), close: b.close }));   // 야후 ascending 유지
      // 전일 종가 = 선택일 이전 마지막 봉의 종가 (기준선/빨강·파랑)
      const prior = withKst.filter(b => b.date < bizdate);
      if (prior.length) indexBaseline = prior[prior.length - 1].close;
      // 지수 봉을 투자자 시각 격자에 리샘플 → 같은 t만 사용(추가 슬롯 없음)해야
      // ordinal 시간축이 안 틀어지고 세로선/축이 정확히 맞음.
      const bars = withKst.filter(b => b.date === bizdate).sort((a, b) => (a.t as number) - (b.t as number));
      if (bars.length > 1) {
        let j = 0;
        indexSeries = series.map(sp => {
          const st = sp.t as number;
          while (j < bars.length - 1 && Math.abs((bars[j + 1].t as number) - st) <= Math.abs((bars[j].t as number) - st)) j++;
          return { t: sp.t, value: bars[j].close };
        });
      }
      // 선물: 분봉 실선물 소스가 프록시 허용 호스트에 없어, 야후 ^KS200(스팟) 형태를
      //  실선물가 레벨로 평행이동(베이시스-시프트) — 오른쪽 끝을 HTS 선물가와 정확히 일치시키고
      //  기준선(빨강·파랑)은 실선물 전일종가 기준. (베이시스는 일중 거의 일정)
      if (market === "futures" && fut.data && indexSeries && indexSeries.length) {
        const basis = fut.data.price - indexSeries[indexSeries.length - 1].value;
        indexSeries = indexSeries.map(p => ({ t: p.t, value: p.value + basis }));
        indexBaseline = fut.data.prevClose;
      }
    }
  } else {
    const pts = daily.data?.points ?? [];
    if (pts.length < 2) return shell(<span>일별 데이터 없음</span>);
    unit = daily.data!.unit;
    const acc = {} as Record<IntradayKey, number>;
    for (const k of KEYS) acc[k] = 0;
    series = pts.map(p => {
      for (const k of KEYS) acc[k] += p[k];
      return { t: dateToTime(p.date), label: p.date.slice(5).replace("-", "/"), values: { ...acc }, daily: pick(p) };
    });
    summary = { ...acc };   // 기간 합계 = 최종 누적
    if (market === "futures" && fut.data) {
      // 선물 일별은 실선물(FUT) 일봉을 배경으로 직접 사용 — 스팟이 아니라 정확.
      const closeByDate = new Map(fut.data.series.map(p => [p.date, p.close]));
      indexSeries = pts
        .map(p => ({ t: dateToTime(p.date), value: closeByDate.get(p.date) }))
        .filter((p): p is { t: UTCTimestamp; value: number } => typeof p.value === "number");
      const prior = fut.data.series.filter(p => p.date < pts[0].date);
      indexBaseline = prior.length ? prior[prior.length - 1].close : fut.data.prevClose;
    } else if (ysym && idxDaily.data) {
      const closeByDate = new Map(idxDaily.data.map(p => [p.date, p.close]));
      indexSeries = pts
        .map(p => ({ t: dateToTime(p.date), value: closeByDate.get(p.date) }))
        .filter((p): p is { t: UTCTimestamp; value: number } => typeof p.value === "number");
      // 기준선 = 기간 첫날 직전 거래일 종가
      const prior = idxDaily.data.filter(p => p.date < pts[0].date);
      if (prior.length) indexBaseline = prior[prior.length - 1].close;
    }
  }

  // 선물(KOSPI200)은 원 스케일(×100)로 표시 — KODEX 200 ETF(≈지수×100) 가격대와 맞춤(예: 1,060.16 → 106,016).
  if (market === "futures") {
    if (indexSeries) indexSeries = indexSeries.map(p => ({ t: p.t, value: p.value * 100 }));
    if (indexBaseline != null) indexBaseline *= 100;
  }
  // 선물 순매수 계약 → 금액(억원) 환산: 계약 × 선물지수 × 25만원(거래승수) ÷ 1억.
  //  네이버 선물 엔드포인트는 계약만 주므로 실선물가로 환산해 코스피·코스닥과 같은 억원 단위로 비교.
  //  (누적 순계약 × 당일 선물가로 근사 — 정확한 거래대금은 아니나 규모 비교엔 충분)
  if (market === "futures" && fut.data) {
    const perContractEok = (fut.data.price * 250_000) / 1e8;   // 계약당 억원
    const conv = (o: Record<IntradayKey, number>) => {
      const r = {} as Record<IntradayKey, number>;
      for (const k of KEYS) r[k] = Math.round(o[k] * perContractEok);
      return r;
    };
    series = series.map(sp => ({ ...sp, values: conv(sp.values), daily: sp.daily ? conv(sp.daily) : undefined }));
    summary = conv(summary);
    unit = "억원";
  }

  return (
    <Suspense fallback={<div className="h-[260px]" />}>
      <IntradayInvestorChart series={series} summary={summary} enabled={enabled}
        unit={unit} marketLabel={label} timeVisible={mode === "intraday"}
        summaryHint={mode === "daily" ? "기간합계" : undefined}
        indexSeries={indexSeries} indexLabel={ysym ? INDEX_LABEL[market] : undefined}
        indexBaseline={indexBaseline} onReady={onReady} onToggle={onToggle}
        refFirstT={refFirstT} refLastT={refLastT} />
    </Suspense>
  );
}

// 단일종목 레버리지 수급 — 증권사별 레버리지 ETF·ETN 바스켓 합산(개인/외국인/기관, 억원).
//   일별 전용(개별종목 시간별 데이터 없음). 배경 지수 = 기초자산 주가.
//   range-sync 격리(broadcast/receive=false): 히스토리 짧은(신규 ETN) 차트가 메인 시장 차트를 클램프하지 않게.
function LeverageBlock({ basket, enabled, days, on, onReady, onToggle }: {
  basket: LeverageBasket; enabled: Record<string, boolean>; days: number; on: boolean;
  onReady: SyncRegistrar; onToggle: (k: IntradayKey) => void;
}) {
  const flow = useQuery({
    queryKey: ["leverage-daily", basket.key, days],
    queryFn: () => fetchLeverageDailyFlow(basket.codes, days),
    enabled: on, staleTime: 5 * 60_000, refetchOnWindowFocus: false,
  });
  const px = useQuery({
    queryKey: ["leverage-underlying-px", basket.underlyingTicker],
    queryFn: () => fetchKrPriceHistory(basket.underlyingTicker, "6mo"),
    enabled: on, staleTime: 5 * 60_000, refetchOnWindowFocus: false,
  });
  const underlyingName = basket.name.replace(/ (레버리지|인버스2X)$/, "");
  const isInverse = basket.name.includes("인버스");

  const shell = (inner: ReactNode) => (
    <div className="h-[240px] flex flex-col items-center justify-center text-xs text-gray-400 border border-gray-200 rounded gap-0.5">
      <span className={`font-bold ${isInverse ? "text-sky-600" : "text-fuchsia-600"}`}>{basket.name}</span>{inner}
    </div>
  );
  if (flow.isLoading) return shell(<span>불러오는 중…</span>);
  const pts = flow.data?.points ?? [];
  if (pts.length < 2) return shell(<span>일별 데이터 없음 <span className="text-[10px]">(신규 상장/집계 전)</span></span>);

  const acc = {} as Record<IntradayKey, number>;
  for (const k of KEYS) acc[k] = 0;
  const series: FlowSeriesPoint[] = pts.map(p => {
    for (const k of KEYS) acc[k] += p[k];
    return { t: dateToTime(p.date), label: p.date.slice(5).replace("-", "/"), values: { ...acc }, daily: pick(p) };
  });
  const summary = { ...acc };

  let indexSeries: { t: UTCTimestamp; value: number }[] | undefined;
  let indexBaseline: number | undefined;
  if (px.data && px.data.length) {
    const closeByDate = new Map(px.data.map(p => [p.date, p.close]));
    indexSeries = pts
      .map(p => ({ t: dateToTime(p.date), value: closeByDate.get(p.date) }))
      .filter((p): p is { t: UTCTimestamp; value: number } => typeof p.value === "number");
    const prior = px.data.filter(p => p.date < pts[0].date);
    if (prior.length) indexBaseline = prior[prior.length - 1].close;
  }

  return (
    <Suspense fallback={<div className="h-[260px]" />}>
      <IntradayInvestorChart series={series} summary={summary} enabled={enabled}
        unit="억원" marketLabel={basket.name} timeVisible={false} summaryHint="기간합계"
        indexSeries={indexSeries} indexLabel={indexSeries?.length ? underlyingName : undefined}
        indexBaseline={indexBaseline} onReady={onReady} onToggle={onToggle} />
    </Suspense>
  );
}

export function IntradayInvestorSection() {
  const [open, setOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(OPEN_KEY) !== "off"; } catch { return true; }
  });
  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    try { localStorage.setItem(OPEN_KEY, next ? "on" : "off"); } catch { /* noop */ }
  };

  const [mode, setMode] = useState<"intraday" | "daily">("intraday");
  const [days, setDays] = useState<number>(22);   // 일별 기간 (기본 1개월)
  const [intraDate, setIntraDate] = useState<string>(todayKST());   // 당일 뷰 조회일
  const today = todayKST();

  const [enabled, setEnabled] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const s of INTRADAY_SERIES) init[s.key] = s.on;
    return init;
  });
  const toggleInvestor = (k: string) => setEnabled(e => ({ ...e, [k]: !e[k] }));

  // 카드 숨김/보임 — 체크한 카드만 렌더. 키 = 시장 key(kospi/futures/kosdaq) + 바스켓 key(lev-samsung…).
  const [cardOn, setCardOn] = useState<Record<string, boolean>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(CARDS_KEY) || "{}");
      if (saved && typeof saved === "object") return saved;
    } catch { /* noop */ }
    return {};   // 미지정 = 보임(기본 전부 보임)
  });
  const cardVisible = (k: string) => cardOn[k] !== false;   // 명시적 false 만 숨김
  const toggleCard = (k: string) => setCardOn(c => {
    const next = { ...c, [k]: c[k] === false ? true : false };
    try { localStorage.setItem(CARDS_KEY, JSON.stringify(next)); } catch { /* noop */ }
    return next;
  });

  const registerSync = useCrosshairSync();   // 3개 차트 crosshair 동기화
  // 레버리지 차트는 range 격리(broadcast/receive=false) — 신규 ETN 짧은 히스토리가 시장 차트 범위를 흔들지 않게.
  //   crosshair(hover)는 그대로 동기화되고, 줌/팬 범위만 독립.
  const registerLeverageSync: SyncRegistrar = useCallback(
    (c, a, h) => registerSync(c, a, h, { rangeBroadcast: false, rangeReceive: false }),
    [registerSync]);

  // 기준 시간범위 = 코스피·코스닥 데이터 범위(선물 제외). 선물이 후행이라 끝시각이 이르므로,
  //   이 범위를 각 차트에 내려 선물이 우측을 공백으로 맞추게 함(코스피·코스닥이 시간축 기준).
  //   MarketBlock 과 동일 queryKey → react-query 가 요청을 중복 없이 공유(추가 네트워크 없음).
  const refKospiIntra = useQuery({
    queryKey: ["market-flow-intraday", "kospi", intraDate],
    queryFn: () => fetchKrIntradayInvestorFlow("kospi", intraDate.replace(/-/g, "")),
    enabled: open && mode === "intraday", staleTime: 60_000, refetchOnWindowFocus: false,
  });
  const refKosdaqIntra = useQuery({
    queryKey: ["market-flow-intraday", "kosdaq", intraDate],
    queryFn: () => fetchKrIntradayInvestorFlow("kosdaq", intraDate.replace(/-/g, "")),
    enabled: open && mode === "intraday", staleTime: 60_000, refetchOnWindowFocus: false,
  });
  const refKospiDaily = useQuery({
    queryKey: ["market-flow-daily", "kospi", days],
    queryFn: () => fetchKrDailyInvestorFlow("kospi", days),
    enabled: open && mode === "daily", staleTime: 5 * 60_000, refetchOnWindowFocus: false,
  });
  const refKosdaqDaily = useQuery({
    queryKey: ["market-flow-daily", "kosdaq", days],
    queryFn: () => fetchKrDailyInvestorFlow("kosdaq", days),
    enabled: open && mode === "daily", staleTime: 5 * 60_000, refetchOnWindowFocus: false,
  });
  const refRange = useMemo(() => {
    const stamps: number[] = [];
    if (mode === "intraday") {
      for (const d of [refKospiIntra.data, refKosdaqIntra.data]) {
        const p = d?.points;
        if (p && p.length) stamps.push(hmToTime(p[0].time) as number, hmToTime(p[p.length - 1].time) as number);
      }
    } else {
      for (const d of [refKospiDaily.data, refKosdaqDaily.data]) {
        const p = d?.points;
        if (p && p.length) stamps.push(dateToTime(p[0].date) as number, dateToTime(p[p.length - 1].date) as number);
      }
    }
    if (!stamps.length) return undefined;
    return { from: Math.min(...stamps) as UTCTimestamp, to: Math.max(...stamps) as UTCTimestamp };
  }, [mode, refKospiIntra.data, refKosdaqIntra.data, refKospiDaily.data, refKosdaqDaily.data]);

  return (
    <div className="relative rounded-xl border border-gray-300 bg-white p-2.5 pt-4 mt-1.5">
      <button onClick={toggleOpen}
              className="absolute -top-3 left-3 z-10 px-2 py-0.5 rounded-md border border-gray-300 bg-gray-50
                         text-sm font-bold text-gray-700 whitespace-nowrap hover:bg-gray-100 hover:text-blue-600">
        🕐 투자자 순매수 <span className="text-[10px] text-gray-400">{open ? "▲" : "▼"}</span>
      </button>

      {open ? (
        <>
          {/* 당일/일별 + (일별) 기간 선택 */}
          <div className="flex items-center gap-2 flex-wrap mb-1.5 mt-0.5">
            <div className="flex rounded-md border border-gray-300 overflow-hidden text-xs">
              {(["intraday", "daily"] as const).map(m => (
                <button key={m} onClick={() => setMode(m)}
                        className={`px-3 py-1 font-medium transition ${
                          mode === m ? "bg-gray-800 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
                  {m === "intraday" ? "당일" : "일별"}
                </button>
              ))}
            </div>
            {mode === "daily" && (
              <div className="flex rounded-md border border-gray-300 overflow-hidden text-xs">
                {PERIODS.map(p => (
                  <button key={p.days} onClick={() => setDays(p.days)}
                          className={`px-2.5 py-1 font-medium transition ${
                            days === p.days ? "bg-indigo-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
                    {p.label}
                  </button>
                ))}
              </div>
            )}
            {mode === "intraday" && (
              <div className="flex items-center gap-1 text-xs">
                <button onClick={() => setIntraDate(d => shiftDate(d, -1))}
                        title="이전 날" className="px-1.5 py-1 rounded border border-gray-300 hover:bg-gray-50 leading-none">‹</button>
                <input type="date" value={intraDate} max={today}
                       onChange={e => e.target.value && setIntraDate(e.target.value)}
                       className="border border-gray-300 rounded px-1.5 py-0.5 text-xs" />
                <button onClick={() => setIntraDate(d => (d < today ? shiftDate(d, 1) : d))}
                        disabled={intraDate >= today} title="다음 날"
                        className="px-1.5 py-1 rounded border border-gray-300 hover:bg-gray-50 leading-none disabled:opacity-40">›</button>
                {intraDate !== today && (
                  <button onClick={() => setIntraDate(today)}
                          className="px-2 py-1 rounded border border-gray-300 hover:bg-gray-50 font-medium">오늘</button>
                )}
              </div>
            )}
            <span className="text-[10px] text-gray-400">
              {mode === "intraday" ? "시간별 누적(날짜 선택)" : "기간 누적 (합계 상단 표시)"} · 전 종목 억원(선물=계약 환산)
            </span>
          </div>

          {/* 공통 투자자 토글 (모든 차트 동시 제어) */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-1.5">
            {INTRADAY_SERIES.map(def => (
              <label key={def.key} className="inline-flex items-center gap-1 text-[11px] cursor-pointer select-none">
                <input type="checkbox" checked={!!enabled[def.key]} onChange={() => toggleInvestor(def.key)}
                       style={{ accentColor: def.color }} />
                <span style={{ color: enabled[def.key] ? def.color : "#9ca3af" }}
                      className={enabled[def.key] ? "font-semibold" : ""}>
                  {def.label}
                </span>
              </label>
            ))}
          </div>

          {/* 카드 숨김/보임 — 체크한 카드만 렌더 */}
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mb-2 pt-1 border-t border-gray-100">
            <span className="text-[10px] text-gray-400 font-medium">카드</span>
            {[
              ...MARKETS.map(m => ({ key: m.key as string, label: m.label })),
              ...(mode === "daily" ? LEVERAGE_BASKETS.map(b => ({ key: b.key, label: b.name })) : []),
            ].map(c => (
              <label key={c.key} className="inline-flex items-center gap-1 text-[11px] cursor-pointer select-none">
                <input type="checkbox" checked={cardVisible(c.key)} onChange={() => toggleCard(c.key)} />
                <span className={cardVisible(c.key) ? "text-gray-700 font-medium" : "text-gray-400"}>{c.label}</span>
              </label>
            ))}
          </div>

          {/* 코스피 / 선물 / 코스닥 — 보이는 카드만 (폭 자동) */}
          {(() => {
            const vis = MARKETS.filter(m => cardVisible(m.key));
            if (vis.length === 0) return null;
            return (
              <div className={`grid ${gridColsClass(vis.length, 3)} gap-2`}>
                {vis.map(m => (
                  // min-w-0 — grid 자식 기본 min-width:auto 로 선물(칩 많음) 셀이 안 줄고 나머지를 압축하는 것 방지.
                  <div key={m.key} className="min-w-0">
                    <MarketBlock market={m.key} label={m.label} enabled={enabled}
                      mode={mode} days={days} bizdate={intraDate} on={open} onReady={registerSync} onToggle={toggleInvestor}
                      refFirstT={refRange?.from} refLastT={refRange?.to} />
                  </div>
                ))}
              </div>
            );
          })()}

          {/* 단일종목 레버리지·인버스 수급 — 일별 전용(개별종목 시간별 데이터 없음). 증권사별 ETF·ETN 합산. */}
          {mode === "daily" && (() => {
            const vis = LEVERAGE_BASKETS.filter(b => cardVisible(b.key));
            if (vis.length === 0) return null;
            return (
              <div className="mt-2.5">
                <div className="text-[10px] text-gray-400 mb-1 pl-0.5">
                  단일종목 레버리지·인버스2X 수급 · 증권사별 ETF·ETN 합산(개인/외국인/기관, 억원) · 배경=기초주가 · 인버스 매수=하락베팅 · 일별 전용
                </div>
                <div className={`grid ${gridColsClass(vis.length, 4)} gap-2`}>
                  {vis.map(b => (
                    <div key={b.key} className="min-w-0">
                      <LeverageBlock basket={b} enabled={enabled} days={days} on={open}
                        onReady={registerLeverageSync} onToggle={toggleInvestor} />
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </>
      ) : (
        <div className="text-[11px] text-gray-400 pt-1 pl-1">
          접힘 — 배지를 눌러 코스피·선물·코스닥 투자자 순매수(당일/일별)를 펼칠 수 있어요.
        </div>
      )}
    </div>
  );
}

export default IntradayInvestorSection;
