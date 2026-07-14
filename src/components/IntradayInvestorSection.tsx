// 증시탭 — 투자자 순매수. 코스피·코스닥·선물 3개를 한 줄에, 공통 투자자 토글로 제어.
//   [당일] 시간별 누적(네이버 intraday) / [일별] 기간별 누적(네이버 daily) 토글.
//   일별은 기간 선택 + 기간 합계(헤더)를 표시. 데이터: 네이버 investorDealTrend*(로그인 불필요).

import { useState, lazy, Suspense, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchKrIntradayInvestorFlow, fetchKrDailyInvestorFlow } from "../lib/api";
import type { IntradayMarket } from "../lib/api";
import { INTRADAY_SERIES, type IntradayKey } from "../lib/intradayInvestor";
import type { FlowSeriesPoint } from "./IntradayInvestorChart";
import type { UTCTimestamp } from "lightweight-charts";

const IntradayInvestorChart = lazy(() => import("./IntradayInvestorChart"));

const MARKETS: { key: IntradayMarket; label: string }[] = [
  { key: "kospi",   label: "코스피" },
  { key: "kosdaq",  label: "코스닥" },
  { key: "futures", label: "선물" },
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
function hmToTime(hm: string): UTCTimestamp {
  const [h, m] = hm.split(":").map(Number);
  return (Date.UTC(2000, 0, 1, h, m) / 1000) as UTCTimestamp;
}
function dateToTime(d: string): UTCTimestamp {
  const [y, mo, day] = d.split("-").map(Number);
  return (Date.UTC(y, mo - 1, day) / 1000) as UTCTimestamp;
}

function MarketBlock({ market, label, enabled, mode, days, on }: {
  market: IntradayMarket; label: string; enabled: Record<string, boolean>;
  mode: "intraday" | "daily"; days: number; on: boolean;
}) {
  const intra = useQuery({
    queryKey: ["market-flow-intraday", market],
    queryFn: () => fetchKrIntradayInvestorFlow(market),
    enabled: on && mode === "intraday",
    staleTime: 60_000, refetchOnWindowFocus: false,
  });
  const daily = useQuery({
    queryKey: ["market-flow-daily", market, days],
    queryFn: () => fetchKrDailyInvestorFlow(market, days),
    enabled: on && mode === "daily",
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

  if (mode === "intraday") {
    const pts = intra.data?.points ?? [];
    if (pts.length < 2) return shell(<span>당일 데이터 없음 <span className="text-[10px]">(장 시작 전/집계 전)</span></span>);
    unit = intra.data!.unit;
    series = pts.map(p => ({ t: hmToTime(p.time), label: p.time, values: pick(p) }));
    summary = pick(pts[pts.length - 1]);   // 당일 누적 최신
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
  }

  return (
    <Suspense fallback={<div className="h-[260px]" />}>
      <IntradayInvestorChart series={series} summary={summary} enabled={enabled}
        unit={unit} marketLabel={label} timeVisible={mode === "intraday"}
        summaryHint={mode === "daily" ? "기간합계" : undefined} />
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

  const [enabled, setEnabled] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const s of INTRADAY_SERIES) init[s.key] = s.on;
    return init;
  });
  const toggleInvestor = (k: string) => setEnabled(e => ({ ...e, [k]: !e[k] }));

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
            <span className="text-[10px] text-gray-400">
              {mode === "intraday" ? "당일 시간별 누적" : "기간 누적 (합계 상단 표시)"} · 코스피·코스닥 억원 / 선물 계약
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

          {/* 코스피 / 코스닥 / 선물 — 한 줄에 3개 */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {MARKETS.map(m => (
              <MarketBlock key={m.key} market={m.key} label={m.label} enabled={enabled}
                mode={mode} days={days} on={open} />
            ))}
          </div>
        </>
      ) : (
        <div className="text-[11px] text-gray-400 pt-1 pl-1">
          접힘 — 배지를 눌러 코스피·코스닥·선물 투자자 순매수(당일/일별)를 펼칠 수 있어요.
        </div>
      )}
    </div>
  );
}

export default IntradayInvestorSection;
