import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { fetchEtfCompositions, fetchTossPrices, fetchKrPriceHistory, fetchKrRegularPrices, searchTossAutoComplete, fetchUsHoldingPrices, fetchTossCodeInfo, fetchYahooPriceHistory, fetchEtfKeyIndicator, fetchWarning, type KrRegularPrice } from "../lib/api";
import { loadHoldings } from "../lib/db";
import { Sparkline } from "./Sparkline";
import { Tooltip } from "./Tooltip";
import { formatSigned, signColor, isEtfByName, etfActiveType, dayChangePct, dayChangeDiff, isKrHoldingClosed, tradeSecOf } from "../lib/format";
import { getDimSleepingEnabled } from "../lib/proxyConfig";
import { usSessionLabel, etTodayStr } from "../lib/usSectorFlow";
import { fetchForeignHoldingPrices, looksLikeForeignName } from "../lib/foreignStocks";
import { openExternal } from "../lib/toss";
import { EtfCompareChartDialog } from "./EtfCompareChartDialog";
import { MarketAlertDialog } from "./MarketAlertDialog";
import { requestValuation } from "../lib/valuationNav";
import { useEscClose } from "../lib/useEscClose";
import type { Price } from "../types";

// 현재가·일간% (+선택적 추세 스파크라인) 미니 카드 — 검색 드롭다운·비교표 공용
function MiniPriceCard({ price, chart, showTrend = true }:
                       { price?: Price; chart?: number[]; showTrend?: boolean }) {
  const pct = price ? dayChangePct(price) : undefined;
  const diff = price ? dayChangeDiff(price) : undefined;
  const colorDiff = price ? price.price - (price.prevClose || price.price) : 0;
  const priceCls = colorDiff > 0 ? "text-rose-600" : colorDiff < 0 ? "text-blue-600" : "text-gray-900";
  const c = chart ?? [];
  return (
    <div className="relative overflow-hidden border border-gray-200 rounded-md
                    bg-gray-50/60 px-2 py-1 min-h-[36px] flex flex-col justify-center">
      {showTrend && c.length > 1 && (
        <Sparkline data={c} width={300} height={36}
                   className="absolute inset-0 w-full h-full opacity-20 pointer-events-none" />
      )}
      <div className="relative z-10 flex items-baseline gap-1.5 flex-wrap">
        <span className={`text-sm font-bold leading-tight tabular-nums ${priceCls}`}>
          {price ? `${price.price.toLocaleString()}원` : "—"}
        </span>
        {pct !== undefined && (
          <span className={`text-xs font-bold tabular-nums rounded px-1 bg-yellow-100 ${signColor(pct)}`}>
            {pct >= 0 ? "+" : ""}{pct.toFixed(2)}%
          </span>
        )}
        {diff !== undefined && (
          <span className="text-[11px] text-gray-600 tabular-nums">({formatSigned(diff)}원)</span>
        )}
      </div>
    </div>
  );
}

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
  // 검색 드롭다운 키보드 선택 인덱스 (방향키 ↑/↓, Enter 선택)
  const [cmpActiveIdx, setCmpActiveIdx] = useState(0);
  // 검색 결과 정렬 기준 — 관련도(기본)/현재등락/1·3·6개월
  const [cmpSort, setCmpSort] = useState<"rel" | "day" | "m1" | "m3" | "m6">("rel");
  // ETF 수수료정보 팝업
  const [infoOpen, setInfoOpen] = useState(false);
  // 그래프 비교 팝업 (분봉/주봉 등락률)
  const [graphOpen, setGraphOpen] = useState(false);

  // ESC — 공용 훅을 쓴다. 자체 리스너를 달면 **겹쳐 뜬 모달이 한 번에 다 닫힌다**
  //   (이 팝업 위에 기업가치를 열고 ESC 를 누르면 둘 다 닫혔다).
  //   useEscClose 는 열린 순서를 스택으로 들고 맨 위 것만 반응시킨다.
  useEscClose(isOpen, onClose);

  // 모달 닫힐 때 비교 state 도 초기화
  useEffect(() => {
    if (!isOpen) {
      setSecondEtf(null); setCompareOpen(false); setCompareQuery("");
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

  // 해당 ETF 총보수 — 헤더 버튼 라벨용
  const { data: ownEtfKey } = useQuery({
    queryKey: ["etf-key-indicator", ticker],
    queryFn: () => fetchEtfKeyIndicator(ticker),
    enabled: isOpen && /^[\dA-Za-z]{6}$/.test(ticker),
    staleTime: 6 * 60 * 60_000,
  });

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
  // 검색결과 ETF 6개월 히스토리 — 추세 스파크라인 + 1·3·6개월 수익률 + 정렬용
  const cmpHistQs = useQueries({
    queries: cmpTickers.map(t => ({
      queryKey: ["price-history", t, "6mo"],
      queryFn: () => fetchKrPriceHistory(t, "6mo"),
      staleTime: 60 * 60_000,
    })),
  });
  const cmpHist = new Map(cmpHistQs.map((q, i) => [cmpTickers[i], q.data ?? []]));
  const cmpReturns = new Map(
    cmpTickers.map(t => [t, computeReturns(cmpHist.get(t) ?? [])]),
  );
  // 정렬된 검색결과 — 선택 기준 내림차순(관련도면 원순서)
  const sortedResults = useMemo(() => {
    const list = searchResults ?? [];
    if (cmpSort === "rel") return list;
    const metric = (tk: string): number => {
      if (cmpSort === "day") { const p = cmpPriceMap.get(tk); return p ? (dayChangePct(p) ?? -Infinity) : -Infinity; }
      const r = cmpReturns.get(tk);
      return r?.[cmpSort] ?? -Infinity;
    };
    return [...list].sort((a, b) => metric(b.ticker) - metric(a.ticker));
    // cmpReturns/cmpPriceMap 는 매 렌더 새 Map 이라 deps 에서 제외(렌더마다 재계산 허용)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchResults, cmpSort, cmpPriceList, cmpHistQs.map(q => q.dataUpdatedAt).join(",")]);
  // 드롭다운 결과 변경 시 키보드 인덱스 리셋
  const cmpKey = cmpTickers.join(",");
  useEffect(() => { setCmpActiveIdx(0); }, [cmpKey]);
  // 활성 항목 스크롤 into view
  const cmpListRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const el = cmpListRef.current?.children[cmpActiveIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [cmpActiveIdx]);

  // 검색결과에서 ETF 선택 → 오른쪽 panel 로
  const selectCmp = (r: { ticker: string; name: string }) => {
    setSecondEtf({ ticker: r.ticker, name: r.name });
    setCompareQuery(""); setCompareOpen(false); setCmpActiveIdx(0);
  };

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
            <button onClick={() => { setSecondEtf(null); setCompareOpen(false); }}
                    title="비교 종료"
                    className="inline-flex items-center gap-1 px-2 py-1
                               border border-gray-300 rounded text-[11px] font-bold
                               bg-white text-gray-700 hover:bg-gray-50">
              ✕ 비교 종료
            </button>
          )}
          {isCompare && secondEtf && (
            <button onClick={() => setGraphOpen(true)}
                    title="두 ETF 등락률 그래프 비교 (분봉/주봉)"
                    className="inline-flex items-center gap-1 px-2 py-1
                               border border-indigo-300 rounded text-[11px] font-bold
                               bg-indigo-50 text-indigo-700 hover:bg-indigo-100">
              📈 그래프 비교
            </button>
          )}
          {/* ETF 수수료정보 — 버튼 아래 레이어 팝오버 */}
          <div className="relative">
            <button onClick={() => setInfoOpen(o => !o)}
                    title="총보수·분배율·괴리율·NAV 등 ETF 수수료/지표"
                    className={`inline-flex items-center gap-1 px-2 py-1 border rounded text-[11px] font-bold
                                ${infoOpen ? "border-amber-500 bg-amber-100 text-amber-800"
                                           : "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"}`}>
              📊 ETF 수수료정보{ownEtfKey?.totalFee != null ? `(${ownEtfKey.totalFee}%)` : ""} {infoOpen ? "▴" : "▾"}
            </button>
            {infoOpen && (
              <>
                <div className="fixed inset-0 z-[55]" onClick={() => setInfoOpen(false)} />
                <div className="absolute left-0 top-full mt-1 z-[60] bg-amber-50 border border-amber-200
                                rounded-lg shadow-xl w-[min(92vw,28rem)] max-h-[78vh] overflow-y-auto p-3">
                  <div className="flex gap-3 flex-wrap">
                    <EtfIndicatorBlock ticker={ticker} name={etfName} />
                    {isCompare && secondEtf && (
                      <EtfIndicatorBlock ticker={secondEtf.ticker} name={secondEtf.name} />
                    )}
                  </div>
                  <EtfFeeTip totalFee={ownEtfKey?.totalFee} className="mt-3" />
                </div>
              </>
            )}
          </div>
          {/* inline 검색 — 비교 열림 + 미선택 상태 */}
          {compareOpen && !isCompare && (
            <div className="relative flex-1 min-w-[240px]">
              <input autoFocus
                     value={compareQuery}
                     onChange={e => { setCompareQuery(e.target.value); setCmpActiveIdx(0); }}
                     onKeyDown={e => {
                       const n = sortedResults.length;
                       if (n === 0) return;
                       if (e.key === "ArrowDown") { e.preventDefault(); setCmpActiveIdx(i => (i + 1) % n); }
                       else if (e.key === "ArrowUp") { e.preventDefault(); setCmpActiveIdx(i => (i - 1 + n) % n); }
                       else if (e.key === "Enter") {
                         e.preventDefault();
                         const r = sortedResults[Math.min(cmpActiveIdx, n - 1)];
                         if (r) selectCmp(r);
                       }
                     }}
                     placeholder="비교할 ETF 검색 (예: KODEX 반도체) · ↑↓ 선택, Enter"
                     className="w-full border border-gray-300 rounded px-2 py-1
                                text-sm focus:outline-none focus:border-indigo-500" />
              {/* 검색 결과 dropdown — 정렬바 + 종목 카드(현재가·%·추세·수익률) */}
              {searchResults && searchResults.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1 z-20
                                bg-white border border-gray-200 rounded shadow-lg overflow-hidden">
                  {/* 정렬바 */}
                  <div className="flex items-center gap-1 px-2 py-1 border-b bg-gray-50 text-[11px]">
                    <span className="text-gray-400 shrink-0 mr-0.5">정렬</span>
                    {([["rel", "관련도"], ["day", "등락"], ["m1", "1개월"], ["m3", "3개월"], ["m6", "6개월"]] as const).map(([k, lbl]) => (
                      <button key={k} onClick={() => { setCmpSort(k); setCmpActiveIdx(0); }}
                              className={`px-1.5 py-0.5 rounded font-bold ${cmpSort === k
                                ? "bg-indigo-600 text-white"
                                : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-100"}`}>
                        {lbl}
                      </button>
                    ))}
                  </div>
                  <ul ref={cmpListRef} className="max-h-[55vh] overflow-y-auto text-sm divide-y divide-gray-100">
                    {sortedResults.map((r, idx) => {
                      const active = idx === Math.min(cmpActiveIdx, sortedResults.length - 1);
                      const p = cmpPriceMap.get(r.ticker);
                      const closes = (cmpHist.get(r.ticker) ?? []).map(pt => pt.close);
                      const ret = cmpReturns.get(r.ticker);
                      return (
                        <li key={r.ticker}>
                          <button onClick={() => selectCmp(r)}
                                  onMouseEnter={() => setCmpActiveIdx(idx)}
                                  className={`w-full text-left px-2 py-2 ${active ? "bg-indigo-50" : "hover:bg-gray-50"}`}>
                            <div className="flex items-baseline gap-1.5 mb-1 min-w-0">
                              <span className="font-bold truncate">{r.name}</span>
                              <span className="text-[11px] text-gray-500 font-mono shrink-0">{r.ticker}</span>
                            </div>
                            <MiniPriceCard price={p} chart={closes} showTrend />
                            {/* 1·3·6개월 수익률 */}
                            <div className="flex items-center gap-2 mt-1 text-[11px] font-bold tabular-nums">
                              {([["1개월", ret?.m1], ["3개월", ret?.m3], ["6개월", ret?.m6]] as const).map(([lbl, v]) =>
                                v == null ? (
                                  <span key={lbl} className="text-gray-300">
                                    <span className="font-normal mr-0.5">{lbl}</span>—
                                  </span>
                                ) : (
                                  <span key={lbl} className={signColor(v)}>
                                    <span className="text-gray-400 font-normal mr-0.5">{lbl}</span>
                                    {v >= 0 ? "+" : ""}{v.toFixed(1)}%
                                  </span>
                                ))}
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
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
          <button onClick={onClose}
                  className="ml-auto text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </header>
        {/* 본체 — 단일 카드 그리드 / 비교 시 3열 비교표 */}
        {isCompare && secondEtf ? (
          <div className="flex-1 overflow-y-auto">
            <EtfDiffTable tickerA={ticker} nameA={etfName}
                          tickerB={secondEtf.ticker} nameB={secondEtf.name}
                          onRequestSearch={onRequestSearch} />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <EtfPanel ticker={ticker} etfName={etfName}
                      onRequestSearch={onRequestSearch} />
          </div>
        )}
      </div>
      {graphOpen && secondEtf && (
        <EtfCompareChartDialog
          isOpen={graphOpen}
          onClose={() => setGraphOpen(false)}
          seed={[{ ticker, name: etfName }, { ticker: secondEtf.ticker, name: secondEtf.name }]} />
      )}
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

// ─── EtfDiffTable — 두 ETF 구성 비교 3열표 (A에만 / 둘다 / B에만) ────────────
interface DiffTableProps {
  tickerA: string; nameA: string;
  tickerB: string; nameB: string;
  onRequestSearch?: (query: string) => void;
}

const isOtherCat = (name: string) => name === "그 외" || name === "기타";
// 구성 배열 → { key: {name, ratio} } 맵. KR=6자리코드, 해외(미국)=토스 내부코드 그대로 key.
//   선물·그외 등은 제외. 같은 미국 종목은 토스코드가 ETF 간 동일해 비교 매칭됨.
function compMap(items: { stockCode: string; name: string; ratio: number }[]) {
  const m = new Map<string, { name: string; ratio: number }>();
  for (const it of items) {
    if (isOtherCat(it.name)) continue;
    const t = it.stockCode.replace(/^A/, "");
    const krCode = /^[\dA-Za-z]{6}$/.test(t);
    const isForeign = !krCode && /^[A-Z]{2,4}\d/.test(it.stockCode);
    if (!krCode && !isForeign) continue;
    m.set(krCode ? t : it.stockCode, { name: it.name, ratio: it.ratio });
  }
  return m;
}

function EtfDiffTable({ tickerA, nameA, tickerB, nameB, onRequestSearch }: DiffTableProps) {
  const [qa, qb] = useQueries({
    queries: [tickerA, tickerB].map(t => ({
      queryKey: ["etf-compositions", t],
      queryFn: () => fetchEtfCompositions(t),
      staleTime: 10 * 60_000,
    })),
  });

  const diff = useMemo(() => {
    const ma = compMap(qa.data?.items ?? []);
    const mb = compMap(qb.data?.items ?? []);
    const onlyA: { ticker: string; name: string; ratio: number }[] = [];
    const onlyB: { ticker: string; name: string; ratio: number }[] = [];
    const both: { ticker: string; name: string; ra: number; rb: number }[] = [];
    for (const [t, v] of ma) {
      if (mb.has(t)) both.push({ ticker: t, name: v.name, ra: v.ratio, rb: mb.get(t)!.ratio });
      else onlyA.push({ ticker: t, name: v.name, ratio: v.ratio });
    }
    for (const [t, v] of mb) if (!ma.has(t)) onlyB.push({ ticker: t, name: v.name, ratio: v.ratio });
    onlyA.sort((x, y) => y.ratio - x.ratio);
    onlyB.sort((x, y) => y.ratio - x.ratio);
    both.sort((x, y) => Math.max(y.ra, y.rb) - Math.max(x.ra, x.rb));
    // 막대 스케일 — 양쪽 모든 비중 중 최댓값
    const maxRatio = Math.max(1,
      ...onlyA.map(x => x.ratio), ...onlyB.map(x => x.ratio),
      ...both.map(x => Math.max(x.ra, x.rb)));
    const sumA = (qa.data?.items ?? []).filter(it => !isOtherCat(it.name)).reduce((s, it) => s + it.ratio, 0);
    const sumB = (qb.data?.items ?? []).filter(it => !isOtherCat(it.name)).reduce((s, it) => s + it.ratio, 0);
    const overlapA = both.reduce((s, x) => s + x.ra, 0);
    const overlapB = both.reduce((s, x) => s + x.rb, 0);
    return { onlyA, onlyB, both, maxRatio, sumA, sumB, overlapA, overlapB };
  }, [qa.data, qb.data]);

  // KR 가격/차트/마감 조회용 ticker — KR 6자리만(미국 토스코드 섞이면 KR 배치 호출이 깨짐).
  //   미국 종목 가격은 StockCard 가 자체 조회.
  const allTickers = useMemo(() => {
    const s = new Set<string>();
    const addKr = (t: string) => { if (/^[\dA-Za-z]{6}$/.test(t)) s.add(t); };
    addKr(tickerA); addKr(tickerB);
    diff.onlyA.forEach(x => addKr(x.ticker));
    diff.onlyB.forEach(x => addKr(x.ticker));
    diff.both.forEach(x => addKr(x.ticker));
    return Array.from(s);
  }, [diff, tickerA, tickerB]);
  const { data: priceList } = useQuery({
    queryKey: ["etf-diff-prices", allTickers],
    queryFn: () => fetchTossPrices(allTickers),
    enabled: allTickers.length > 0,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const priceMap = new Map((priceList ?? []).map(p => [p.ticker, p]));
  const chartQs = useQueries({
    queries: allTickers.map(t => ({
      queryKey: ["price-history", t, "3mo"],
      queryFn: () => fetchKrPriceHistory(t, "3mo"),
      staleTime: 60 * 60_000,
    })),
  });
  const chartMap = new Map(chartQs.map((q, i) => [allTickers[i], (q.data ?? []).map(p => p.close)]));
  // 카드 — 장 마감 흐림 + 마감가 태그 + 보유 그룹 (카드뷰와 동일)
  const dimEnabled = getDimSleepingEnabled();
  const { data: krRegMap } = useQuery({
    queryKey: ["etf-kr-reg-prices", allTickers],
    queryFn: () => fetchKrRegularPrices(allTickers),
    enabled: allTickers.length > 0,
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
  });
  const { data: holdings } = useQuery({
    queryKey: ["holdings-for-etf-modal"],
    queryFn: loadHoldings,
    staleTime: 30_000,
  });
  const holdingGroups = new Map<string, string[]>();
  for (const h of holdings ?? []) {
    const acc = (h.account ?? "").trim();
    if (!acc) continue;
    const arr = holdingGroups.get(h.ticker) ?? [];
    if (!arr.includes(acc)) arr.push(acc);
    holdingGroups.set(h.ticker, arr);
  }

  const loading = qa.isLoading || qb.isLoading;
  if (loading) return <div className="text-center text-xs text-gray-400 py-10">불러오는 중...</div>;

  const A_COLOR = "#6366f1";   // indigo — A(왼쪽)
  const B_COLOR = "#0d9488";   // teal   — B(오른쪽)
  const endDateA = qa.data?.endDate ?? null;   // 구성 기준일
  const endDateB = qb.data?.endDate ?? null;
  // 각 ETF 전체 구성 ticker(6자리 영숫자) — "한번에 추가"용
  const allOf = (items?: { stockCode: string; name: string }[]) =>
    (items ?? []).map(it => it.stockCode.replace(/^A/, "")).filter(t => /^[\dA-Za-z]{6}$/.test(t));
  const aAll = allOf(qa.data?.items);
  const bAll = allOf(qb.data?.items);

  // "종목 N개 한번에 추가" 버튼
  const addAllBtn = (tickers: string[]) =>
    onRequestSearch && tickers.length > 0 ? (
      <button onClick={() => onRequestSearch(tickers.join(" "))}
              title="이 ETF 모든 구성 종목을 검색창에 한번에 추가"
              className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 border border-emerald-300
                         rounded text-[10px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100">
        ✅ 종목 {tickers.length}개 한번에 추가
      </button>
    ) : null;

  // ETF 전체 구성 → 파이용 데이터(표시 종목/그외/현금)
  const pieData = (raw: { stockCode: string; name: string; ratio: number }[]) => {
    const vis = raw.filter(it => !isOtherCat(it.name));
    const other = raw.filter(it => isOtherCat(it.name)).reduce((s, it) => s + it.ratio, 0);
    const visRatio = vis.reduce((s, it) => s + it.ratio, 0);
    const cash = Math.max(0, 100 - visRatio - other);
    return { vis, other, cash };
  };
  const pieA = pieData(qa.data?.items ?? []);
  const pieB = pieData(qb.data?.items ?? []);

  // 열 상단 — ETF 자기 카드(좌) + 파이(우)
  const etfHeader = (etfTicker: string, etfName: string, pie: ReturnType<typeof pieData>) => (
    <div className="flex gap-2 items-start pt-3">
      <div className="flex-1 min-w-0">
        <StockCard i={0} item={{ stockCode: etfTicker, name: etfName, ratio: 0 }} hideRatio
                   price={priceMap.get(etfTicker)} chart={chartMap.get(etfTicker)}
                   krReg={krRegMap?.get(etfTicker)} groups={holdingGroups.get(etfTicker) ?? []}
                   dimEnabled={dimEnabled} onRequestSearch={onRequestSearch}
                   boxMinH="min-h-[128px]" bigFont showReturns />
      </div>
      <div className="flex-1 min-w-0">
        <PieSlot items={pie.vis} otherRatio={pie.other} cashRatio={pie.cash}
                 hoveredIdx={null} onHoverIdx={() => {}} />
      </div>
    </div>
  );

  // 단독 보유(A에만/B에만) 종목 → 리치 카드 세로 나열
  const soloCards = (list: { ticker: string; name: string; ratio: number }[]) =>
    list.length === 0
      ? <div className="text-center text-[11px] text-gray-400 py-4">없음</div>
      : (
        <div className="grid grid-cols-2 gap-x-2 gap-y-5 pt-3 px-1">
          {list.map((x, i) => (
            <StockCard key={x.ticker} i={i}
                       item={{ stockCode: x.ticker, name: x.name, ratio: x.ratio }}
                       price={priceMap.get(x.ticker)} chart={chartMap.get(x.ticker)}
                       krReg={krRegMap?.get(x.ticker)} groups={holdingGroups.get(x.ticker) ?? []}
                       dimEnabled={dimEnabled} onRequestSearch={onRequestSearch} />
          ))}
        </div>
      );

  return (
    <div className="p-3">
      <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_2fr] gap-3">
        {/* ─ A에만 — A 파이 + A 단독 카드 ─ */}
        <section className="rounded-lg border border-indigo-200 bg-indigo-50/30 flex flex-col min-h-0">
          <div className="px-3 py-2 border-b border-indigo-100">
            <div className="text-xs font-bold text-indigo-800 truncate">◀ {nameA} 에만</div>
            <div className="text-[11px] text-gray-500">
              {diff.onlyA.length}종목 · 비중 {(diff.sumA - diff.overlapA).toFixed(1)}%
              {endDateA && <> · 기준일 {endDateA}</>}
            </div>
            {addAllBtn(aAll)}
          </div>
          <div className="p-2 overflow-y-auto max-h-[70vh]">
            {etfHeader(tickerA, nameA, pieA)}
            {soloCards(diff.onlyA)}
          </div>
        </section>

        {/* ─ 둘다 (비중 비교) ─ */}
        <section className="rounded-lg border border-gray-300 bg-white flex flex-col min-h-0">
          <div className="px-3 py-2 border-b border-gray-200">
            <div className="text-xs font-bold text-gray-800">⇄ 둘 다 보유 · {diff.both.length}종목</div>
            <div className="text-[11px] flex items-center gap-1 mt-0.5">
              <span className="flex-1 truncate text-right font-bold" title={nameA} style={{ color: A_COLOR }}>◀ {nameA}</span>
              <span className="text-gray-300 shrink-0">│</span>
              <span className="flex-1 truncate font-bold" title={nameB} style={{ color: B_COLOR }}>{nameB} ▶</span>
            </div>
          </div>
          <div className="p-2 space-y-4 overflow-y-auto max-h-[70vh]">
            {diff.both.length === 0
              ? <div className="text-center text-[11px] text-gray-400 py-4">겹치는 종목 없음</div>
              : diff.both.map((x, i) => {
                  const delta = Math.abs(x.ra - x.rb);
                  const same = delta < 0.05;
                  const aBigger = x.ra >= x.rb;
                  // 차이 책갈피 — 동일하면 없음
                  const diffBadge = same ? null : (
                    <div className="border rounded px-1 py-0 leading-tight tabular-nums
                                    text-[11px] font-bold bg-white whitespace-nowrap"
                         style={{ color: "#ef4444", borderColor: "#ef444466" }}>
                      +{delta.toFixed(1)}%
                    </div>
                  );
                  const aTag = <RatioTag ratio={x.ra} color={A_COLOR} />;
                  const bTag = <RatioTag ratio={x.rb} color={B_COLOR} />;
                  // 차이 책갈피를 많은 쪽 비중 옆에 붙임
                  const leftTag = !same && aBigger
                    ? <div className="flex items-center gap-0.5">{aTag}{diffBadge}</div> : aTag;
                  const rightTag = !same && !aBigger
                    ? <div className="flex items-center gap-0.5">{diffBadge}{bTag}</div> : bTag;
                  return (
                    <div key={x.ticker}>
                      {/* 종목 리치 카드 — A 비중(좌)·B 비중(우), 차이는 많은 쪽에 부착 */}
                      <StockCard i={i} item={{ stockCode: x.ticker, name: x.name, ratio: 0 }} hideRatio
                                 price={priceMap.get(x.ticker)} chart={chartMap.get(x.ticker)}
                                 krReg={krRegMap?.get(x.ticker)} groups={holdingGroups.get(x.ticker) ?? []}
                                 dimEnabled={dimEnabled} onRequestSearch={onRequestSearch}
                                 leftTag={leftTag} rightTag={rightTag} />
                    </div>
                  );
                })}
          </div>
        </section>

        {/* ─ B에만 — B 파이 + B 단독 카드 ─ */}
        <section className="rounded-lg border border-teal-200 bg-teal-50/30 flex flex-col min-h-0">
          <div className="px-3 py-2 border-b border-teal-100">
            <div className="text-xs font-bold text-teal-800 truncate">{nameB} 에만 ▶</div>
            <div className="text-[11px] text-gray-500">
              {diff.onlyB.length}종목 · 비중 {(diff.sumB - diff.overlapB).toFixed(1)}%
              {endDateB && <> · 기준일 {endDateB}</>}
            </div>
            {addAllBtn(bAll)}
          </div>
          <div className="p-2 overflow-y-auto max-h-[70vh]">
            {etfHeader(tickerB, nameB, pieB)}
            {soloCards(diff.onlyB)}
          </div>
        </section>
      </div>
      <div className="text-[11px] text-gray-400 text-center mt-3">
        둘 다 보유 <b className="text-gray-600">{diff.both.length}</b>종목 · 공통 비중 <span className="text-gray-500 font-bold">회색</span> · 더 담은 쪽은 그 ETF 색(<span className="text-indigo-600 font-bold">A</span>·<span className="text-teal-600 font-bold">B</span>)으로 강조 · 중앙 숫자는 차이(%) · 행 클릭 시 검색창에 추가
      </div>
    </div>
  );
}

// ─── StockCard — ETF 구성 종목 1개 리치 카드 (탭·비중태그·추세·가격%·보유그룹) ──
//     EtfPanel(카드뷰)과 EtfDiffTable(A/B 전용 열) 공용 — 한쪽만 바뀌지 않게 단일 소스.
interface StockCardProps {
  i: number;                 // 0-base 인덱스 — 번호 배지 + 비중태그 팔레트색
  item: { stockCode: string; name: string; ratio: number };
  price?: Price;
  chart?: number[];
  krReg?: KrRegularPrice;
  groups?: string[];         // 보유 그룹
  dimEnabled?: boolean;      // 장 마감 흐림 설정
  onRequestSearch?: (query: string) => void;
  extraDim?: string;         // 부모 지정 dim 클래스(공통종목/파이호버) — 있으면 우선
  hideRatio?: boolean;       // ETF 자기 카드 등 — 번호배지·비중태그 숨김
  leftTag?: ReactNode;       // 좌상단 책갈피 커스텀(없으면 마감가 태그)
  rightTag?: ReactNode;      // 우상단 책갈피 커스텀(없으면 비중 태그)
  centerTag?: ReactNode;     // 상단 가운데 책갈피(비교표 비중 차이 등)
  className?: string;        // 루트에 추가(예: 그리드 self-end 정렬)
  boxMinH?: string;          // 가격 박스 최소 높이 클래스(기본 min-h-[80px]) — ETF 자체 카드 등 크게
  bigFont?: boolean;         // 가격·% 폰트 크게 — ETF 자체 카드용
  showReturns?: boolean;     // 1·3·6개월 수익률 표시 (ETF 자체 카드용, KR 한정)
  returns?: { m1: number | null; m3: number | null; m6: number | null } | null;  // 외부 계산 주입(자체조회 대체)
  actionLeft?: ReactNode;    // 상단 + 버튼 왼쪽 추가 액션(예: ETF 구성 보기)
  boxRight?: ReactNode;      // 가격 박스 내부 오른쪽 영역(예: 포함 종목 분해)
  highlightReturn?: "m1" | "m3" | "m6";  // 해당 기간 수익률 강조(정렬 기준)
  highlightDay?: boolean;    // 일간% 강조(정렬=현재)
  // 해외(미국) 구성종목 — 부모가 한 번에 받아 내려주면 카드는 자기 조회를 건너뛴다.
  //   (종목마다 따로 부르면 10종에 코드조회 10 + 시세 10 = 20콜이다)
  usPrice?: Price;
  usSymbol?: string;
  usChart?: number[];        // 부모가 이미 받아 둔 해외 일봉 종가 — 배경 스파크라인용(추가 호출 없음)
  warning?: string;          // 거래소 시장조치(투자경고/투자주의/거래정지…) — 종목 카드와 같은 소스
  noteRow?: ReactNode;       // 가격 박스 안, 일간% 아래 한 줄 (예: 구성종목 프리장 가중)
}
// 6개월 종가 → 수익률 계산 export (EtfReverseTab 등 재사용)
export { computeReturns };

// 6개월 히스토리 → 1/3/6개월 수익률(%) — 마지막 종가 기준 N개월 전 종가 대비
function computeReturns(h: { date: string; close: number }[]): { m1: number | null; m3: number | null; m6: number | null } | null {
  if (h.length < 2) return null;
  const last = h[h.length - 1].close;
  const lastDate = new Date(h[h.length - 1].date);
  const at = (months: number): number | null => {
    const target = new Date(lastDate);
    target.setMonth(target.getMonth() - months);
    let base: number | null = null;
    for (let i = h.length - 1; i >= 0; i--) {
      if (new Date(h[i].date) <= target) { base = h[i].close; break; }
    }
    if (base == null) base = h[0].close;
    return base > 0 ? ((last - base) / base) * 100 : null;
  };
  return { m1: at(1), m3: at(3), m6: at(6) };
}
// 비중 책갈피 — 색상 지정(비교표 A/B 등)
function RatioTag({ ratio, color }: { ratio: number; color: string }) {
  return (
    <div className="border rounded px-1.5 py-0 leading-tight flex items-baseline gap-0.5"
         style={{ backgroundColor: `${color}22`, borderColor: `${color}66` }}>
      <span className="text-[9px]" style={{ color }}>비중</span>
      <span className="font-bold text-xs tabular-nums" style={{ color }}>{ratio.toFixed(1)}%</span>
    </div>
  );
}
// 시장조치 뱃지 색 — 종목 카드(StockCard.tsx WARN_BG)와 같은 체계로 맞춘다.
//   같은 경고가 화면마다 다른 색이면 위험도를 눈으로 읽을 수 없다.
// 현지통화 보조표기 — 런던은 펜스(GBp)라 기호도 값도 다르다.
const CUR_SIGN: Record<string, string> = {
  // ⚠️ 위안(CNY)에 그냥 '¥' 를 쓰면 엔(JPY)과 구분이 안 된다 — 값이 10배 넘게 차이 난다.
  JPY: "¥", EUR: "€", GBP: "£", USD: "$", HKD: "HK$", CNY: "CN¥", TWD: "NT$",
  CHF: "CHF ", SEK: "kr ", DKK: "kr ", NOK: "kr ", AUD: "A$", CAD: "C$",
};
function nativeText(v: number, cur?: string): string {
  if (cur === "GBp") return `${Math.round(v).toLocaleString()}p`;   // 펜스 — 그대로 쓴다
  const sign = CUR_SIGN[cur ?? ""] ?? "";
  const dec = v < 1000 ? 2 : 0;                                     // 유럽은 한 자릿수 유로가 흔하다
  return `${sign}${v.toLocaleString(undefined, { maximumFractionDigits: dec })}`;
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

export function StockCard({ i, item, price: priceProp, chart = [], krReg, groups = [], dimEnabled = false, onRequestSearch, extraDim, hideRatio, leftTag, rightTag, centerTag, className, boxMinH = "min-h-[80px]", bigFont, showReturns, returns: returnsProp, actionLeft, boxRight, highlightReturn, highlightDay, usPrice, usSymbol, usChart, noteRow, warning }: StockCardProps) {
  const priceSize = bigFont ? "text-2xl" : "text-base";
  const pctSize = bigFont ? "text-lg" : "text-sm";
  const [alertOpen, setAlertOpen] = useState(false);   // 시장조치 공시 모달
  const rawCode = item.stockCode;
  const tNum = rawCode.replace(/^A/, "");
  const krCode = /^[\dA-Za-z]{6}$/.test(tNum);   // 한국 코드(영숫자 6자리, 신형 ETF 포함)
  // 해외(미국) 토스 내부코드(US.../NAS... 등) — 티커가 아니므로 해석 필요
  const isForeignCode = !krCode && /^[A-Z]{2,4}\d/.test(rawCode);
  const { data: fInfo } = useQuery({
    queryKey: ["toss-code-info", rawCode],
    queryFn: () => fetchTossCodeInfo(rawCode),
    enabled: isForeignCode && !usSymbol,
    staleTime: 24 * 60 * 60_000,
  });
  const fSymbol = isForeignCode ? (usSymbol ?? fInfo?.symbol ?? null) : null;   // 예: SNDK, MU
  const { data: usPriceList } = useQuery({
    queryKey: ["stockcard-us-price", fSymbol],
    queryFn: () => fetchUsHoldingPrices([fSymbol!]),
    enabled: !!fSymbol && !usPrice,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  // 해외면 US 가격으로, 아니면 부모가 넘긴 KR 가격으로
  // ★ 일본 구성종목은 stockCode 가 없어 isForeignCode 가 false 다. 그래서 usPrice 를
  //   분기 밖에서 먼저 쓴다 — 안 그러면 부모가 내려준 엔화 시세가 그냥 버려진다.
  const price = usPrice ?? (isForeignCode ? (usPriceList?.[0] ?? undefined) : priceProp);
  const fxSym = price?.fxSymbol ?? null;   // 미국 외 해외(6857.T / BA.L …)
  // 해외 추세 — 부모는 KR 히스토리만 주므로 US 티커로 자체 조회
  const { data: usHist } = useQuery({
    queryKey: ["us-history", fSymbol],
    queryFn: () => fetchYahooPriceHistory(fSymbol!, "3mo"),
    enabled: !!fSymbol,
    staleTime: 60 * 60_000,
  });
  // 일본 종목은 코드가 없어 isForeignCode 가 false 다 → 부모 chart 는 늘 비어 있다.
  //   usChart(부모가 시세와 함께 받아 둔 일봉)를 먼저 본다.
  const chartData = usChart?.length ? usChart
    : isForeignCode ? (usHist ?? []).map(p => p.close) : chart;
  // 마감 책갈피에 붙일 **그 마감이 언제인지**. 이미 받아 둔 US 일봉의 마지막 봉 날짜를 쓴다.
  //   토스 usRegClose 는 "직전(또는 오늘) 정규장 종가" 이고, 야후 일봉의 마지막 봉이 정확히 그 세션이다.
  //   (오버나잇·프리마켓엔 오늘 봉이 아직 없어 직전 거래일이 마지막 봉 = 그 정규장)
  //   ⚠️ **정규장이 진행 중이면 마지막 봉은 오늘의 미완성 봉**이고, 그때 토스 usRegClose 는
  //   '어제 종가' 다(closeIsLive → regClose = base). 그래서 한 칸 물러난 봉을 써야 날짜·%가 맞는다.
  const regIdx = (() => {
    if (!isForeignCode || !usHist || usHist.length === 0) return -1;
    const last = usHist.length - 1;
    return usHist[last].date === etTodayStr() && usSessionLabel() === "정규장" ? last - 1 : last;
  })();
  const regDate = regIdx >= 0 ? (usHist?.[regIdx]?.date ?? null) : null;
  // ★ 정규장 등락률. 토스는 **오버나잇·프리장엔 이 값을 안 준다**(전전일 종가가 없어 계산 불가) →
  //   예전엔 `?? 0` 이라 "마감 (+0.00%)" 이라는 거짓말을 찍었다. 야후 일봉 두 봉으로 직접 낸다.
  //   (% 는 통화 무관이라 USD 일봉으로 내도 원화 표시와 어긋나지 않는다)
  const regPctResolved: number | null = !isForeignCode ? null
    : price?.usRegPct != null ? price.usRegPct
    : (usHist && regIdx >= 1 && usHist[regIdx - 1].close > 0
        ? ((usHist[regIdx].close - usHist[regIdx - 1].close) / usHist[regIdx - 1].close) * 100
        : null);
  // 메인 숫자가 '지금 어느 장' 값인지 — 마감과 다른 값을 나란히 놓을 때 이 라벨이 없으면 둘을 못 읽는다.
  const usSess = isForeignCode ? usSessionLabel() : fxSym;
  const addTicker = fSymbol ?? tNum;                                // +추가/검색용
  // 해외는 심볼 해석되면 정상(추가가능), KR 은 영숫자 6자리면 정상
  const isStandard = isForeignCode ? !!fSymbol : krCode;
  // 1·3·6개월 수익률(ETF 자체 카드) — KR 한정. returns prop 주입되면 자체조회 생략.
  const { data: selfReturns } = useQuery({
    queryKey: ["stockcard-returns", tNum],
    queryFn: async () => computeReturns(await fetchKrPriceHistory(tNum, "6mo")),
    enabled: !!showReturns && krCode && returnsProp === undefined,
    staleTime: 60 * 60_000,
  });
  const returns = returnsProp ?? selfReturns;
  const dayDiff = dayChangeDiff(price);
  const dayPct = dayChangePct(price) ?? 0;
  const colorDiff = price ? price.price - (price.prevClose || price.price) : 0;
  const priceColorCls = colorDiff > 0 ? "text-rose-600"
    : colorDiff < 0 ? "text-blue-600" : "text-gray-900";
  const showRegTag = krReg && krReg.regularPrice !== price?.price
                     && (price?.price ?? 0) > 0
                     && Math.abs(krReg.regularPrice - (price?.price ?? 0)) / (price?.price ?? 1) < 0.15;
  const regTagBg = !krReg ? "bg-white/20 border-gray-300/20"
    : krReg.regularPct > 0 ? "bg-rose-100/20 border-rose-300/20"
    : krReg.regularPct < 0 ? "bg-blue-100/20 border-blue-300/20"
    : "bg-white/20 border-gray-300/20";
  const isHeld = groups.length > 0;
  const shownGroups = groups.length >= 3 ? groups.slice(0, 2) : groups;
  const moreGroups = groups.length - shownGroups.length;
  // 해외(미국) 종목은 한국 세션 마감과 무관 — 토스 24h 가격으로 밝게 유지(자기 시장 시간 따름)
  const closedDim = isStandard && dimEnabled && !isForeignCode
    && isKrHoldingClosed(krReg?.tradingEnd, krReg?.nextTradingStart, price?.singlePrice, tradeSecOf(price?.trade_dt));
  const tabBg = closedDim ? "bg-gray-100/60 border-transparent"
    : colorDiff > 0 ? "bg-rose-50 border-rose-300"
    : colorDiff < 0 ? "bg-blue-50/70 border-blue-300"
    : "bg-white border-gray-300";
  // 일본 종목은 isStandard 가 false 다(토스 코드가 없어 +추가·토스링크 불가). 하지만 시세가
  //   있으면 흐리게 할 이유가 없다 — '값이 없다' 는 신호를 '값이 있는데' 보내면 안 된다.
  const dimCls = extraDim || ((!isStandard && !fxSym) ? "opacity-60" : closedDim ? "opacity-60" : "");
  return (
    <div className={`group transition-opacity duration-150 ${dimCls} ${className ?? ""}`}>
      {alertOpen && (
        <MarketAlertDialog ticker={tNum} name={item.name} warning={warning ?? ""}
                           onClose={() => setAlertOpen(false)} />
      )}
      <div className="flex items-end justify-between gap-1 mx-1">
        <div className="flex items-end gap-0.5 flex-wrap min-w-0">
          {/* 종목명 탭 = 외부 링크. 토스에 있는 종목은 토스로, 일본 종목은 토스가 취급하지 않으므로
              야후 파이낸스로 보낸다(심볼은 우리가 이름으로 찾아낸 6857.T 같은 JPX 코드). */}
          <button onClick={isStandard
                    ? () => openExternal(`https://www.tossinvest.com/stocks/${item.stockCode}`)
                    : fxSym
                    ? () => openExternal(`https://finance.yahoo.com/quote/${encodeURIComponent(fxSym)}`)
                    : undefined}
                  disabled={!isStandard && !fxSym}
                  className={`inline-flex items-center px-2 py-0.5 rounded-t-md
                              border-t border-l border-r font-bold text-xs leading-none
                              ${tabBg} ${priceColorCls}
                              ${isStandard || fxSym ? "cursor-pointer hover:brightness-95 transition" : ""}`}
                  title={isStandard ? undefined
                       : fxSym ? `${item.name} (${fxSym}) — 야후 파이낸스에서 보기`
                       : `${item.name} — 선물·기타 (추가 불가)`}>
            {!hideRatio && <span className="text-[10px] text-gray-500 mr-1">{i + 1}</span>}
            {item.name}
          </button>
          {/* 시장조치 뱃지 — 누르면 거래소 공시 모달(종목 카드와 동일 동작) */}
          {warning && krCode && (
            <button onClick={() => setAlertOpen(true)}
                    title={`${item.name} — ${warning} 지정. 눌러서 시장조치 공시 보기`}
                    className={`inline-flex items-center px-1.5 py-0.5 rounded-t-md
                                text-white text-[10px] font-bold leading-none
                                cursor-pointer active:opacity-80 ${WARN_BG[warning] ?? "bg-gray-500"}`}>
              {warning}
            </button>
          )}
        </div>
        <div className="flex items-end gap-0.5">
          {actionLeft}
          {/* 기업가치 — 한국 종목·ETF 만(해외는 재무 소스가 없다). ETF 자기 카드에도 붙는다. */}
          {krCode && (
            <button onClick={e => { e.preventDefault(); e.stopPropagation(); requestValuation(tNum, item.name); }}
                    title={`${item.name} 기업가치 상세 — 지표·수급·대화·뉴스`}
                    className="px-1.5 py-0.5 rounded-t-md text-[10px] font-bold leading-none
                               bg-violet-50 text-violet-700 border-t border-l border-r border-violet-300
                               hover:bg-violet-100">
              📊
            </button>
          )}
          {onRequestSearch && isStandard && (
            <button onClick={e => { e.preventDefault(); e.stopPropagation(); onRequestSearch(addTicker); }}
                    title={`${item.name} (${addTicker}) 추가하기`}
                    className="px-1.5 py-0.5 rounded-t-md text-[10px] font-bold leading-none
                               bg-blue-50 text-blue-700 border-t border-l border-r border-blue-300
                               hover:bg-blue-100">
              +
            </button>
          )}
        </div>
      </div>
      <div className={`border rounded-lg bg-gray-100/60 px-1.5 pt-3 pb-1.5 relative
                       ${closedDim ? "border-transparent" : "border-gray-300"}`}>
        <div className="relative w-full h-full">
          {/* 좌상단 책갈피 — leftTag 우선, 없으면 마감가 태그 */}
          {leftTag ? (
            <div className="absolute -top-2 left-1 z-10">{leftTag}</div>
          ) : showRegTag && krReg ? (
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
          ) : isForeignCode && usSess !== "정규장" && price && (price.usRegClose ?? 0) > 0 ? (
            // ★ 정규장 중엔 안 띄운다 — 그때 usRegClose 는 '전일 종가' 이고, 큰 숫자의 등락률이
            //   이미 그 전일 종가 대비다. 같은 기준을 두 번 적는 셈이라 읽는 사람만 헷갈린다.
            //   프리·오버나잇·애프터·휴장에만 의미가 있다(그땐 큰 숫자가 정규장 움직임이 아니다).
            // 해외(미국) — 정규장 마감가 + 전일 종가 대비 등락률 (지수창과 동일). 애프터장에도 마감 기준 고정.
            (() => {
              const regPct = regPctResolved ?? 0;
              return (
                <div className={`absolute -top-2 left-1 z-10 px-1.5 py-0 border rounded text-[10px] leading-tight whitespace-nowrap
                                 ${regPct > 0 ? "bg-rose-100/20 border-rose-300/20"
                                   : regPct < 0 ? "bg-blue-100/20 border-blue-300/20"
                                   : "bg-white/20 border-gray-300/20"}`}>
                  <span className="text-gray-500">
                    마감{regDate ? ` ${+regDate.slice(5, 7)}/${+regDate.slice(8, 10)}` : ""}{" "}
                  </span>
                  <span className={`tabular-nums font-bold ${signColor(regPct)}`}>{Math.round(price.usRegClose!).toLocaleString()}</span>
                  {regPctResolved != null && (
                    <span className={`tabular-nums ml-1 font-bold ${signColor(regPct)}`}>
                      ({regPct >= 0 ? "+" : ""}{regPct.toFixed(2)}%)
                    </span>
                  )}
                </div>
              );
            })()
          ) : fxSym && price?.trade_date ? (
            // 일본 — 연휴가 길어 한국 ETF 와 며칠씩 어긋난다. **언제 마감값인지**를 반드시 적는다.
            (() => {
              const d = price.trade_date;
              const pct = dayChangePct(price) ?? 0;
              return (
                <div className={`absolute -top-2 left-1 z-10 px-1.5 py-0 border rounded text-[10px] leading-tight whitespace-nowrap
                                 ${pct > 0 ? "bg-rose-100/20 border-rose-300/20"
                                   : pct < 0 ? "bg-blue-100/20 border-blue-300/20"
                                   : "bg-white/20 border-gray-300/20"}`}>
                  <span className="text-gray-500">{`마감 ${+d.slice(5, 7)}/${+d.slice(8, 10)}`}</span>
                </div>
              );
            })()
          ) : null}
          {/* 우상단 책갈피 — rightTag 우선, 없으면 비중 태그(hideRatio 면 생략) */}
          {rightTag ? (
            <div className="absolute -top-2 right-1 z-10">{rightTag}</div>
          ) : !hideRatio ? (() => {
            const [pLight, pBase, pDark] = PIE_PALETTE[i % PIE_PALETTE.length];
            return (
              <div className="absolute -top-2 right-1 z-10 border rounded px-1.5 py-0
                              leading-tight flex items-baseline gap-0.5"
                   style={{ backgroundColor: `${pLight}33`, borderColor: `${pBase}66` }}>
                <span className="text-[9px]" style={{ color: pBase }}>비중</span>
                <span className="font-bold text-xs tabular-nums" style={{ color: pDark }}>
                  {item.ratio.toFixed(1)}%
                </span>
              </div>
            );
          })() : null}
          {/* 상단 가운데 책갈피 */}
          {centerTag && (
            <div className="absolute -top-2 left-1/2 -translate-x-1/2 z-10">{centerTag}</div>
          )}
          {/* 내부: 그래프박스(좌) + boxRight 종목명박스(우) */}
          <div className="flex items-stretch gap-1.5">
          <div className={`relative overflow-hidden border rounded-md
                          bg-gray-50/60 px-2 py-1 space-y-0.5 flex-1 min-w-0 ${boxMinH}
                          flex flex-col justify-center
                          ${closedDim ? "border-transparent" : "border-gray-200"}`}>
            {chartData.length > 1 && (
              <Sparkline data={chartData} width={300} height={120}
                         className="absolute inset-0 w-full h-full opacity-20 pointer-events-none" />
            )}
            <div className="relative z-10">
              <div className="flex items-baseline gap-2">
                <span className={`${priceSize} font-bold leading-tight invisible`}>▲</span>
                <span className={`${priceSize} font-bold leading-tight tabular-nums ${priceColorCls}`}>
                  {price ? `${price.price.toLocaleString()}원` : "—"}
                </span>
                {/* 해외 종목 — 이 숫자가 '지금 어느 장' 값인지. 왼쪽 위 '마감' 책갈피와 짝이다.
                    (마감 9/19 12,345 (+1.07%)  ←→  12,500원 [프리장] +1.24%) */}
                {usSess && (
                  <span className="text-[9px] font-bold leading-none px-1 py-0.5 rounded
                                   border border-gray-300 bg-white/70 text-gray-600 whitespace-nowrap">
                    {usSess}
                  </span>
                )}
              </div>
              <div className={`flex items-baseline gap-1 pl-5 font-bold ${signColor(dayDiff)}`}>
                <span className={`${pctSize} leading-tight rounded px-1 tabular-nums
                                  ${highlightDay ? "bg-white border border-gray-300 shadow-sm" : "bg-yellow-100"}`}>
                  {dayPct >= 0 ? "+" : ""}{dayPct.toFixed(2)}%
                </span>
                <span className="text-[10px] font-normal text-gray-700 tabular-nums">
                  {/* 큰 숫자는 원화 환산값. 괄호 안은 **현지 통화 현재가** — 환산 전 원값을 같이
                      보여줘야 우리가 곱한 숫자인지 소스 값인지 구분이 된다.
                      ⚠️ 여기에 price.price(원화)를 넣고 현지 기호만 붙이면 'CN¥58,013' 같은
                      엉뚱한 표기가 된다(실측). 반드시 priceNative 를 쓴다. */}
                  {price?.nativeCurrency && price.priceNative != null
                    ? `(${nativeText(price.priceNative, price.nativeCurrency)})`
                    : `(${formatSigned(dayDiff)}원)`}
                </span>
              </div>
              {noteRow && <div className="pl-5 mt-0.5">{noteRow}</div>}
              {/* 1·3·6개월 수익률 — 정렬 기준 기간은 박스+배경 강조 */}
              {showReturns && returns && (
                <div className="flex items-center gap-1.5 pl-5 mt-1 text-[11px] font-bold tabular-nums">
                  {([["1개월", returns.m1, "m1"], ["3개월", returns.m3, "m3"], ["6개월", returns.m6, "m6"]] as const).map(([lbl, v, key]) =>
                    v == null ? null : (
                      <span key={lbl}
                            className={`${signColor(v)} ${highlightReturn === key
                              ? "bg-white border border-gray-300 rounded px-1 py-0 shadow-sm" : ""}`}>
                        <span className="text-gray-400 font-normal mr-0.5">{lbl}</span>
                        {v >= 0 ? "+" : ""}{v.toFixed(1)}%
                      </span>
                    ))}
                </div>
              )}
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
          {boxRight && (
            <div className="shrink-0 self-stretch flex items-center max-w-[48%]">{boxRight}</div>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}

// 운용사 상품 설명은 **줄바꿈 없는 한 덩어리**로 온다. 게다가 뒤쪽 절반은 어느 ETF 나 똑같은
//   법적 고지(원금 손실 가능·판매사 책임 없음·투자설명서 확인)다. 그대로 뿌리면 벽처럼 보여
//   정작 중요한 앞부분(무엇에 투자하는지)을 아무도 안 읽는다.
//   → 문장 단위로 끊어 두 문장씩 문단을 만들고, 법적 고지는 접어 둔다.
//   ※ 문장 분리에 lookbehind(?<=)를 쓰지 않는다 — 구형 Safari 는 정규식 리터럴 파싱 단계에서
//     터져 화면 전체가 죽는다. '다. ' 로 split 하고 다시 붙이는 쪽이 안전하다.
const LEGAL_RE = /(투자원금|원본에 손실|손실은 투자자|책임을 지지|집합투자업자|금융감독원|투자설명서|판매회사|자세한 내용은)/;

// 본문에 운용사 홈페이지 주소가 섞여 있다(때로 <…> 로 감싸서). 글자로 두면 아무도 못 누른다.
//   ⚠️ /g 정규식은 lastIndex 를 들고 다녀 test() 를 반복 호출하면 결과가 번갈아 틀린다
//     → 판별용은 /g 없는 별도 상수를 쓴다.
const URL_SPLIT_RE = /(https?:\/\/[^\s<>()]+)/g;
const URL_TEST_RE = /^https?:\/\//;

function Linkify({ text }: { text: string }) {
  return (
    <>
      {text.split(URL_SPLIT_RE).map((part, i) =>
        URL_TEST_RE.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer"
             onClick={e => { e.preventDefault(); openExternal(part); }}
             className="text-blue-600 underline decoration-dotted break-all hover:text-blue-800">
            {part.replace(/^https?:\/\//, "")}
          </a>
        ) : part)}
    </>
  );
}

function splitSummary(raw: string): { body: string[]; legal: string } {
  // ⚠️ 운용사마다 서식이 제각각이다. 특히 번호 항목이 **마침표에 붙어서** 온다:
  //   "…목적으로 합니다.2. 기초지수는…" / "…등을 포함3. 이 투자신탁은…" / "…투자합니다.※ CPU 산업:"
  //   그대로 두면 문장이 안 끊겨 한 줄짜리 벽이 된다. 붙은 자리에 공백을 넣어 준다.
  //   (lookahead(?=)는 어디서나 되지만 lookbehind(?<=)는 구형 Safari 가 파싱에서 터진다 — 쓰지 않는다)
  const text = raw
    .replace(/<(https?:\/\/[^>]+)>/g, "$1")               // <http://…> 감싼 꺾쇠 제거
    .replace(/\s+/g, " ")
    .replace(/다\.(?=\S)/g, "다. ")                        // 합니다.2. → 합니다. 2.
    .replace(/([^\d\s])(\d+\.)\s*(?=[가-힣])/g, "$1 $2 ")  // 포함3. 이 → 포함 3. 이
    .replace(/※/g, " ※")
    .replace(/\s+/g, " ")
    .trim();
  const sentences = text.split(/다\.\s+/)
    .map((x, i, a) => (i < a.length - 1 ? `${x}다.` : x))
    // 한 문장 안에 번호 항목·※ 가 이어 붙은 경우까지 쪼갠다("…등을 포함 3. 이 투자신탁은…")
    .flatMap(x => x.split(/(?=\s\d+\.\s)|(?=\s※\s)/))
    .filter(x => x.trim().length > 0);
  const cut = sentences.findIndex(x => LEGAL_RE.test(x));
  const head = cut < 0 ? sentences : sentences.slice(0, cut);
  const tail = cut < 0 ? [] : sentences.slice(cut);
  // 번호 항목(1. 2. 3.)·※ 는 **그 자체로 한 문단**이다. 그 외에는 두 문장씩 묶는다.
  const paras: string[] = [];
  let cur: string[] = [];
  for (const sen of head) {
    const isItem = /^(\d+\.|※)/.test(sen.trim());
    if ((isItem && cur.length > 0) || cur.length >= 2) { paras.push(cur.join(" ")); cur = []; }
    cur.push(sen.trim());
  }
  if (cur.length > 0) paras.push(cur.join(" "));
  return { body: paras, legal: tail.join(" ").trim() };
}

// 총보수가 어떻게 빠져나가는지 — 세 화면(구성 팝업·ETF비교 탭·기업가치 팝업)이 같은 설명을 쓴다.
//   각자 복사해 두면 문구가 갈라진다. totalFee 를 주면 1개월 환산 예시를 그 ETF 값으로 보여준다.
export function EtfFeeTip({ totalFee, className = "" }: { totalFee?: number; className?: string }) {
  return (
    <div className={`border border-amber-200 rounded-md bg-white/60 p-2
                     text-[11px] text-gray-500 leading-relaxed ${className}`}>
      <div className="font-bold text-gray-600 mb-0.5">💡 총보수는 이렇게 적용돼요</div>
      <ul className="list-disc pl-4 space-y-0.5">
        <li>매일 순자산(NAV)에서 <b>연 보수 ÷ 365</b>씩 자동 차감 — 별도 청구·출금 없음</li>
        <li>ETF 가격에 이미 반영 → <b>보유한 일수만큼만 부담</b>
          {totalFee != null && (
            <> (예: {totalFee}%면 1개월 보유 ≈ {(totalFee * 30 / 365).toFixed(3)}%)</>
          )}</li>
        <li>매수·매도가에 이미 녹아 있어 따로 떼거나 계산하지 않음</li>
        <li>증권사 매매수수료·세금, ETF 내부 매매비용은 <b>총보수와 별개</b></li>
      </ul>
    </div>
  );
}

// ─── EtfIndicatorBlock — ETF 핵심 지표(총보수·분배율·괴리율·운용사·NAV·시총·기간수익률) 한 ETF분 ──
export function EtfIndicatorBlock({ ticker, name }: { ticker: string; name: string }) {
  const { data } = useQuery({
    queryKey: ["etf-key-indicator", ticker],
    queryFn: () => fetchEtfKeyIndicator(ticker),
    enabled: /^[\dA-Za-z]{6}$/.test(ticker),
    staleTime: 6 * 60 * 60_000,
  });
  // [라벨, 값, 용어설명]
  const rows: [string, string, string][] = [];
  if (data?.issuerName) rows.push(["운용사", data.issuerName, "이 ETF를 운용하는 자산운용사"]);
  if (data?.marketValue) rows.push(["시가총액", data.marketValue, "상장 시가총액"]);
  if (data?.totalNav) rows.push(["순자산", data.totalNav, "ETF 총 순자산 규모 (AUM)"]);
  if (data?.totalFee != null) rows.push(["총보수", `${data.totalFee}%`, "연 운용·판매 등 총 보수율 (낮을수록 비용 유리)"]);
  {
    const dy = data?.dividendYieldTtm ?? data?.dividendYield;
    if (dy != null) rows.push(["분배율", `${dy}%`, "최근 1년 분배금 ÷ 주가 (ETF 배당수익률)"]);
    if (data?.dividendPerShareTtm != null) {
      rows.push(["주당 분배금", `${data.dividendPerShareTtm.toLocaleString()}원`,
                 "최근 1년(TTM) 1주당 실제로 지급된 분배금 합계"]);
    }
    // 분배 주기 — 올해 지급한 '달' 목록으로 추정한다. 횟수만 보면 신규 상장 ETF 가
    //   '연 1회' 로 잘못 읽힌다 → 상장이 올해면 주기를 단정하지 않고 실적만 적는다.
    const months = (data?.dividendMonthThisYear ?? "").split(",").filter(Boolean);
    const n = data?.dividendCountThisYear ?? months.length;
    if (n > 0) {
      const listedThisYear = data?.listedDate?.slice(0, 4) === String(new Date().getFullYear());
      const cycle = listedThisYear ? null
        : n >= 10 ? "월 분배" : n >= 4 ? "분기 분배" : n >= 2 ? "반기 분배" : "연 1회";
      rows.push([
        "분배 주기",
        cycle ? `${cycle} (올해 ${n}회)` : `올해 ${n}회 (상장 첫해)`,
        `올해 분배한 달: ${months.join("·")}월. 국내 ETF 는 보통 그 달 마지막 영업일이 분배 기준일이고, `
        + `지급은 그 뒤 2영업일 안에 들어옵니다 — 기준일에 보유하고 있어야 받습니다. `
        + `정확한 날짜는 운용사 공지를 확인하세요.`,
      ]);
    }
  }
  if (data?.nav) rows.push(["NAV", data.nav, "1좌당 순자산가치 (ETF의 이론 적정가)"]);
  if (data?.deviationRate != null) rows.push(["괴리율", `${data.deviationSign ?? ""}${data.deviationRate}%`, "시장가 − NAV 차이 (+면 비싸게, −면 싸게 거래)"]);
  const active = etfActiveType(name);   // true=액티브 / false=패시브 / null=ETF 아님
  if (data?.chaseErrorRate != null) rows.push(["추적오차", `${data.chaseErrorRate}%`,
    active ? "기초지수 대비 이탈 정도 (액티브는 의도적 이탈 → 큰 게 정상)"
           : "기초지수 대비 이탈 정도 (패시브는 낮을수록 추종 정확)"]);
  return (
    <div className="flex-1 min-w-[170px]">
      <div className="font-bold text-sm text-gray-800 mb-1.5 truncate flex items-center gap-1">
        {active != null && (
          <span className={`shrink-0 px-1 py-0.5 rounded text-[10px] font-bold leading-none border ${
            active ? "bg-violet-100 text-violet-700 border-violet-300"
                   : "bg-sky-100 text-sky-700 border-sky-300"}`}>
            {active ? "액티브" : "패시브"}
          </span>
        )}
        <span className="truncate">{name} <span className="text-gray-400 font-normal text-xs">({ticker})</span></span>
      </div>
      {/* 추종 지수 + 상품 설명 — etfAnalysis 가 etfBaseIndex·etfSummary 를 **필드로** 준다.
          (문장에서 정규식으로 캐낼 필요가 없다) 전문은 접어 둔다 — 카드 위가 좁다. */}
      {(data?.baseIndex || data?.summary || data?.description) && (
        <div className="mb-1.5 border border-amber-200 rounded-md bg-white/60 px-2 py-1.5">
          <div className="text-[11px] leading-snug text-gray-700">
            {data?.baseIndex
              ? <>📌 추종 지수 <b className="text-gray-900">{data.baseIndex}</b></>
              : <>📌 상품 설명</>}
          </div>
          {(() => {
            const { body, legal } = splitSummary(data?.summary || data?.description || "");
            return (
              <>
                {body.map((para, i) => (
                  <p key={i} className="mt-1.5 text-[11px] leading-relaxed text-gray-600
                                        break-keep text-pretty">
                    <Linkify text={para} />
                  </p>
                ))}
                {legal && (
                  <div className="mt-2 pt-1.5 border-t border-amber-200/70">
                    <div className="text-[10px] font-bold text-gray-400">⚖️ 투자 위험·법적 고지</div>
                    <p className="mt-0.5 text-[10px] leading-relaxed text-gray-400 break-keep">
                      <Linkify text={legal} />
                    </p>
                  </div>
                )}
              </>
            );
          })()}
          {data?.listedDate?.length === 8 && (
            <p className="mt-1 text-[10px] text-gray-400 tabular-nums">
              상장일 {data.listedDate.slice(0, 4)}.{data.listedDate.slice(4, 6)}.{data.listedDate.slice(6, 8)}
            </p>
          )}
        </div>
      )}
      {!data ? (
        <div className="text-xs text-gray-400 py-3">불러오는 중…</div>
      ) : rows.length === 0 ? (
        <div className="text-xs text-gray-400 py-3">지표 데이터 없음</div>
      ) : (
        <div className="border border-amber-200 rounded-md bg-white/60 p-2 text-[12px] tabular-nums space-y-1.5">
          {rows.map(([k, v, desc]) => {
            const hl = k === "총보수" || k === "추적오차";   // 비용·추종품질 — 흰 배경으로 강조
            return (
              <div key={k} className={hl ? "bg-white border border-amber-300 rounded px-1.5 py-1 shadow-sm" : ""}>
                <div className="flex justify-between gap-2">
                  <span className={`shrink-0 font-bold ${hl ? "text-amber-800" : "text-gray-500"}`}>{k}</span>
                  <span className={`truncate text-right font-extrabold ${hl ? "text-amber-800 text-sm" : "text-amber-700"}`}>{v}</span>
                </div>
                <div className="text-[10px] text-gray-400 leading-tight">{desc}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
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

  const { data: comp, isLoading } = useQuery({
    queryKey: ["etf-compositions", ticker],
    queryFn: () => fetchEtfCompositions(ticker),
    staleTime: 10 * 60_000,
  });
  const items = comp?.items;
  const endDate = comp?.endDate ?? null;

  const stockTickers = (items ?? [])
    .map(it => it.stockCode.replace(/^A/, ""))
    .filter(t => /^[\dA-Za-z]{6}$/.test(t));
  // ETF 자기 카드용 — 가격/차트/마감 조회엔 ETF 자신도 포함(공통 종목 계산엔 미포함)
  const selfTicker = /^[\dA-Za-z]{6}$/.test(ticker) ? ticker : null;
  const cardTickers = selfTicker ? [selfTicker, ...stockTickers] : stockTickers;

  // 부모(비교 컨테이너) 로 ticker 목록 전달 — 공통 종목 계산용
  const tickersKey = stockTickers.join(",");
  useEffect(() => {
    onTickersChange?.(stockTickers);
    // stockTickers ref 가 매 렌더마다 새로 생성되므로 join key 로 동등성 비교
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickersKey]);

  const { data: priceList } = useQuery({
    queryKey: ["etf-stock-prices", cardTickers],
    queryFn: () => fetchTossPrices(cardTickers),
    enabled: cardTickers.length > 0,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const priceMap = new Map((priceList ?? []).map(p => [p.ticker, p]));
  // 장 마감 흐림 — 메인 카드와 동일 기준(설정 ON + 토스 tradingEnd/단일가 마감)
  const dimEnabled = getDimSleepingEnabled();

  const { data: krRegMap } = useQuery({
    queryKey: ["etf-kr-reg-prices", cardTickers],
    queryFn: () => fetchKrRegularPrices(cardTickers),
    enabled: cardTickers.length > 0,
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
  });

  const chartQs = useQueries({
    queries: cardTickers.map(t => ({
      queryKey: ["price-history", t, "3mo"],
      queryFn: () => fetchKrPriceHistory(t, "3mo"),
      staleTime: 60 * 60_000,
    })),
  });
  const chartMap = new Map(chartQs.map((q, i) =>
    [cardTickers[i], (q.data ?? []).map(p => p.close)]));

  // ── 해외(미국) 구성종목 시세를 **한 번에**. 카드마다 따로 부르면 10종에 20콜이다.
  //    ETF 자기 카드의 '구성 [프리장] 가중' 도 이 값으로 낸다 — 같은 숫자를 두 번 받지 않는다.
  const foreignCodes = (items ?? [])
    .map(it => it.stockCode ?? "")
    .filter(c => !/^[\dA-Za-z]{6}$/.test(c.replace(/^A/, "")) && /^[A-Z]{2,4}\d/.test(c));
  const foreignKey = foreignCodes.join(",");
  const { data: foreign } = useQuery({
    queryKey: ["etf-foreign-quotes", foreignKey],
    queryFn: async () => {
      const codes = foreignKey.split(",").filter(Boolean);
      const infos = await Promise.all(codes.map(c => fetchTossCodeInfo(c).catch(() => null)));
      const symByCode = new Map<string, string>();
      infos.forEach((info, i) => { if (info?.symbol) symByCode.set(codes[i], info.symbol); });
      const syms = [...new Set(symByCode.values())];
      const prices = syms.length ? await fetchUsHoldingPrices(syms) : [];
      const bySym = new Map(prices.map(p => [p.ticker, p]));
      const byCode = new Map<string, Price>();
      for (const [code, sym] of symByCode) {
        const p = bySym.get(sym);
        if (p) byCode.set(code, p);
      }
      return { symByCode, byCode };
    },
    enabled: foreignCodes.length > 0,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  // ── 일본 구성종목 — 토스가 stockCode 를 null 로 주는 종목들.
  //    코드가 없으니 **이름이 키**다. 이름 → JPX 심볼은 한 번 풀면 localStorage 에 영구 보관된다.
  const fxNames = (items ?? [])
    .filter(it => !(it.stockCode ?? "").trim() && looksLikeForeignName(it.name))
    .map(it => it.name);
  const fxKey = fxNames.join("|");
  const { data: fxPrices } = useQuery({
    queryKey: ["etf-foreign-nonus-quotes", fxKey],
    queryFn: () => fetchForeignHoldingPrices(fxKey.split("|").filter(Boolean)),
    enabled: fxNames.length > 0,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const fxMap = new Map((fxPrices?.prices ?? []).map(p => [p.ticker, p]));

  // ── 거래소 시장조치(투자경고·투자주의·거래정지…) — 종목 카드와 **같은 쿼리키**라
  //    이미 보유 중인 종목은 캐시가 그대로 맞아 추가 호출이 안 나간다.
  const warnQs = useQueries({
    queries: stockTickers.map(t => ({
      queryKey: ["warning", t],
      queryFn: () => fetchWarning(t),
      staleTime: 10 * 60_000,
      refetchOnWindowFocus: false,
    })),
  });
  const warnMap = new Map(warnQs.map((q, i) => [stockTickers[i], q.data ?? ""]));

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
  // 해외(미국) 구성종목이 섞인 ETF 인가 — 섞였으면 아래 시차 안내를 띄운다.
  //   ETF 등락률과 구성종목 부호가 갈리는 건 버그가 아니라 **기준 시각이 다르기 때문**이다.
  //   실측(TIGER 미국우주테크/로켓랩): 9/18 ETF +4.75% vs 종목 −4.79%, 9/21 ETF −3.46% vs 종목 +1.07%.
  // 구성종목의 **지금 미국 시장** 등락률을 비중 가중으로 합친 값.
  //   ETF 자기 등락률(= 직전 미국 정규장 반영)과 나란히 놓으면 "장마감으로 이런데, 프리장에선 이렇다" 가 된다.
  //   커버리지(모인 비중)도 같이 들고 나온다 — top10 만 보이는 ETF 라 100% 가 아니다.
  const usNowAgg = (() => {
    if (!foreign) return null;
    let w = 0, acc = 0;
    for (const it of visibleItems) {
      const p = foreign.byCode.get(it.stockCode ?? "");
      if (!p) continue;
      const pct = dayChangePct(p);
      if (pct == null || !Number.isFinite(pct)) continue;
      w += it.ratio; acc += it.ratio * pct;
    }
    return w > 0 ? { pct: acc / w, cover: w } : null;
  })();
  // 일본 구성(코드 없는 라틴 이름) — 안내 문구를 미국과 따로 쓴다. 원인이 다르다:
  //   미국은 '직전 정규장 반영'(하루 시차), 일본은 한국과 같은 시간대인데 **연휴**로 어긋난다.
  const hasFxItems = visibleItems.some(it =>
    !(it.stockCode ?? "").trim() && looksLikeForeignName(it.name));
  const fxAsOf = [...fxMap.values()].map(p => p.trade_date).filter(Boolean).sort().pop() ?? null;
  const hasForeignItems = visibleItems.some(it => {
    const t = (it.stockCode ?? "").replace(/^A/, "");
    return !/^[\dA-Za-z]{6}$/.test(t) && /^[A-Z]{2,4}\d/.test(it.stockCode ?? "");
  });
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
            ✅ 종목 {stockTickers.length}개 한번에 추가
          </button>
        )}
        {/* 요약 — 오른쪽 위 */}
        {visibleItems.length > 0 && (
          <span className="ml-auto text-[11px] text-gray-400 tabular-nums whitespace-nowrap">
            {endDate && <>구성 기준일 <b className="text-gray-500">{endDate}</b> · </>}
            종목 <b className="text-gray-500">{visibleItems.length}개</b> ·
            합계 <b className="text-gray-500">{visibleRatio.toFixed(1)}%</b>
            {otherRatio > 0.01 && <> · 그 외 <b className="text-gray-500">{otherRatio.toFixed(1)}%</b></>}
            {cashRatio > 0.5 && <> · 현금·기타 <b className="text-gray-500">{cashRatio.toFixed(1)}%</b></>}
          </span>
        )}
      </header>
      {hasFxItems && (() => {
        // 어느 나라 장인지 — 찾아낸 심볼의 접미사로 센다. 한 ETF 안에 여러 나라가 섞인다
        //   (PLUS 글로벌방산 = 미국 + 영국·프랑스·이탈리아·독일·스웨덴).
        const SUFFIX_MARKET: Record<string, string> = {
          T: "일본", L: "영국", PA: "프랑스", MI: "이탈리아", DE: "독일", ST: "스웨덴",
          AS: "네덜란드", BR: "벨기에", LS: "포르투갈", VI: "오스트리아",
          CO: "덴마크", HE: "핀란드", OL: "노르웨이", SW: "스위스", MC: "스페인",
          HK: "홍콩", TW: "대만", AX: "호주", TO: "캐나다",
        };
        const markets = [...new Set([...fxMap.values()]
          .map(p => SUFFIX_MARKET[(p.fxSymbol ?? "").split(".")[1] ?? ""])
          .filter(Boolean))];
        return (
          <div className="mb-2 px-2 py-1 rounded border border-amber-200 bg-amber-50
                          text-[11px] leading-snug text-amber-800">
            🌐 <b>기준일이 다를 수 있습니다</b> — 아래{markets.length ? ` ${markets.join("·")} ` : " 해외 "}
            구성종목은 현지 증시
            {fxAsOf && <> <b>{`${+fxAsOf.slice(5, 7)}/${+fxAsOf.slice(8, 10)}`}</b> 마감</>} 기준입니다.
            현지 휴장일(예: 일본 9/21~23 연휴)에는 한국 ETF 와 며칠씩 어긋납니다.
            <span className="text-amber-700"> 토스가 미국 외 해외 종목 코드를 주지 않아 야후에서
              이름으로 찾아온 값이라, 카드의 심볼이 맞는지 한 번 봐 주세요.</span>
          </div>
        );
      })()}
      {hasForeignItems && (
        <div className="mb-2 px-2 py-1 rounded border border-amber-200 bg-amber-50
                        text-[11px] leading-snug text-amber-800">
          🕒 <b>기준 시각이 다릅니다</b> — 국내 상장 해외 ETF 의 등락률은 <b>직전 미국 정규장</b>을 반영하고,
          아래 구성종목은 <b>지금 미국 시장</b>(프리·정규·애프터) 값입니다. 하루 시차가 있어 부호가 반대일 수 있습니다.
          <span className="text-amber-700">각 종목의 <b>마감</b> 책갈피에 그 마감이 언제인지 날짜를 붙였습니다.</span>
        </div>
      )}
      {isLoading ? (
        <div className="text-center text-xs text-gray-400 py-8">불러오는 중...</div>
      ) : !items || items.length === 0 ? (
        <div className="text-center text-xs text-gray-400 py-8">구성 종목 데이터 없음</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-2 gap-y-5 pt-3 pb-2">
          {/* ETF 자체 카드 — 좌상단 (비중태그·번호 없음) */}
          {selfTicker && (
            <div>
              <StockCard i={0} item={{ stockCode: selfTicker, name: etfName, ratio: 0 }} hideRatio
                         price={priceMap.get(selfTicker)} chart={chartMap.get(selfTicker)}
                         krReg={krRegMap?.get(selfTicker)} groups={holdingGroups.get(selfTicker) ?? []}
                         dimEnabled={dimEnabled} onRequestSearch={onRequestSearch}
                         boxMinH="min-h-[128px]" bigFont showReturns
                         noteRow={usNowAgg && (
                           <span className="inline-flex items-baseline gap-1 text-[11px] whitespace-nowrap">
                             <span className="text-gray-400">구성</span>
                             <span className="px-1 py-0.5 rounded border border-gray-300 bg-white/70
                                              text-[9px] font-bold leading-none text-gray-600">
                               {usSessionLabel()}
                             </span>
                             <span className={`font-bold tabular-nums ${signColor(usNowAgg.pct)}`}>
                               {usNowAgg.pct >= 0 ? "+" : ""}{usNowAgg.pct.toFixed(2)}%
                             </span>
                             <span className="text-gray-400 tabular-nums">
                               (비중 {usNowAgg.cover.toFixed(0)}%)
                             </span>
                           </span>
                         )} />
            </div>
          )}
          <PieSlot items={visibleItems} otherRatio={otherRatio} cashRatio={cashRatio}
                   hoveredIdx={hoveredIdx} onHoverIdx={setHoveredIdx} />
          {visibleItems.map((it, i) => {
            const tNum = it.stockCode.replace(/^A/, "");
            // dim 우선순위: 1) 비교 모드 공통 종목 2) 파이 호버 미선택 (그 외 장마감·비표준은 StockCard 내부)
            const isCommon = dimTickers?.has(tNum) ?? false;
            const hoverDim = hoveredIdx !== null && hoveredIdx !== i;
            const extraDim = isCommon ? "opacity-30" : hoverDim ? "opacity-15" : "";
            return (
              <StockCard key={`${it.stockCode || "x"}-${i}`} i={i} item={it}
                         usPrice={foreign?.byCode.get(it.stockCode ?? "") ?? fxMap.get(it.name)}
                         usChart={fxPrices?.charts[it.name]}
                         warning={warnMap.get(tNum)}
                         usSymbol={foreign?.symByCode.get(it.stockCode ?? "")}
                         price={priceMap.get(tNum)} chart={chartMap.get(tNum)}
                         krReg={krRegMap?.get(tNum)} groups={holdingGroups.get(tNum) ?? []}
                         dimEnabled={dimEnabled} onRequestSearch={onRequestSearch}
                         extraDim={extraDim}
                         className={i === 0 ? "self-end" : undefined} />
            );
          })}
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
