// 구매대기 관리 팝업 — 현재 그룹 보유 종목을 골라 수량×주문가로 건별 추가/삭제.
//   카드엔 총액만, 여기서 목록 관리. 그룹(account)별 저장(deposits.ts).
import { useState } from "react";
import type { Stock } from "../types";
import { getPendingItems, setPendingItems, type PendingBuyItem } from "../lib/deposits";

interface Props {
  account: string;
  holdings: Stock[];      // 현재 그룹 종목(종목 선택 목록)
  onClose: () => void;
  onChange: () => void;   // 저장 후 부모(총자산) 갱신
}

let seq = 0;
const newId = () => `pb-${Date.now().toString(36)}-${(seq++).toString(36)}`;
const won = (n: number) => `${Math.round(n).toLocaleString()}원`;

export function PendingBuysDialog({ account, holdings, onClose, onChange }: Props) {
  const [items, setItems] = useState<PendingBuyItem[]>(() => getPendingItems(account));
  // 종목 후보 — 현재 그룹의 종목명(중복 제거). 직접입력도 허용.
  const names = Array.from(new Set(holdings.filter(s => s.name || s.ticker).map(s => s.name || s.ticker)));
  const [name, setName] = useState("");
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");

  const total = items.reduce((a, x) => a + x.qty * x.price, 0);

  const num = (s: string) => Number(String(s).replace(/[, ]/g, "")) || 0;
  const persist = (next: PendingBuyItem[]) => {
    setItems(next);
    setPendingItems(account, next);   // 유효 건(qty>0·price>0)만 저장
    onChange();
  };
  const add = () => {
    const q = num(qty), p = num(price);
    if (!(q > 0) || !(p > 0)) return;
    persist([...items, { id: newId(), name: name.trim() || undefined, qty: q, price: Math.round(p) }]);
    setName(""); setQty(""); setPrice("");
  };
  const remove = (id: string) => persist(items.filter(x => x.id !== id));
  // 인라인 수정 — 종목/수량/주문가. 편집 중 0/빈값 허용(로컬 유지), 저장은 유효 건만.
  const update = (id: string, patch: Partial<PendingBuyItem>) =>
    persist(items.map(x => (x.id === id ? { ...x, ...patch } : x)));

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
         onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-xl shadow-xl p-4 max-h-[85vh] overflow-auto"
           onClick={e => e.stopPropagation()}>
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="text-base font-bold text-gray-800">🔒 구매대기 관리</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-lg leading-none">✕</button>
        </div>

        {/* 목록 */}
        {items.length === 0 ? (
          <div className="text-xs text-gray-400 py-4 text-center">등록된 구매대기가 없어요. 아래에서 추가하세요.</div>
        ) : (
          <div className="divide-y divide-gray-100 mb-2">
            {items.map(x => (
              <div key={x.id} className="flex items-center gap-1 py-1.5 text-sm">
                <input list="pending-names" value={x.name ?? ""} placeholder="종목"
                       onChange={e => update(x.id, { name: e.target.value.trim() || undefined })}
                       className="flex-1 min-w-0 border border-transparent hover:border-gray-200 focus:border-blue-500 rounded px-1 py-0.5 text-gray-700 focus:outline-none" />
                <input inputMode="numeric" value={x.qty || ""} placeholder="수량"
                       onChange={e => update(x.id, { qty: num(e.target.value) })}
                       className="w-14 border border-transparent hover:border-gray-200 focus:border-blue-500 rounded px-1 py-0.5 text-right tabular-nums focus:outline-none" />
                <span className="text-gray-400 text-xs">×</span>
                <input inputMode="numeric" value={x.price || ""} placeholder="주문가"
                       onChange={e => update(x.id, { price: num(e.target.value) })}
                       className="w-20 border border-transparent hover:border-gray-200 focus:border-blue-500 rounded px-1 py-0.5 text-right tabular-nums focus:outline-none" />
                <span className="w-24 text-right font-medium tabular-nums whitespace-nowrap text-gray-700">{won(x.qty * x.price)}</span>
                <button onClick={() => remove(x.id)} title="삭제"
                        className="text-gray-300 hover:text-rose-500 text-sm leading-none px-1">✕</button>
              </div>
            ))}
          </div>
        )}

        {/* 총액 */}
        <div className="flex items-baseline justify-between border-t border-gray-200 pt-2 mb-3">
          <span className="text-xs text-gray-500">총 구매대기</span>
          <span className="text-lg font-bold text-gray-800 tabular-nums">{won(total)}</span>
        </div>

        {/* 추가 — 종목(현재 그룹 목록) + 수량 × 주문가 */}
        <div className="bg-gray-50 rounded-lg p-2.5 space-y-2">
          <div className="text-[11px] text-gray-500 font-medium">건 추가</div>
          <input list="pending-names" value={name} onChange={e => setName(e.target.value)}
                 placeholder="종목 (현재 그룹에서 선택 / 직접입력)"
                 className="w-full border rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-500" />
          <datalist id="pending-names">
            {names.map(n => <option key={n} value={n} />)}
          </datalist>
          <div className="flex items-center gap-1.5">
            <input inputMode="numeric" value={qty} onChange={e => setQty(e.target.value)}
                   onKeyDown={e => e.key === "Enter" && add()} placeholder="수량"
                   className="w-20 border rounded px-2 py-1 text-sm text-right focus:outline-none focus:border-blue-500" />
            <span className="text-gray-400 text-sm">주 ×</span>
            <input inputMode="numeric" value={price} onChange={e => setPrice(e.target.value)}
                   onKeyDown={e => e.key === "Enter" && add()} placeholder="주문가"
                   className="flex-1 min-w-0 border rounded px-2 py-1 text-sm text-right focus:outline-none focus:border-blue-500" />
            <span className="text-gray-400 text-sm">원</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500 tabular-nums">
              {(() => {
                const q = Number(qty.replace(/[, ]/g, "")), p = Number(price.replace(/[, ]/g, ""));
                return q > 0 && p > 0 ? `= ${won(q * p)}` : "";
              })()}
            </span>
            <button onClick={add}
                    className="px-3 py-1 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-40"
                    disabled={!(Number(qty.replace(/[, ]/g, "")) > 0 && Number(price.replace(/[, ]/g, "")) > 0)}>
              추가
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PendingBuysDialog;
