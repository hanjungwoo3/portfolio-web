// 다중 종목 → 포함/제외 필터 기반 ETF 검색 탭.
// - 포함 종목: 모두 포함("all") 또는 하나라도 포함("any") 토글
// - 제외 종목: 하나라도 들어있으면 결과에서 제외
// 데이터 소스: portfolio-etf-index (lib/etfIndex).

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import type { Stock } from "../types";
import {
  loadEtfData, searchEtfs, type EtfMatchMulti,
} from "../lib/etfIndex";
import {
  searchTossAutoComplete, searchNaverAutoComplete, fetchTossPrices, fetchKrPriceHistory, type SearchResult,
} from "../lib/api";
import { signColor, dayChangePct } from "../lib/format";
import { getTossCode } from "../lib/toss";
import { StockCard, computeReturns } from "./EtfCompositionDialog";
import { EtfCompareChartDialog } from "./EtfCompareChartDialog";

const TREND_CAP = 36;   // 추세·수익률 조회 상위 개수(전부 조회는 부담 — 정렬 상위만)

interface Props {
  holdings: Stock[];
  onOpenEtfComposition?: (etfCode: string, etfName: string) => void;
  onRequestAdd?: (query: string) => void;   // ETF 자체를 포트폴리오에 추가 (SearchDialog 오픈)
}

type Slot = "include" | "exclude";

export function EtfReverseTab({ holdings, onOpenEtfComposition, onRequestAdd }: Props) {
  // 보유 종목 중 6자리 한국 종목만 (수량>0 + 중복 제거, 이름 기준 사전순)
  const uniqStocks = useMemo(() => {
    const m = new Map<string, string>();
    for (const h of holdings) {
      if (!/^\d{6}$/.test(h.ticker)) continue;
      if (h.shares <= 0) continue;
      if (!m.has(h.ticker)) m.set(h.ticker, h.name || h.ticker);
    }
    return Array.from(m, ([ticker, name]) => ({ ticker, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }, [holdings]);

  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [nameCache, setNameCache] = useState<Record<string, string>>({});
  // 해외종목 검색키(US 토스코드) → 표시 심볼(MU) 매핑 — 칩에 코드 대신 심볼 노출용
  const [symCache, setSymCache] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<"all" | "any">("all");
  const [results, setResults] = useState<EtfMatchMulti[] | null>(null);
  const [dataReady, setDataReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const reqIdRef = useRef(0);

  // 자동완성 제안 종목들의 현재가/% — 일반 검색과 동일하게 표시
  const suggTickers = useMemo(() => suggestions.map(s => s.ticker), [suggestions]);
  const { data: suggPriceList } = useQuery({
    queryKey: ["etf-reverse-sugg-prices", suggTickers],
    queryFn: () => fetchTossPrices(suggTickers),
    enabled: suggTickers.length > 0,
    staleTime: 30_000,
  });
  const suggPriceMap = useMemo(
    () => new Map((suggPriceList ?? []).map(p => [p.ticker, p])),
    [suggPriceList],
  );

  // 매칭 결과 ETF 들의 현재가/% — 결과 카드 표시용
  const resultTickers = useMemo(() => (results ?? []).map(r => r.etfCode), [results]);
  const { data: resultPriceList } = useQuery({
    queryKey: ["etf-reverse-result-prices", resultTickers],
    queryFn: () => fetchTossPrices(resultTickers),
    enabled: resultTickers.length > 0,
    staleTime: 30_000,
  });
  const resultPriceMap = useMemo(
    () => new Map((resultPriceList ?? []).map(p => [p.ticker, p])),
    [resultPriceList],
  );

  // 결과 정렬 — 비중 / 현재등락 / 1·3·6개월 수익률
  const [resultSort, setResultSort] = useState<"ratio" | "day" | "m1" | "m3" | "m6">("ratio");
  // ETF 이름 필터 — 포함(이 단어 들어간 것만) / 제외(이 단어 들어간 것 빼기)
  const [nameInc, setNameInc] = useState("");
  const [nameExc, setNameExc] = useState("");
  // 비교 차트 팝업
  const [compareOpen, setCompareOpen] = useState(false);

  // 추세·수익률 — 상위 TREND_CAP 개만 6개월 히스토리 조회.
  //   비중/수익률 정렬 → 비중 기본순 상위(수익률 정렬은 이 집합 내에서만, 순환 방지).
  //   현재(등락) 정렬 → 등락 상위(그래야 표시 상단 카드에 추세·수익률이 보임).
  const trendCodes = useMemo(() => {
    const base = results ?? [];
    let ordered = base;
    if (resultSort === "day") {
      ordered = [...base].sort((a, b) => {
        const pa = resultPriceMap.get(a.etfCode), pb = resultPriceMap.get(b.etfCode);
        const va = pa ? (dayChangePct(pa) ?? -Infinity) : -Infinity;
        const vb = pb ? (dayChangePct(pb) ?? -Infinity) : -Infinity;
        return vb - va;
      });
    }
    return ordered.slice(0, TREND_CAP).map(r => r.etfCode);
  }, [results, resultSort, resultPriceMap]);
  const trendQs = useQueries({
    queries: trendCodes.map(code => ({
      queryKey: ["price-history", code, "6mo"],
      queryFn: () => fetchKrPriceHistory(code, "6mo"),
      staleTime: 60 * 60_000,
    })),
  });
  const trendHist = new Map(trendQs.map((q, i) => [trendCodes[i], q.data ?? []]));
  const trendReturns = new Map(trendCodes.map(c => [c, computeReturns(trendHist.get(c) ?? [])]));
  const trendStamp = trendQs.map(q => q.dataUpdatedAt).join(",");

  const sortedResults = useMemo(() => {
    if (!results) return results;
    if (resultSort === "ratio") return results;   // searchEtfs 가 이미 비중합 내림차순
    const metric = (code: string): number => {
      if (resultSort === "day") {
        const p = resultPriceMap.get(code);
        return p ? (dayChangePct(p) ?? -Infinity) : -Infinity;
      }
      return trendReturns.get(code)?.[resultSort] ?? -Infinity;   // 수익률 미조회분은 하위로
    };
    return [...results].sort((a, b) => metric(b.etfCode) - metric(a.etfCode));
    // trendReturns 는 매 렌더 새 Map — trendStamp 로 갱신 트리거(deps 직접 포함 시 무한루프)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, resultSort, resultPriceList, trendStamp]);

  // ETF 이름 포함/제외 필터 적용 (공백/쉼표로 여러 단어 — 각각 OR)
  const displayResults = useMemo(() => {
    const list = sortedResults ?? [];
    const terms = (s: string) => s.toLowerCase().split(/[\s,]+/).filter(Boolean);
    const inc = terms(nameInc), exc = terms(nameExc);
    if (inc.length === 0 && exc.length === 0) return list;
    return list.filter(r => {
      const n = r.etfName.toLowerCase();
      if (inc.length && !inc.some(t => n.includes(t))) return false;
      if (exc.length && exc.some(t => n.includes(t))) return false;
      return true;
    });
  }, [sortedResults, nameInc, nameExc]);

  // 데이터 사전 로드
  useEffect(() => {
    let alive = true;
    loadEtfData().then(() => { if (alive) setDataReady(true); })
      .catch(e => { if (alive) setErr(String(e)); });
    return () => { alive = false; };
  }, []);

  // include/exclude/mode 변경 시 결과 자동 갱신
  useEffect(() => {
    if (included.size === 0) { setResults(null); return; }
    let alive = true;
    void searchEtfs({ include: [...included], exclude: [...excluded], mode })
      .then(r => { if (alive) setResults(r); })
      .catch(e => { if (alive) setErr(String(e)); });
    return () => { alive = false; };
  }, [included, excluded, mode]);

  // ticker 가 어느 슬롯에 있는지
  const slotOf = (ticker: string): Slot | null =>
    included.has(ticker) ? "include" : excluded.has(ticker) ? "exclude" : null;

  // ticker 를 지정 슬롯으로 이동 (null = 제거)
  const setSlot = (ticker: string, target: Slot | null) => {
    setIncluded(prev => {
      if (target === "include") {
        if (prev.has(ticker)) return prev;
        const n = new Set(prev); n.add(ticker); return n;
      }
      if (!prev.has(ticker)) return prev;
      const n = new Set(prev); n.delete(ticker); return n;
    });
    setExcluded(prev => {
      if (target === "exclude") {
        if (prev.has(ticker)) return prev;
        const n = new Set(prev); n.add(ticker); return n;
      }
      if (!prev.has(ticker)) return prev;
      const n = new Set(prev); n.delete(ticker); return n;
    });
  };

  // 보유 칩 클릭: 없음 → 포함 → 제외 → 없음 사이클
  const cycleHolding = (ticker: string) => {
    const cur = slotOf(ticker);
    if (cur === null) setSlot(ticker, "include");
    else if (cur === "include") setSlot(ticker, "exclude");
    else setSlot(ticker, null);
  };

  // 검색결과 → 인덱스 키. 국내=6자리코드 그대로, 해외=토스코드(US...) — 심볼(MU)로는 인덱스 매칭 불가
  const keyOf = (s: SearchResult): string =>
    /^[\dA-Za-z]{6}$/.test(s.ticker) ? s.ticker : (getTossCode(s.ticker) ?? s.ticker);

  // 종목명 자동완성
  useEffect(() => {
    const q = query.trim();
    if (!q || /^[\d\s,]+$/.test(q)) { setSuggestions([]); return; }
    const id = ++reqIdRef.current;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        let res: SearchResult[] = [];
        try { res = await searchTossAutoComplete(q); }
        catch { res = await searchNaverAutoComplete(q); }
        if (id !== reqIdRef.current) return;
        // 국내 6자리 + 해외(토스코드 확인 가능한 종목만 — 인덱스가 토스코드로 색인됨)
        setSuggestions(
          res.filter(r => /^[\dA-Za-z]{6}$/.test(r.ticker) || getTossCode(r.ticker) != null).slice(0, 12),
        );
      } catch {
        if (id === reqIdRef.current) setSuggestions([]);
      } finally {
        if (id === reqIdRef.current) setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  // 6자리 코드 직접 추가 — 슬롯 지정 필수
  const addManual = (target: Slot) => {
    const codes = query.match(/\b\d{6}\b/g) ?? [];
    if (codes.length === 0) return;
    for (const c of codes) setSlot(c, target);
    setQuery("");
    setSuggestions([]);
  };

  // 자동완성에서 토글 — 같은 슬롯 재클릭은 해제, 반대 슬롯이면 이동
  // 드롭다운은 유지 (여러 종목 연속 처리 가능)
  const toggleFromSuggestion = (s: SearchResult, target: Slot) => {
    const key = keyOf(s);   // 해외는 토스코드, 국내는 6자리코드
    setNameCache(prev => prev[key] === s.name ? prev : { ...prev, [key]: s.name });
    if (key !== s.ticker) setSymCache(prev => prev[key] ? prev : { ...prev, [key]: s.ticker });
    const cur = slotOf(key);
    setSlot(key, cur === target ? null : target);
  };

  const nameOf = (ticker: string): string =>
    uniqStocks.find(s => s.ticker === ticker)?.name ?? nameCache[ticker] ?? ticker;

  const totalSelected = included.size + excluded.size;

  return (
    <div className="space-y-3">
      <div className="relative z-20 bg-white border border-gray-300 rounded-lg shadow-sm p-3 space-y-2">
        {/* 헤더 */}
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-base font-bold text-gray-800">🍱 ETF 검색</span>
          <span className="text-xs text-gray-500">
            포함/제외 종목으로 ETF를 필터링합니다
          </span>
          {dataReady && (
            <span className="ml-auto text-[11px] text-gray-400">
              인덱스 갱신: 매일 06:00 KST
            </span>
          )}
        </div>

        {/* 보유 종목 칩 — 클릭 시 없음→포함→제외→없음 사이클 */}
        {uniqStocks.length > 0 && (
          <div>
            <div className="text-[11px] text-gray-500 mb-1">
              보유 종목 ({uniqStocks.length}개) · 클릭하면 포함→제외→해제 사이클
            </div>
            <div className="flex flex-wrap gap-1.5">
              {uniqStocks.map(s => {
                const slot = slotOf(s.ticker);
                const cls = slot === "include"
                  ? "bg-emerald-600 text-white border-emerald-700 font-bold"
                  : slot === "exclude"
                  ? "bg-rose-600 text-white border-rose-700 font-bold"
                  : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50";
                return (
                  <button key={s.ticker}
                          onClick={() => cycleHolding(s.ticker)}
                          title={slot === "include" ? "포함됨 (클릭: 제외로)" : slot === "exclude" ? "제외됨 (클릭: 해제)" : "클릭: 포함 추가"}
                          className={`px-2 py-0.5 rounded-full text-xs border transition ${cls}`}>
                    {slot === "include" ? "＋" : slot === "exclude" ? "－" : ""}{s.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 검색 입력 */}
        <div className="relative inline-block max-w-full">
          <div className="flex items-center gap-1.5">
            <input value={query}
                   onChange={e => setQuery(e.target.value)}
                   onKeyDown={e => {
                     if (e.key === "Enter") {
                       // 검색 결과가 있으면 1번째를 포함으로, 아니면 6자리 코드를 포함으로
                       if (suggestions.length > 0) toggleFromSuggestion(suggestions[0], "include");
                       else if (/\d{6}/.test(query)) addManual("include");
                     } else if (e.key === "Escape") {
                       setSuggestions([]);
                     }
                   }}
                   placeholder="종목명 또는 코드"
                   className="w-64 px-2 py-1 text-sm border border-gray-300 rounded
                              focus:outline-none focus:border-blue-500" />
            {/* 6자리 코드 직접 입력 시에만 노출 */}
            {/\d{6}/.test(query) && (
              <>
                <button onClick={() => addManual("include")}
                        title="입력된 6자리 코드를 포함에 추가"
                        className="px-2 py-1 text-xs font-bold rounded
                                   bg-emerald-50 text-emerald-700 border border-emerald-300
                                   hover:bg-emerald-100">
                  ＋포함
                </button>
                <button onClick={() => addManual("exclude")}
                        title="입력된 6자리 코드를 제외에 추가"
                        className="px-2 py-1 text-xs font-bold rounded
                                   bg-rose-50 text-rose-700 border border-rose-300
                                   hover:bg-rose-100">
                  －제외
                </button>
              </>
            )}
          </div>

          {/* 자동완성 드롭다운 — 각 항목에 포함/제외 버튼 */}
          {(searching || suggestions.length > 0) && query.trim() && !/^[\d\s,]+$/.test(query) && (
            <div className="absolute left-0 mt-1 z-30 bg-white border border-gray-300
                            rounded-md shadow-lg max-h-80 overflow-hidden
                            w-[30rem] max-w-[calc(100vw-2rem)] flex flex-col">
              {/* 헤더 + 닫기 */}
              <div className="flex items-center justify-between px-3 py-1.5 bg-gray-50 border-b border-gray-200">
                <span className="text-[11px] text-gray-500">
                  {searching ? "검색 중…" : `검색 결과 ${suggestions.length}개`}
                </span>
                <button onClick={() => { setQuery(""); setSuggestions([]); }}
                        title="닫기 (Esc)"
                        className="text-gray-500 hover:text-gray-900 text-lg leading-none px-1">
                  ×
                </button>
              </div>
              <div className="overflow-y-auto">
              {searching && suggestions.length === 0 ? (
                <div className="px-3 py-2 text-xs text-gray-400">검색 중…</div>
              ) : suggestions.length === 0 ? (
                <div className="px-3 py-2 text-xs text-gray-400">검색 결과 없음</div>
              ) : (
                suggestions.map(s => {
                  const slot = slotOf(keyOf(s));
                  return (
                    <div key={s.ticker}
                         className="px-3 py-1.5 flex items-baseline gap-2 border-b border-gray-100 last:border-b-0">
                      <span className="font-medium text-sm text-gray-800 truncate flex-1 min-w-0">{s.name}</span>
                      <span className="text-[11px] text-gray-500 font-mono tabular-nums shrink-0">{s.ticker}</span>
                      <span className="text-[10px] text-gray-400 shrink-0">{s.market}</span>
                      {(() => {
                        const p = suggPriceMap.get(s.ticker);
                        if (!p) return null;
                        const pct = dayChangePct(p);
                        return (
                          <span className="tabular-nums text-xs shrink-0">
                            <span className="font-bold">{p.price.toLocaleString()}원</span>
                            {pct !== undefined && (
                              <span className={`ml-1 ${signColor(pct)}`}>
                                {pct >= 0 ? "+" : ""}{pct.toFixed(2)}%
                              </span>
                            )}
                          </span>
                        );
                      })()}
                      <span className="flex items-center gap-1 shrink-0">
                        {slot && (
                          <span className={`text-[10px] mr-1 ${slot === "include" ? "text-emerald-700" : "text-rose-700"}`}>
                            {slot === "include" ? "포함됨" : "제외됨"}
                          </span>
                        )}
                        <button onClick={() => toggleFromSuggestion(s, "include")}
                                title={slot === "include" ? "포함 해제" : "포함에 추가"}
                                className={`px-1.5 py-0.5 rounded text-[11px] font-bold border transition
                                            ${slot === "include"
                                              ? "bg-emerald-600 text-white border-emerald-700"
                                              : "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"}`}>
                          ＋포함
                        </button>
                        <button onClick={() => toggleFromSuggestion(s, "exclude")}
                                title={slot === "exclude" ? "제외 해제" : "제외에 추가"}
                                className={`px-1.5 py-0.5 rounded text-[11px] font-bold border transition
                                            ${slot === "exclude"
                                              ? "bg-rose-600 text-white border-rose-700"
                                              : "bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100"}`}>
                          －제외
                        </button>
                      </span>
                    </div>
                  );
                })
              )}
              </div>
            </div>
          )}
        </div>

        {/* 선택된 종목 — 포함 */}
        {included.size > 0 && (
          <div className="flex flex-wrap items-baseline gap-1.5 pt-1 border-t border-gray-100">
            <span className="text-[11px] text-emerald-700 font-bold">＋포함 ({included.size}):</span>
            {[...included].map(t => (
              <span key={t}
                    className="px-2 py-0.5 rounded-full text-xs bg-emerald-100 border border-emerald-300
                               text-emerald-900 flex items-center gap-1">
                {nameOf(t)} <span className="text-gray-500 font-mono text-[10px]">{symCache[t] ?? t}</span>
                <button onClick={() => setSlot(t, null)}
                        className="text-emerald-700 hover:text-rose-700 font-bold">×</button>
              </span>
            ))}
            <button onClick={() => setIncluded(new Set())}
                    className="ml-1 text-[11px] text-gray-500 hover:text-rose-700 underline">
              포함 해제
            </button>
          </div>
        )}

        {/* 선택된 종목 — 제외 */}
        {excluded.size > 0 && (
          <div className="flex flex-wrap items-baseline gap-1.5">
            <span className="text-[11px] text-rose-700 font-bold">－제외 ({excluded.size}):</span>
            {[...excluded].map(t => (
              <span key={t}
                    className="px-2 py-0.5 rounded-full text-xs bg-rose-100 border border-rose-300
                               text-rose-900 flex items-center gap-1">
                {nameOf(t)} <span className="text-gray-500 font-mono text-[10px]">{symCache[t] ?? t}</span>
                <button onClick={() => setSlot(t, null)}
                        className="text-rose-700 hover:text-gray-700 font-bold">×</button>
              </span>
            ))}
            <button onClick={() => setExcluded(new Set())}
                    className="ml-1 text-[11px] text-gray-500 hover:text-rose-700 underline">
              제외 해제
            </button>
          </div>
        )}

        {/* 모드 토글 — 포함 종목 2개 이상일 때 */}
        {included.size >= 2 && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-500">포함 조건:</span>
            <button onClick={() => setMode("all")}
                    className={`px-2 py-0.5 rounded-full border transition
                                ${mode === "all"
                                  ? "bg-blue-600 text-white border-blue-700 font-bold"
                                  : "bg-white text-gray-700 border-gray-300"}`}>
              모두 포함
            </button>
            <button onClick={() => setMode("any")}
                    className={`px-2 py-0.5 rounded-full border transition
                                ${mode === "any"
                                  ? "bg-blue-600 text-white border-blue-700 font-bold"
                                  : "bg-white text-gray-700 border-gray-300"}`}>
              하나라도 포함
            </button>
          </div>
        )}
      </div>

      {/* 결과 */}
      {err && (
        <div className="text-rose-600 text-sm py-4 text-center">데이터 오류: {err}</div>
      )}
      {included.size === 0 ? (
        <div className="text-center text-gray-400 py-12 text-sm">
          {totalSelected === 0
            ? (uniqStocks.length === 0
                ? "보유 종목이 없습니다. 종목명이나 6자리 코드를 입력해 보세요."
                : "포함할 종목을 하나 이상 선택하세요.")
            : "제외만으로는 검색할 수 없습니다. 포함 종목을 추가하세요."}
        </div>
      ) : results === null ? (
        <div className="text-center text-gray-400 py-8 text-sm">불러오는 중…</div>
      ) : results.length === 0 ? (
        <div className="text-center text-gray-500 py-8 text-sm">
          매칭되는 ETF가 없습니다.
          {mode === "all" && included.size > 1 && (
            <div className="text-[11px] text-gray-400 mt-1">
              "하나라도 포함" 모드로 바꿔보세요.
            </div>
          )}
          {excluded.size > 0 && (
            <div className="text-[11px] text-gray-400 mt-1">
              제외 종목을 줄여보세요.
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white border border-gray-300 rounded-lg shadow-sm overflow-hidden">
          <div className="px-3 py-2 bg-gray-50 border-b text-[11px] text-gray-600
                          flex items-center gap-2 flex-wrap">
            <span>
              매칭 ETF <b className="text-gray-800">{displayResults.length}</b>
              {displayResults.length !== results.length && <span className="text-gray-400">/{results.length}</span>}개 ·
              {mode === "all" ? " 포함 종목 모두" : " 포함 종목 하나 이상"}
              {excluded.size > 0 && ` · 제외 ${excluded.size}개 적용`}
            </span>
            {/* ETF 이름 포함/제외 */}
            <span className="inline-flex items-center gap-1">
              <span className="text-gray-400">ETF명</span>
              <input value={nameInc} onChange={e => setNameInc(e.target.value)}
                     placeholder="포함" title="ETF명에 이 단어 포함(공백/쉼표로 여러 개)"
                     className="border border-emerald-300 rounded px-1.5 py-0.5 text-[11px] w-20
                                focus:outline-none focus:border-emerald-500 bg-emerald-50/40" />
              <input value={nameExc} onChange={e => setNameExc(e.target.value)}
                     placeholder="제외" title="ETF명에 이 단어 들어가면 제외(공백/쉼표로 여러 개)"
                     className="border border-rose-300 rounded px-1.5 py-0.5 text-[11px] w-20
                                focus:outline-none focus:border-rose-500 bg-rose-50/40" />
              {(nameInc || nameExc) && (
                <button onClick={() => { setNameInc(""); setNameExc(""); }}
                        className="text-gray-400 hover:text-rose-500 px-0.5">✕</button>
              )}
            </span>
            <button onClick={() => setCompareOpen(true)}
                    disabled={displayResults.length < 2}
                    title="검색된 ETF들을 한 그래프에서 등락률 비교"
                    className="ml-auto px-2 py-0.5 rounded text-[11px] font-bold border transition
                               bg-indigo-50 text-indigo-700 border-indigo-300 hover:bg-indigo-100
                               disabled:opacity-40 disabled:cursor-not-allowed">
              📊 비교 차트
            </button>
            <span className="inline-flex items-center gap-0.5">
              <span className="text-gray-400 mr-1">정렬</span>
              {([["ratio", "비중"], ["day", "현재"], ["m1", "1개월"], ["m3", "3개월"], ["m6", "6개월"]] as const).map(([k, label]) => (
                <button key={k} onClick={() => setResultSort(k)}
                        className={`px-1.5 py-0.5 rounded text-[11px] font-bold border transition
                                    ${resultSort === k
                                      ? "bg-gray-700 text-white border-gray-700"
                                      : "bg-white text-gray-600 border-gray-300 hover:bg-gray-100"}`}>
                  {label}
                </button>
              ))}
            </span>
          </div>
          {/* 3 컬럼 그리드 — 카드형 띄워 배치, 좁은 화면은 1/2 단 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 p-2
                          max-h-[70vh] overflow-y-auto bg-gray-50">
            {displayResults.map(r => {
              // 포함 종목별 비중 분해 (포함 2개 이상일 때만 표시)
              const breakdownItems = included.size > 1
                ? [...included]
                    .filter(t => r.perTicker[t] !== undefined)
                    .sort((a, b) => r.perTicker[b] - r.perTicker[a])
                    .map(t => ({ name: nameOf(t), ratio: r.perTicker[t] }))
                : null;
              const hist = trendHist.get(r.etfCode) ?? [];
              const withTrend = hist.length > 1;
              const closes = hist.map(p => p.close);
              const rets = trendReturns.get(r.etfCode) ?? null;
              return (
                <div key={r.etfCode} className="group min-w-0">
                  {/* ETF 리치 카드 — 이름(코드) + 구성(+옆) + 매칭비중(우) + 그래프(좌)·포함종목(우, 카드 내부) */}
                  <StockCard i={0} item={{ stockCode: r.etfCode, name: `${r.etfName} (${r.etfCode})`, ratio: 0 }} hideRatio
                             price={resultPriceMap.get(r.etfCode)} chart={closes}
                             onRequestSearch={onRequestAdd}
                             showReturns={withTrend} returns={rets}
                             highlightReturn={resultSort === "m1" || resultSort === "m3" || resultSort === "m6" ? resultSort : undefined}
                             highlightDay={resultSort === "day"}
                             boxMinH="min-h-[52px]"
                             actionLeft={onOpenEtfComposition ? (
                               <button onClick={e => { e.preventDefault(); e.stopPropagation(); onOpenEtfComposition(r.etfCode, r.etfName); }}
                                       title={`${r.etfName} 구성종목 보기`}
                                       className="px-1.5 py-0.5 rounded-t-md text-[10px] font-bold leading-none
                                                  bg-amber-50 text-amber-700 border-t border-l border-r border-amber-300
                                                  hover:bg-amber-100">
                                 🍱
                               </button>
                             ) : undefined}
                             rightTag={
                               <div className="border rounded px-1 py-0 leading-tight tabular-nums
                                               text-[11px] font-bold bg-white whitespace-nowrap text-rose-600"
                                    style={{ borderColor: "#fecaca" }}>
                                 비중 {r.totalRatio.toFixed(1)}%
                               </div>
                             }
                             boxRight={
                               (breakdownItems || (included.size > 1 && mode === "any")) ? (
                                 <div className="rounded-md border border-gray-200 bg-white/85 backdrop-blur-[1px]
                                                 px-1.5 py-1 flex flex-col items-end gap-0.5
                                                 text-[10px] text-gray-600 tabular-nums">
                                   {included.size > 1 && mode === "any" && (
                                     <span className="text-gray-400">{r.hitCount}/{included.size}</span>
                                   )}
                                   {breakdownItems && breakdownItems.map((b, i) => (
                                     <div key={b.name + i} className="truncate max-w-full text-right">
                                       {b.name} <span className="text-rose-600 font-medium">{b.ratio.toFixed(1)}%</span>
                                     </div>
                                   ))}
                                 </div>
                               ) : undefined
                             } />
                </div>
              );
            })}
          </div>
        </div>
      )}

      <EtfCompareChartDialog
        isOpen={compareOpen}
        onClose={() => setCompareOpen(false)}
        etfs={displayResults.map(r => ({ code: r.etfCode, name: r.etfName }))} />
    </div>
  );
}
