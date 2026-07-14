// 증시탭 — 당일 시간별 투자자 순매수. 코스피·코스닥·선물 3개를 한 줄에, 공통 투자자 토글로 제어.
//   HTS "시간별동향" 형식. 데이터: 네이버 investorDealTrendTime (로그인 불필요).
//   비용: 시장당 최대 ~40 프록시 호출(페이지네이션) → 접힘 시 fetch 안 함 + 60초 캐시.

import { useState, lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchKrIntradayInvestorFlow } from "../lib/api";
import type { IntradayMarket } from "../lib/api";
import { INTRADAY_SERIES } from "../lib/intradayInvestor";

const IntradayInvestorChart = lazy(() => import("./IntradayInvestorChart"));

const MARKETS: { key: IntradayMarket; label: string }[] = [
  { key: "kospi",   label: "코스피" },
  { key: "kosdaq",  label: "코스닥" },
  { key: "futures", label: "선물" },
];

const OPEN_KEY = "intraday_investor_open";

function MarketBlock({ market, label, enabled, on }: {
  market: IntradayMarket; label: string; enabled: Record<string, boolean>; on: boolean;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["market-flow-intraday", market],
    queryFn: () => fetchKrIntradayInvestorFlow(market),
    enabled: on,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  if (isLoading) {
    return <div className="h-[240px] flex items-center justify-center text-xs text-gray-400 border border-gray-200 rounded">불러오는 중… <span className="ml-1 font-bold text-green-600">{label}</span></div>;
  }
  if (!data || data.points.length < 2) {
    return (
      <div className="h-[240px] flex flex-col items-center justify-center text-xs text-gray-400 border border-gray-200 rounded gap-0.5">
        <span className="font-bold text-green-600">{label}</span>
        당일 데이터 없음
        <span className="text-[10px]">(장 시작 전이거나 집계 전)</span>
      </div>
    );
  }
  return (
    <Suspense fallback={<div className="h-[260px]" />}>
      <IntradayInvestorChart points={data.points} unit={data.unit} enabled={enabled} marketLabel={label} />
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

  // 공통 투자자 토글 — 3개 차트를 함께 제어
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
        🕐 시간별 투자자 순매수 <span className="text-[10px] text-gray-400">{open ? "▲" : "▼"}</span>
      </button>

      {open ? (
        <>
          {/* 공통 투자자 토글 (모든 차트 동시 제어) */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2 mt-1">
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
            <span className="text-[10px] text-gray-400 ml-auto">단위: 코스피·코스닥 억원 / 선물 계약</span>
          </div>

          {/* 코스피 / 코스닥 / 선물 — 한 줄에 3개 */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {MARKETS.map(m => (
              <MarketBlock key={m.key} market={m.key} label={m.label} enabled={enabled} on={open} />
            ))}
          </div>
        </>
      ) : (
        <div className="text-[11px] text-gray-400 pt-1 pl-1">
          접힘 — 배지를 눌러 코스피·코스닥·선물 당일 시간별 순매수를 펼칠 수 있어요.
        </div>
      )}
    </div>
  );
}

export default IntradayInvestorSection;
