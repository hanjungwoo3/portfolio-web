import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  searchTossAutoComplete, searchNaverAutoComplete, fetchStockName, fetchTossPrices,
  type SearchResult,
} from "../lib/api";
import {
  bulkRemoveFromGroup, removeHolding, getUserGroups, loadHoldings,
  upsertHoldingToGroup, syncAllRowsForTicker,
} from "../lib/db";
import { useAdaptiveRefreshMs } from "../lib/proxyStatus";
import { getIndependentGroupsMode } from "../lib/groupMode";
import type { Stock, Price } from "../types";
import { signColor, isEtfByName } from "../lib/format";
import { useEscClose } from "../lib/useEscClose";
import { EtfCompositionDialog } from "./EtfCompositionDialog";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onAdded: () => void;
  initialQuery?: string;
}

interface RowEdit { shares: string; avgPrice: string; buyDate: string; }

function todayKstStr(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

export function SearchDialog({ isOpen, onClose, onAdded, initialQuery }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [newGroup, setNewGroup] = useState("");
  const [rowEdits, setRowEdits] = useState<Map<string, RowEdit>>(new Map());
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
    setRowEdits(new Map());
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
      setResults([]); setSelected(new Set()); setStatusMsg("");
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
          let stocks: SearchResult[];
          if (codes.length > 0) {
            const names = await Promise.all(
              codes.map(c => fetchStockName(c).then(n => n ?? c))
            );
            stocks = codes.map((c, i) => ({
              ticker: c, name: names[i], market: "KOSPI",
            }));
          } else {
            // 토스 우선 (자음 매칭 + 부분 매칭 강함), 0건이면 네이버
            stocks = await searchTossAutoComplete(q);
            if (stocks.length === 0) {
              stocks = await searchNaverAutoComplete(q);
            }
          }
          // 더 최신 요청이 발생했으면 결과 무시
          if (reqIdRef.current !== myId) return;
          setResults(stocks);
          setSelected(new Set(stocks.map(s => s.ticker)));
          setStatusMsg(stocks.length === 0
            ? "검색 결과 없음"
            : `${stocks.length}건 — 체크 후 그룹 선택 (보유 포함) → [일괄적용]`);
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

  const updateRowEdit = (ticker: string, patch: Partial<RowEdit>) => {
    setRowEdits(prev => {
      const next = new Map(prev);
      const cur = next.get(ticker)
        ?? { shares: "", avgPrice: "", buyDate: todayKstStr() };
      next.set(ticker, { ...cur, ...patch });
      return next;
    });
  };

  const REFRESH_MS = useAdaptiveRefreshMs(10_000);
  const tickers = results.map(r => r.ticker);
  const { data: prices } = useQuery({
    queryKey: ["search-prices", tickers],
    queryFn: () => fetchTossPrices(tickers),
    enabled: isOpen && tickers.length > 0,
    refetchInterval: REFRESH_MS,
  });
  const priceMap = new Map((prices ?? []).map(p => [p.ticker, p]));

  const { data: userGroups = [] } = useQuery({
    queryKey: ["user-groups", reloadKey],
    queryFn: getUserGroups,
    enabled: isOpen,
  });

  // 보유는 더 이상 기본 그룹으로 노출하지 않음 — 사용자가 만든 그룹만 칩으로 표시.
  // 첫 사용자(그룹 0개) → "관심" 가상 그룹만 자동 노출·마킹.
  const HOLDING_LABEL = "보유";  // upsertHoldingToGroup 매핑용 상수 유지 (account="")
  const isFirstUser = userGroups.length === 0;
  const baseGroups = isFirstUser ? ["관심"] : [...userGroups];
  // 사용자가 새로 만든 그룹(pending) 도 칩 영역에 — 중복 제거
  const displayGroups = [
    ...baseGroups,
    ...pendingGroups.filter(g => !baseGroups.includes(g)),
  ];
  useEffect(() => {
    if (!isOpen || !isFirstUser) return;
    if (results.length === 0) return;
    if (markedGroups.size > 0) return;
    setMarkedGroups(new Set(["관심"]));
  }, [isOpen, isFirstUser, results.length, markedGroups.size]);

  const { data: existingMap } = useQuery({
    queryKey: ["existing-groups", reloadKey],
    queryFn: async () => {
      const all = await loadHoldings();
      const map = new Map<string, string[]>();
      for (const s of all) {
        const groups = map.get(s.ticker) ?? [];
        groups.push(s.account || "보유");
        map.set(s.ticker, groups);
      }
      return map;
    },
    enabled: isOpen,
  });

  // ticker → 가장 정보 많은 Stock (shares > 0 우선) — 검색 결과 prefill 용
  const { data: existingStocks } = useQuery({
    queryKey: ["existing-stocks", reloadKey],
    queryFn: async () => {
      const all = await loadHoldings();
      const map = new Map<string, Stock>();
      for (const s of all) {
        const ex = map.get(s.ticker);
        if (!ex || (s.shares > 0 && ex.shares === 0)) {
          map.set(s.ticker, s);
        }
      }
      return map;
    },
    enabled: isOpen,
  });

  // 검색 결과 받으면 기존 보유값 자동 prefill (사용자 입력은 보존)
  useEffect(() => {
    if (!existingStocks || results.length === 0) return;
    setRowEdits(prev => {
      const next = new Map(prev);
      for (const r of results) {
        const ex = existingStocks.get(r.ticker);
        if (!ex || ex.shares <= 0) continue;
        const cur = next.get(r.ticker);
        const empty = !cur || (!cur.shares && !cur.avgPrice && !cur.buyDate);
        if (empty) {
          next.set(r.ticker, {
            shares: String(ex.shares),
            avgPrice: String(ex.avg_price),
            buyDate: ex.buy_date || todayKstStr(),
          });
        }
      }
      return next;
    });
  }, [results, existingStocks]);

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
      let stocks: SearchResult[];
      if (codes.length > 0) {
        const names = await Promise.all(
          codes.map(c => fetchStockName(c).then(n => n ?? c))
        );
        stocks = codes.map((c, i) => ({
          ticker: c, name: names[i], market: "KOSPI",
        }));
      } else {
        stocks = await searchTossAutoComplete(q);
        if (stocks.length === 0) {
          stocks = await searchNaverAutoComplete(q);
        }
      }
      if (reqIdRef.current !== myId) return;
      setResults(stocks);
      setSelected(new Set(stocks.map(s => s.ticker)));
      setStatusMsg(stocks.length === 0
        ? "검색 결과 없음"
        : `${stocks.length}건 — 체크 후 그룹 선택 (보유 포함) → [일괄적용]`);
    } catch {
      if (reqIdRef.current !== myId) return;
      setStatusMsg("검색 실패");
    } finally {
      if (reqIdRef.current === myId) setSearching(false);
    }
  };

  const toggleAll = () => {
    if (selected.size === results.length) setSelected(new Set());
    else setSelected(new Set(results.map(r => r.ticker)));
  };

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

  // 일괄적용 — 마킹된 그룹들에만 적용 ("보유" 도 일반 그룹과 동일하게 마킹 시에만).
  // 1) 수량 입력된 행: 마킹된 각 그룹에 upsert (보유 = account="")
  //    + sync 모드면 같은 ticker 의 모든 기존 row 동일 값으로 sync
  // 2) 수량 미입력 행: 마킹된 watchlist 그룹들에 0주 추가 (보유는 watchlist 의미 없어 제외)
  const bulkApply = async () => {
    if (selected.size === 0) {
      setStatusMsg("⚠️ 종목을 먼저 체크하세요");
      return;
    }
    // 아무 그룹도 선택 안 했으면 차단 — "보유" 도 명시적으로 선택해야 추가됨
    if (markedGroups.size === 0) {
      setStatusMsg("⚠️ 그룹을 먼저 선택하세요 — 위쪽 그룹 칩 클릭 (보유 포함)");
      setGroupWarn(true);
      window.setTimeout(() => setGroupWarn(false), 1600);
      return;
    }
    const sel = results.filter(r => selected.has(r.ticker));
    let syncedTotal = 0;
    const groupResults: Map<string, { added: number; updated: number }> = new Map();

    // 마킹된 그룹의 실제 account 값 ("보유" → "")
    const toAccount = (g: string) => (g === HOLDING_LABEL ? "" : g);

    for (const r of sel) {
      const ed = rowEdits.get(r.ticker);
      const sh = Number(ed?.shares ?? "");
      const ap = Number(ed?.avgPrice ?? "");
      const hasValues =
        Number.isFinite(sh) && sh > 0 && Number.isFinite(ap) && ap > 0;
      const buyDate = ed?.buyDate || todayKstStr();

      if (hasValues) {
        // 마킹된 각 그룹에 upsert (보유 포함 — 단, 마킹된 경우에만)
        for (const g of markedGroups) {
          const stock: Stock = {
            ticker: r.ticker, name: r.name,
            shares: sh, avg_price: ap, invested: Math.round(sh * ap),
            buy_date: buyDate, market: r.market, account: toAccount(g),
          };
          const gres = await upsertHoldingToGroup(stock, toAccount(g));
          const cur = groupResults.get(g) ?? { added: 0, updated: 0 };
          if (gres === "added") cur.added += 1; else cur.updated += 1;
          groupResults.set(g, cur);
        }

        // sync 모드 — 같은 ticker 의 모든 기존 그룹 row 동일 값으로 sync
        if (!getIndependentGroupsMode()) {
          const sync = await syncAllRowsForTicker(r.ticker, {
            shares: sh, avg_price: ap, buy_date: buyDate,
            market: r.market, name: r.name,
          });
          syncedTotal += sync.updated;
        }
      } else {
        // 수량 미입력 — 마킹된 watchlist 그룹들에 0주 추가 ("보유" 는 의미 없어 skip)
        for (const g of markedGroups) {
          if (g === HOLDING_LABEL) continue;
          const stock: Stock = {
            ticker: r.ticker, name: r.name,
            shares: 0, avg_price: 0, invested: 0,
            buy_date: "", market: r.market, account: g,
          };
          const gres = await upsertHoldingToGroup(stock, g);
          const cur = groupResults.get(g) ?? { added: 0, updated: 0 };
          if (gres === "added") cur.added += 1; else cur.updated += 1;
          groupResults.set(g, cur);
        }
      }
    }

    // 결과 메시지
    const parts: string[] = [];
    if (syncedTotal > 0) parts.push(`🔄 모든 그룹 sync ${syncedTotal}건`);
    for (const [g, { added, updated }] of groupResults) {
      const line = [];
      if (added > 0) line.push(`+${added}`);
      if (updated > 0) line.push(`갱신 ${updated}`);
      parts.push(`"${g}" ${line.join(" · ")}`);
    }
    setStatusMsg(parts.length > 0
      ? `✅ ${parts.join(" · ")}`
      : "⚠️ 적용된 항목 없음 — 수량 입력 + 보유 마킹 또는 다른 그룹 마킹 필요");
    setReloadKey(k => k + 1);
    onAdded();
    if (parts.length > 0) onClose();
  };

  // 행의 ✓그룹 배지 클릭 = 그 종목만 그 그룹에서 제거
  const removeOneFromGroup = async (ticker: string, group: string) => {
    if (group === "보유") {
      await removeHolding(ticker, "");
    } else {
      await bulkRemoveFromGroup([ticker], group);
    }
    setStatusMsg(`🗑 ${ticker} 을 "${group}" 에서 제거`);
    setReloadKey(k => k + 1);
    onAdded();
  };

  if (!isOpen) return null;
  const allChecked = results.length > 0 && selected.size === results.length;
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
    <div className="fixed inset-0 z-50 flex items-start justify-center
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
              setQuery(""); setResults([]); setSelected(new Set()); setStatusMsg("");
            }}
                    className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200
                               text-gray-700 rounded text-sm">
              지우기
            </button>
          </div>
        </div>

        {/* 그룹 일괄 토글 영역 */}
        {results.length > 0 && (
          <div className={`px-5 py-2.5 border-b space-y-1.5 transition-colors
                          ${groupWarn
                            ? "bg-rose-100 border-2 border-rose-400 animate-shake"
                            : "bg-blue-50/30"}`}>
            {isFirstUser && (
              <div className="text-[11px] text-blue-700 bg-blue-100/60 rounded
                              px-2 py-1 border border-blue-200">
                💡 처음이시군요! <b>"관심"</b> 그룹이 자동 선택됐어요.
                수량 입력 없이 그대로 <b>일괄적용</b> 하면 관심종목으로 등록됩니다.
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
                ({selected.size} / {results.length})
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

        {/* 검색 결과 (행마다 수량/매수가/매수일) */}
        <div className="overflow-y-auto p-3 space-y-1 flex-1">
          {results.length === 0 ? (
            <div className="text-center text-gray-400 py-8 text-sm">
              검색 결과가 여기에 표시됩니다.
            </div>
          ) : (
            results.map(r => {
              const isChecked = selected.has(r.ticker);
              return (
                <SearchResultRow
                  key={r.ticker}
                  item={r}
                  price={priceMap.get(r.ticker)}
                  existing={existingMap?.get(r.ticker) ?? []}
                  // 체크된 행에만 pending 뱃지 — 일괄적용은 체크 종목에만 반영되므로
                  pending={isChecked
                    ? [...markedGroups].filter(
                        g => !(existingMap?.get(r.ticker) ?? []).includes(g))
                    : []}
                  checked={isChecked}
                  onToggle={() => toggleOne(r.ticker)}
                  edit={rowEdits.get(r.ticker)
                         ?? { shares: "", avgPrice: "", buyDate: todayKstStr() }}
                  onEditChange={p => updateRowEdit(r.ticker, p)}
                  onRemoveGroup={g => void removeOneFromGroup(r.ticker, g)}
                  onOpenEtf={() => setEtfDialog({ ticker: r.ticker, name: r.name })} />
              );
            })
          )}
        </div>

        {/* 하단 일괄적용 — 마킹된 그룹들에만 추가 (보유도 마킹 시 추가) */}
        {results.length > 0 && (
          <footer className="px-5 py-3 border-t bg-gray-50 flex items-center gap-2">
            <span className="text-xs text-gray-600">
              마킹된 그룹{markedGroups.size > 0 && ` (${markedGroups.size}개)`}에만 추가 — 보유 포함 선택해야 보유에 등록
              <span className="ml-1 text-blue-700">— 수량 입력 시 sync 모드면 동일 ticker 모든 그룹에 반영</span>
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
  edit: RowEdit;
  onEditChange: (patch: Partial<RowEdit>) => void;
  onRemoveGroup: (group: string) => void;
  onOpenEtf: () => void;  // ETF 책갈피 클릭 시 구성종목 모달 열기
}

function SearchResultRow({
  item, price, existing, pending, checked,
  onToggle, edit, onEditChange, onRemoveGroup, onOpenEtf,
}: RowProps) {
  const dayPct = price && price.base > 0
    ? ((price.price - price.base) / price.base) * 100 : undefined;
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
        <a href={`https://tossinvest.com/stocks/A${item.ticker}`}
           target="_blank" rel="noopener noreferrer"
           onClick={e => e.stopPropagation()}
           className="font-bold text-sm hover:text-blue-600">
          {item.name}
        </a>
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
      {/* 행별 입력 (일괄적용 시 모든 그룹에 동일 적용) */}
      <div className="mt-1.5 flex items-center gap-2 text-xs ml-6 flex-wrap">
        <label className="flex items-center gap-1">
          <span className="text-gray-500">수량</span>
          <input type="number" inputMode="numeric" placeholder="0"
                 value={edit.shares}
                 onChange={e => onEditChange({ shares: e.target.value })}
                 onClick={e => e.stopPropagation()}
                 className="border rounded px-1.5 py-0.5 w-20 text-right
                            tabular-nums focus:outline-none focus:border-blue-500" />
        </label>
        <label className="flex items-center gap-1">
          <span className="text-gray-500">평단가</span>
          <input type="number" inputMode="numeric" placeholder="0"
                 value={edit.avgPrice}
                 onChange={e => onEditChange({ avgPrice: e.target.value })}
                 onClick={e => e.stopPropagation()}
                 className="border rounded px-1.5 py-0.5 w-24 text-right
                            tabular-nums focus:outline-none focus:border-blue-500" />
        </label>
      </div>
    </div>
  );
}
