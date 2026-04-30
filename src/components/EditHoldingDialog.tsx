import { useEffect, useRef, useState } from "react";
import type { Stock } from "../types";
import {
  syncAllRowsForTicker, deleteAllRowsForTicker,
  getUserGroups, upsertHoldingToGroup, removeHolding, loadHoldings,
} from "../lib/db";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  stock: Stock | null;
  curPrice?: number;
  onChanged: () => void;
}

type Mode = "buy" | "sell" | "edit";

const DEFAULT_GROUP = "보유";  // empty account 의 표시 라벨

function todayKstStr(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

export function EditHoldingDialog({
  isOpen, onClose, stock, curPrice, onChanged,
}: Props) {
  const [mode, setMode] = useState<Mode>("buy");
  const [shares, setShares] = useState("");
  const [price, setPrice] = useState("");
  const [editShares, setEditShares] = useState("");
  const [editAvg, setEditAvg] = useState("");
  const [err, setErr] = useState("");
  const downOnBackdropRef = useRef(false);

  // 그룹 선택 상태 — 현재 속한 그룹 + 새로 추가/제외할 그룹
  const [groupSelection, setGroupSelection] = useState<Set<string>>(new Set());
  const [originalGroups, setOriginalGroups] = useState<Set<string>>(new Set());
  const [allGroups, setAllGroups] = useState<string[]>([]);
  const [newGroup, setNewGroup] = useState("");

  // 다이얼로그 열릴 때 (혹은 다른 종목으로 변경 시) 그룹 정보 로드
  useEffect(() => {
    if (!isOpen || !stock) return;
    void (async () => {
      const [holdings, userGroups] = await Promise.all([
        loadHoldings(), getUserGroups(),
      ]);
      const current = new Set(
        holdings.filter(s => s.ticker === stock.ticker)
                .map(s => s.account || DEFAULT_GROUP)
      );
      setGroupSelection(new Set(current));
      setOriginalGroups(new Set(current));
      // 보유 + user groups (보유 중복 제거)
      setAllGroups([
        DEFAULT_GROUP,
        ...userGroups.filter(g => g !== DEFAULT_GROUP),
      ]);
      setNewGroup("");
      setErr("");
    })();
  }, [isOpen, stock?.ticker]);

  if (!isOpen || !stock) return null;

  const curShares = stock.shares;
  const curAvg = stock.avg_price;
  const curInvested = stock.invested ?? Math.round(curShares * curAvg);

  const toggleGroup = (g: string) => {
    setGroupSelection(prev => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  };

  const addNewGroupMark = () => {
    const g = newGroup.trim();
    if (!g) return;
    if (!allGroups.includes(g)) {
      setAllGroups(prev => [...prev, g]);
    }
    setGroupSelection(prev => new Set(prev).add(g));
    setNewGroup("");
  };

  // 사용자 의도: "어느 그룹에서든 수정해도 같은 종목은 모든 그룹이 동일 값을 가짐."
  // → 0주 → 모든 그룹 row 일괄 삭제 / shares > 0 → 모든 그룹 row 일괄 sync.
  // 그룹 추가/제거는 모드 액션 전에 처리해 sync 가 새 row 도 반영하게 한다.
  const apply = async () => {
    setErr("");

    // 1. 모드 액션 준비 (입력 있을 때만)
    let modeAction: (() => Promise<void>) | null = null;

    if (mode === "buy" && (shares || price)) {
      const sh = Number(shares);
      const pr = Number(price);
      if (!Number.isFinite(sh) || sh <= 0) return setErr("추가 수량 입력");
      if (!Number.isFinite(pr) || pr <= 0) return setErr("매수가 입력");
      const newShares = curShares + sh;
      const newInvested = curInvested + Math.round(sh * pr);
      const newAvg = newInvested / newShares;
      modeAction = async () => {
        await syncAllRowsForTicker(stock.ticker, {
          shares: newShares, avg_price: newAvg,
          buy_date: stock.buy_date || todayKstStr(),
          market: stock.market, name: stock.name,
        });
      };
    } else if (mode === "sell" && shares) {
      const sh = Number(shares);
      if (!Number.isFinite(sh) || sh <= 0) return setErr("매도 수량 입력");
      if (sh > curShares) return setErr(`보유 ${curShares}주를 초과`);
      const newShares = curShares - sh;
      modeAction = async () => {
        if (newShares === 0) {
          await deleteAllRowsForTicker(stock.ticker);
        } else {
          await syncAllRowsForTicker(stock.ticker, {
            shares: newShares, avg_price: curAvg,
            buy_date: stock.buy_date,
            market: stock.market, name: stock.name,
          });
        }
      };
    } else if (mode === "edit" && (editShares || editAvg)) {
      const sh = Number(editShares || curShares);
      const ap = Number(editAvg || curAvg);
      if (!Number.isFinite(sh) || sh < 0) return setErr("수량 오류");
      if (!Number.isFinite(ap) || ap <= 0) return setErr("매수가 오류");
      modeAction = async () => {
        if (sh === 0) {
          await deleteAllRowsForTicker(stock.ticker);
        } else {
          await syncAllRowsForTicker(stock.ticker, {
            shares: sh, avg_price: ap,
            buy_date: stock.buy_date || todayKstStr(),
            market: stock.market, name: stock.name,
          });
        }
      };
    }

    // 2. 그룹 변경 diff
    const toAdd = [...groupSelection].filter(g => !originalGroups.has(g));
    const toRemove = [...originalGroups].filter(g => !groupSelection.has(g));

    if (!modeAction && toAdd.length === 0 && toRemove.length === 0) {
      return setErr("변경 사항이 없습니다");
    }

    // 3. 그룹 추가 (모드 액션 전)
    for (const g of toAdd) {
      const account = g === DEFAULT_GROUP ? "" : g;
      await upsertHoldingToGroup(stock, account);
    }
    // 4. 그룹 제거
    for (const g of toRemove) {
      const account = g === DEFAULT_GROUP ? "" : g;
      await removeHolding(stock.ticker, account);
    }
    // 5. 모드 액션 (전체 row sync)
    if (modeAction) await modeAction();

    onChanged();
    onClose();
    // reset
    setShares(""); setPrice("");
    setEditShares(""); setEditAvg("");
  };

  const tabBtn = (m: Mode, label: string) => (
    <button onClick={() => { setMode(m); setErr(""); }}
            className={`flex-1 px-3 py-1.5 text-sm font-medium rounded
                        ${mode === m
                          ? "bg-blue-600 text-white"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center
                     justify-center bg-black/40 sm:p-4"
         onMouseDown={e => { downOnBackdropRef.current = e.target === e.currentTarget; }}
         onClick={e => {
           if (e.target === e.currentTarget && downOnBackdropRef.current) onClose();
         }}>
      <div className="bg-white shadow-xl w-full max-w-md
                       rounded-t-xl sm:rounded-lg
                       max-h-[90vh] overflow-y-auto">
        <header className="px-5 py-3 border-b bg-gray-50 flex items-center">
          <h2 className="text-lg font-bold">✏️ 보유 수정</h2>
          <span className="ml-3 text-sm text-gray-600 truncate">
            {stock.name} ({stock.ticker})
            {stock.account && <span className="text-amber-600 ml-1">— {stock.account}</span>}
          </span>
          <button onClick={onClose}
                  className="ml-auto text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </header>

        <div className="px-5 py-3 space-y-3">
          {/* 현재 보유 */}
          <div className="bg-gray-50 rounded p-2.5 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-gray-500">현재 수량</span>
              <span className="tabular-nums font-bold">{curShares.toLocaleString()}주</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">평균 매수가</span>
              <span className="tabular-nums">{Math.round(curAvg).toLocaleString()}원</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">투자 원금</span>
              <span className="tabular-nums">{curInvested.toLocaleString()}원</span>
            </div>
            {curPrice && (
              <div className="flex justify-between">
                <span className="text-gray-500">현재가</span>
                <span className="tabular-nums">{curPrice.toLocaleString()}원</span>
              </div>
            )}
          </div>

          {/* 모드 탭 */}
          <div className="flex gap-1">
            {tabBtn("buy", "➕ 추가매수")}
            {tabBtn("sell", "➖ 매도")}
            {tabBtn("edit", "✏️ 직접수정")}
          </div>

          <div className="text-[11px] text-blue-700 bg-blue-50 border border-blue-200
                          rounded px-2 py-1">
            💡 이 변경은 <b>같은 종목의 모든 그룹</b>에 동일하게 적용됩니다
            {curShares > 0 && " (전량 매도 시 모든 그룹에서 삭제)"}
          </div>

          {/* 모드별 입력 */}
          {mode === "buy" && (
            <div className="space-y-2">
              <Field label="추가 수량">
                <input type="number" inputMode="numeric" value={shares}
                       onChange={e => setShares(e.target.value)}
                       placeholder="예: 10" className={inputCls} />
              </Field>
              <Field label="매수가">
                <input type="number" inputMode="numeric" value={price}
                       onChange={e => setPrice(e.target.value)}
                       placeholder={curPrice ? `예: ${curPrice}` : "예: 100000"}
                       className={inputCls} />
              </Field>
              {shares && price && Number(shares) > 0 && Number(price) > 0 && (
                <div className="text-xs text-gray-500 mt-1">
                  → 신규 평균가 {
                    Math.round((curInvested + Number(shares) * Number(price))
                                / (curShares + Number(shares))).toLocaleString()
                  }원 (총 {(curShares + Number(shares)).toLocaleString()}주)
                </div>
              )}
            </div>
          )}

          {mode === "sell" && (
            <div className="space-y-2">
              <Field label={`매도 수량 (최대 ${curShares.toLocaleString()})`}>
                <input type="number" inputMode="numeric" value={shares}
                       onChange={e => setShares(e.target.value)}
                       placeholder="예: 5" className={inputCls} />
              </Field>
              <button onClick={() => setShares(String(curShares))}
                      className="text-xs text-blue-600 hover:underline">
                전량 매도
              </button>
              {shares && Number(shares) > 0 && Number(shares) <= curShares && (
                <div className="text-xs text-gray-500 mt-1">
                  → 잔여 {(curShares - Number(shares)).toLocaleString()}주
                  {Number(shares) === curShares && " (전량 매도 시 보유 삭제)"}
                </div>
              )}
            </div>
          )}

          {mode === "edit" && (
            <div className="space-y-2">
              <Field label="수량">
                <input type="number" inputMode="numeric" value={editShares}
                       onChange={e => setEditShares(e.target.value)}
                       placeholder={String(curShares)} className={inputCls} />
              </Field>
              <Field label="평균 매수가">
                <input type="number" inputMode="numeric" value={editAvg}
                       onChange={e => setEditAvg(e.target.value)}
                       placeholder={String(Math.round(curAvg))} className={inputCls} />
              </Field>
              <p className="text-xs text-gray-400">
                비워두면 기존 값 유지. 수량을 0 으로 설정하면 보유에서 삭제됩니다.
              </p>
            </div>
          )}

          {/* 그룹 토글 — 클릭 = 추가/제외, [적용] 시 일괄 처리 */}
          <div className="border-t pt-3 space-y-1.5">
            <label className="text-xs font-bold text-gray-700 block">
              그룹 (클릭 = 추가/제외)
            </label>
            <div className="flex flex-wrap items-center gap-1.5">
              {allGroups.map(g => {
                const active = groupSelection.has(g);
                return (
                  <button key={g}
                          onClick={() => toggleGroup(g)}
                          className={`px-2.5 py-1 text-xs rounded border transition
                                      ${active
                                        ? "bg-blue-600 text-white border-blue-700 font-bold"
                                        : "bg-white hover:bg-gray-50 text-gray-700 border-gray-300"}`}>
                    {active ? "✓ " : ""}{g}
                  </button>
                );
              })}
              <div className="flex items-center gap-1 ml-1">
                <input type="text" placeholder="새 그룹"
                       value={newGroup}
                       onChange={e => setNewGroup(e.target.value)}
                       onKeyDown={e => {
                         if (e.key === "Enter") { e.preventDefault(); addNewGroupMark(); }
                       }}
                       className="border rounded px-1.5 py-0.5 text-xs w-20
                                  focus:outline-none focus:border-blue-500" />
                <button onClick={addNewGroupMark}
                        disabled={!newGroup.trim()}
                        className="px-2 py-0.5 bg-green-600 hover:bg-green-700
                                   disabled:opacity-40
                                   text-white text-xs rounded">
                  +
                </button>
              </div>
            </div>
            {/* 변경 미리보기 */}
            {(() => {
              const toAdd = [...groupSelection].filter(g => !originalGroups.has(g));
              const toRemove = [...originalGroups].filter(g => !groupSelection.has(g));
              if (toAdd.length === 0 && toRemove.length === 0) return null;
              return (
                <div className="text-[11px]">
                  {toAdd.length > 0 && (
                    <span className="text-blue-700 font-medium">+ {toAdd.join(", ")}</span>
                  )}
                  {toAdd.length > 0 && toRemove.length > 0 && (
                    <span className="text-gray-400 mx-1">/</span>
                  )}
                  {toRemove.length > 0 && (
                    <span className="text-rose-700 font-medium">− {toRemove.join(", ")}</span>
                  )}
                </div>
              );
            })()}
          </div>

          {err && (
            <div className="text-sm text-rose-700 bg-rose-50 px-2 py-1 rounded">
              {err}
            </div>
          )}
        </div>

        <footer className="px-5 py-3 border-t bg-gray-50 flex justify-end gap-2">
          <button onClick={onClose}
                  className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200
                             text-gray-700 rounded text-sm">
            취소
          </button>
          <button onClick={() => void apply()}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700
                             text-white rounded text-sm font-bold">
            적용
          </button>
        </footer>
      </div>
    </div>
  );
}

const inputCls =
  "w-full border rounded px-2 py-1 text-sm tabular-nums "
  + "focus:outline-none focus:border-blue-500";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-gray-600 block mb-0.5">{label}</span>
      {children}
    </label>
  );
}
