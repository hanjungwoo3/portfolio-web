import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  searchNaverAutoComplete, fetchStockName, fetchTossPrices,
  type SearchResult,
} from "../lib/api";
import {
  bulkAddToGroup, bulkRemoveFromGroup,
  removeHolding, getUserGroups, loadHoldings,
} from "../lib/db";
import type { Stock, Price } from "../types";
import { signColor } from "../lib/format";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onAdded: () => void;
}

interface RowEdit { shares: string; avgPrice: string; buyDate: string; }

function todayKstStr(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

export function SearchDialog({ isOpen, onClose, onAdded }: Props) {
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

  const tickers = results.map(r => r.ticker);
  const { data: prices } = useQuery({
    queryKey: ["search-prices", tickers],
    queryFn: () => fetchTossPrices(tickers),
    enabled: isOpen && tickers.length > 0,
    refetchInterval: 5_000,
  });
  const priceMap = new Map((prices ?? []).map(p => [p.ticker, p]));

  const { data: userGroups = [] } = useQuery({
    queryKey: ["user-groups", reloadKey],
    queryFn: getUserGroups,
    enabled: isOpen,
  });

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

  const doSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setStatusMsg("검색 중...");
    setSelected(new Set());
    try {
      const codes = Array.from(new Set(q.match(/\b\d{6}\b/g) ?? []));
      let stocks: SearchResult[];
      if (codes.length > 0) {
        const names = await Promise.all(
          codes.map(c => fetchStockName(c).then(n => n ?? c))
        );
        stocks = codes.map((c, i) => ({
          ticker: c, name: names[i], market: "KOSPI",
        }));
      } else {
        stocks = await searchNaverAutoComplete(q);
      }
      setResults(stocks);
      setSelected(new Set(stocks.map(s => s.ticker)));
      setStatusMsg(stocks.length === 0
        ? "검색 결과 없음"
        : `${stocks.length}건 — 체크 후 그룹 토글 또는 하단 [일괄적용] (보유 추가)`);
    } catch {
      setStatusMsg("검색 실패");
    } finally {
      setSearching(false);
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

  // 새 그룹 — 즉시 마킹 (일괄적용 시 추가됨)
  const addNewGroupMark = () => {
    const g = newGroup.trim();
    if (!g) return;
    setMarkedGroups(prev => new Set(prev).add(g));
    setNewGroup("");
  };

  // 일괄적용 = 보유 (수량 입력된 행만) + 마킹된 그룹들에도 추가
  const bulkApply = async () => {
    if (selected.size === 0) {
      setStatusMsg("⚠️ 종목을 먼저 체크하세요");
      return;
    }
    const sel = results.filter(r => selected.has(r.ticker));
    let holdingsAdded = 0, holdingsSkipped = 0, invalid = 0;
    const groupResults: Map<string, { added: number; skipped: number }> = new Map();

    // 1) 보유 — 수량/매수가 입력된 행만
    const holdingItems: Stock[] = [];
    for (const r of sel) {
      const ed = rowEdits.get(r.ticker);
      const sh = Number(ed?.shares ?? "");
      const ap = Number(ed?.avgPrice ?? "");
      if (!Number.isFinite(sh) || sh <= 0 || !Number.isFinite(ap) || ap <= 0) {
        invalid += 1; continue;
      }
      holdingItems.push({
        ticker: r.ticker, name: r.name,
        shares: sh, avg_price: ap, invested: Math.round(sh * ap),
        buy_date: ed?.buyDate || todayKstStr(),
        market: r.market, account: "",
      });
    }
    if (holdingItems.length > 0) {
      const r = await bulkAddToGroup(holdingItems, "");
      holdingsAdded = r.added; holdingsSkipped = r.skipped;
    }

    // 2) 마킹된 각 그룹에 일괄 추가
    for (const g of markedGroups) {
      const items: Stock[] = sel.map(r => ({
        ticker: r.ticker, name: r.name,
        shares: 0, avg_price: 0, invested: 0,
        buy_date: "", market: r.market, account: g,
      }));
      const r = await bulkAddToGroup(items, g);
      groupResults.set(g, { added: r.added, skipped: r.skipped });
    }

    // 결과 메시지
    const parts: string[] = [];
    if (holdingsAdded > 0) parts.push(`💼 보유 ${holdingsAdded}`);
    if (holdingsSkipped > 0) parts.push(`보유 중복 ${holdingsSkipped}`);
    if (invalid > 0) parts.push(`보유 미입력 ${invalid}`);
    for (const [g, { added, skipped }] of groupResults) {
      parts.push(`"${g}" ${added}${skipped > 0 ? ` (중복 ${skipped})` : ""}`);
    }
    setStatusMsg(parts.length > 0
      ? `✅ ${parts.join(" · ")}`
      : "⚠️ 적용된 항목 없음 — 수량 입력 또는 그룹 마킹 필요");
    setReloadKey(k => k + 1);
    onAdded();
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
                     bg-black/40 p-4 pt-10"
         onMouseDown={e => { downOnBackdropRef.current = e.target === e.currentTarget; }}
         onClick={e => {
           if (e.target === e.currentTarget && downOnBackdropRef.current) onClose();
         }}>
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full
                       max-h-[90vh] flex flex-col">
        <header className="px-5 py-3 border-b bg-gray-50
                            flex items-center gap-3">
          <h2 className="text-lg font-bold shrink-0">🔍 종목 검색 / 추가</h2>
          <span className="text-xs text-gray-500 truncate">{statusMsg}</span>
          <button onClick={onClose}
                  className="ml-auto text-gray-400 hover:text-gray-600 text-xl">
            ✕
          </button>
        </header>

        {/* 검색 입력 */}
        <div className="px-5 py-3 border-b">
          <textarea
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
          <div className="px-5 py-2.5 border-b bg-blue-50/30 space-y-1.5">
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
              {userGroups.map(g => {
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
                       onKeyDown={e => { if (e.key === "Enter") addNewGroupMark(); }}
                       className="border rounded px-1.5 py-0.5 text-xs w-24
                                  focus:outline-none focus:border-blue-500" />
                <button onClick={addNewGroupMark}
                        disabled={!newGroup.trim()}
                        className="px-2 py-0.5 bg-green-600 hover:bg-green-700
                                   disabled:opacity-40
                                   text-white text-xs rounded">
                  생성+마킹
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
            results.map(r => (
              <SearchResultRow
                key={r.ticker}
                item={r}
                price={priceMap.get(r.ticker)}
                existing={existingMap?.get(r.ticker) ?? []}
                checked={selected.has(r.ticker)}
                onToggle={() => toggleOne(r.ticker)}
                edit={rowEdits.get(r.ticker)
                       ?? { shares: "", avgPrice: "", buyDate: todayKstStr() }}
                onEditChange={p => updateRowEdit(r.ticker, p)}
                onRemoveGroup={g => void removeOneFromGroup(r.ticker, g)} />
            ))
          )}
        </div>

        {/* 하단 일괄적용 — 보유 + 마킹된 그룹 모두 처리 */}
        {results.length > 0 && (
          <footer className="px-5 py-3 border-t bg-gray-50 flex items-center gap-2">
            <span className="text-xs text-gray-600">
              수량 입력된 행은 보유로 + 마킹된 그룹{markedGroups.size > 0 && ` (${markedGroups.size}개)`}에 추가
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
    </div>
  );
}

interface RowProps {
  item: SearchResult;
  price?: Price;
  existing: string[];
  checked: boolean;
  onToggle: () => void;
  edit: RowEdit;
  onEditChange: (patch: Partial<RowEdit>) => void;
  onRemoveGroup: (group: string) => void;
}

function SearchResultRow({
  item, price, existing, checked, onToggle, edit, onEditChange, onRemoveGroup,
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
      {/* 행별 보유 입력 (일괄적용 시 사용) */}
      <div className="mt-1.5 flex items-center gap-1.5 text-xs ml-6">
        <span className="text-gray-400">보유 시:</span>
        <input type="number" inputMode="numeric" placeholder="수량"
               value={edit.shares}
               onChange={e => onEditChange({ shares: e.target.value })}
               onClick={e => e.stopPropagation()}
               className="border rounded px-1.5 py-0.5 w-20 text-right
                          tabular-nums focus:outline-none focus:border-blue-500" />
        <input type="number" inputMode="numeric" placeholder="매수가"
               value={edit.avgPrice}
               onChange={e => onEditChange({ avgPrice: e.target.value })}
               onClick={e => e.stopPropagation()}
               className="border rounded px-1.5 py-0.5 w-24 text-right
                          tabular-nums focus:outline-none focus:border-blue-500" />
        <input type="date" value={edit.buyDate}
               onChange={e => onEditChange({ buyDate: e.target.value })}
               onClick={e => e.stopPropagation()}
               className="border rounded px-1.5 py-0.5
                          focus:outline-none focus:border-blue-500" />
      </div>
    </div>
  );
}
