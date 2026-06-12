// 내거래 — 모든 종목의 거래 기록(trades)을 한 곳에 모아 보는 탭.
// 분류(전체 시간순 / 종목별 / 날짜별) + 정렬방향 선택. 인라인 수정/삭제 지원.
// 보유(수량/평단)와 무관 — 여기서 고쳐도 보유엔 영향 없음.
import { Fragment, useEffect, useMemo, useState } from "react";
import { Table2, GanttChartSquare } from "lucide-react";
import { loadAllTrades, updateTrade, deleteTrade, type Trade } from "../lib/db";
import { getIndependentGroupsMode } from "../lib/groupMode";
import { formatSigned, signColor, signBg } from "../lib/format";
import { computeRealizedByTrade, realizedChip } from "../lib/tradeCalc";
import { TradeGantt } from "./TradeGantt";
import type { Stock } from "../types";

type ViewMode = "recent" | "byStock" | "byDate";
type Dir = "desc" | "asc";
type Period = "week" | "month" | "year" | "all" | "custom";

// unit=주당가, amount=총액 — 둘 다 입력칸. 한쪽 입력 시 수량 기준 자동 계산.
interface EditForm { type: "buy" | "sell"; date: string; qty: string; unit: string; amount: string; last: "unit" | "amount" }

// 수량/주당가/총액 상호 계산 — 변경 필드 기준 파생값 갱신
function recalcEdit(f: EditForm, field: "qty" | "unit" | "amount", v: string): EditForm {
  const next = { ...f, [field]: v };
  const q = Number(field === "qty" ? v : next.qty);
  if (field === "unit") { next.last = "unit"; if (q > 0 && Number(v) > 0) next.amount = String(Math.round(Number(v) * q)); }
  else if (field === "amount") { next.last = "amount"; if (q > 0 && Number(v) > 0) next.unit = String(Math.round(Number(v) / q)); }
  else if (q > 0) {
    if (next.last === "unit" && Number(next.unit) > 0) next.amount = String(Math.round(Number(next.unit) * q));
    else if (Number(next.amount) > 0) next.unit = String(Math.round(Number(next.amount) / q));
  }
  return next;
}

// 프리셋 → 시작일/종료일(YYYY-MM-DD). 오늘(KST) 종료, 시작은 롤링 윈도우. all=둘 다 빈값(제한 없음).
function presetRange(p: Period): { from: string; to: string } {
  if (p === "all" || p === "custom") return { from: "", to: "" };
  const today = new Date(Date.now() + 9 * 3600_000); // KST
  const to = today.toISOString().slice(0, 10);
  const d = new Date(today);
  if (p === "week") d.setDate(d.getDate() - 7);
  else if (p === "month") d.setMonth(d.getMonth() - 1);
  else d.setFullYear(d.getFullYear() - 1);
  return { from: d.toISOString().slice(0, 10), to };
}

export function MyTradesTab({ holdings, pc = false }: { holdings: Stock[]; pc?: boolean }) {
  const [trades, setTrades] = useState<Trade[] | null>(null);
  const [view, setView] = useState<"chart" | "table">("chart");        // 차트 기본, 상세보기=테이블
  const [scope, setScope] = useState<"all" | "byGroup">("all");        // 차트: 전체 / 그룹별
  const [mode, setMode] = useState<ViewMode>("recent");
  const [dir, setDir] = useState<Dir>("asc");   // 기본 오래된→최신 (마지막 거래가 맨 아래)
  const [period, setPeriod] = useState<Period>("month");   // 프리셋(표시용) — 기본 최근 1개월
  const [from, setFrom] = useState<string>(() => presetRange("month").from);  // 시작일 YYYY-MM-DD ('' = 제한없음)
  const [to, setTo] = useState<string>(() => presetRange("month").to);        // 종료일 YYYY-MM-DD
  const applyPreset = (p: Period) => { setPeriod(p); const r = presetRange(p); if (p !== "custom") { setFrom(r.from); setTo(r.to); } };
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<EditForm | null>(null);

  const reload = async () => setTrades(await loadAllTrades());
  useEffect(() => { void reload(); }, []);

  // 그룹별 독립보유 모드 — 종목명 아래에 거래의 그룹(account) 표시
  const independent = getIndependentGroupsMode();

  // 기간 필터 적용 — 시작일~종료일(YYYYMMDD) 범위. 빈값이면 그쪽 제한 없음.
  const filtered = useMemo(() => {
    const all = trades ?? [];
    const f = from.replace(/\D/g, ""), t2 = to.replace(/\D/g, "");
    if (!f && !t2) return all;
    return all.filter(t => {
      const d = t.date.replace(/\D/g, "");
      if (f && d < f) return false;
      if (t2 && d > t2) return false;
      return true;
    });
  }, [trades, from, to]);

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

  // 매도 건별 실현손익 — 전체 거래 기준 시간순 계산(원가 정확). 화면엔 보이는 매도행에만 표시.
  const realizedByTrade = useMemo(
    () => computeRealizedByTrade(trades ?? [], independent),
    [trades, independent],
  );

  const startEdit = (t: Trade) => {
    setEditId(t.id);
    setForm({ type: t.type, date: t.date, qty: String(t.qty), amount: String(t.amount),
              unit: String(Math.round(t.amount / t.qty)), last: "amount" });
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

  // ── 그룹 구성 ──
  // 전체: 그룹 1개(시간순) / 날짜별: 날짜로 묶음 / 종목별: 종목(독립모드는 종목+그룹)로 묶음.
  // 각 그룹 끝에 '합계' 소계, 맨 마지막에 '전체 합계'.
  const buildGroups = (m: ViewMode): { key: string; trades: Trade[] }[] => {
    if (m === "recent") {
      return [{ key: "all", trades: [...filtered].sort(sortByDate) }];
    }
    const byName = (a: Trade, b: Trade) => nameOf(a.ticker).localeCompare(nameOf(b.ticker));
    const byAcct = (a: Trade, b: Trade) => (a.account ?? "").localeCompare(b.account ?? "");
    const sorted = [...filtered].sort((a, b) =>
      m === "byStock"
        ? (byName(a, b) || (independent ? byAcct(a, b) : 0) || sortByDate(a, b))  // 종목 가나다 → 입력순(dir)
        : sortByDate(a, b));                                                       // 날짜별: 날짜 → 입력순(dir)
    const keyOf = (t: Trade) =>
      m === "byStock" ? (independent ? `${t.ticker}␟${t.account ?? ""}` : t.ticker) : t.date;
    const groups: { key: string; trades: Trade[] }[] = [];
    let cur: { key: string; trades: Trade[] } | null = null;
    for (const t of sorted) {
      const k = keyOf(t);
      if (!cur || cur.key !== k) { cur = { key: k, trades: [] }; groups.push(cur); }
      cur.trades.push(t);
    }
    return groups;
  };

  // 매수/매도 금액 셀 — 값 있으면 금액+수량·단가, 없으면 빈칸.
  //  매도 셀엔 그 매도의 실현손익(익절/손절)을 한 줄 더 — 그 시점 평단가 기준, 부분매도 포함.
  const valueCell = (
    qty: number, amt: number, kind: "buy" | "sell",
    realized?: { realized: number; pct: number },
  ) => {
    if (qty <= 0) return <td className="py-1 px-1.5"></td>;
    const color = kind === "buy" ? "text-rose-600" : "text-blue-600";
    return (
      <td className="py-1 px-1.5 text-right">
        <div className={`font-medium ${color}`}>{won(amt)}</div>
        <div className="text-[10px] text-gray-400">{won(qty)}주 · {won(Math.round(amt / qty))}</div>
        {realized && (
          <div className="mt-1 flex items-center justify-end gap-1 whitespace-nowrap"
               title="이 매도의 실현손익 — 그 시점 평단가 기준 (부분매도 포함)">
            <span className={`rounded-full px-1.5 py-px text-[9px] font-bold text-white leading-none ${realizedChip(realized.realized).bg}`}>
              {realizedChip(realized.realized).label}
            </span>
            <span className={`text-[10px] font-semibold ${signColor(realized.realized)}`}>
              {formatSigned(realized.realized)}
              <span className="ml-0.5 text-[9px] opacity-70">({realized.pct >= 0 ? "+" : ""}{realized.pct.toFixed(1)}%)</span>
            </span>
          </div>
        )}
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
                 onChange={e => setForm(f => f ? recalcEdit(f, "qty", e.target.value) : f)}
                 className="border rounded px-1 py-0.5 w-14 text-right text-[11px] tabular-nums" />
          <input type="number" inputMode="numeric" value={form.unit} placeholder="주당가"
                 onChange={e => setForm(f => f ? recalcEdit(f, "unit", e.target.value) : f)}
                 className="border rounded px-1 py-0.5 w-20 text-right text-[11px] tabular-nums" />
          <input type="number" inputMode="numeric" value={form.amount} placeholder="총액"
                 onChange={e => setForm(f => f ? recalcEdit(f, "amount", e.target.value) : f)}
                 className="border rounded px-1 py-0.5 w-24 text-right text-[11px] tabular-nums" />
          <span className="ml-auto whitespace-nowrap">
            <button onClick={() => void saveEdit(t)} className="text-blue-600 hover:underline mr-1.5">저장</button>
            <button onClick={cancelEdit} className="text-gray-400 hover:underline">취소</button>
          </span>
        </div>
      </td>
    </tr>
  );

  const renderDataRow = (t: Trade, showName: boolean, showDate: boolean, groupStart: boolean,
                         boldName = false, boldDate = false) => {
    if (editId === t.id && form) return renderEditRow(t);
    const top = groupStart ? "border-t border-gray-300" : "border-t border-gray-100";
    return (
      <tr key={t.id} className={`${top} hover:bg-gray-50 align-top`}>
        <td className="py-1 px-1.5 text-gray-700" title={showName ? nameOf(t.ticker) : ""}>
          {showName && (
            <>
              <div className={`truncate ${boldName ? "font-bold" : ""}`}>{nameOf(t.ticker)}</div>
              {independent && t.account && (
                <div className="text-[10px] text-gray-400 truncate">{t.account}</div>
              )}
            </>
          )}
        </td>
        <td className={`py-1 px-1.5 text-gray-500 whitespace-nowrap ${boldDate && showDate ? "font-bold text-gray-700" : ""}`}>{showDate ? t.date : ""}</td>
        {valueCell(t.type === "buy" ? t.qty : 0, t.type === "buy" ? t.amount : 0, "buy")}
        {valueCell(t.type === "sell" ? t.qty : 0, t.type === "sell" ? t.amount : 0, "sell",
                   t.type === "sell" ? realizedByTrade.get(t.id) : undefined)}
        {actionsCell(t)}
      </tr>
    );
  };

  // 합계 행 — 금액만 (수량은 종목 섞여 무의미). strong=전체 합계.
  const renderTotalRow = (key: string, label: string, rows: Trade[], strong: boolean) => {
    const tot = totalsOf(rows);
    const rowCls = strong
      ? "border-t-2 border-emerald-400 bg-emerald-50"
      : "border-t border-amber-200 bg-amber-50/70";
    const labelCls = strong ? "text-emerald-800 font-bold" : "text-amber-700 font-semibold";
    const amtCls = strong ? "text-[12px] font-bold" : "font-semibold";
    return (
      <tr key={key} className={rowCls}>
        <td className={`py-1 px-1.5 text-[10px] ${labelCls}`}>{label}</td>
        <td className="py-1 px-1.5"></td>
        <td className={`py-1 px-1.5 text-right text-rose-600 ${amtCls}`}>{tot.buyQty > 0 ? won(tot.buyAmt) : ""}</td>
        <td className={`py-1 px-1.5 text-right text-blue-600 ${amtCls}`}>{tot.sellQty > 0 ? won(tot.sellAmt) : ""}</td>
        <td className="py-1 px-1.5"></td>
      </tr>
    );
  };

  // 종목별 누적 실현손익 행 — 그 종목 매도들의 실현손익 합 + 청산원가 대비 %. 매도 없으면 표시 안 함.
  const renderRealizedRow = (key: string, rows: Trade[]) => {
    let realized = 0, cost = 0, has = false;
    for (const t of rows) {
      if (t.type !== "sell") continue;
      const r = realizedByTrade.get(t.id);
      if (r) { realized += r.realized; cost += r.cost; has = true; }
    }
    if (!has) return null;
    const pct = cost > 0 ? (realized / cost) * 100 : 0;
    const chip = realizedChip(realized);
    return (
      <tr key={`${key}__realized`} className={`border-t border-gray-200 ${signBg(realized)}`}>
        <td className="py-1 px-1.5 whitespace-nowrap">
          <span className="text-[9px] text-gray-400 mr-1">실현</span>
          <span className={`rounded-full px-1.5 py-px text-[9px] font-bold text-white leading-none ${chip.bg}`}>{chip.label}</span>
        </td>
        <td className="py-1 px-1.5"></td>
        <td colSpan={2} className={`py-1 px-1.5 text-right text-[11px] font-bold ${signColor(realized)}`}>
          {formatSigned(realized)} <span className="text-[10px] font-normal opacity-70">({pct >= 0 ? "+" : ""}{pct.toFixed(2)}%)</span>
        </td>
        <td className="py-1 px-1.5"></td>
      </tr>
    );
  };

  // ── 한 패널 — 단일 표 (헤더 하나, 그룹 키는 첫 행에만, 그룹 소계 + 전체 합계) ──
  const colW = ["27%", "17%", "23%", "23%", "10%"];
  const renderPanel = (m: ViewMode) => {
    const groups = buildGroups(m);
    const grouped = m !== "recent";
    // 전체 합계 — PC 는 3패널이 동일하므로 전체(시간순)에만. 모바일은 패널 하나씩이라 항상.
    const showGrand = !pc || m === "recent";
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
        <tbody>
          {groups.map(g => (
            <Fragment key={g.key}>
              {g.trades.map((t, i) => renderDataRow(
                t,
                m === "byStock" ? i === 0 : true,   // 종목별: 종목 한 번만
                m === "byDate" ? i === 0 : true,     // 날짜별: 날짜 한 번만
                grouped && i === 0,
                m === "byStock",                     // 종목별: 종목 볼드
                m === "byDate",                      // 날짜별: 날짜 볼드
              ))}
              {grouped && renderTotalRow(`${g.key}__sub`, "합계", g.trades, false)}
              {m === "byStock" && renderRealizedRow(g.key, g.trades)}
            </Fragment>
          ))}
        </tbody>
        {showGrand && <tfoot>{renderTotalRow("__grand", "전체 합계", filtered, true)}</tfoot>}
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
        {/* 기간 — 시작/종료일 직접 검색 → 프리셋 (날짜 먼저) */}
        <span className="inline-flex items-center gap-1">
          <input type="date" value={from} max={to || undefined}
                 onChange={e => { setFrom(e.target.value); setPeriod("custom"); cancelEdit(); }}
                 title="시작일"
                 className="border border-gray-300 rounded px-1 py-1 bg-white text-gray-700 focus:outline-none cursor-pointer" />
          <span className="text-gray-400">~</span>
          <input type="date" value={to} min={from || undefined}
                 onChange={e => { setTo(e.target.value); setPeriod("custom"); cancelEdit(); }}
                 title="종료일"
                 className="border border-gray-300 rounded px-1 py-1 bg-white text-gray-700 focus:outline-none cursor-pointer" />
        </span>
        <select value={period} onChange={e => { applyPreset(e.target.value as Period); cancelEdit(); }}
                title="기간 프리셋 — 선택 시 시작/종료일 자동 입력"
                className="border border-gray-300 rounded px-1.5 py-1 bg-white text-gray-700 focus:outline-none cursor-pointer">
          <option value="week">1주</option>
          <option value="month">1개월</option>
          <option value="year">1년</option>
          <option value="all">전체</option>
          <option value="custom">직접</option>
        </select>

        {/* 보기 토글 — 맨 뒤. 차트/상세보기 + (차트)전체/그룹별 또는 (상세)분류/정렬 */}
        <div className="inline-flex rounded-md border border-gray-300 overflow-hidden">
          <button onClick={() => { setView("chart"); cancelEdit(); }}
                  className={`inline-flex items-center gap-1 px-2 py-1 ${view === "chart" ? "bg-emerald-500 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
            <GanttChartSquare size={13} /> 차트
          </button>
          <button onClick={() => { setView("table"); cancelEdit(); }}
                  className={`px-2 py-1 border-l border-gray-300 ${view === "table" ? "bg-emerald-500 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
            상세보기
          </button>
        </div>
        {view === "chart" ? (
          <div className="inline-flex rounded-md border border-gray-300 overflow-hidden">
            {(["all", "byGroup"] as const).map(s => (
              <button key={s} onClick={() => setScope(s)}
                      className={`px-2 py-1 ${s === "byGroup" ? "border-l border-gray-300" : ""} ${scope === s ? "bg-gray-700 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
                {s === "all" ? "전체" : "그룹별"}
              </button>
            ))}
          </div>
        ) : !pc ? (
          <select value={mode} onChange={e => { setMode(e.target.value as ViewMode); cancelEdit(); }}
                  className="border border-gray-300 rounded px-1.5 py-1 bg-white text-gray-700 focus:outline-none cursor-pointer">
            <option value="recent">전체 시간순</option>
            <option value="byStock">종목별</option>
            <option value="byDate">날짜별</option>
          </select>
        ) : null}
        {/* 정렬 방향 — 차트(날짜순)·테이블 공통 */}
        <button onClick={() => setDir(d => d === "desc" ? "asc" : "desc")}
                title="날짜 정렬 방향"
                className="px-2 py-1 rounded border border-gray-300 bg-white text-gray-600 hover:bg-gray-50">
          {dir === "desc" ? "↓ 최신순" : "↑ 오래된순"}
        </button>
      </div>

      {view === "chart" ? (
        // 차트 — 기간 범위(표시만), 실현손익 원가는 전체 거래 기준
        <TradeGantt trades={trades} nameOf={nameOf} scope={scope} from={from} to={to} desc={dir === "desc"} />
      ) : filtered.length === 0 ? (
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
