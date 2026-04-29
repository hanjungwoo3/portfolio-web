import { useRef, useState } from "react";
import type { Stock } from "../types";
import { updateHolding, removeHolding } from "../lib/db";

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
  const [mode, setMode] = useState<Mode>("buy");
  const [shares, setShares] = useState("");
  const [price, setPrice] = useState("");
  const [date, setDate] = useState(todayKstStr());
  const [editShares, setEditShares] = useState("");
  const [editAvg, setEditAvg] = useState("");
  const [editDate, setEditDate] = useState("");
  const [err, setErr] = useState("");
  const downOnBackdropRef = useRef(false);

  if (!isOpen || !stock) return null;

  const curShares = stock.shares;
  const curAvg = stock.avg_price;
  const curInvested = stock.invested ?? Math.round(curShares * curAvg);

  const apply = async () => {
    setErr("");
    if (mode === "buy") {
      const sh = Number(shares);
      const pr = Number(price);
      if (!Number.isFinite(sh) || sh <= 0) return setErr("추가 수량 입력");
      if (!Number.isFinite(pr) || pr <= 0) return setErr("매수가 입력");
      const newShares = curShares + sh;
      const newInvested = curInvested + Math.round(sh * pr);
      const newAvg = Math.round(newInvested / newShares);
      await updateHolding({
        ...stock, shares: newShares, avg_price: newAvg, invested: newInvested,
        buy_date: date || stock.buy_date || todayKstStr(),
      });
    } else if (mode === "sell") {
      const sh = Number(shares);
      if (!Number.isFinite(sh) || sh <= 0) return setErr("매도 수량 입력");
      if (sh > curShares) return setErr(`보유 ${curShares}주를 초과`);
      const newShares = curShares - sh;
      if (newShares === 0) {
        await removeHolding(stock.ticker, stock.account || "");
      } else {
        // 한국 관행 — 평균가 유지, 투자금만 비례 감소
        const newInvested = Math.round(newShares * curAvg);
        await updateHolding({
          ...stock, shares: newShares, invested: newInvested,
        });
      }
    } else {
      // 직접수정
      const sh = Number(editShares || curShares);
      const ap = Number(editAvg || curAvg);
      if (!Number.isFinite(sh) || sh < 0) return setErr("수량 오류");
      if (!Number.isFinite(ap) || ap <= 0) return setErr("매수가 오류");
      if (sh === 0) {
        await removeHolding(stock.ticker, stock.account || "");
      } else {
        await updateHolding({
          ...stock, shares: sh, avg_price: ap,
          invested: Math.round(sh * ap),
          buy_date: editDate || stock.buy_date || todayKstStr(),
        });
      }
    }
    onChanged();
    onClose();
    // reset
    setShares(""); setPrice(""); setDate(todayKstStr());
    setEditShares(""); setEditAvg(""); setEditDate("");
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
    <div className="fixed inset-0 z-50 flex items-center justify-center
                     bg-black/40 p-4"
         onMouseDown={e => { downOnBackdropRef.current = e.target === e.currentTarget; }}
         onClick={e => {
           if (e.target === e.currentTarget && downOnBackdropRef.current) onClose();
         }}>
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
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
              <span className="tabular-nums">{curAvg.toLocaleString()}원</span>
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
              <Field label="매수일">
                <input type="date" value={date}
                       onChange={e => setDate(e.target.value)}
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
                       placeholder={String(curAvg)} className={inputCls} />
              </Field>
              <Field label="매수일">
                <input type="date" value={editDate}
                       onChange={e => setEditDate(e.target.value)}
                       placeholder={stock.buy_date} className={inputCls} />
              </Field>
              <p className="text-xs text-gray-400">
                비워두면 기존 값 유지. 수량을 0 으로 설정하면 보유에서 삭제됩니다.
              </p>
            </div>
          )}

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
