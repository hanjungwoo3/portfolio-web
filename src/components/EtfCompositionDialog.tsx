import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { fetchEtfCompositions, fetchTossPrices, fetchKrPriceHistory, fetchKrRegularPrices, searchTossAutoComplete } from "../lib/api";
import { loadHoldings } from "../lib/db";
import { Sparkline } from "./Sparkline";
import { Tooltip } from "./Tooltip";
import { formatSigned, signColor, isEtfByName, dayChangePct, dayChangeDiff } from "../lib/format";
import { handleTossLinkClick, openExternal } from "../lib/toss";

// ETF 구성 종목 모달 — 토스 v2 compositions endpoint
// 비교 모드: secondEtf 가 있으면 좌우 2-panel 으로 표시, 공통 종목은 opacity 로 흐리게
interface Props {
  isOpen: boolean;
  onClose: () => void;
  ticker: string;          // 6자리 (예: "069500")
  etfName: string;         // 표시명 (예: "KODEX 200")
  onRequestSearch?: (query: string) => void;  // "+추가" 클릭 시 SearchDialog 오픈
}

export function EtfCompositionDialog({ isOpen, onClose, ticker, etfName, onRequestSearch }: Props) {
  // 비교 대상 ETF (오른쪽 panel)
  const [secondEtf, setSecondEtf] = useState<{ ticker: string; name: string } | null>(null);
  // 비교 검색 모드 — 열린 inline 검색 input + dropdown
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareQuery, setCompareQuery] = useState("");
  // 각 panel 이 로드된 종목 ticker 목록 (공통 종목 계산용)
  const [panelATickers, setPanelATickers] = useState<string[]>([]);
  const [panelBTickers, setPanelBTickers] = useState<string[]>([]);

  // 공통 종목 = A ∩ B
  const dimTickers = useMemo(() => {
    if (!secondEtf) return undefined;
    const a = new Set(panelATickers);
    const common = new Set<string>();
    for (const t of panelBTickers) if (a.has(t)) common.add(t);
    return common;
  }, [secondEtf, panelATickers, panelBTickers]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  // 모달 닫힐 때 비교 state 도 초기화
  useEffect(() => {
    if (!isOpen) {
      setSecondEtf(null); setCompareOpen(false); setCompareQuery("");
      setPanelATickers([]); setPanelBTickers([]);
    }
  }, [isOpen]);

  // 비교 검색 — 300ms debounce 후 토스 자동완성 → ETF 만 필터
  const debouncedQ = useDebounce(compareQuery, 250);
  const { data: searchResults } = useQuery({
    queryKey: ["compare-etf-search", debouncedQ],
    queryFn: async () => {
      const list = await searchTossAutoComplete(debouncedQ, 30);
      // ETF 만 (이름 패턴 매칭) + 현재 ETF 와 비교 대상 자기자신 제외
      return list.filter(r => isEtfByName(r.name) && r.ticker !== ticker
                              && r.ticker !== secondEtf?.ticker);
    },
    enabled: isOpen && compareOpen && debouncedQ.trim().length > 0,
    staleTime: 30_000,
  });

  // 해당 ETF 자신의 현재가/% — 헤더 표시용
  const { data: ownPriceList } = useQuery({
    queryKey: ["etf-own-price", ticker],
    queryFn: () => fetchTossPrices([ticker]),
    enabled: isOpen && /^[\dA-Za-z]{6}$/.test(ticker),
    staleTime: 30_000,
  });
  const ownPrice = ownPriceList?.[0];
  const ownPct = dayChangePct(ownPrice);

  // 비교검색 결과 ETF 들의 현재가/% — 드롭다운 표시용
  const cmpTickers = useMemo(
    () => (searchResults ?? []).map(r => r.ticker),
    [searchResults],
  );
  const { data: cmpPriceList } = useQuery({
    queryKey: ["etf-compare-prices", cmpTickers],
    queryFn: () => fetchTossPrices(cmpTickers),
    enabled: cmpTickers.length > 0,
    staleTime: 30_000,
  });
  const cmpPriceMap = useMemo(
    () => new Map((cmpPriceList ?? []).map(p => [p.ticker, p])),
    [cmpPriceList],
  );

  if (!isOpen) return null;

  const isCompare = !!secondEtf;
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-stretch sm:items-center
                    justify-center p-0 sm:p-4 overflow-y-auto"
         onClick={onClose}>
      <div className={`bg-white w-full h-full sm:h-auto sm:max-h-[95vh]
                       rounded-none sm:rounded-lg shadow-xl flex flex-col my-auto
                       ${isCompare ? "max-w-7xl" : "max-w-3xl"}`}
           onClick={e => e.stopPropagation()}>
        {/* 상단 thin 바 — 비교하기 버튼 + 검색 + 닫기 */}
        <header className="px-4 py-2 border-b bg-gray-50 flex items-center gap-2 flex-wrap">
          <span className="text-base font-bold">📋 ETF 구성</span>
          {ownPrice && (
            <span className="tabular-nums text-sm">
              <span className="font-bold">{ownPrice.price.toLocaleString()}원</span>
              {ownPct !== undefined && (
                <span className={`ml-1 text-xs ${signColor(ownPct)}`}>
                  {ownPct >= 0 ? "+" : ""}{ownPct.toFixed(2)}%
                </span>
              )}
            </span>
          )}
          {!isCompare ? (
            <button onClick={() => setCompareOpen(o => !o)}
                    title="다른 ETF 와 구성 종목 비교"
                    className={`inline-flex items-center gap-1 px-2 py-1
                                border rounded text-[11px] font-bold
                                ${compareOpen
                                  ? "border-indigo-500 bg-indigo-100 text-indigo-800"
                                  : "border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"}`}>
              🔀 비교하기
            </button>
          ) : (
            <button onClick={() => { setSecondEtf(null); setPanelBTickers([]); setCompareOpen(false); }}
                    title="비교 종료"
                    className="inline-flex items-center gap-1 px-2 py-1
                               border border-gray-300 rounded text-[11px] font-bold
                               bg-white text-gray-700 hover:bg-gray-50">
              ✕ 비교 종료
            </button>
          )}
          {/* inline 검색 — 비교 열림 + 미선택 상태 */}
          {compareOpen && !isCompare && (
            <div className="relative flex-1 min-w-[240px]">
              <input autoFocus
                     value={compareQuery}
                     onChange={e => setCompareQuery(e.target.value)}
                     placeholder="비교할 ETF 검색 (예: KODEX 반도체)"
                     className="w-full border border-gray-300 rounded px-2 py-1
                                text-sm focus:outline-none focus:border-indigo-500" />
              {/* 검색 결과 dropdown */}
              {searchResults && searchResults.length > 0 && (
                <ul className="absolute left-0 right-0 top-full mt-1 z-20
                               bg-white border border-gray-200 rounded shadow-lg
                               max-h-[280px] overflow-y-auto text-sm">
                  {searchResults.map(r => (
                    <li key={r.ticker}>
                      <button onClick={() => {
                                setSecondEtf({ ticker: r.ticker, name: r.name });
                                setCompareQuery(""); setCompareOpen(false);
                              }}
                              className="w-full text-left px-2 py-1.5 hover:bg-indigo-50
                                         flex items-center gap-2">
                        <span className="font-bold">{r.name}</span>
                        <span className="text-xs text-gray-500 font-mono">{r.ticker}</span>
                        {(() => {
                          const p = cmpPriceMap.get(r.ticker);
                          if (!p) return null;
                          const pct = dayChangePct(p);
                          return (
                            <span className="ml-auto tabular-nums text-xs">
                              <span className="font-bold">{p.price.toLocaleString()}원</span>
                              {pct !== undefined && (
                                <span className={`ml-1 ${signColor(pct)}`}>
                                  {pct >= 0 ? "+" : ""}{pct.toFixed(2)}%
                                </span>
                              )}
                            </span>
                          );
                        })()}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {searchResults && searchResults.length === 0 && debouncedQ.trim() && (
                <div className="absolute left-0 right-0 top-full mt-1 z-20
                                bg-white border border-gray-200 rounded shadow-lg
                                px-2 py-1.5 text-xs text-gray-400">
                  ETF 검색 결과 없음
                </div>
              )}
            </div>
          )}
          {isCompare && dimTickers && (
            <span className="text-[11px] text-gray-500">
              공통 종목 <b className="text-indigo-700">{dimTickers.size}개</b> 흐리게 표시
            </span>
          )}
          <button onClick={onClose}
                  className="ml-auto text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </header>
        {/* 본체 — 1 panel or 2 panel side-by-side (lg 이상) */}
        <div className={`flex-1 overflow-y-auto
                         ${isCompare ? "grid grid-cols-1 lg:grid-cols-2 lg:divide-x" : ""}`}>
          <EtfPanel ticker={ticker} etfName={etfName}
                    onRequestSearch={onRequestSearch}
                    dimTickers={dimTickers}
                    onTickersChange={setPanelATickers} />
          {isCompare && secondEtf && (
            <EtfPanel ticker={secondEtf.ticker} etfName={secondEtf.name}
                      onRequestSearch={onRequestSearch}
                      dimTickers={dimTickers}
                      onTickersChange={setPanelBTickers} />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 단순 useDebounce ─────────────────────────────────────
function useDebounce<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// ─── EtfPanel — 단일 ETF 의 헤더(이름·+추가·토스링크) + 카드 grid + 파이 ────
interface EtfPanelProps {
  ticker: string;
  etfName: string;
  onRequestSearch?: (query: string) => void;
  dimTickers?: Set<string>;  // 비교 모드에서 공통 종목 흐리게
  onTickersChange?: (tickers: string[]) => void;
}

function EtfPanel({ ticker, etfName, onRequestSearch, dimTickers, onTickersChange }: EtfPanelProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const { data: items, isLoading } = useQuery({
    queryKey: ["etf-compositions", ticker],
    queryFn: () => fetchEtfCompositions(ticker),
    staleTime: 10 * 60_000,
  });

  const stockTickers = (items ?? [])
    .map(it => it.stockCode.replace(/^A/, ""))
    .filter(t => /^\d{6}$/.test(t));

  // 부모(비교 컨테이너) 로 ticker 목록 전달 — 공통 종목 계산용
  const tickersKey = stockTickers.join(",");
  useEffect(() => {
    onTickersChange?.(stockTickers);
    // stockTickers ref 가 매 렌더마다 새로 생성되므로 join key 로 동등성 비교
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickersKey]);

  const { data: priceList } = useQuery({
    queryKey: ["etf-stock-prices", stockTickers],
    queryFn: () => fetchTossPrices(stockTickers),
    enabled: stockTickers.length > 0,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const priceMap = new Map((priceList ?? []).map(p => [p.ticker, p]));

  const { data: krRegMap } = useQuery({
    queryKey: ["etf-kr-reg-prices", stockTickers],
    queryFn: () => fetchKrRegularPrices(stockTickers),
    enabled: stockTickers.length > 0,
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
  });

  const chartQs = useQueries({
    queries: stockTickers.map(t => ({
      queryKey: ["price-history", t, "3mo"],
      queryFn: () => fetchKrPriceHistory(t, "3mo"),
      staleTime: 60 * 60_000,
    })),
  });
  const chartMap = new Map(chartQs.map((q, i) =>
    [stockTickers[i], (q.data ?? []).map(p => p.close)]));

  const { data: holdings } = useQuery({
    queryKey: ["holdings-for-etf-modal"],
    queryFn: loadHoldings,
    staleTime: 30_000,
  });
  const holdingGroups = new Map<string, string[]>();
  for (const h of holdings ?? []) {
    const acc = (h.account ?? "").trim();
    if (!acc) continue;   // 그룹(account) 없는 행은 제외 — 빈 계좌는 더 이상 없음
    const arr = holdingGroups.get(h.ticker) ?? [];
    if (!arr.includes(acc)) arr.push(acc);
    holdingGroups.set(h.ticker, arr);
  }

  const isOtherCategory = (name: string) => name === "그 외" || name === "기타";
  const visibleItems = (items ?? []).filter(it => !isOtherCategory(it.name));
  const otherRatio = (items ?? []).filter(it => isOtherCategory(it.name))
                                  .reduce((s, it) => s + it.ratio, 0);
  const visibleRatio = visibleItems.reduce((s, it) => s + it.ratio, 0);
  const totalRatio = visibleRatio + otherRatio;
  const cashRatio = Math.max(0, 100 - totalRatio);

  return (
    <div className="px-3 py-2">
      {/* 패널 header — ETF 이름 + 추가/토스 링크 */}
      <header className="flex items-center gap-2 flex-wrap mb-2 pb-2 border-b border-gray-100">
        <h3 className="text-sm font-bold">
          {etfName} — {visibleItems.length > 0 ? `top ${visibleItems.length}` : "구성"}
        </h3>
        {onRequestSearch && stockTickers.length > 0 && (
          <button onClick={() => onRequestSearch(stockTickers.join(" "))}
                  title="모든 구성 종목을 검색창에 한번에 추가"
                  className="inline-flex items-center gap-1 px-2 py-0.5
                             border border-emerald-300 rounded
                             text-[10px] font-bold text-emerald-700 bg-emerald-50
                             hover:bg-emerald-100">
            ✅ 한번에 추가
          </button>
        )}
        <a href={`https://www.tossinvest.com/stocks/A${ticker}`}
           target="_blank" rel="noopener noreferrer"
           onClick={e => handleTossLinkClick(e, `https://www.tossinvest.com/stocks/A${ticker}`)}
           title="토스 ETF 페이지에서 보기"
           className="ml-auto inline-flex items-center gap-1 px-2 py-0.5
                      border border-blue-200 rounded
                      text-[10px] text-blue-700 bg-blue-50/50 hover:bg-blue-100/70">
          토스 ↗
        </a>
      </header>
      {isLoading ? (
        <div className="text-center text-xs text-gray-400 py-8">불러오는 중...</div>
      ) : !items || items.length === 0 ? (
        <div className="text-center text-xs text-gray-400 py-8">구성 종목 데이터 없음</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-2 gap-y-5 pt-3 pb-2">
          <PieSlot items={visibleItems} otherRatio={otherRatio} cashRatio={cashRatio}
                   hoveredIdx={hoveredIdx} onHoverIdx={setHoveredIdx} />
          {visibleItems.map((it, i) => {
            const tNum = it.stockCode.replace(/^A/, "");
            const isStandard = /^\d{6}$/.test(tNum);
            const price = priceMap.get(tNum);
            const chart = chartMap.get(tNum) ?? [];
            const krReg = krRegMap?.get(tNum);

            const dayDiff = dayChangeDiff(price);
            const dayPct = dayChangePct(price) ?? 0;
            const colorDiff = price ? price.price - (price.prevClose || price.price) : 0;
            const priceColorCls = colorDiff > 0 ? "text-rose-600"
              : colorDiff < 0 ? "text-blue-600"
              : "text-gray-900";

            const showRegTag = krReg && krReg.regularPrice !== price?.price
                               && (price?.price ?? 0) > 0
                               && Math.abs(krReg.regularPrice - (price?.price ?? 0)) / (price?.price ?? 1) < 0.15;
            const regTagBg = !krReg ? "bg-white/20 border-gray-300/20"
              : krReg.regularPct > 0 ? "bg-rose-100/20 border-rose-300/20"
              : krReg.regularPct < 0 ? "bg-blue-100/20 border-blue-300/20"
              : "bg-white/20 border-gray-300/20";

            const groups = holdingGroups.get(tNum) ?? [];
            const isHeld = groups.length > 0;
            // 그룹 3개 이상이면 2개만 보이고 "외 N개"
            const shownGroups = groups.length >= 3 ? groups.slice(0, 2) : groups;
            const moreGroups = groups.length - shownGroups.length;
            const tabBg = colorDiff > 0 ? "bg-rose-50 border-rose-300"
              : colorDiff < 0 ? "bg-blue-50/70 border-blue-300"
              : "bg-white border-gray-300";
            // dim 우선순위: 1) 비교 모드 공통 종목 2) 파이 호버 미선택
            const isCommon = dimTickers?.has(tNum) ?? false;
            const hoverDim = hoveredIdx !== null && hoveredIdx !== i;
            const dimCls = isCommon ? "opacity-30"
              : hoverDim ? "opacity-15"
              : isStandard ? "" : "opacity-60";
            return (
              <div key={`${it.stockCode || "x"}-${i}`}
                   className={`group transition-opacity duration-150 ${dimCls}`}>
                <div className="flex items-end justify-between gap-1 mx-1">
                  <div className="flex items-end gap-0.5 flex-wrap min-w-0">
                    <button onClick={isStandard
                              ? () => openExternal(`https://www.tossinvest.com/stocks/${it.stockCode}`)
                              : undefined}
                            disabled={!isStandard}
                            className={`inline-flex items-center px-2 py-0.5 rounded-t-md
                                        border-t border-l border-r font-bold text-sm leading-none
                                        ${tabBg} ${priceColorCls}
                                        ${isStandard ? "cursor-pointer hover:brightness-95 transition" : ""}`}
                            title={isStandard ? undefined : `${it.name} — 선물·기타 (추가 불가)`}>
                      <span className="text-[10px] text-gray-500 mr-1">{i + 1}</span>
                      {it.name}
                    </button>
                  </div>
                  <div className="flex items-end gap-0.5">
                    {onRequestSearch && isStandard && (
                      <button onClick={e => { e.preventDefault(); e.stopPropagation();
                                              onRequestSearch(tNum); }}
                              title={`${it.name} (${tNum}) 추가하기`}
                              className="px-1.5 py-0.5 rounded-t-md text-[10px] font-bold leading-none
                                         bg-blue-50 text-blue-700 border-t border-l border-r border-blue-300
                                         hover:bg-blue-100">
                        +
                      </button>
                    )}
                  </div>
                </div>
                <div className="border border-gray-300 rounded-lg bg-gray-100/60 px-1.5 pt-3 pb-1.5 relative">
                  <div className="relative w-full h-full">
                    {showRegTag && krReg && (
                      <div className={`absolute -top-2 left-1 z-10 px-1.5 py-0
                                       border rounded text-[10px] leading-tight whitespace-nowrap ${regTagBg}`}>
                        <span className="text-gray-500">마감 </span>
                        <span className="text-gray-800 tabular-nums">
                          {Math.round(krReg.regularPrice).toLocaleString()}
                        </span>
                        <span className={`tabular-nums ml-1 font-bold ${signColor(krReg.regularPct)}`}>
                          ({krReg.regularPct >= 0 ? "+" : ""}{krReg.regularPct.toFixed(2)}%)
                        </span>
                      </div>
                    )}
                    {(() => {
                      const [pLight, pBase, pDark] = PIE_PALETTE[i % PIE_PALETTE.length];
                      return (
                        <div className="absolute -top-2 right-1 z-10 border rounded px-1.5 py-0
                                        leading-tight flex items-baseline gap-0.5"
                             style={{
                               backgroundColor: `${pLight}33`,
                               borderColor:     `${pBase}66`,
                             }}>
                          <span className="text-[10px]" style={{ color: pBase }}>비중</span>
                          <span className="font-bold text-sm tabular-nums" style={{ color: pDark }}>
                            {it.ratio.toFixed(1)}%
                          </span>
                        </div>
                      );
                    })()}
                    <div className="relative overflow-hidden border border-gray-200 rounded-md
                                    bg-gray-50/60 px-2 py-1 space-y-0.5 w-full min-h-[120px]
                                    flex flex-col justify-center">
                      {chart.length > 1 && (
                        <Sparkline data={chart} width={300} height={120}
                                   className="absolute inset-0 w-full h-full opacity-20
                                              pointer-events-none" />
                      )}
                      <div className="relative z-10">
                        <div className="flex items-baseline gap-2">
                          <span className="text-xl font-bold leading-tight invisible">▲</span>
                          <span className={`text-xl font-bold leading-tight tabular-nums ${priceColorCls}`}>
                            {price ? `${price.price.toLocaleString()}원` : "—"}
                          </span>
                        </div>
                        <div className={`flex items-baseline gap-1 pl-6 font-bold ${signColor(dayDiff)}`}>
                          <span className="text-lg leading-tight bg-yellow-100 rounded px-1 tabular-nums">
                            {dayPct >= 0 ? "+" : ""}{dayPct.toFixed(2)}%
                          </span>
                          <span className="text-xs font-normal text-gray-700 tabular-nums">
                            ({formatSigned(dayDiff)}원)
                          </span>
                        </div>
                        {/* 보유 그룹 — % 아래. 3개 이상이면 "외 N개" */}
                        {isHeld && (
                          <div className="flex flex-wrap items-center gap-1 pl-6 mt-1">
                            {shownGroups.map(g => (
                              <span key={g} title={`보유 그룹: ${g}`}
                                    className="px-1.5 py-0.5 rounded text-[10px] font-bold leading-none
                                               bg-emerald-100/30 text-emerald-700/80 border border-emerald-300/30">
                                {g}
                              </span>
                            ))}
                            {moreGroups > 0 && (
                              <Tooltip content={
                                <div className="flex flex-wrap gap-1 max-w-[200px]">
                                  {groups.slice(shownGroups.length).map(g => (
                                    <span key={g} className="px-1.5 py-0.5 rounded text-[10px] font-bold leading-none
                                                              bg-emerald-100 text-emerald-800 border border-emerald-300">
                                      {g}
                                    </span>
                                  ))}
                                </div>
                              }>
                                <span className="text-[10px] font-bold text-emerald-700 cursor-help">
                                  외 {moreGroups}개
                                </span>
                              </Tooltip>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          <div className="sm:col-start-3 flex items-end justify-end
                          px-2 pb-2 text-xs text-gray-400 tabular-nums whitespace-nowrap">
            종목 <span className="font-bold text-gray-500 mx-0.5">{visibleItems.length}개</span> ·
            합계 <span className="font-bold text-gray-500 mx-0.5">{visibleRatio.toFixed(1)}%</span>
            {otherRatio > 0.01 && (
              <> · 그 외 <span className="font-bold text-gray-500 ml-0.5">{otherRatio.toFixed(1)}%</span></>
            )}
            {cashRatio > 0.5 && (
              <> · 현금·기타 <span className="font-bold text-gray-500 ml-0.5">{cashRatio.toFixed(1)}%</span></>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// 큐레이트 10색 팔레트 — tailwind 500 톤 (인접 슬라이스 max 대비)
// [light, base, dark] — radial gradient 로 3D 돔 효과
const PIE_PALETTE: [string, string, string][] = [
  ["#fb7185", "#f43f5e", "#be123c"],  // rose
  ["#fb923c", "#f97316", "#c2410c"],  // orange
  ["#facc15", "#eab308", "#a16207"],  // yellow
  ["#a3e635", "#84cc16", "#4d7c0f"],  // lime
  ["#34d399", "#10b981", "#047857"],  // emerald
  ["#22d3ee", "#06b6d4", "#0e7490"],  // cyan
  ["#60a5fa", "#3b82f6", "#1d4ed8"],  // blue
  ["#818cf8", "#6366f1", "#4338ca"],  // indigo
  ["#c084fc", "#a855f7", "#7e22ce"],  // purple
  ["#f472b6", "#ec4899", "#be185d"],  // pink
];

// 첫번째 카드 자리 — 비중 파이그래프
function PieSlot({ items, otherRatio, cashRatio, onHoverIdx }:
                 { items: { name: string; ratio: number }[];
                   otherRatio: number; cashRatio: number;
                   hoveredIdx: number | null;
                   onHoverIdx: (idx: number | null) => void }) {
  // 슬라이스 = 표시 종목 + (그 외) + (현금·기타). itemIdx: 종목 카드 인덱스(메타 슬라이스는 null)
  const slices: { name: string; ratio: number; colors: [string, string, string]; itemIdx: number | null }[] = [
    ...items.map((it, i) => ({
      name: it.name, ratio: it.ratio,
      colors: PIE_PALETTE[i % PIE_PALETTE.length],
      itemIdx: i,
    })),
  ];
  if (otherRatio > 0.5)  slices.push({ name: "그 외",     ratio: otherRatio, colors: ["#d1d5db", "#9ca3af", "#6b7280"], itemIdx: null });
  if (cashRatio  > 0.5)  slices.push({ name: "현금·기타", ratio: cashRatio,  colors: ["#e5e7eb", "#d1d5db", "#9ca3af"], itemIdx: null });

  const total = slices.reduce((s, x) => s + x.ratio, 0);
  // viewBox 220×150 — 콜아웃 라인+% 라벨이 파이 옆으로 빠질 공간 확보
  const cx = 110, cy = 75, r = 50;
  // 슬라이스 기하 미리 계산 (start/mid/end angle)
  const geoms: { start: number; mid: number; end: number; angle: number }[] = [];
  {
    let cum = -Math.PI / 2;
    for (const s of slices) {
      const angle = (s.ratio / total) * Math.PI * 2;
      const start = cum;
      const mid = cum + angle / 2;
      cum += angle;
      geoms.push({ start, mid, end: cum, angle });
    }
  }
  const gid = `pie-${Math.random().toString(36).slice(2, 8)}`;
  // 호버는 PieSlot 내부 상태 (모든 슬라이스 대상), 부모로는 종목 인덱스만 전파
  const [localHover, setLocalHover] = useState<number | null>(null);

  const onEnter = (i: number) => {
    setLocalHover(i);
    onHoverIdx(slices[i].itemIdx);  // 메타 슬라이스는 null
  };
  const onLeave = () => {
    setLocalHover(null);
    onHoverIdx(null);
  };

  return (
    <div className="flex items-center justify-center min-h-[160px]">
      <svg viewBox="0 0 220 150" className="w-full h-auto max-h-[160px]"
           role="img" aria-label="ETF 구성 비중 분포">
        <defs>
          {/* 슬라이스별 radial gradient — 중심 밝게, 가장자리 어둡게 (3D 돔) */}
          {slices.map((s, i) => (
            <radialGradient key={i} id={`${gid}-grad-${i}`}
                            cx="50%" cy="50%" r="62%" fx="42%" fy="38%">
              <stop offset="0%"   stopColor={s.colors[0]} />
              <stop offset="55%"  stopColor={s.colors[1]} />
              <stop offset="100%" stopColor={s.colors[2]} />
            </radialGradient>
          ))}
        </defs>
        <g>
          {slices.map((s, i) => {
            const g = geoms[i];
            const x1 = cx + r * Math.cos(g.start);
            const y1 = cy + r * Math.sin(g.start);
            const x2 = cx + r * Math.cos(g.end);
            const y2 = cy + r * Math.sin(g.end);
            const largeArc = g.angle > Math.PI ? 1 : 0;
            const path = `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)}
                          A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
            // 호버 시 mid-angle 방향으로 살짝 튀어나옴
            const isHover = localHover === i;
            const offset = isHover ? 7 : 0;
            const dx = offset * Math.cos(g.mid);
            const dy = offset * Math.sin(g.mid);
            return (
              <path key={`${s.name}-${i}`} d={path}
                    fill={`url(#${gid}-grad-${i})`}
                    stroke="white" strokeWidth="3" strokeLinejoin="round"
                    transform={`translate(${dx.toFixed(2)} ${dy.toFixed(2)})`}
                    style={{ transition: "transform 0.15s ease-out", cursor: "pointer" }}
                    onMouseEnter={() => onEnter(i)}
                    onMouseLeave={onLeave}>
                <title>{`${s.name} — ${s.ratio.toFixed(1)}%`}</title>
              </path>
            );
          })}
        </g>
        {/* 콜아웃 — 항상 표시. mid-angle 방향으로 선 + dot + % 라벨 */}
        <g style={{ pointerEvents: "none" }}>
          {slices.map((s, i) => {
            if (s.ratio / total < 0.015) return null;  // 1.5% 미만은 라벨 생략(겹침 방지)
            const g = geoms[i];
            const isHover = localHover === i;
            const offset = isHover ? 7 : 0;  // 슬라이스 튀어나오면 콜아웃도 함께 이동
            const ox = offset * Math.cos(g.mid);
            const oy = offset * Math.sin(g.mid);
            const lineStartX = cx + ox + r * 0.95 * Math.cos(g.mid);
            const lineStartY = cy + oy + r * 0.95 * Math.sin(g.mid);
            const lineEndX   = cx + ox + r * 1.28 * Math.cos(g.mid);
            const lineEndY   = cy + oy + r * 1.28 * Math.sin(g.mid);
            const onRight = Math.cos(g.mid) >= 0;
            const labelX = lineEndX + (onRight ? 2.5 : -2.5);
            return (
              <g key={`callout-${i}`}
                 style={{ transition: "transform 0.15s ease-out" }}>
                <line x1={lineStartX} y1={lineStartY} x2={lineEndX} y2={lineEndY}
                      stroke={s.colors[2]} strokeWidth="1" strokeLinecap="round" />
                <circle cx={lineEndX} cy={lineEndY} r="1.3" fill={s.colors[2]} />
                <text x={labelX} y={lineEndY} fontSize="10"
                      fontWeight={isHover ? "bold" : "600"}
                      fill={s.colors[2]} textAnchor={onRight ? "start" : "end"}
                      dominantBaseline="central"
                      style={{ paintOrder: "stroke", stroke: "white", strokeWidth: 3 }}>
                  {s.ratio.toFixed(1)}%
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
