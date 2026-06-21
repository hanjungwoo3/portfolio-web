import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { fetchEtfCompositions, fetchTossPrices, fetchKrPriceHistory, fetchKrRegularPrices, searchTossAutoComplete, fetchUsHoldingPrices, fetchTossCodeInfo, type KrRegularPrice } from "../lib/api";
import { loadHoldings } from "../lib/db";
import { Sparkline } from "./Sparkline";
import { Tooltip } from "./Tooltip";
import { formatSigned, signColor, isEtfByName, dayChangePct, dayChangeDiff, isKrHoldingClosed } from "../lib/format";
import { getDimSleepingEnabled } from "../lib/proxyConfig";
import { openExternal } from "../lib/toss";
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
          {/* inline 검색 — 비교 열림 + 미선택 상태 */}
          {compareOpen && !isCompare && (
            <div className="relative flex-1 min-w-[240px]">
              <input autoFocus
                     value={compareQuery}
                     onChange={e => { setCompareQuery(e.target.value); setCmpActiveIdx(0); }}
                     onKeyDown={e => {
                       const n = searchResults?.length ?? 0;
                       if (n === 0) return;
                       if (e.key === "ArrowDown") { e.preventDefault(); setCmpActiveIdx(i => (i + 1) % n); }
                       else if (e.key === "ArrowUp") { e.preventDefault(); setCmpActiveIdx(i => (i - 1 + n) % n); }
                       else if (e.key === "Enter") {
                         e.preventDefault();
                         const r = searchResults?.[Math.min(cmpActiveIdx, n - 1)];
                         if (r) selectCmp(r);
                       }
                     }}
                     placeholder="비교할 ETF 검색 (예: KODEX 반도체) · ↑↓ 선택, Enter"
                     className="w-full border border-gray-300 rounded px-2 py-1
                                text-sm focus:outline-none focus:border-indigo-500" />
              {/* 검색 결과 dropdown — 종목 카드(현재가·%·추세) */}
              {searchResults && searchResults.length > 0 && (
                <ul ref={cmpListRef}
                    className="absolute left-0 right-0 top-full mt-1 z-20
                               bg-white border border-gray-200 rounded shadow-lg
                               max-h-[60vh] overflow-y-auto text-sm divide-y divide-gray-100">
                  {searchResults.map((r, idx) => {
                    const active = idx === Math.min(cmpActiveIdx, searchResults.length - 1);
                    const p = cmpPriceMap.get(r.ticker);
                    return (
                      <li key={r.ticker}>
                        <button onClick={() => selectCmp(r)}
                                onMouseEnter={() => setCmpActiveIdx(idx)}
                                className={`w-full text-left px-2 py-2 ${active ? "bg-indigo-50" : "hover:bg-gray-50"}`}>
                          <div className="flex items-baseline gap-1.5 mb-1 min-w-0">
                            <span className="font-bold truncate">{r.name}</span>
                            <span className="text-[11px] text-gray-500 font-mono shrink-0">{r.ticker}</span>
                          </div>
                          {/* 가격 카드 — 추세그래프 제외(현재가·일간%만) */}
                          <MiniPriceCard price={p} showTrend={false} />
                        </button>
                      </li>
                    );
                  })}
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
  groups: string[];          // 보유 그룹
  dimEnabled: boolean;       // 장 마감 흐림 설정
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
}

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
function StockCard({ i, item, price: priceProp, chart = [], krReg, groups, dimEnabled, onRequestSearch, extraDim, hideRatio, leftTag, rightTag, centerTag, className, boxMinH = "min-h-[80px]", bigFont, showReturns }: StockCardProps) {
  const priceSize = bigFont ? "text-2xl" : "text-base";
  const pctSize = bigFont ? "text-lg" : "text-sm";
  const rawCode = item.stockCode;
  const tNum = rawCode.replace(/^A/, "");
  const krCode = /^[\dA-Za-z]{6}$/.test(tNum);   // 한국 코드(영숫자 6자리, 신형 ETF 포함)
  // 해외(미국) 토스 내부코드(US.../NAS... 등) — 티커가 아니므로 해석 필요
  const isForeignCode = !krCode && /^[A-Z]{2,4}\d/.test(rawCode);
  const { data: fInfo } = useQuery({
    queryKey: ["toss-code-info", rawCode],
    queryFn: () => fetchTossCodeInfo(rawCode),
    enabled: isForeignCode,
    staleTime: 24 * 60 * 60_000,
  });
  const fSymbol = isForeignCode ? (fInfo?.symbol ?? null) : null;   // 예: SNDK, MU
  const { data: usPriceList } = useQuery({
    queryKey: ["stockcard-us-price", fSymbol],
    queryFn: () => fetchUsHoldingPrices([fSymbol!]),
    enabled: !!fSymbol,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  // 해외면 US 가격으로, 아니면 부모가 넘긴 KR 가격으로
  const price = isForeignCode ? (usPriceList?.[0] ?? undefined) : priceProp;
  const addTicker = fSymbol ?? tNum;                                // +추가/검색용
  // 해외는 심볼 해석되면 정상(추가가능), KR 은 영숫자 6자리면 정상
  const isStandard = isForeignCode ? !!fSymbol : krCode;
  // 1·3·6개월 수익률(ETF 자체 카드) — KR 한정
  const { data: returns } = useQuery({
    queryKey: ["stockcard-returns", tNum],
    queryFn: async () => computeReturns(await fetchKrPriceHistory(tNum, "6mo")),
    enabled: !!showReturns && krCode,
    staleTime: 60 * 60_000,
  });
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
  const closedDim = isStandard && dimEnabled
    && isKrHoldingClosed(krReg?.tradingEnd, krReg?.nextTradingStart, price?.singlePrice);
  const tabBg = closedDim ? "bg-gray-100/60 border-transparent"
    : colorDiff > 0 ? "bg-rose-50 border-rose-300"
    : colorDiff < 0 ? "bg-blue-50/70 border-blue-300"
    : "bg-white border-gray-300";
  const dimCls = extraDim || (!isStandard ? "opacity-60" : closedDim ? "opacity-60" : "");
  return (
    <div className={`group transition-opacity duration-150 ${dimCls} ${className ?? ""}`}>
      <div className="flex items-end justify-between gap-1 mx-1">
        <div className="flex items-end gap-0.5 flex-wrap min-w-0">
          <button onClick={isStandard
                    ? () => openExternal(`https://www.tossinvest.com/stocks/${item.stockCode}`)
                    : undefined}
                  disabled={!isStandard}
                  className={`inline-flex items-center px-2 py-0.5 rounded-t-md
                              border-t border-l border-r font-bold text-xs leading-none
                              ${tabBg} ${priceColorCls}
                              ${isStandard ? "cursor-pointer hover:brightness-95 transition" : ""}`}
                  title={isStandard ? undefined : `${item.name} — 선물·기타 (추가 불가)`}>
            {!hideRatio && <span className="text-[10px] text-gray-500 mr-1">{i + 1}</span>}
            {item.name}
          </button>
        </div>
        <div className="flex items-end gap-0.5">
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
          <div className={`relative overflow-hidden border rounded-md
                          bg-gray-50/60 px-2 py-1 space-y-0.5 w-full ${boxMinH}
                          flex flex-col justify-center
                          ${closedDim ? "border-transparent" : "border-gray-200"}`}>
            {chart.length > 1 && (
              <Sparkline data={chart} width={300} height={120}
                         className="absolute inset-0 w-full h-full opacity-20 pointer-events-none" />
            )}
            <div className="relative z-10">
              <div className="flex items-baseline gap-2">
                <span className={`${priceSize} font-bold leading-tight invisible`}>▲</span>
                <span className={`${priceSize} font-bold leading-tight tabular-nums ${priceColorCls}`}>
                  {price ? `${price.price.toLocaleString()}원` : "—"}
                </span>
              </div>
              <div className={`flex items-baseline gap-1 pl-5 font-bold ${signColor(dayDiff)}`}>
                <span className={`${pctSize} leading-tight bg-yellow-100 rounded px-1 tabular-nums`}>
                  {dayPct >= 0 ? "+" : ""}{dayPct.toFixed(2)}%
                </span>
                <span className="text-[10px] font-normal text-gray-700 tabular-nums">
                  ({formatSigned(dayDiff)}원)
                </span>
              </div>
              {/* 1·3·6개월 수익률 */}
              {showReturns && returns && (
                <div className="flex items-center gap-2 pl-5 mt-1 text-[11px] font-bold tabular-nums">
                  {([["1개월", returns.m1], ["3개월", returns.m3], ["6개월", returns.m6]] as const).map(([lbl, v]) =>
                    v == null ? null : (
                      <span key={lbl} className={signColor(v)}>
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
        </div>
      </div>
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
    .filter(t => /^\d{6}$/.test(t));
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
      {isLoading ? (
        <div className="text-center text-xs text-gray-400 py-8">불러오는 중...</div>
      ) : !items || items.length === 0 ? (
        <div className="text-center text-xs text-gray-400 py-8">구성 종목 데이터 없음</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-2 gap-y-5 pt-3 pb-2">
          {/* ETF 자체 카드 — 좌상단 (비중태그·번호 없음) */}
          {selfTicker && (
            <StockCard i={0} item={{ stockCode: selfTicker, name: etfName, ratio: 0 }} hideRatio
                       price={priceMap.get(selfTicker)} chart={chartMap.get(selfTicker)}
                       krReg={krRegMap?.get(selfTicker)} groups={holdingGroups.get(selfTicker) ?? []}
                       dimEnabled={dimEnabled} onRequestSearch={onRequestSearch}
                       boxMinH="min-h-[128px]" bigFont showReturns />
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
