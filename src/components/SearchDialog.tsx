import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  searchNaverAutoComplete, fetchStockName, fetchTossPrices,
  type SearchResult,
} from "../lib/api";
import { bulkAddToGroup, getUserGroups, loadHoldings } from "../lib/db";
import type { Stock, Price } from "../types";
import { signColor } from "../lib/format";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onAdded: () => void;          // 추가 후 부모 reload 트리거
}

// 보유로 추가 시 행별 입력값 (체크된 행만 의미 있음)
interface RowEdit { shares: string; avgPrice: string; buyDate: string; }

function todayKstStr(): string {
  const d = new Date(Date.now() + 9 * 3600_000);
  return d.toISOString().slice(0, 10);
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
      // 검색 결과 들어오면 모두 자동 선택 (사용자가 의도적으로 해제 가능)
      setSelected(new Set(stocks.map(s => s.ticker)));
      setStatusMsg(stocks.length === 0
        ? "검색 결과 없음"
        : `${stocks.length}건 — 체크박스로 선택 후 위에서 그룹 추가`);
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

  const addToGroup = async (group: string) => {
    if (selected.size === 0) {
      setStatusMsg("⚠️ 추가할 종목을 먼저 체크하세요");
      return;
    }
    const items: Stock[] = results
      .filter(r => selected.has(r.ticker))
      .map(r => ({
        ticker: r.ticker, name: r.name,
        shares: 0, avg_price: 0, invested: 0,
        buy_date: "", market: r.market, account: group,
      }));
    const { added, skipped } = await bulkAddToGroup(items, group);
    setStatusMsg(
      `✅ "${group}" 에 ${added}건 추가` +
      (skipped > 0 ? ` · ⚠️ ${skipped}건은 이미 있음` : "")
    );
    setReloadKey(k => k + 1);
    onAdded();
  };

  const addNew = () => {
    const g = newGroup.trim();
    if (!g) return;
    void addToGroup(g);
    setNewGroup("");
  };

  // 💼 보유로 추가 — 행별 수량/매수가/매수일 사용 (account="")
  const addAsHoldings = async () => {
    if (selected.size === 0) {
      setStatusMsg("⚠️ 추가할 종목을 먼저 체크하세요");
      return;
    }
    const items: Stock[] = [];
    let invalid = 0;
    for (const r of results) {
      if (!selected.has(r.ticker)) continue;
      const ed = rowEdits.get(r.ticker);
      const sh = Number(ed?.shares ?? "");
      const ap = Number(ed?.avgPrice ?? "");
      if (!Number.isFinite(sh) || sh <= 0 || !Number.isFinite(ap) || ap <= 0) {
        invalid += 1; continue;
      }
      items.push({
        ticker: r.ticker, name: r.name,
        shares: sh, avg_price: ap, invested: Math.round(sh * ap),
        buy_date: ed?.buyDate || todayKstStr(),
        market: r.market, account: "",
      });
    }
    if (items.length === 0) {
      setStatusMsg(`⚠️ 보유 추가 — 수량/매수가 입력 필요 (${invalid}건 누락)`);
      return;
    }
    const { added, skipped } = await bulkAddToGroup(items, "");
    setStatusMsg(
      `💼 보유 ${added}건 추가` +
      (skipped > 0 ? ` · ⚠️ ${skipped}건 이미 있음` : "") +
      (invalid > 0 ? ` · ${invalid}건 입력 누락` : "")
    );
    setReloadKey(k => k + 1);
    onAdded();
  };

  if (!isOpen) return null;
  const allChecked = results.length > 0 && selected.size === results.length;
  const noneChecked = selected.size === 0;

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

        {/* 그룹 일괄 추가 영역 */}
        {results.length > 0 && (
          <div className="px-5 py-3 border-b bg-blue-50/30 space-y-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer
                              select-none">
              <input type="checkbox" checked={allChecked}
                     onChange={toggleAll}
                     className="w-4 h-4 accent-blue-600" />
              <span className="font-medium text-gray-700">
                전체 선택
              </span>
              <span className="text-xs text-gray-500">
                ({selected.size} / {results.length} 선택됨)
              </span>
            </label>
            <div className="flex flex-wrap items-center gap-1.5">
              <button onClick={() => void addAsHoldings()}
                      disabled={noneChecked}
                      className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700
                                 text-white text-xs font-bold rounded
                                 disabled:opacity-40 disabled:cursor-not-allowed"
                      title="아래 행의 수량/매수가/매수일로 보유 등록">
                💼 보유로 추가
              </button>
              <span className="text-sm font-medium text-gray-700 mx-1">
                또는 그룹:
              </span>
              {userGroups.map(g => (
                <button key={g}
                        onClick={() => void addToGroup(g)}
                        disabled={noneChecked}
                        className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100
                                   text-amber-800 text-xs rounded
                                   border border-amber-200
                                   disabled:opacity-40 disabled:cursor-not-allowed">
                  ⭐ {g}
                </button>
              ))}
              <div className="flex items-center gap-1 ml-1">
                <input type="text" placeholder="새 그룹"
                       value={newGroup}
                       onChange={e => setNewGroup(e.target.value)}
                       onKeyDown={e => {
                         if (e.key === "Enter") addNew();
                       }}
                       className="border rounded px-1.5 py-0.5 text-xs w-24
                                  focus:outline-none focus:border-blue-500" />
                <button onClick={addNew}
                        disabled={!newGroup.trim() || noneChecked}
                        className="px-2 py-0.5 bg-green-600 hover:bg-green-700
                                   disabled:opacity-40
                                   text-white text-xs rounded">
                  생성+추가
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 검색 결과 */}
        <div className="overflow-y-auto p-3 space-y-1">
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
                onEditChange={p => updateRowEdit(r.ticker, p)} />
            ))
          )}
        </div>
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
}

function SearchResultRow({
  item, price, existing, checked, onToggle, edit, onEditChange,
}: RowProps) {
  const dayPct = price && price.base > 0
    ? ((price.price - price.base) / price.base) * 100 : undefined;
  const isFaded = existing.length > 0;

  // 클릭이 input/button 내부인지 체크해서 체크박스 토글 방지
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
                      ${isFaded ? "opacity-70" : ""}`}>
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
          <span key={g}
                className="text-[10px] bg-amber-100 text-amber-800
                           px-1.5 py-0.5 rounded">
            ✓ {g}
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
      {/* 보유 추가용 입력 (옵션) */}
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
