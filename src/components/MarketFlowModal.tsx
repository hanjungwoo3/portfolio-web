// 시장 매매동향 모달 — KOSPI/KOSDAQ 일별 투자자별 순매수 (Toss API)
//   기업가치 모달 (개별 종목) 의 일별 상세 표와 동일한 형식.
//   sticky thead: 컬럼 헤더 + 5/20/60/120/200일 합계 + ▼ separator
//   scrollable tbody: 일별 상세 (60일치)
//   금액 단위: 원 → 화면 표시는 억원 (1억 = 100,000,000)

import { useEffect, useMemo, useState, lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchKrMarketFlow, fetchYahooPriceHistory, fetchInvestingPriceHistory } from "../lib/api";
import type { MarketIndexKey, MarketFlowPoint } from "../lib/api";
import { useCrosshairSync } from "../lib/useCrosshairSync";
import { getMarketEvents } from "../lib/marketEvents";

const InvestorChartLight = lazy(() => import("./InvestorChartLight"));
const IndexLineChart = lazy(() => import("./IndexLineChart"));

const UP   = "#dc2626";   // 매수 (양수): 한국식 빨강
const DOWN = "#2563eb";   // 매도 (음수): 한국식 파랑

function fmtBillion(won: number): string {
  // 원 → 억원, 부호 + 콤마 (정수). 0 은 "—" (호출자 처리)
  const eok = Math.round(won / 100_000_000);
  const sign = eok > 0 ? "+" : "";
  return `${sign}${eok.toLocaleString()}`;
}

function colorOf(v: number): string {
  return v > 0 ? UP : v < 0 ? DOWN : "#9ca3af";
}

const COLS: { key: keyof Omit<MarketFlowPoint, "date">; label: string }[] = [
  { key: "individuals",         label: "개인" },
  { key: "foreigners",          label: "외국인" },
  { key: "institutions",        label: "기관계" },
  { key: "financialInvestment", label: "금융투자" },
  { key: "pensionFund",         label: "연기금" },
  { key: "trust",               label: "투신" },
  { key: "privateEquity",       label: "사모" },
  { key: "insurance",           label: "보험" },
  { key: "bank",                label: "은행" },
  { key: "otherFinancial",      label: "기타금융" },
];

const PERIODS: { label: string; days: number }[] = [
  { label: "5일",            days: 5 },
  { label: "20일 (1개월)",   days: 20 },
  { label: "60일 (3개월)",   days: 60 },
  { label: "120일 (6개월)",  days: 120 },
  { label: "200일 (~10개월)", days: 200 },
];

export function MarketFlowModal({
  isOpen, onClose, indexKey,
}: {
  isOpen: boolean;
  onClose: () => void;
  indexKey: MarketIndexKey;
}) {
  // 200일치까지 받기 위해 count=250
  const { data: flow, isLoading } = useQuery({
    queryKey: ["market-flow", indexKey],
    queryFn: () => fetchKrMarketFlow(indexKey, 250),
    enabled: isOpen,
    staleTime: 5 * 60_000,
  });

  // 지수 가격 (200일치) — Yahoo
  const yahooSymbol = indexKey === "KOSPI" ? "^KS11" : "^KQ11";
  const { data: indexPrices } = useQuery({
    queryKey: ["index-prices", yahooSymbol],
    queryFn: () => fetchYahooPriceHistory(yahooSymbol, "1y"),
    enabled: isOpen,
    staleTime: 5 * 60_000,
  });

  // VIX (미국 공포지수, 토글 ON 시에만 fetch)
  const [showVix, setShowVix] = useState<boolean>(() => {
    try { return localStorage.getItem("market_flow_vix") === "on"; }
    catch { return false; }
  });
  const toggleVix = () => {
    const next = !showVix;
    setShowVix(next);
    if (next) { setShowVkospi(false); try { localStorage.setItem("market_flow_vkospi", "off"); } catch { /* noop */ } }
    try { localStorage.setItem("market_flow_vix", next ? "on" : "off"); } catch { /* noop */ }
  };
  const { data: vixPrices } = useQuery({
    queryKey: ["vix-prices"],
    queryFn: () => fetchYahooPriceHistory("^VIX", "1y"),
    enabled: isOpen && showVix,
    staleTime: 5 * 60_000,
  });

  // V-KOSPI (한국 공포지수) — 기본 ON. 단 VIX 와 상호배타(VIX 켜져 있으면 끔), 저장값 "off" 면 끔.
  const [showVkospi, setShowVkospi] = useState<boolean>(() => {
    try {
      if (localStorage.getItem("market_flow_vkospi") === "off") return false;
      if (localStorage.getItem("market_flow_vix") === "on") return false;   // VIX 우선
      return true;
    } catch { return true; }
  });
  const toggleVkospi = () => {
    const next = !showVkospi;
    setShowVkospi(next);
    if (next) { setShowVix(false); try { localStorage.setItem("market_flow_vix", "off"); } catch { /* noop */ } }
    try { localStorage.setItem("market_flow_vkospi", next ? "on" : "off"); } catch { /* noop */ }
  };
  const { data: vkospiPrices } = useQuery({
    queryKey: ["vkospi-prices"],
    queryFn: () => fetchInvestingPriceHistory("VKOSPI"),
    enabled: isOpen && showVkospi,
    staleTime: 5 * 60_000,
  });

  // 시간순 정렬 (오래됨 → 최신) + 누적 합 — 미니 차트용
  // 5 차트 X축 동기화: flow ∩ indexPrices 교집합 날짜만 사용 → 모든 차트 동일 길이
  const ascending = useMemo(() => {
    const all = (flow ?? []).slice();
    if (indexPrices && indexPrices.length > 0) {
      const idxSet = new Set(indexPrices.map(p => p.date));
      return all.filter(p => idxSet.has(p.date)).sort((a, b) => a.date.localeCompare(b.date));
    }
    return all.sort((a, b) => a.date.localeCompare(b.date));
  }, [flow, indexPrices]);
  const dates = useMemo(() => ascending.map(d => d.date), [ascending]);
  const dailyIndividuals = useMemo(() => ascending.map(d => d.individuals), [ascending]);
  const dailyForeign = useMemo(() => ascending.map(d => d.foreigners), [ascending]);
  const dailyInst = useMemo(() => ascending.map(d => d.institutions), [ascending]);
  const dailyPension = useMemo(() => ascending.map(d => d.pensionFund), [ascending]);
  const cumIndividuals = useMemo(() => {
    let s = 0; return ascending.map(d => { s += d.individuals; return s; });
  }, [ascending]);
  const cumForeign = useMemo(() => {
    let s = 0; return ascending.map(d => { s += d.foreigners; return s; });
  }, [ascending]);
  const cumInst = useMemo(() => {
    let s = 0; return ascending.map(d => { s += d.institutions; return s; });
  }, [ascending]);
  const cumPension = useMemo(() => {
    let s = 0; return ascending.map(d => { s += d.pensionFund; return s; });
  }, [ascending]);

  // 지수 가격을 매매동향 날짜에 정렬
  const alignedIndexPrices = useMemo(() => {
    if (!indexPrices) return [];
    const dateSet = new Set(dates);
    return indexPrices.filter(p => dateSet.has(p.date));
  }, [indexPrices, dates]);

  // 시장 이벤트 (옵션만기 / 쿼드 / 금통위 / FOMC) — 데이터 기간 내
  const marketEvents = useMemo(() => {
    if (dates.length === 0) return [];
    return getMarketEvents(dates[0], dates[dates.length - 1]);
  }, [dates]);

  // 4 차트 crosshair + 줌 동기화
  const registerSync = useCrosshairSync();

  // 지수 차트 모드 (line/candle) — localStorage 영속
  const [indexMode, setIndexMode] = useState<"line" | "candle">(() => {
    try { return localStorage.getItem("market_flow_chart_mode") === "candle" ? "candle" : "line"; }
    catch { return "line"; }
  });
  const toggleIndexMode = () => {
    const next = indexMode === "candle" ? "line" : "candle";
    setIndexMode(next);
    try { localStorage.setItem("market_flow_chart_mode", next); } catch { /* noop */ }
  };

  // 4 차트 Y축 통일 — 0원 높이가 모든 차트에서 정확히 같은 위치에 오도록
  const dailyMaxAbs = useMemo(() => {
    const all = [...dailyIndividuals, ...dailyForeign, ...dailyInst, ...dailyPension];
    return Math.max(1, ...all.map(Math.abs));
  }, [dailyIndividuals, dailyForeign, dailyInst, dailyPension]);
  const cumMaxAbs = useMemo(() => {
    const all = [...cumIndividuals, ...cumForeign, ...cumInst, ...cumPension];
    return Math.max(1, ...all.map(Math.abs));
  }, [cumIndividuals, cumForeign, cumInst, cumPension]);

  // ESC 닫기
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const sorted = (flow ?? []).slice().sort((a, b) => b.date.localeCompare(a.date));   // 최신 먼저
  const summaries = PERIODS.map(p => {
    const slice = sorted.slice(0, p.days);
    const sums: Record<string, number> = {};
    for (const c of COLS) sums[c.key] = slice.reduce((acc, r) => acc + r[c.key], 0);
    return { label: p.label, days: p.days, actualDays: slice.length, sums };
  });

  const indexLabel = indexKey === "KOSPI" ? "KOSPI" : "KOSDAQ";

  // colgroup — 일자(130) + 투자자 10개(86 each) → 두 테이블 공유로 컬럼 정렬 일치
  const colgroup = (
    <colgroup>
      <col style={{ width: 130 }} />
      {COLS.map(c => <col key={c.key} style={{ width: 86 }} />)}
    </colgroup>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-lg shadow-xl max-w-7xl w-full max-h-[90vh] flex flex-col">
        <header className="px-5 py-3 border-b flex items-center gap-3">
          <h2 className="font-bold text-gray-800">📊 {indexLabel} 매매동향</h2>
          <span className="text-[11px] text-gray-500">단위: 억원 · Toss</span>
          <button onClick={onClose}
                  className="ml-auto text-gray-400 hover:text-gray-700 text-xl leading-none">
            ✕
          </button>
        </header>

        <div className="flex-1 min-h-0 px-5 py-4 overflow-y-auto flex flex-col gap-3">
          {isLoading && (
            <div className="text-center text-sm text-gray-400 py-8">불러오는 중...</div>
          )}
          {!isLoading && (!flow || flow.length === 0) && (
            <div className="text-center text-sm text-gray-400 py-8">데이터 없음</div>
          )}
          {flow && flow.length > 0 && (
            <>
              <Suspense fallback={<div className="h-[220px]" />}>
                {/* 1) 지수 — 전체 폭 한 줄 */}
                {alignedIndexPrices.length >= 2 ? (
                  <IndexLineChart label={indexLabel} prices={alignedIndexPrices}
                                  heightClass="h-[200px] lg:h-[260px]"
                                  mode={indexMode} onToggleMode={toggleIndexMode}
                                  events={marketEvents}
                                  vixPrices={vixPrices} showVix={showVix}
                                  onToggleVix={toggleVix}
                                  vkospiPrices={vkospiPrices} showVkospi={showVkospi}
                                  onToggleVkospi={toggleVkospi}
                                  onReady={registerSync} />
                ) : (
                  <div className="border border-gray-200 rounded p-2 h-[200px] text-xs text-gray-400 flex items-center justify-center">
                    지수 데이터 없음
                  </div>
                )}
                {/* 2) 4개 투자자 미니 차트 — 한 줄 */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
                  <InvestorChartLight
                    label="개인" unit="원"
                    daily={dailyIndividuals} cumulative={cumIndividuals} dates={dates}
                    barColor="#e5e7eb" cumColor="#6b7280"
                    dailyMaxAbs={dailyMaxAbs} cumMaxAbs={cumMaxAbs}
                    onReady={registerSync}
                  />
                  <InvestorChartLight
                    label="외국인" unit="원"
                    daily={dailyForeign} cumulative={cumForeign} dates={dates}
                    barColor="#ddd6fe" cumColor="#6d28d9"
                    dailyMaxAbs={dailyMaxAbs} cumMaxAbs={cumMaxAbs}
                    onReady={registerSync}
                  />
                  <InvestorChartLight
                    label="기관계" unit="원"
                    daily={dailyInst} cumulative={cumInst} dates={dates}
                    barColor="#bbf7d0" cumColor="#047857"
                    dailyMaxAbs={dailyMaxAbs} cumMaxAbs={cumMaxAbs}
                    onReady={registerSync}
                  />
                  <InvestorChartLight
                    label="연기금" unit="원"
                    daily={dailyPension} cumulative={cumPension} dates={dates}
                    barColor="#fed7aa" cumColor="#c2410c"
                    dailyMaxAbs={dailyMaxAbs} cumMaxAbs={cumMaxAbs}
                    onReady={registerSync}
                  />
                </div>
              </Suspense>

              {/* 일별 상세 표 — 모바일에서는 숨김 (좁은 화면에서 가독성 X, 차트로 충분) */}
              <div className="hidden sm:block border border-gray-200 rounded">
                {/* 고정 영역 — 컬럼 헤더 + 합계 + ▼ separator */}
                <table className="text-[11px] tabular-nums whitespace-nowrap w-full"
                       style={{ tableLayout: "fixed" }}>
                  {colgroup}
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="px-2 py-1.5 text-left text-gray-600 font-medium">일자 / 기간</th>
                      {COLS.map(c => (
                        <th key={c.key}
                            className="px-2 py-1.5 text-right text-gray-600 font-medium">
                          {c.label}
                        </th>
                      ))}
                    </tr>
                    {summaries.map(s => (
                      <tr key={s.label}
                          className="border-b border-gray-200 bg-blue-50 font-bold">
                        <td className="px-2 py-1.5 text-left text-gray-800">
                          {s.label}
                          {s.actualDays < s.days && (
                            <span className="ml-1 text-[10px] font-normal text-gray-400">
                              (실제 {s.actualDays}일)
                            </span>
                          )}
                        </td>
                        {COLS.map(c => {
                          const v = s.sums[c.key];
                          return (
                            <td key={c.key}
                                className="px-2 py-1.5 text-right"
                                style={{ color: colorOf(v) }}>
                              {v === 0 ? "—" : fmtBillion(v)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    <tr className="border-b-2 border-gray-300 bg-gray-100">
                      <td colSpan={COLS.length + 1}
                          className="px-2 py-0.5 text-[10px] text-gray-500">
                        ▼ 일별 상세
                      </td>
                    </tr>
                  </thead>
                </table>
                {/* 일별 상세 본문 — max-h 스크롤 (개별 종목 모달과 동일) */}
                <div className="max-h-[50vh] overflow-y-auto">
                  <table className="text-[11px] tabular-nums whitespace-nowrap w-full"
                         style={{ tableLayout: "fixed" }}>
                    {colgroup}
                    <tbody>
                      {sorted.map(r => (
                        <tr key={r.date}
                            className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="px-2 py-1 text-left text-gray-700">{r.date}</td>
                          {COLS.map(c => {
                            const v = r[c.key];
                            return (
                              <td key={c.key}
                                  className="px-2 py-1 text-right"
                                  style={{ color: colorOf(v) }}>
                                {v === 0 ? "—" : fmtBillion(v)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default MarketFlowModal;
