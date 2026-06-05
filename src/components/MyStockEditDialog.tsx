// 내주식(합산)에서 한 종목의 보유를 그룹별로 한 번에 수정.
//  · sync 모드(기본): 값은 하나 — 수정하면 모든 그룹에 동일하게 반영(보여짐).
//  · 독립(그룹별) 모드: 그룹마다 값이 달라서 그룹별 행으로 각각 수정.
import { useEffect, useMemo, useState } from "react";
import { loadHoldings, updateHolding, syncAllRowsForTicker } from "../lib/db";
import { getIndependentGroupsMode } from "../lib/groupMode";
import { useEscClose } from "../lib/useEscClose";
import type { Stock } from "../types";

interface RowState { account: string; orig: Stock; shares: string; avg: string }

export function MyStockEditDialog({ ticker, name, onClose, onChanged }: {
  ticker: string; name: string; onClose: () => void; onChanged: () => void;
}) {
  const independent = useMemo(() => getIndependentGroupsMode(), []);
  const [rows, setRows] = useState<RowState[] | null>(null);
  const [single, setSingle] = useState<{ shares: string; avg: string }>({ shares: "", avg: "" });
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");

  useEscClose(true, onClose);

  useEffect(() => {
    void (async () => {
      const all = await loadHoldings();
      // 실제 그룹만 (빈 계좌/관심ETF 제외), 그룹명 가나다
      const mine = all
        .filter(s => s.ticker === ticker && (s.account || "") !== "" && s.account !== "관심ETF")
        .sort((a, b) => (a.account || "").localeCompare(b.account || ""));
      setRows(mine.map(s => ({
        account: s.account || "", orig: s,
        shares: String(s.shares), avg: String(s.avg_price),
      })));
      const f = mine[0];
      if (f) setSingle({ shares: String(f.shares), avg: String(f.avg_price) });
    })();
  }, [ticker]);

  const setRow = (account: string, patch: Partial<Pick<RowState, "shares" | "avg">>) =>
    setRows(prev => prev?.map(r => r.account === account ? { ...r, ...patch } : r) ?? prev);

  const saveIndependent = async () => {
    setErr(""); setOkMsg("");
    if (!rows || rows.length === 0) return;
    let n = 0;
    for (const r of rows) {
      const sh = Number(r.shares), ap = Number(r.avg);
      if (!Number.isFinite(sh) || sh < 0 || !Number.isFinite(ap) || ap < 0) continue;
      await updateHolding({ ...r.orig, shares: sh, avg_price: ap, invested: Math.round(sh * ap) });
      n += 1;
    }
    setOkMsg(`✅ ${n}개 그룹 보유 수정`);
    onChanged();
    onClose();
  };

  const saveSync = async () => {
    setErr(""); setOkMsg("");
    const sh = Number(single.shares), ap = Number(single.avg);
    if (!Number.isFinite(sh) || sh < 0 || !Number.isFinite(ap) || ap < 0) {
      setErr("수량·평단가를 확인하세요"); return;
    }
    await syncAllRowsForTicker(ticker, { shares: sh, avg_price: ap });
    setOkMsg("✅ 전체 그룹에 동일 적용");
    onChanged();
    onClose();
  };

  const groups = rows?.map(r => r.account) ?? [];

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[90vh] flex flex-col">
        <header className="px-5 py-3 border-b flex items-center gap-2">
          <h2 className="font-bold text-gray-800 truncate">📦 {name} <span className="text-xs font-normal text-gray-400">{ticker}</span></h2>
          <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-700 text-xl leading-none">✕</button>
        </header>

        <div className="px-5 py-4 overflow-y-auto flex flex-col gap-3">
          {rows === null ? (
            <div className="text-center text-sm text-gray-400 py-8">불러오는 중…</div>
          ) : rows.length === 0 ? (
            <div className="text-center text-sm text-gray-400 py-8">보유 그룹이 없습니다.</div>
          ) : independent ? (
            <>
              <p className="text-[11px] text-gray-500">
                <b>그룹별 독립 보유</b> — 그룹마다 보유수량/평단가가 다릅니다. 각각 수정하세요.
              </p>
              <table className="w-full text-xs tabular-nums">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-200">
                    <th className="text-left font-medium py-1">그룹</th>
                    <th className="text-right font-medium py-1">보유수량</th>
                    <th className="text-right font-medium py-1">평단가</th>
                    <th className="py-1 w-7"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.account} className="border-b border-gray-100">
                      <td className="py-1.5 pr-2 text-gray-700 truncate max-w-[120px]" title={r.account}>📁 {r.account}</td>
                      <td className="py-1.5 text-right">
                        <input type="number" inputMode="numeric" value={r.shares}
                               onChange={e => setRow(r.account, { shares: e.target.value })}
                               className="border rounded px-1.5 py-1 w-24 text-right focus:outline-none focus:border-blue-500" />
                      </td>
                      <td className="py-1.5 pl-2 text-right">
                        <input type="number" inputMode="numeric" value={r.avg}
                               onChange={e => setRow(r.account, { avg: e.target.value })}
                               className="border rounded px-1.5 py-1 w-24 text-right focus:outline-none focus:border-blue-500" />
                      </td>
                      <td className="py-1.5 pl-1 text-right">
                        <button onClick={() => setRow(r.account, { shares: "0", avg: "0" })}
                                title="이 그룹 보유 0으로 (저장 시 반영)"
                                className="text-gray-400 hover:text-rose-600">🗑</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <>
              <p className="text-[11px] text-gray-500">
                이 종목은 <b>모든 그룹이 동일한 값</b>으로 표시됩니다(sync). 한 번 수정하면 전 그룹에 똑같이 반영됩니다.
              </p>
              <div className="flex flex-wrap gap-1">
                {groups.map(g => (
                  <span key={g} className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">📁 {g}</span>
                ))}
              </div>
              <label className="flex items-center justify-between gap-2 text-sm">
                <span className="text-gray-600">보유수량</span>
                <input type="number" inputMode="numeric" value={single.shares}
                       onChange={e => setSingle(s => ({ ...s, shares: e.target.value }))}
                       className="border rounded px-2 py-1 w-32 text-right tabular-nums focus:outline-none focus:border-blue-500" />
              </label>
              <label className="flex items-center justify-between gap-2 text-sm">
                <span className="text-gray-600">평단가</span>
                <input type="number" inputMode="numeric" value={single.avg}
                       onChange={e => setSingle(s => ({ ...s, avg: e.target.value }))}
                       className="border rounded px-2 py-1 w-32 text-right tabular-nums focus:outline-none focus:border-blue-500" />
              </label>
              <button onClick={() => setSingle({ shares: "0", avg: "0" })}
                      className="self-end text-xs text-gray-400 hover:text-rose-600">🗑 보유 0으로</button>
            </>
          )}

          {err && <div className="text-xs text-rose-600">{err}</div>}
          {okMsg && <div className="text-xs text-emerald-600">{okMsg}</div>}
        </div>

        <footer className="px-5 py-3 border-t flex items-center">
          {rows && rows.length > 0 && (
            <button onClick={() => void (independent ? saveIndependent() : saveSync())}
                    className="ml-auto px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium">
              저장
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
