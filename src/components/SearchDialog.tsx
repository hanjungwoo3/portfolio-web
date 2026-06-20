import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  searchTossAutoComplete, searchNaverAutoComplete, fetchKrStockName, fetchTossPrices,
  searchNaverThemes, fetchTossRealtimeRanking, fetchTossMarketCap, fetchUsHoldingPrices,
  type SearchResult, type NaverThemeMatch,
} from "../lib/api";
import {
  bulkRemoveFromGroup, getUserGroups, loadHoldings,
  upsertHoldingToGroup,
} from "../lib/db";
import { useAdaptiveRefreshMs } from "../lib/proxyStatus";
import { getEffectivePollMs } from "../lib/proxyConfig";
import type { Stock, Price } from "../types";
import { signColor, isEtfByName } from "../lib/format";
import { handleTossLinkClick, tossStockUrl } from "../lib/toss";
import { useEscClose } from "../lib/useEscClose";
import { EtfCompositionDialog } from "./EtfCompositionDialog";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onAdded: () => void;
  initialQuery?: string;
}


export function SearchDialog({ isOpen, onClose, onAdded, initialQuery }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [themeMatches, setThemeMatches] = useState<NaverThemeMatch[]>([]);
  // 펼친 테마 no 집합 — 기본 모두 접힘. 헤더 클릭으로 토글.
  const [expandedThemes, setExpandedThemes] = useState<Set<number>>(new Set());
  // 종목 검색 결과 + 테마 구성 종목을 ticker 단위로 dedup 한 통합 리스트(results 우선).
  // 가격/존재여부 등 데이터 fetch 는 이걸 기준 (테마 접혀 있어도 사전 로드 가능).
  const allStocks = useMemo<SearchResult[]>(() => {
    const m = new Map<string, SearchResult>();
    for (const r of results) m.set(r.ticker, r);
    for (const tm of themeMatches) for (const s of tm.stocks) if (!m.has(s.ticker)) m.set(s.ticker, s);
    return Array.from(m.values());
  }, [results, themeMatches]);
  // 화면에 노출되는 종목 — 종목 섹션(results) + 펼친 테마 섹션의 종목만.
  // "전체 선택"/카운트 표시는 이걸 기준 (접힌 테마 종목은 제외).
  const visibleStocks = useMemo<SearchResult[]>(() => {
    const m = new Map<string, SearchResult>();
    for (const r of results) m.set(r.ticker, r);
    for (const tm of themeMatches) {
      if (!expandedThemes.has(tm.theme.no)) continue;
      for (const s of tm.stocks) if (!m.has(s.ticker)) m.set(s.ticker, s);
    }
    return Array.from(m.values());
  }, [results, themeMatches, expandedThemes]);
  const [searching, setSearching] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [newGroup, setNewGroup] = useState("");
  // 일괄적용 시 함께 추가할 그룹 (마킹/선택)
  const [markedGroups, setMarkedGroups] = useState<Set<string>>(new Set());
  // 새로 생성한(아직 DB 에 없는) 그룹 — 칩 영역에만 추가됨, 마킹은 사용자가 직접
  const [pendingGroups, setPendingGroups] = useState<string[]>([]);
  // 그룹 미선택 경고 시각 효과 — 빨강 테두리 + 흔들림 (1.6s 후 해제)
  const [groupWarn, setGroupWarn] = useState(false);
  // ETF 구성종목 모달 — 검색 결과 행의 ETF 책갈피 클릭 시
  const [etfDialog, setEtfDialog] = useState<{ ticker: string; name: string } | null>(null);
  // 검색 input 포커스 ref — 열릴 때 자동 포커스
  const searchInputRef = useRef<HTMLTextAreaElement | null>(null);
  useEscClose(isOpen, onClose);

  // 창 닫힐 때 모든 상태 초기화
  useEffect(() => {
    if (isOpen) return;
    setQuery("");
    setResults([]);
    setSelected(new Set());
    setNewGroup("");
    setMarkedGroups(new Set());
    setPendingGroups([]);
    setStatusMsg("");
    setGroupWarn(false);
    setEtfDialog(null);
  }, [isOpen]);

  // 외부 prefill — 열릴 때 initialQuery 가 있으면 query 만 세팅, 검색은 라이브 useEffect 가 자동 처리
  useEffect(() => {
    if (isOpen && initialQuery) {
      setQuery(initialQuery);
    }
  }, [isOpen, initialQuery]);

  // 다이얼로그 열릴 때 검색 input 자동 포커스
  useEffect(() => {
    if (isOpen) {
      // 모바일 키보드 자동 노출 회피 위해 약간 지연
      const t = setTimeout(() => searchInputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  // 라이브 검색 — query 변경 시 300ms debounce 후 자동 검색.
  // 6자리 코드면 직접 조회, 아니면 토스(자음/부분 매칭) 우선 → 0건이면 네이버 fallback.
  // 중첩 요청 race 방지 — requestId 로 최신 응답만 반영
  const reqIdRef = useRef(0);
  useEffect(() => {
    if (!isOpen) return;
    const q = query.trim();
    if (!q) {
      setResults([]); setThemeMatches([]); setExpandedThemes(new Set());
      setSelected(new Set()); setStatusMsg("");
      return;
    }
    const myId = ++reqIdRef.current;
    const t = setTimeout(() => {
      void (async () => {
        setSearching(true);
        setStatusMsg("검색 중...");
        try {
          const codes = Array.from(new Set(
            (q.match(/\b[\dA-Za-z]{6}\b/g) ?? []).map(c => c.toUpperCase())
          ));
          // 종목 검색 + 테마 검색 병렬
          const stocksTask = (async () => {
            let stocks: SearchResult[] = [];
            if (codes.length > 0) {
              const names = await Promise.all(codes.map(c => fetchKrStockName(c)));
              stocks = codes
                .map((c, i) => ({ ticker: c, name: names[i] ?? "", market: "KOSPI" }))
                .filter(s => s.name);
            }
            if (stocks.length === 0) {
              stocks = await searchTossAutoComplete(q);
              if (stocks.length === 0) stocks = await searchNaverAutoComplete(q);
            }
            return stocks;
          })();
          const themesTask = searchNaverThemes(q, 3);
          const [stocks, themes] = await Promise.all([stocksTask, themesTask]);
          if (reqIdRef.current !== myId) return;
          setResults(stocks);
          setThemeMatches(themes);
          // 선택은 종목 결과만 기본 체크(테마 종목은 사용자가 명시 선택)
          setSelected(new Set(stocks.map(s => s.ticker)));
          const total = stocks.length + themes.reduce((n, t) => n + t.stocks.length, 0);
          const themePart = themes.length > 0 ? ` · 테마 ${themes.length}건` : "";
          setStatusMsg(total === 0
            ? "검색 결과 없음"
            : `${stocks.length}건${themePart} — 체크 후 그룹 선택 → [일괄적용]`);
        } catch {
          if (reqIdRef.current !== myId) return;
          setStatusMsg("검색 실패");
        } finally {
          if (reqIdRef.current === myId) setSearching(false);
        }
      })();
    }, 300);
    return () => clearTimeout(t);
  }, [query, isOpen]);
  // 그룹 마킹되면 경고 즉시 해제
  useEffect(() => {
    if (markedGroups.size > 0) setGroupWarn(false);
  }, [markedGroups.size]);
  const downOnBackdropRef = useRef(false);

  const REFRESH_MS = useAdaptiveRefreshMs(getEffectivePollMs());
  const tickers = allStocks.map(r => r.ticker);
  const krTickers = tickers.filter(t => /^[\dA-Za-z]{6}$/.test(t));
  const usTickers = tickers.filter(t => /^[A-Za-z][A-Za-z.]{0,4}$/.test(t));
  const { data: prices } = useQuery({
    queryKey: ["search-prices", krTickers],
    queryFn: () => fetchTossPrices(krTickers),
    enabled: isOpen && krTickers.length > 0,
    refetchInterval: REFRESH_MS,
  });
  // 미국 종목 — 토스US 우선 + Yahoo 폴백 (KR 가격 fetch 와 분리해야 안 깨짐)
  const { data: usPrices } = useQuery({
    queryKey: ["search-us-prices", usTickers],
    queryFn: () => fetchUsHoldingPrices(usTickers),
    enabled: isOpen && usTickers.length > 0,
    refetchInterval: REFRESH_MS,
  });
  const priceMap = new Map((prices ?? []).map(p => [p.ticker, p]));
  for (const p of usPrices ?? []) priceMap.set(p.ticker, p);

  const { data: userGroups = [] } = useQuery({
    queryKey: ["user-groups", reloadKey],
    queryFn: getUserGroups,
    enabled: isOpen,
  });

  // "보유" 는 특별 그룹이 아님 — 일반 사용자 그룹과 동일하게 취급.
  // 첫 사용자(그룹 0개) → "관심" 가상 그룹만 자동 노출·마킹.
  const isFirstUser = userGroups.length === 0;
  const baseGroups = isFirstUser ? ["관심"] : [...userGroups];
  // 사용자가 새로 만든 그룹(pending) 도 칩 영역에 — 중복 제거
  const displayGroups = [
    ...baseGroups,
    ...pendingGroups.filter(g => !baseGroups.includes(g)),
  ];
  useEffect(() => {
    if (!isOpen || !isFirstUser) return;
    if (allStocks.length === 0) return;
    if (markedGroups.size > 0) return;
    setMarkedGroups(new Set(["관심"]));
  }, [isOpen, isFirstUser, allStocks.length, markedGroups.size]);

  const { data: existingMap } = useQuery({
    queryKey: ["existing-groups", reloadKey],
    queryFn: async () => {
      const all = await loadHoldings();
      const map = new Map<string, string[]>();
      for (const s of all) {
        const acc = s.account ?? "";
        if (!acc) continue;  // 그룹 없는 row(account="") 는 칩 카운트/배지 대상 아님
        const groups = map.get(s.ticker) ?? [];
        groups.push(acc);
        map.set(s.ticker, groups);
      }
      return map;
    },
    enabled: isOpen,
  });

  // 기존 보유값 자동 prefill 제거 — 검색에서는 수량/평단 없이(0주 관심) 추가하고,
  // 매수가/매수일은 추가 후 각 그룹의 "보유 수정 → 매수"에서 입력하도록 한다.
  // (옛 동작: 기존 보유의 buy_date 까지 복사돼, 다른 그룹에서 재추가 시 오늘 매수가 아닌
  //  원래 날짜로 잡혀 "오늘" 손익이 어긋나던 문제가 있었음)

  // 엔터/검색 버튼 — 디바운스 우회용 즉시 트리거. 라이브 useEffect 와 동일 로직
  const doSearch = async () => {
    const q = query.trim();
    if (!q) return;
    const myId = ++reqIdRef.current;
    setSearching(true);
    setStatusMsg("검색 중...");
    try {
      const codes = Array.from(new Set(
        (q.match(/\b[\dA-Za-z]{6}\b/g) ?? []).map(c => c.toUpperCase())
      ));
      const stocksTask = (async () => {
        let stocks: SearchResult[] = [];
        if (codes.length > 0) {
          const names = await Promise.all(codes.map(c => fetchKrStockName(c)));
          stocks = codes
            .map((c, i) => ({ ticker: c, name: names[i] ?? "", market: "KOSPI" }))
            .filter(s => s.name);
        }
        if (stocks.length === 0) {
          stocks = await searchTossAutoComplete(q);
          if (stocks.length === 0) stocks = await searchNaverAutoComplete(q);
        }
        return stocks;
      })();
      const themesTask = searchNaverThemes(q, 3);
      const [stocks, themes] = await Promise.all([stocksTask, themesTask]);
      if (reqIdRef.current !== myId) return;
      setResults(stocks);
      setThemeMatches(themes);
      setSelected(new Set(stocks.map(s => s.ticker)));
      const total = stocks.length + themes.reduce((n, t) => n + t.stocks.length, 0);
      const themePart = themes.length > 0 ? ` · 테마 ${themes.length}건` : "";
      setStatusMsg(total === 0
        ? "검색 결과 없음"
        : `${stocks.length}건${themePart} — 체크 후 그룹 선택 → [일괄적용]`);
    } catch {
      if (reqIdRef.current !== myId) return;
      setStatusMsg("검색 실패");
    } finally {
      if (reqIdRef.current === myId) setSearching(false);
    }
  };

  // 빠른 목록(시가총액/인기) 불러오기 → 결과에 채우고 전체 체크. 그룹 선택 후 [일괄적용].
  const loadRanking = async (fetcher: () => Promise<SearchResult[]>, loadingMsg: string, label: string) => {
    const myId = ++reqIdRef.current;
    setSearching(true);
    setStatusMsg(loadingMsg);
    try {
      const items = await fetcher();
      if (reqIdRef.current !== myId) return;
      setQuery(""); setThemeMatches([]); setExpandedThemes(new Set());
      setResults(items);
      setSelected(new Set(items.map(r => r.ticker)));
      setStatusMsg(items.length === 0
        ? "⚠️ 불러오기 실패 — 잠시 후 다시 시도"
        : `✅ ${label} ${items.length}종목 — 그룹 선택 후 [일괄적용]`);
    } catch {
      if (reqIdRef.current === myId) setStatusMsg("⚠️ 불러오기 실패");
    } finally {
      if (reqIdRef.current === myId) setSearching(false);
    }
  };

  // 전체 선택 — 화면에 노출된 종목만 대상 (접힌 테마는 제외)
  const toggleAll = () => {
    const visTickers = visibleStocks.map(s => s.ticker);
    // 노출된 종목이 모두 선택돼 있으면 그것만 해제, 아니면 추가 (다른 테마 선택은 보존)
    const allSelected = visTickers.every(t => selected.has(t));
    setSelected(prev => {
      const next = new Set(prev);
      if (allSelected) for (const t of visTickers) next.delete(t);
      else for (const t of visTickers) next.add(t);
      return next;
    });
  };

  // 테마 펼침/접기 — 접을 때는 해당 테마의 종목 선택도 해제
  const toggleThemeExpand = (no: number) => {
    setExpandedThemes(prev => {
      const next = new Set(prev);
      if (next.has(no)) {
        next.delete(no);
        // 접힘 → 그 테마 종목 선택 해제
        const tm = themeMatches.find(t => t.theme.no === no);
        if (tm) {
          setSelected(sel => {
            const s2 = new Set(sel);
            for (const st of tm.stocks) s2.delete(st.ticker);
            return s2;
          });
        }
      } else {
        next.add(no);
      }
      return next;
    });
  };
  // 특정 테마의 종목 전체 선택/해제.
  // 접힌 상태에서 클릭 → 펼치면서 전체 선택. 펼친 상태 → 표준 토글.
  const toggleThemeSelectAll = (tm: NaverThemeMatch) => {
    const collapsed = !expandedThemes.has(tm.theme.no);
    if (collapsed) {
      setExpandedThemes(prev => {
        const next = new Set(prev); next.add(tm.theme.no); return next;
      });
      setSelected(prev => {
        const next = new Set(prev);
        for (const s of tm.stocks) next.add(s.ticker);
        return next;
      });
      return;
    }
    setSelected(prev => {
      const next = new Set(prev);
      const allSelected = tm.stocks.every(s => next.has(s.ticker));
      if (allSelected) for (const s of tm.stocks) next.delete(s.ticker);
      else for (const s of tm.stocks) next.add(s.ticker);
      return next;
    });
  };
  const themeAllSelected = (tm: NaverThemeMatch): boolean =>
    tm.stocks.length > 0 && tm.stocks.every(s => selected.has(s.ticker));

  const toggleOne = (ticker: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(ticker)) next.delete(ticker);
      else next.add(ticker);
      return next;
    });
  };

  // 그룹 마킹 토글 — 일괄적용 시 함께 추가될 그룹 선택/해제
  const toggleMarkGroup = (group: string) => {
    setMarkedGroups(prev => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  // 새 그룹 — 칩 영역에만 추가 (마킹은 사용자가 직접 클릭)
  const addNewGroup = () => {
    const g = newGroup.trim();
    if (!g) return;
    // 이미 존재하는 그룹이면 추가 안 함
    if (displayGroups.includes(g)) {
      setStatusMsg(`⚠️ "${g}" 그룹은 이미 있습니다`);
      setNewGroup("");
      return;
    }
    setPendingGroups(prev => [...prev, g]);
    setNewGroup("");
  };

  // 일괄적용 — 마킹된 그룹들에 0주(관심)로만 추가. 이미 있는 종목은 보존(스킵).
  // 수량/평단가/매수일은 각 그룹의 "보유 수정"에서 입력 (검색 단계에서 입력 안 받음).
  // 2) 수량 미입력 행: 마킹된 그룹들에 0주(관심) 추가
  const bulkApply = async () => {
    if (selected.size === 0) {
      setStatusMsg("⚠️ 종목을 먼저 체크하세요");
      return;
    }
    if (markedGroups.size === 0) {
      setStatusMsg("⚠️ 그룹을 먼저 선택하세요 — 위쪽 그룹 칩 클릭");
      setGroupWarn(true);
      window.setTimeout(() => setGroupWarn(false), 1600);
      return;
    }
    const sel = allStocks.filter(r => selected.has(r.ticker));
    const groupResults: Map<string, { added: number; skipped: number }> = new Map();

    // 검색 추가 = 항상 0주(관심)로만 등록. 수량/평단/매수일은 각 그룹의 "보유 수정"에서 입력.
    // 이미 그 그룹에 있는 종목은 절대 건드리지 않음 (기존 수량이 0으로 덮어써지지 않도록).
    for (const r of sel) {
      const inGroups = existingMap?.get(r.ticker) ?? [];
      for (const g of markedGroups) {
        const cur = groupResults.get(g) ?? { added: 0, skipped: 0 };
        if (inGroups.includes(g)) {
          // 이미 보유/등록된 그룹 — 기존 값 보존, 스킵
          cur.skipped += 1;
          groupResults.set(g, cur);
          continue;
        }
        const stock: Stock = {
          ticker: r.ticker, name: r.name,
          shares: 0, avg_price: 0, invested: 0,
          buy_date: "", market: r.market, account: g,
        };
        await upsertHoldingToGroup(stock, g);
        cur.added += 1;
        groupResults.set(g, cur);
      }
    }

    // 결과 메시지
    const parts: string[] = [];
    for (const [g, { added, skipped }] of groupResults) {
      const line = [];
      if (added > 0) line.push(`+${added}`);
      if (skipped > 0) line.push(`이미있음 ${skipped}`);
      parts.push(`"${g}" ${line.join(" · ")}`);
    }
    setStatusMsg(parts.length > 0
      ? `✅ ${parts.join(" · ")}`
      : "⚠️ 적용된 항목 없음 — 그룹 마킹 확인");
    setReloadKey(k => k + 1);
    onAdded();
    if (parts.length > 0) onClose();
  };

  // 행의 ✓그룹 배지 클릭 = 그 종목만 그 그룹에서 제거
  const removeOneFromGroup = async (ticker: string, group: string) => {
    await bulkRemoveFromGroup([ticker], group);
    setStatusMsg(`🗑 ${ticker} 을 "${group}" 에서 제거`);
    setReloadKey(k => k + 1);
    onAdded();
  };

  if (!isOpen) return null;
  // "전체 선택" 체크박스 — 노출된 종목 기준 (접힌 테마는 제외)
  const allChecked = visibleStocks.length > 0
    && visibleStocks.every(s => selected.has(s.ticker));
  const noneChecked = selected.size === 0;

  const countInGroup = (g: string): number => {
    if (!existingMap) return 0;
    let c = 0;
    for (const t of selected) {
      const groups = existingMap.get(t) ?? [];
      if (groups.includes(g)) c += 1;
    }
    return c;
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center
                     bg-black/40 sm:p-4 sm:pt-10"
         onMouseDown={e => { downOnBackdropRef.current = e.target === e.currentTarget; }}
         onClick={e => {
           if (e.target === e.currentTarget && downOnBackdropRef.current) onClose();
         }}>
      <div className="bg-white shadow-xl w-full h-screen
                       sm:rounded-lg sm:max-w-3xl sm:h-auto sm:max-h-[90vh]
                       flex flex-col">
        <header className="px-5 py-3 border-b bg-gray-50
                            flex items-center gap-3">
          <h2 className="text-lg font-bold shrink-0">🔍 종목 검색 / 추가</h2>
          <span className={`text-xs truncate font-medium
                           ${statusMsg.startsWith("⚠️")
                              ? "text-rose-600"
                              : statusMsg.startsWith("✅")
                                ? "text-emerald-700"
                                : "text-gray-500"}`}>
            {statusMsg}
          </span>
          <button onClick={onClose}
                  className="ml-auto text-gray-400 hover:text-gray-600 text-xl">
            ✕
          </button>
        </header>

        {/* 검색 입력 */}
        <div className="px-5 py-3 border-b">
          {/* 빠른 목록 — 시가총액(live) / 토스 인기 */}
          <div className="mb-2 flex gap-1.5">
            <button onClick={() => loadRanking(() => fetchTossMarketCap(10), "📊 국내 시총 불러오는 중...", "국내 시총 TOP")}
                    disabled={searching}
                    className="px-2 py-0.5 text-[11px] rounded border border-gray-300 bg-gray-100
                               text-gray-600 hover:bg-gray-200 disabled:opacity-50">
              📊 국내 시총 TOP10
            </button>
            <button onClick={() => loadRanking(() => fetchTossRealtimeRanking(10), "🔥 인기 종목 불러오는 중...", "토스 인기 TOP")}
                    disabled={searching}
                    className="px-2 py-0.5 text-[11px] rounded border border-gray-300 bg-gray-100
                               text-gray-600 hover:bg-gray-200 disabled:opacity-50">
              🔥 토스 인기 TOP10
            </button>
          </div>
          <textarea
            ref={searchInputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault(); doSearch();
              }
            }}
            rows={2}
            placeholder="종목명 1건 (예: 삼성전자) 또는 6자리 코드 여러 개 일괄 (Enter=검색, Shift+Enter=줄바꿈)"
            className="w-full border rounded px-2 py-1.5 text-sm
                       focus:outline-none focus:border-blue-500" />
          <div className="mt-2 flex gap-2">
            <button onClick={doSearch} disabled={searching}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700
                               text-white rounded text-sm disabled:opacity-50">
              🔍 검색
            </button>
            <button onClick={() => {
              setQuery(""); setResults([]); setThemeMatches([]); setExpandedThemes(new Set());
              setSelected(new Set()); setStatusMsg("");
            }}
                    className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200
                               text-gray-700 rounded text-sm">
              지우기
            </button>
          </div>
        </div>

        {/* 그룹 일괄 토글 영역 */}
        {allStocks.length > 0 && (
          <div className={`px-5 py-2.5 border-b space-y-1.5 transition-colors
                          ${groupWarn
                            ? "bg-rose-100 border-2 border-rose-400 animate-shake"
                            : "bg-blue-50/30"}`}>
            {isFirstUser && (
              <div className="text-[11px] text-blue-700 bg-blue-100/60 rounded
                              px-2 py-1 border border-blue-200">
                💡 처음이시군요! <b>"관심"</b> 그룹이 자동 선택됐어요.
                체크 후 <b>일괄적용</b> 하면 0주(관심)로 등록돼요. 수량·평단가는 그룹에서 <b>보유 수정</b>으로 입력하세요.
              </div>
            )}
            {groupWarn && (
              <div className="text-xs text-rose-700 bg-white/80 rounded
                              px-2 py-1 border border-rose-300 font-bold">
                ⚠️ 추가할 그룹을 먼저 선택하세요 — 아래 칩 중 하나를 클릭
              </div>
            )}
            <label className="flex items-center gap-2 text-sm cursor-pointer
                              select-none">
              <input type="checkbox" checked={allChecked}
                     onChange={toggleAll}
                     className="w-4 h-4 accent-blue-600" />
              <span className="font-medium text-gray-700">전체 선택</span>
              <span className="text-xs text-gray-500">
                ({selected.size} / {visibleStocks.length})
              </span>
            </label>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-medium text-gray-700">
                그룹 적용:
              </span>
              {displayGroups.map(g => {
                const cnt = countInGroup(g);
                const sel = selected.size;
                const marked = markedGroups.has(g);
                return (
                  <button key={g}
                          onClick={() => toggleMarkGroup(g)}
                          title={marked
                            ? `"${g}" 마킹됨 — 일괄적용 시 추가`
                            : `클릭 = "${g}" 마킹 (일괄적용에 포함)`}
                          className={`px-2.5 py-1 text-xs rounded border transition
                                      ${marked
                                        ? "bg-blue-600 text-white border-blue-700 font-bold"
                                        : "bg-white hover:bg-gray-50 text-gray-700 border-gray-300"}`}>
                    {g}
                    {sel > 0 && cnt > 0 && (
                      <span className={`ml-1 text-[10px] ${marked ? "opacity-80" : "text-gray-400"}`}>
                        (✓{cnt}/{sel})
                      </span>
                    )}
                  </button>
                );
              })}
              <div className="flex items-center gap-1 ml-1">
                <input type="text" placeholder="새 그룹"
                       value={newGroup}
                       onChange={e => setNewGroup(e.target.value)}
                       onKeyDown={e => { if (e.key === "Enter") addNewGroup(); }}
                       className="border rounded px-1.5 py-0.5 text-xs w-24
                                  focus:outline-none focus:border-blue-500" />
                <button onClick={addNewGroup}
                        disabled={!newGroup.trim()}
                        title="칩만 추가됩니다 — 마킹은 직접 클릭"
                        className="px-2 py-0.5 bg-green-600 hover:bg-green-700
                                   disabled:opacity-40
                                   text-white text-xs rounded">
                  생성
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 검색 결과 (행마다 수량/매수가/매수일) — 테마 섹션 + 종목 섹션 */}
        <div className="overflow-y-auto p-3 space-y-2 flex-1">
          {allStocks.length === 0 ? (
            <div className="text-center text-gray-400 py-8 text-sm">
              검색 결과가 여기에 표시됩니다.
            </div>
          ) : (
            <>
              {/* 🏷️ 테마 섹션 — 기본 접힘, 헤더 클릭 시 펼침. 헤더 우측에 "모두 선택" */}
              {themeMatches.map(tm => {
                const expanded = expandedThemes.has(tm.theme.no);
                const allSel = themeAllSelected(tm);
                return (
                  <div key={`theme-${tm.theme.no}`} className="space-y-1">
                    <div className="flex items-center gap-2 px-2 py-1.5 bg-amber-50/60
                                    border border-amber-200 rounded-md select-none">
                      {/* 헤더 본체 — 클릭 시 펼침/접기 */}
                      <button type="button" onClick={() => toggleThemeExpand(tm.theme.no)}
                              className="flex items-baseline gap-2 flex-1 min-w-0 text-left
                                         hover:opacity-80">
                        <span className="text-gray-500 text-xs w-3 inline-block">
                          {expanded ? "▼" : "▶"}
                        </span>
                        <span className="text-amber-700 text-xs">🏷️ 테마</span>
                        <span className="font-semibold text-amber-900 text-sm truncate">
                          {tm.theme.name}
                        </span>
                        <span className="text-[11px] text-gray-500 ml-auto">
                          {tm.stocks.length}종목
                        </span>
                      </button>
                      {/* 모두 선택 — 클릭 시 이 테마 종목 전체 토글 (펼침 동작과 분리) */}
                      <label className="flex items-center gap-1 text-[11px] text-gray-700
                                        cursor-pointer shrink-0"
                             onClick={e => e.stopPropagation()}
                             title="이 테마 종목 전체 선택/해제">
                        <input type="checkbox" checked={allSel}
                               onChange={() => toggleThemeSelectAll(tm)}
                               className="w-3.5 h-3.5 accent-amber-600" />
                        모두 선택
                      </label>
                    </div>
                    {expanded && tm.stocks.map(r => {
                      const isChecked = selected.has(r.ticker);
                      return (
                        <SearchResultRow
                          key={`theme-${tm.theme.no}-${r.ticker}`}
                          item={r}
                          price={priceMap.get(r.ticker)}
                          existing={existingMap?.get(r.ticker) ?? []}
                          pending={isChecked
                            ? [...markedGroups].filter(
                                g => !(existingMap?.get(r.ticker) ?? []).includes(g))
                            : []}
                          checked={isChecked}
                          onToggle={() => toggleOne(r.ticker)}
                          onRemoveGroup={g => void removeOneFromGroup(r.ticker, g)}
                          onOpenEtf={() => setEtfDialog({ ticker: r.ticker, name: r.name })} />
                      );
                    })}
                  </div>
                );
              })}
              {/* 📊 종목 섹션 — 이름/코드 매칭 */}
              {results.length > 0 && (
                <div className="space-y-1">
                  {themeMatches.length > 0 && (
                    <div className="flex items-baseline gap-2 px-1 py-1 bg-gray-50
                                    border border-gray-200 rounded-md">
                      <span className="text-gray-600 text-xs">📊 종목</span>
                      <span className="text-[11px] text-gray-500 ml-auto">
                        {results.length}건
                      </span>
                    </div>
                  )}
                  {results.map(r => {
                    const isChecked = selected.has(r.ticker);
                    return (
                      <SearchResultRow
                        key={r.ticker}
                        item={r}
                        price={priceMap.get(r.ticker)}
                        existing={existingMap?.get(r.ticker) ?? []}
                        pending={isChecked
                          ? [...markedGroups].filter(
                              g => !(existingMap?.get(r.ticker) ?? []).includes(g))
                          : []}
                        checked={isChecked}
                        onToggle={() => toggleOne(r.ticker)}
                        onRemoveGroup={g => void removeOneFromGroup(r.ticker, g)}
                        onOpenEtf={() => setEtfDialog({ ticker: r.ticker, name: r.name })} />
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* 하단 일괄적용 — 마킹된 그룹들에만 추가 */}
        {allStocks.length > 0 && (
          <footer className="px-5 py-3 border-t bg-gray-50 flex items-center gap-2">
            <span className="text-xs text-gray-600">
              마킹된 그룹{markedGroups.size > 0 && ` (${markedGroups.size}개)`}에만 0주(관심)로 추가
              <span className="ml-1 text-blue-700">— 이미 있는 종목은 건드리지 않아요 (수량 보존)</span>
            </span>
            <button onClick={() => void bulkApply()}
                    disabled={noneChecked}
                    className="ml-auto px-4 py-1.5 bg-rose-600 hover:bg-rose-700
                               text-white text-sm font-bold rounded
                               disabled:opacity-40 disabled:cursor-not-allowed">
              ✅ 일괄적용 ({selected.size})
            </button>
          </footer>
        )}
      </div>

      {/* ETF 구성종목 모달 — 검색 결과 ETF 책갈피 클릭 시 (SearchDialog 위에 겹쳐 표시) */}
      {etfDialog && (
        <EtfCompositionDialog isOpen={true}
                              ticker={etfDialog.ticker}
                              etfName={etfDialog.name}
                              onClose={() => setEtfDialog(null)} />
      )}
    </div>
  );
}

interface RowProps {
  item: SearchResult;
  price?: Price;
  existing: string[];
  pending: string[];      // 마킹된 (아직 적용 안 된) 그룹들
  checked: boolean;
  onToggle: () => void;
  onRemoveGroup: (group: string) => void;
  onOpenEtf: () => void;  // ETF 책갈피 클릭 시 구성종목 모달 열기
}

function SearchResultRow({
  item, price, existing, pending, checked,
  onToggle, onRemoveGroup, onOpenEtf,
}: RowProps) {
  // 거래일엔 base 기준, 비거래일(자정 롤오버로 base 리셋→변동 0)이면 prevClose(마지막 거래일) 기준 유지
  const dayPct = (() => {
    if (!price) return undefined;
    const d = price.price - price.base;
    if (d !== 0) return price.base > 0 ? (d / price.base) * 100 : undefined;
    return price.prevClose > 0 ? ((price.price - price.prevClose) / price.prevClose) * 100 : undefined;
  })();
  const isFaded = existing.length > 0;

  const handleRowClick = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest("input, a, button")) return;
    onToggle();
  };

  return (
    <div onClick={handleRowClick}
         className={`border rounded px-2.5 py-1.5 cursor-pointer transition
                      ${checked ? "border-blue-400 bg-blue-50/40"
                                : "border-gray-200 hover:border-gray-300"}
                      ${isFaded ? "opacity-90" : ""}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <input type="checkbox" checked={checked} onChange={onToggle}
               onClick={e => e.stopPropagation()}
               className="w-4 h-4 accent-blue-600 shrink-0" />
        {(() => {
          const tu = tossStockUrl(item.ticker);
          return tu ? (
            <a href={tu} target="_blank" rel="noopener noreferrer"
               onClick={e => { e.stopPropagation(); handleTossLinkClick(e, tu); }}
               className="font-bold text-sm hover:text-blue-600">
              {item.name}
            </a>
          ) : (
            <span className="font-bold text-sm">{item.name}</span>
          );
        })()}
        <span className="text-xs text-gray-500 font-mono">{item.ticker}</span>
        <span className="text-[10px] bg-gray-100 px-1 rounded text-gray-600">
          {item.market}
        </span>
        {/* ETF 책갈피 — 이름이 ETF 패턴이면. 클릭 시 구성종목 모달 (이벤트 전파 차단) */}
        {isEtfByName(item.name) && /^\d{6}$/.test(item.ticker) && (
          <button onClick={e => { e.stopPropagation(); onOpenEtf(); }}
                  title="ETF 구성 종목 보기"
                  className="px-1.5 py-0 rounded text-[10px] font-bold leading-none
                             text-violet-700 bg-violet-50 border border-violet-200
                             hover:bg-violet-100 transition">
            ETF
          </button>
        )}
        {existing.map(g => (
          <button key={g}
                  onClick={e => {
                    e.stopPropagation();
                    if (confirm(`"${item.name}" 을 "${g}" 에서 제거할까요?`)) {
                      onRemoveGroup(g);
                    }
                  }}
                  title={`클릭 = "${g}" 에서 이 종목 제거`}
                  className="text-[10px] bg-amber-100 hover:bg-rose-100
                             text-amber-800 hover:text-rose-700
                             px-1.5 py-0.5 rounded transition">
            ✓ {g}
          </button>
        ))}
        {/* pending 배지 — 일괄적용 시 추가될 그룹을 행마다 미리보기.
            (모든 행에 표시 — 어디로 추가될지 명확히 확인 가능하게) */}
        {pending.map(g => (
          <span key={g}
                title="일괄적용 시 추가됨"
                className="text-[10px] bg-blue-50 text-blue-700
                           border border-dashed border-blue-300
                           px-1.5 py-0.5 rounded">
            ➕ {g}
          </span>
        ))}
        {price && (
          <span className="ml-auto tabular-nums text-sm">
            <span className="font-bold">{price.price.toLocaleString()}원</span>
            {dayPct !== undefined && (
              <span className={`ml-1.5 text-xs ${signColor(dayPct)}`}>
                {dayPct >= 0 ? "+" : ""}{dayPct.toFixed(2)}%
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
