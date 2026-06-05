import { useEffect, useRef, useState } from "react";
import { Settings } from "lucide-react";
import type { Stock } from "../types";
import {
  syncAllRowsForTicker, deleteAllRowsForTicker,
  getUserGroups, upsertHoldingToGroup, removeHolding, loadHoldings,
  updateHolding, addTrade,
} from "../lib/db";
import { TradeLogSection } from "./TradeLogSection";
import { getIndependentGroupsMode } from "../lib/groupMode";
import { useEscClose } from "../lib/useEscClose";

// 모드별 적용 — sync OFF 면 단건만, ON 이면 모든 그룹 sync
async function applyTickerUpdate(
  stock: Stock,
  values: { shares: number; avg_price: number; buy_date?: string; market?: string; name?: string },
): Promise<void> {
  if (getIndependentGroupsMode()) {
    // 독립 모드 — 해당 (ticker, account) 단건만 update
    await updateHolding({
      ...stock,
      shares: values.shares,
      avg_price: values.avg_price,
      invested: Math.round(values.shares * values.avg_price),
      buy_date: values.buy_date ?? stock.buy_date,
      market: values.market ?? stock.market,
      name: values.name ?? stock.name,
    });
  } else {
    // sync 모드 — 모든 그룹 동일 값
    await syncAllRowsForTicker(stock.ticker, values);
  }
}

async function applyTickerDelete(stock: Stock): Promise<void> {
  if (getIndependentGroupsMode()) {
    await removeHolding(stock.ticker, stock.account || "");
  } else {
    await deleteAllRowsForTicker(stock.ticker);
  }
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  stock: Stock | null;
  curPrice?: number;
  onChanged: () => void;
}

type Mode = "buy" | "sell" | "edit";


function todayKstStr(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

export function EditHoldingDialog({
  isOpen, onClose, stock, curPrice, onChanged,
}: Props) {
  useEscClose(isOpen, onClose);
  const [mode, setMode] = useState<Mode>("buy");
  const [shares, setShares] = useState("");
  const [price, setPrice] = useState("");
  const [sellPrice, setSellPrice] = useState("");   // 매도가 (거래기록 금액용 — 보유엔 영향 없음)
  const [tradeDate, setTradeDate] = useState(todayKstStr());   // 매수일/매도일 (기본 오늘)
  // 창을 안 닫고 매수/매도 반영하므로, 현재 보유를 로컬에서 갱신해 표시 (prop 은 stale)
  const [live, setLive] = useState<Stock | null>(stock);
  const [logKey, setLogKey] = useState(0);          // 자동기록 후 거래기록 새로고침 트리거
  const [okMsg, setOkMsg] = useState("");
  const [editShares, setEditShares] = useState("");
  const [editAvg, setEditAvg] = useState("");
  const [err, setErr] = useState("");
  const downOnBackdropRef = useRef(false);

  // 그룹 선택 상태 — 현재 속한 그룹 + 새로 추가/제외할 그룹
  const [groupSelection, setGroupSelection] = useState<Set<string>>(new Set());
  const [originalGroups, setOriginalGroups] = useState<Set<string>>(new Set());
  const [allGroups, setAllGroups] = useState<string[]>([]);
  const [newGroup, setNewGroup] = useState("");

  // 다이얼로그 열릴 때 (혹은 다른 종목으로 변경 시) 그룹 정보 로드 + 로컬 보유/입력 초기화
  useEffect(() => {
    if (!isOpen || !stock) return;
    setLive(stock);
    setShares(""); setPrice(""); setSellPrice(""); setTradeDate(todayKstStr());
    setEditShares(""); setEditAvg(""); setOkMsg("");
    void (async () => {
      const [holdings, userGroups] = await Promise.all([
        loadHoldings(), getUserGroups(),
      ]);
      const current = new Set(
        holdings.filter(s => s.ticker === stock.ticker)
                .map(s => s.account)
                .filter((a): a is string => !!a)   // 레거시 빈 계좌(보유) 통합 완료 — 실제 그룹만
      );
      setGroupSelection(new Set(current));
      setOriginalGroups(new Set(current));
      setAllGroups(userGroups.filter(Boolean));
      setNewGroup("");
      setErr("");
    })();
  }, [isOpen, stock?.ticker]);

  if (!isOpen || !stock) return null;

  const cur = live ?? stock;
  const curShares = cur.shares;
  const curAvg = cur.avg_price;
  const curInvested = cur.invested ?? Math.round(curShares * curAvg);
  const independent = getIndependentGroupsMode();  // 그룹별 독립 보유 모드

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
  // 매수/매도/직접수정 적용 — 창은 닫지 않음(직접수정 0주 삭제만 닫음). 매수/매도는 거래기록 자동 추가.
  const applyMode = async () => {
    setErr(""); setOkMsg("");
    let modeAction: (() => Promise<void>) | null = null;
    let tradeToLog: { type: "buy" | "sell"; date: string; qty: number; amount: number } | null = null;
    let willDelete = false;

    if (mode === "buy") {
      const sh = Number(shares), pr = Number(price);
      if (!Number.isFinite(sh) || sh <= 0) return setErr("추가 수량 입력");
      if (!Number.isFinite(pr) || pr <= 0) return setErr("매수가 입력");
      const newShares = curShares + sh;
      const newAvg = (curInvested + Math.round(sh * pr)) / newShares;
      const bd = tradeDate || todayKstStr();
      tradeToLog = { type: "buy", date: bd, qty: sh, amount: Math.round(sh * pr) };
      modeAction = () => applyTickerUpdate(stock, {
        shares: newShares, avg_price: newAvg, buy_date: bd,
        market: stock.market, name: stock.name,
      });
    } else if (mode === "sell") {
      const sh = Number(shares);
      if (!Number.isFinite(sh) || sh <= 0) return setErr("매도 수량 입력");
      if (sh > curShares) return setErr(`보유 ${curShares}주를 초과`);
      const sellPr = Number(sellPrice) > 0 ? Number(sellPrice) : (curPrice || curAvg);
      tradeToLog = { type: "sell", date: tradeDate || todayKstStr(), qty: sh, amount: Math.round(sh * sellPr) };
      modeAction = () => applyTickerUpdate(stock, {
        shares: curShares - sh, avg_price: curAvg, buy_date: cur.buy_date,
        market: stock.market, name: stock.name,
      });
    } else {
      if (!editShares && !editAvg) return setErr("수정할 값 입력");
      const sh = Number(editShares || curShares);
      const ap = Number(editAvg || curAvg);
      if (!Number.isFinite(sh) || sh < 0) return setErr("수량 오류");
      if (!Number.isFinite(ap) || ap <= 0) return setErr("매수가 오류");
      willDelete = sh === 0;
      modeAction = () => sh === 0
        ? applyTickerDelete(stock)
        : applyTickerUpdate(stock, {
            shares: sh, avg_price: ap, buy_date: cur.buy_date || todayKstStr(),
            market: stock.market, name: stock.name,
          });
    }

    await modeAction();
    if (tradeToLog) await addTrade({ ticker: stock.ticker, account: stock.account, ...tradeToLog });
    onChanged();
    if (willDelete) { onClose(); return; }
    // 창 유지 — 로컬 보유 갱신 + 입력 초기화 + 거래기록 새로고침
    const fresh = (await loadHoldings())
      .find(s => s.ticker === stock.ticker && (s.account || "") === (stock.account || ""));
    if (fresh) setLive(fresh);
    setShares(""); setPrice(""); setSellPrice(""); setTradeDate(todayKstStr());
    setEditShares(""); setEditAvg("");
    setLogKey(k => k + 1);
    setOkMsg(mode === "buy" ? "✅ 매수 반영 + 기록 추가"
      : mode === "sell" ? "✅ 매도 반영 + 기록 추가" : "✅ 수정 반영");
  };

  // 그룹 추가/제외만 적용 — 보유 수량/평단과 무관 (창 유지)
  const applyGroups = async () => {
    setErr(""); setOkMsg("");
    const toAdd = [...groupSelection].filter(g => !originalGroups.has(g));
    const toRemove = [...originalGroups].filter(g => !groupSelection.has(g));
    if (toAdd.length === 0 && toRemove.length === 0) return setErr("그룹 변경 사항이 없습니다");
    // 독립(그룹별) 모드 — 새 그룹은 수량/평단 없이 0주로 추가 (그룹마다 별도 입력).
    // sync 모드 — 모든 그룹이 같은 값이어야 하므로 현재 보유값 복사.
    for (const g of toAdd) {
      const stockForGroup: Stock = independent
        ? { ...cur, shares: 0, avg_price: 0, invested: 0, buy_date: "", account: g }
        : cur;
      await upsertHoldingToGroup(stockForGroup, g);
    }
    for (const g of toRemove) await removeHolding(stock.ticker, g);
    setOriginalGroups(new Set(groupSelection));
    onChanged();
    setOkMsg("✅ 그룹 변경 반영");
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
          <h2 className="text-lg font-bold inline-flex items-center gap-1.5">
            <Settings size={18} strokeWidth={2.2} className="text-slate-700" /> 보유 수정
          </h2>
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
            {tabBtn("edit", "⚙️ 직접수정")}
          </div>

          <div className="text-[11px] text-blue-700 bg-blue-50 border border-blue-200
                          rounded px-2 py-1">
            💡 {independent
              ? <><b>그룹별 독립 보유</b>가 설정되어 있어, 이 변경은 현재 선택된 그룹 <b>"{stock.account}"</b>에만 적용됩니다</>
              : <>이 변경은 <b>같은 종목의 모든 그룹</b>에 동일하게 적용됩니다</>}
            {curShares > 0 && " (전량 매도해도 0주로 보관 — 삭제 안 됨)"}
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
              <Field label="매수일 (기본 오늘)">
                <input type="date" value={tradeDate}
                       onChange={e => setTradeDate(e.target.value)}
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
              <Field label="매도가 (기록용·선택)">
                <input type="number" inputMode="numeric" value={sellPrice}
                       onChange={e => setSellPrice(e.target.value)}
                       placeholder={curPrice ? `예: ${curPrice} (비우면 현재가)` : "예: 100000"}
                       className={inputCls} />
              </Field>
              <Field label="매도일 (기본 오늘)">
                <input type="date" value={tradeDate}
                       onChange={e => setTradeDate(e.target.value)}
                       className={inputCls} />
              </Field>
              <button onClick={() => setShares(String(curShares))}
                      className="text-xs text-blue-600 hover:underline">
                전량 매도
              </button>
              {shares && Number(shares) > 0 && Number(shares) <= curShares && (
                <div className="text-xs text-gray-500 mt-1">
                  → 잔여 {(curShares - Number(shares)).toLocaleString()}주
                  {Number(shares) === curShares && " (전량 매도 시 0주로 보관 — 삭제 안 됨)"}
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

          {/* 매수/매도/수정 적용 — 창 유지(매수/매도는 닫지 않음). 그룹 변경과 분리된 버튼 */}
          <button onClick={() => void applyMode()}
                  className="w-full py-2 rounded text-sm font-bold text-white transition
                             bg-blue-600 hover:bg-blue-700">
            {mode === "buy" ? "➕ 매수 적용 (기록 추가)"
              : mode === "sell" ? "➖ 매도 적용 (기록 추가)"
              : "⚙️ 직접수정 적용"}
          </button>

          {/* 📒 거래 기록 — 매수/매도 바로 아래. 보유와 별개 로그(추가/수정/삭제는 보유 무관) */}
          <TradeLogSection ticker={stock.ticker} account={stock.account} refreshKey={logKey} />

          {/* 그룹 토글 — 클릭 = 추가/제외, [그룹 적용] 으로 별도 반영 */}
          <div className="border-t pt-3 space-y-1.5">
            <label className="text-xs font-bold text-gray-700 block">
              이 종목이 속한 그룹 (클릭 = 추가/제외)
            </label>
            <p className="text-[11px] text-gray-500 leading-relaxed">
              체크된 그룹 = 이 종목이 포함된 그룹입니다. 클릭으로 넣거나 빼고 <b>[적용]</b> 시 반영됩니다.
              {independent && (
                <><br />그룹별 독립 보유가 설정되어 있어 수량과 매수가가 선택한 그룹 전체에 적용되지는 않습니다.</>
              )}
            </p>
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
            {/* 그룹 변경만 적용 — 보유 수량/평단과 무관 */}
            <button onClick={() => void applyGroups()}
                    className="w-full mt-1 py-1.5 rounded text-sm font-bold transition
                               bg-gray-700 hover:bg-gray-800 text-white">
              📁 그룹 변경 적용
            </button>
          </div>

          {okMsg && (
            <div className="text-sm text-emerald-700 bg-emerald-50 px-2 py-1 rounded">{okMsg}</div>
          )}
          {err && (
            <div className="text-sm text-rose-700 bg-rose-50 px-2 py-1 rounded">{err}</div>
          )}
        </div>

        <footer className="px-5 py-3 border-t bg-gray-50 flex justify-end gap-2">
          <button onClick={onClose}
                  className="px-4 py-1.5 bg-gray-100 hover:bg-gray-200
                             text-gray-700 rounded text-sm font-medium">
            닫기
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
