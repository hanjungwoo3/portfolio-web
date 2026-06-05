// 내거래 — 모든 종목의 거래 기록(trades)을 한 곳에 모아 보는 탭.
// 분류(전체 시간순 / 종목별 / 날짜별) + 정렬방향 선택. 인라인 수정/삭제 지원.
// 보유(수량/평단)와 무관 — 여기서 고쳐도 보유엔 영향 없음.
import { useEffect, useMemo, useState } from "react";
import { Table2 } from "lucide-react";
import { loadAllTrades, updateTrade, deleteTrade, type Trade } from "../lib/db";
import { getIndependentGroupsMode } from "../lib/groupMode";
import type { Stock } from "../types";

type ViewMode = "recent" | "byStock" | "byDate";
type Dir = "desc" | "asc";
type Period = "week" | "month" | "year" | "all";

interface EditForm { type: "buy" | "sell"; date: string; qty: string; amount: string }

// 기간 필터 — 오늘(KST) 기준 롤링 윈도우 시작일(YYYYMMDD). all 이면 제한 없음.
function periodCutoff(p: Period): string | null {
  if (p === "all") return null;
  const d = new Date(Date.now() + 9 * 3600_000); // KST
  if (p === "week") d.setDate(d.getDate() - 7);
  else if (p === "month") d.setMonth(d.getMonth() - 1);
  else d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

export function MyTradesTab({ holdings, pc = false }: { holdings: Stock[]; pc?: boolean }) {
  const [trades, setTrades] = useState<Trade[] | null>(null);
  const [mode, setMode] = useState<ViewMode>("recent");
  const [dir, setDir] = useState<Dir>("asc");   // 기본 오래된→최신 (마지막 거래가 맨 아래)
  const [period, setPeriod] = useState<Period>("all");
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<EditForm | null>(null);

  const reload = async () => setTrades(await loadAllTrades());
  useEffect(() => { void reload(); }, []);

  // 그룹별 독립보유 모드 — 종목명 아래에 거래의 그룹(account) 표시
  const independent = getIndependentGroupsMode();

  // 기간 필터 적용 — 분류/요약/합계 모두 이 결과 기준
  const filtered = useMemo(() => {
    const all = trades ?? [];
    const cutoff = periodCutoff(period);
    if (!cutoff) return all;
    return all.filter(t => t.date.replace(/\D/g, "") >= cutoff);
  }, [trades, period]);

  // ticker → 종목명 (보유 목록에서). 없으면 코드 그대로.
  const nameOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const h of holdings) if (h.name && !m.has(h.ticker)) m.set(h.ticker, h.name);
    return (t: string) => m.get(t) ?? t;
  }, [holdings]);

  const sortByDate = (a: Trade, b: Trade) => {
    const c = a.date.localeCompare(b.date);
    const base = c !== 0 ? c : (a.createdAt ?? 0) - (b.createdAt ?? 0);
    return dir === "desc" ? -base : base;
  };

  const summary = useMemo(() => {
    let buy = 0, sell = 0, buyN = 0, sellN = 0;
    for (const t of filtered) {
      if (t.type === "buy") { buy += t.amount; buyN++; }
      else { sell += t.amount; sellN++; }
    }
    return { buy, sell, buyN, sellN, total: filtered.length };
  }, [filtered]);

  const startEdit = (t: Trade) => {
    setEditId(t.id);
    setForm({ type: t.type, date: t.date, qty: String(t.qty), amount: String(t.amount) });
  };
  const cancelEdit = () => { setEditId(null); setForm(null); };
  const saveEdit = async (orig: Trade) => {
    if (!form) return;
    const qty = Number(form.qty), amount = Number(form.amount);
    if (!(qty > 0) || !(amount > 0) || !form.date) return;
    await updateTrade({ ...orig, type: form.type, date: form.date, qty, amount });
    cancelEdit();
    await reload();
  };
  const remove = async (id: string) => {
    if (confirm("이 거래 기록을 삭제할까요? (보유엔 영향 없음)")) { await deleteTrade(id); await reload(); }
  };

  if (trades === null) {
    return <div className="text-center py-12 text-gray-400 text-sm">불러오는 중…</div>;
  }
  if (trades.length === 0) {
    return (
      <div className="text-center py-16 text-gray-500">
        <div className="text-4xl mb-3">🧾</div>
        <p>아직 거래 기록이 없습니다.<br />
          각 종목의 <b>보유 수정 → 매수/매도</b> 또는 <b>거래 기록</b>에서 추가하세요.</p>
      </div>
    );
  }

  // 행 묶음의 매수/매도 수량·금액 합계
  const totalsOf = (rows: Trade[]) => {
    let buyQty = 0, buyAmt = 0, sellQty = 0, sellAmt = 0;
    for (const t of rows) {
      if (t.type === "buy") { buyQty += t.qty; buyAmt += t.amount; }
      else { sellQty += t.qty; sellAmt += t.amount; }
    }
    return { buyQty, buyAmt, sellQty, sellAmt };
  };

  const won = (n: number) => n.toLocaleString();

  // ── 표시 행 모델 ──
  // 모든 거래를 다 표시. 그룹 키(날짜/종목)는 그룹의 첫 행에만 한 번 표시(나머지 빈칸).
  // 전체: 그룹 없음(둘 다 매행 표시) / 날짜별: 날짜로 묶음 / 종목별: 종목으로 묶음.
  type DRow = { t: Trade; showName: boolean; showDate: boolean; groupStart: boolean };
  const buildRows = (m: ViewMode): DRow[] => {
    if (m === "recent") {
      return [...filtered].sort(sortByDate)
        .map(t => ({ t, showName: true, showDate: true, groupStart: false }));
    }
    const byName = (a: Trade, b: Trade) => nameOf(a.ticker).localeCompare(nameOf(b.ticker));
    const byAcct = (a: Trade, b: Trade) => (a.account ?? "").localeCompare(b.account ?? "");
    const sorted = [...filtered].sort((a, b) =>
      m === "byStock" ? (byName(a, b) || (independent ? byAcct(a, b) : 0) || sortByDate(a, b))
                      : (sortByDate(a, b) || byName(a, b)));
    // 독립모드 종목별 묶음은 종목+그룹 단위로 (그룹마다 별도 보유라서)
    const keyOf = (t: Trade) =>
      m === "byStock" ? (independent ? `${t.ticker}␟${t.account ?? ""}` : t.ticker) : t.date;
    let prev: string | null = null;
    return sorted.map(t => {
      const k = keyOf(t);
      const groupStart = k !== prev;
      prev = k;
      return {
        t,
        showName: m === "byStock" ? groupStart : true,   // 종목별: 종목 한 번만
        showDate: m === "byDate" ? groupStart : true,    // 날짜별: 날짜 한 번만
        groupStart,
      };
    });
  };

  // 매수/매도 금액 셀 — 값 있으면 금액+수량·단가, 없으면 빈칸
  const valueCell = (qty: number, amt: number, kind: "buy" | "sell") => {
    if (qty <= 0) return <td className="py-1 px-1.5"></td>;
    const color = kind === "buy" ? "text-rose-600" : "text-blue-600";
    return (
      <td className="py-1 px-1.5 text-right">
        <div className={`font-medium ${color}`}>{won(amt)}</div>
        <div className="text-[10px] text-gray-400">{won(qty)}주 · {won(Math.round(amt / qty))}</div>
      </td>
    );
  };

  const actionsCell = (t: Trade) => (
    <td className="py-1 px-1.5 text-right whitespace-nowrap">
      <button onClick={() => startEdit(t)} title="수정" className="text-gray-400 hover:text-blue-600 mr-1.5">✎</button>
      <button onClick={() => void remove(t.id)} title="삭제" className="text-gray-400 hover:text-rose-600">🗑</button>
    </td>
  );

  // 편집 행 — 한 줄 인라인 에디터 (개별 거래만)
  const renderEditRow = (t: Trade) => form && (
    <tr key={t.id} className="border-b border-blue-100 bg-blue-50/40">
      <td className="py-1.5 px-1.5" colSpan={5}>
        <div className="flex items-center flex-wrap gap-1.5">
          <span className="text-gray-700 font-medium mr-1">{nameOf(t.ticker)}</span>
          <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value as "buy" | "sell" })}
                  className="border rounded px-1 py-0.5 text-[11px]">
            <option value="buy">매수</option>
            <option value="sell">매도</option>
          </select>
          <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })}
                 className="border rounded px-1 py-0.5 text-[11px]" />
          <input type="number" inputMode="numeric" value={form.qty} placeholder="수량"
                 onChange={e => setForm({ ...form, qty: e.target.value })}
                 className="border rounded px-1 py-0.5 w-16 text-right text-[11px] tabular-nums" />
          <input type="number" inputMode="numeric" value={form.amount} placeholder="금액(원)"
                 onChange={e => setForm({ ...form, amount: e.target.value })}
                 className="border rounded px-1 py-0.5 w-24 text-right text-[11px] tabular-nums" />
          <span className="ml-auto whitespace-nowrap">
            <button onClick={() => void saveEdit(t)} className="text-blue-600 hover:underline mr-1.5">저장</button>
            <button onClick={cancelEdit} className="text-gray-400 hover:underline">취소</button>
          </span>
        </div>
      </td>
    </tr>
  );

  const renderDataRow = (r: DRow) => {
    const t = r.t;
    if (editId === t.id && form) return renderEditRow(t);
    const top = r.groupStart ? "border-t border-gray-300" : "border-t border-gray-100";
    return (
      <tr key={t.id} className={`${top} hover:bg-gray-50 align-top`}>
        <td className="py-1 px-1.5 text-gray-700" title={r.showName ? nameOf(t.ticker) : ""}>
          {r.showName && (
            <>
              <div className="truncate">{nameOf(t.ticker)}</div>
              {independent && t.account && (
                <div className="text-[10px] text-gray-400 truncate">{t.account}</div>
              )}
            </>
          )}
        </td>
        <td className="py-1 px-1.5 text-gray-500 whitespace-nowrap">{r.showDate ? t.date : ""}</td>
        {valueCell(t.type === "buy" ? t.qty : 0, t.type === "buy" ? t.amount : 0, "buy")}
        {valueCell(t.type === "sell" ? t.qty : 0, t.type === "sell" ? t.amount : 0, "sell")}
        {actionsCell(t)}
      </tr>
    );
  };

  // 한 패널(모드) — 종목·날짜·매수·매도 단일 표 + 하단 합계
  const colW = ["27%", "17%", "23%", "23%", "10%"];
  const renderPanel = (m: ViewMode) => {
    const rows = buildRows(m);
    const gt = totalsOf(filtered);
    return (
      <table className="w-full table-fixed text-[11px] tabular-nums border-collapse border border-gray-200 rounded-md">
        <colgroup>{colW.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
        <thead>
          <tr className="text-gray-400 border-b border-gray-200 bg-white">
            <th className="text-left font-medium py-1 px-1.5">종목</th>
            <th className="text-left font-medium py-1 px-1.5">날짜</th>
            <th className="text-right font-medium py-1 px-1.5 text-rose-500">매수</th>
            <th className="text-right font-medium py-1 px-1.5 text-blue-500">매도</th>
            <th className="py-1 px-1.5"></th>
          </tr>
        </thead>
        <tbody>{rows.map(renderDataRow)}</tbody>
        <tfoot className="bg-gray-50/70">
          <tr className="border-t border-gray-300 font-medium">
            <td className="py-1 px-1.5 text-[10px] text-gray-500">합계</td>
            <td className="py-1 px-1.5"></td>
            <td className="py-1 px-1.5 text-right text-rose-600">{gt.buyQty > 0 ? won(gt.buyAmt) : ""}</td>
            <td className="py-1 px-1.5 text-right text-blue-600">{gt.sellQty > 0 ? won(gt.sellAmt) : ""}</td>
            <td className="py-1 px-1.5"></td>
          </tr>
        </tfoot>
      </table>
    );
  };

  const PC_PANELS: { m: ViewMode; label: string }[] = [
    { m: "recent", label: "전체 (시간순)" },
    { m: "byDate", label: "날짜별" },
    { m: "byStock", label: "종목별" },
  ];

  return (
    <div className="space-y-3">
      {/* 컨트롤 바 + 요약 */}
      <div className="flex items-center flex-wrap gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 font-bold text-gray-700">
          <Table2 size={15} className="text-emerald-600" /> 내거래
          <span className="text-gray-400 font-normal">({summary.total})</span>
        </span>
        <select value={period} onChange={e => { setPeriod(e.target.value as Period); cancelEdit(); }}
                title="기간 — 오늘 기준"
                className="border border-gray-300 rounded px-1.5 py-1 bg-white text-gray-700 focus:outline-none cursor-pointer">
          <option value="week">최근 1주</option>
          <option value="month">최근 1개월</option>
          <option value="year">최근 1년</option>
          <option value="all">전체</option>
        </select>
        {/* 분류 — 모바일만 (PC 는 3패널 동시 표시) */}
        {!pc && (
          <select value={mode} onChange={e => { setMode(e.target.value as ViewMode); cancelEdit(); }}
                  className="border border-gray-300 rounded px-1.5 py-1 bg-white text-gray-700 focus:outline-none cursor-pointer">
            <option value="recent">전체 시간순</option>
            <option value="byStock">종목별</option>
            <option value="byDate">날짜별</option>
          </select>
        )}
        <button onClick={() => setDir(d => d === "desc" ? "asc" : "desc")}
                title="날짜 정렬 방향"
                className="px-2 py-1 rounded border border-gray-300 bg-white text-gray-600 hover:bg-gray-50">
          {dir === "desc" ? "↓ 최신순" : "↑ 오래된순"}
        </button>
        <span className="ml-auto tabular-nums text-gray-600">
          <span className="text-rose-600 font-medium">매수 {won(summary.buy)}</span>
          <span className="mx-1.5 text-gray-300">·</span>
          <span className="text-blue-600 font-medium">매도 {won(summary.sell)}</span>
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center text-xs text-gray-400 py-10">
          이 기간에 거래 기록이 없습니다.
        </div>
      ) : pc ? (
        // PC — 전체 / 날짜별 / 종목별 3패널 동시
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-start">
          {PC_PANELS.map(({ m, label }) => (
            <div key={m} className="min-w-0">
              <div className="text-xs font-bold text-gray-600 mb-1.5 px-0.5 pb-1 border-b border-gray-200">{label}</div>
              {renderPanel(m)}
            </div>
          ))}
        </div>
      ) : (
        renderPanel(mode)
      )}
    </div>
  );
}
