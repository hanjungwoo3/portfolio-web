// 거래 기록 섹션 — 보유(수량/평단)와 별개의 매수/매도 로그 (엑셀형 표).
// 추가/수정/삭제는 trades 테이블만 건드리고 보유엔 영향 없음.
import { useCallback, useEffect, useState } from "react";
import { Table2 } from "lucide-react";
import { getTradesForTicker, addTrade, updateTrade, deleteTrade, type Trade } from "../lib/db";

function todayKstStr(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

// unit=주당가, amount=총액 — 둘 다 입력칸. 한쪽 입력 시 수량 기준으로 나머지 자동 계산.
//  last: 직접 친 칸(unit|amount) — 수량 바뀌면 이 칸은 유지하고 반대편을 다시 계산.
interface FormState { type: "buy" | "sell"; date: string; qty: string; unit: string; amount: string; last: "unit" | "amount" }
const emptyForm = (): FormState => ({ type: "buy", date: todayKstStr(), qty: "", unit: "", amount: "", last: "amount" });

// 수량/주당가/총액 상호 계산 — 변경된 필드 기준으로 파생값 갱신
function recalc(f: FormState, field: "qty" | "unit" | "amount", v: string): FormState {
  const next = { ...f, [field]: v };
  const q = Number(field === "qty" ? v : next.qty);
  if (field === "unit") { next.last = "unit"; if (q > 0 && Number(v) > 0) next.amount = String(Math.round(Number(v) * q)); }
  else if (field === "amount") { next.last = "amount"; if (q > 0 && Number(v) > 0) next.unit = String(Math.round(Number(v) / q)); }
  else { // qty 변경 — 마지막에 친 칸 유지, 반대편 재계산
    if (q > 0) {
      if (next.last === "unit" && Number(next.unit) > 0) next.amount = String(Math.round(Number(next.unit) * q));
      else if (Number(next.amount) > 0) next.unit = String(Math.round(Number(next.amount) / q));
    }
  }
  return next;
}

export function TradeLogSection({ ticker, account, refreshKey, defaultOpen }:
  { ticker: string; account?: string; refreshKey?: number; defaultOpen?: boolean }) {
  const [trades, setTrades] = useState<Trade[] | null>(null);
  const [open, setOpen] = useState(!!defaultOpen);
  const [editId, setEditId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);

  // 같은 종목이라도 거래는 그룹(계좌)별로 다름 — (종목+그룹) 단위로만 표시.
  const reload = useCallback(async () => {
    const all = await getTradesForTicker(ticker);
    setTrades(all.filter(t => (t.account ?? "") === (account ?? "")));
  }, [ticker, account]);
  // ticker/account 변경 + 외부 refreshKey(매수/매도 자동기록 후) 시 재로드
  useEffect(() => { void reload(); }, [reload, refreshKey]);

  const reset = () => { setForm(emptyForm()); setEditId(null); setAdding(false); };

  const submit = async () => {
    const qty = Number(form.qty), amount = Number(form.amount);
    if (!(qty > 0) || !(amount > 0) || !form.date) return;
    if (editId) {
      const orig = trades?.find(t => t.id === editId);
      if (orig) await updateTrade({ ...orig, type: form.type, date: form.date, qty, amount });
    } else {
      await addTrade({ ticker, account, type: form.type, date: form.date, qty, amount });
    }
    reset();
    await reload();
  };

  const startEdit = (t: Trade) => {
    setEditId(t.id);
    setAdding(true);
    setForm({ type: t.type, date: t.date, qty: String(t.qty), amount: String(t.amount),
              unit: String(Math.round(t.amount / t.qty)), last: "amount" });
  };
  const remove = async (id: string) => {
    if (confirm("이 거래 기록을 삭제할까요? (보유엔 영향 없음)")) { await deleteTrade(id); await reload(); }
  };

  const count = trades?.length ?? 0;
  return (
    <div className="border border-gray-200 rounded-md p-2.5">
      <button onClick={() => setOpen(o => !o)}
              className="flex items-center gap-1.5 text-xs font-bold text-gray-700 w-full">
        <Table2 size={14} className="text-emerald-600" /> 거래 기록
        <span className="text-gray-400">({count})</span>
        <span className="ml-auto text-gray-400 text-[10px]">{open ? "▲ 접기" : "▼ 펼치기"}</span>
      </button>

      {open && (
        <div className="mt-2">
          <p className="text-[10px] text-gray-400 mb-1.5">
            보유와 별개 로그 — 추가/수정/삭제해도 보유 수량·평단엔 영향 없습니다.
          </p>

          {count > 0 && (
            <table className="w-full text-[11px] tabular-nums border-collapse">
              <thead>
                <tr className="text-gray-400 border-b border-gray-200">
                  <th className="text-left font-medium py-1 px-1">구분</th>
                  <th className="text-left font-medium py-1 px-1">날짜</th>
                  <th className="text-right font-medium py-1 px-1">수량</th>
                  <th className="text-right font-medium py-1 px-1">금액(원)</th>
                  <th className="text-right font-medium py-1 px-1">단가</th>
                  <th className="py-1 px-1 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {trades?.map(t => (
                  <tr key={t.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-1 px-1">
                      <span className={`px-1 rounded text-[10px] font-bold
                                        ${t.type === "buy" ? "bg-rose-50 text-rose-600" : "bg-blue-50 text-blue-600"}`}>
                        {t.type === "buy" ? "매수" : "매도"}
                      </span>
                    </td>
                    <td className="py-1 px-1 text-gray-500">{t.date}</td>
                    <td className="py-1 px-1 text-right">{t.qty.toLocaleString()}</td>
                    <td className="py-1 px-1 text-right font-medium text-gray-700">{t.amount.toLocaleString()}</td>
                    <td className="py-1 px-1 text-right text-gray-400">{Math.round(t.amount / t.qty).toLocaleString()}</td>
                    <td className="py-1 px-1 text-right whitespace-nowrap">
                      <button onClick={() => startEdit(t)} title="수정"
                              className="text-gray-400 hover:text-blue-600 mr-1.5">✎</button>
                      <button onClick={() => remove(t.id)} title="삭제"
                              className="text-gray-400 hover:text-rose-600">🗑</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {count === 0 && !adding && (
            <div className="text-[11px] text-gray-400 py-1">기록이 없습니다.</div>
          )}

          {adding ? (
            <div className="border border-blue-200 bg-blue-50/40 rounded p-2 space-y-1.5 mt-1.5">
              <div className="flex gap-1">
                {(["buy", "sell"] as const).map(tp => (
                  <button key={tp} onClick={() => setForm(f => ({ ...f, type: tp }))}
                          className={`flex-1 text-[11px] py-1 rounded border transition
                                      ${form.type === tp
                                        ? (tp === "buy" ? "bg-rose-600 text-white border-rose-700" : "bg-blue-600 text-white border-blue-700")
                                        : "bg-white text-gray-600 border-gray-300"}`}>
                    {tp === "buy" ? "매수" : "매도"}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-1">
                <input type="date" value={form.date}
                       onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                       className="border rounded px-1 py-0.5 text-[11px] focus:outline-none focus:border-blue-500" />
                <label className="flex items-center gap-1 border rounded px-1 py-0.5 focus-within:border-blue-500">
                  <span className="text-[10px] text-gray-400 shrink-0">수량</span>
                  <input type="number" inputMode="numeric" placeholder="0" value={form.qty}
                         onChange={e => setForm(f => recalc(f, "qty", e.target.value))}
                         className="w-full text-[11px] text-right tabular-nums focus:outline-none" />
                </label>
              </div>
              {/* 주당가 ↔ 총액 — 한 칸 입력 시 수량 기준 자동 계산 */}
              <div className="grid grid-cols-2 gap-1">
                <label className="flex items-center gap-1 border rounded px-1 py-0.5 focus-within:border-blue-500">
                  <span className="text-[10px] text-gray-400 shrink-0">주당가</span>
                  <input type="number" inputMode="numeric" placeholder="0" value={form.unit}
                         onChange={e => setForm(f => recalc(f, "unit", e.target.value))}
                         className="w-full text-[11px] text-right tabular-nums focus:outline-none" />
                </label>
                <label className="flex items-center gap-1 border rounded px-1 py-0.5 focus-within:border-blue-500">
                  <span className="text-[10px] text-gray-400 shrink-0">총액</span>
                  <input type="number" inputMode="numeric" placeholder="0" value={form.amount}
                         onChange={e => setForm(f => recalc(f, "amount", e.target.value))}
                         className="w-full text-[11px] text-right tabular-nums focus:outline-none" />
                </label>
              </div>
              <div className="flex justify-end gap-1.5">
                <button onClick={reset}
                        className="text-[11px] px-2 py-0.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-50">취소</button>
                <button onClick={submit}
                        className="text-[11px] px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-700 text-white">
                  {editId ? "수정 저장" : "추가"}
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => { reset(); setAdding(true); }}
                    className="text-[11px] text-blue-600 hover:underline mt-1.5">+ 기록 추가</button>
          )}
        </div>
      )}
    </div>
  );
}
