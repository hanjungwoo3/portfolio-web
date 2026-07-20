// 증시탭 — 투자자 순매수. 코스피·선물·코스닥 3개를 한 줄에, 공통 투자자 토글로 제어.
//   [당일] 시간별 누적(네이버 intraday) / [일별] 기간별 누적(네이버 daily) 토글.
//   일별은 기간 선택 + 기간 합계(헤더)를 표시. 데이터: 네이버 investorDealTrend*(로그인 불필요).

import { useState, useMemo, lazy, Suspense, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchKrIntradayInvestorFlow, fetchKrDailyInvestorFlow, fetchYahooIntraday, fetchYahooPriceHistory } from "../lib/api";
import type { IntradayMarket } from "../lib/api";
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
// 배경 지수 — 코스피(^KS11)·코스닥(^KQ11)·선물(^KS200=코스피200 지수, 선물과 거의 동일).
const YAHOO_SYM: Partial<Record<IntradayMarket, string>> = { kospi: "^KS11", kosdaq: "^KQ11", futures: "^KS200" };
const INDEX_LABEL: Partial<Record<IntradayMarket, string>> = { kospi: "코스피", kosdaq: "코스닥", futures: "KOSPI200" };
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
    }
  } else {
    const pts = daily.data?.points ?? [];
    if (pts.length < 2) return shell(<span>일별 데이터 없음</span>);
    unit = daily.data!.unit;
    const acc = {} as Record<IntradayKey, number>;
    for (const k of KEYS) acc[k] = 0;
    series = pts.map(p => {
      for (const k of KEYS) acc[k] += p[k];
      return { t: dateToTime(p.date), label: p.date.slice(5).replace("-", "/"), values: { ...acc } };
    });
    summary = { ...acc };   // 기간 합계 = 최종 누적
    if (ysym && idxDaily.data) {
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

  const registerSync = useCrosshairSync();   // 3개 차트 crosshair 동기화

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
              {mode === "intraday" ? "시간별 누적(날짜 선택)" : "기간 누적 (합계 상단 표시)"} · 코스피·코스닥 억원 / 선물 계약
            </span>
          </div>

          {/* 공통 투자자 토글 (모든 차트 동시 제어) */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2">
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

          {/* 코스피 / 선물 / 코스닥 — 한 줄에 3개 */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {MARKETS.map(m => (
              // min-w-0 — grid 자식 기본 min-width:auto 로 선물(칩 많음) 셀이 안 줄고 나머지를 압축하는 것 방지.
              <div key={m.key} className="min-w-0">
                <MarketBlock market={m.key} label={m.label} enabled={enabled}
                  mode={mode} days={days} bizdate={intraDate} on={open} onReady={registerSync} onToggle={toggleInvestor}
                  refFirstT={refRange?.from} refLastT={refRange?.to} />
              </div>
            ))}
          </div>
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
