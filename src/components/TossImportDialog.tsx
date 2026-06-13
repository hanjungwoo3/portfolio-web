import { useMemo, useState } from "react";
import { loadAllTrades, addTrade, replaceAllTrades, type Trade } from "../lib/db";
import { parseTossTransactionsJson, tradeDedupeKey, type ImportTradeRow } from "../lib/parseTossTransactions";
import { rememberTickerNames } from "../lib/tickerNames";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onImported: () => void;       // 추가 후 부모 reload
  groups: string[];             // 거래의 그룹(account) 선택용 (선택)
}

type Status = "new" | "dup";
interface Cand extends ImportTradeRow { status: Status; key: string; }

const today = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);   // KST
// YYYY-MM-DD 에서 n개월 빼기 (윈도우 이동용)
const minusMonths = (ymd: string, n: number) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 - n, d)).toISOString().slice(0, 10);
};
const yearsAgo = (n: number) => {
  const d = new Date(Date.now() + 9 * 3600_000);
  d.setFullYear(d.getFullYear() - n);
  return d.toISOString().slice(0, 10);
};
const maxYmd = (a: string, b: string) => (a > b ? a : b);   // YYYY-MM-DD 문자열 비교
const WINDOW_MONTHS = 6;   // 토스 한 요청 날짜범위 상한(약 6개월) — 자동 윈도우 단위
const PERIODS = [
  { key: "1y", label: "1년", years: 1 },
  { key: "2y", label: "2년", years: 2 },
  { key: "5y", label: "5년", years: 5 },
  { key: "10y", label: "10년", years: 10 },
  { key: "custom", label: "직접", years: 0 },
] as const;
type PeriodKey = typeof PERIODS[number]["key"];
const won = (n: number) => Math.round(n).toLocaleString();

export function TossImportDialog({ isOpen, onClose, onImported, groups }: Props) {
  const [period, setPeriod] = useState<PeriodKey>("1y");
  const [from, setFrom] = useState(() => yearsAgo(1));   // 목표 최초일 (조회 기간)
  const [to, setTo] = useState(today);
  const size = 50;   // 토스 최대 50/페이지 — 고정
  const [raw, setRaw] = useState("");
  const [cands, setCands] = useState<Cand[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());   // 체크된 key(신규)
  const [account, setAccount] = useState("");
  const [err, setErr] = useState("");
  const [skipped, setSkipped] = useState(0);
  const [busy, setBusy] = useState(false);
  const [doneRanges, setDoneRanges] = useState<Set<string>>(new Set());   // 분석 완료된 구간 "from~to"

  const applyPeriod = (p: PeriodKey) => {
    setPeriod(p);
    if (p === "custom") return;
    const yrs = PERIODS.find(x => x.key === p)!.years;
    setFrom(yearsAgo(yrs)); setTo(today()); setDoneRanges(new Set());
  };

  const buildUrl = (rFrom: string, rTo: string) =>
    `https://wts-api.tossinvest.com/api/v3/my-assets/transactions/markets/kr`
    + `?size=${size}&filters=0&range.from=${rFrom}&range.to=${rTo}`;
  // [from, to] 를 6개월 윈도우로 분할(최신→과거). 토스 날짜범위 제한 회피 + 빈 구간도 건너뜀.
  const windows = useMemo(() => {
    const out: { from: string; to: string }[] = [];
    let cur = to, guard = 0;
    while (cur > from && guard++ < 100) {
      const f = maxYmd(from, minusMonths(cur, WINDOW_MONTHS));
      out.push({ from: f, to: cur });
      if (f <= from) break;
      cur = f;
    }
    return out;
  }, [from, to]);
  const ym = (d: string) => d.slice(2, 7).replace("-", ".");   // 2025-12-14 → 25.12
  const rangeKey = (w: { from: string; to: string }) => `${w.from}~${w.to}`;

  // 토스 JSON 을 작은 팝업 창으로 — 화면 안 가리게(좌상단)
  const openToss = (url: string) => window.open(url, "tossImport", "popup,width=460,height=620,left=30,top=30");

  const reset = () => { setCands(null); setPicked(new Set()); setSkipped(0); setErr(""); setDoneRanges(new Set()); };

  const analyze = async () => {
    setErr("");
    const parsed = parseTossTransactionsJson(raw);
    if (!parsed) { setErr("토스 거래내역 JSON 형식이 아니에요. 링크에서 뜬 JSON 전체를 붙여넣어 주세요."); return; }
    if (parsed.rows.length === 0 && !cands) { setErr(`매수/매도 거래가 없어요. (전체 ${parsed.total}건 중 거래 아님 ${parsed.skipped}건)`); setCands([]); return; }

    // 종목명 저장 — 보유에 없는 종목도 코드 대신 이름 표시되게(추가 안 해도 분석만으로 채움)
    rememberTickerNames(parsed.rows.map(r => ({ ticker: r.ticker, name: r.name })));

    const existing = await loadAllTrades();
    const existKeys = new Set(existing.map(t => tradeDedupeKey(t)));
    // 기존 누적 + 이번 페이지 병합 (key 중복 제거)
    const map = new Map<string, Cand>((cands ?? []).map(c => [c.key, c]));
    const newlyPicked = new Set(picked);
    for (const r of parsed.rows) {
      const key = tradeDedupeKey(r);
      if (map.has(key)) continue;
      const status: Status = existKeys.has(key) ? "dup" : "new";
      map.set(key, { ...r, key, status });
      if (status === "new") newlyPicked.add(key);
    }
    const arr = Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
    setCands(arr);
    setPicked(newlyPicked);
    setSkipped(s => s + parsed.skipped);
    setRaw("");   // 다음 구간 붙여넣기 위해 비움
    if (parsed.range) setDoneRanges(prev => new Set(prev).add(`${parsed.range!.from}~${parsed.range!.to}`));
  };

  const newCount = useMemo(() => cands?.filter(c => c.status === "new").length ?? 0, [cands]);
  const dupCount = useMemo(() => cands?.filter(c => c.status === "dup").length ?? 0, [cands]);
  const toggle = (key: string) => setPicked(p => {
    const n = new Set(p);
    if (n.has(key)) n.delete(key); else n.add(key);
    return n;
  });

  const doImport = async () => {
    if (!cands) return;
    setBusy(true);
    try {
      const acct = account.trim();
      for (const c of cands) {
        if (!picked.has(c.key)) continue;
        const t: Omit<Trade, "id" | "createdAt"> & { id?: string } = {
          id: `toss_${c.key}`,            // 멱등 — 재가져와도 덮어쓰기(중복 방지)
          ticker: c.ticker,
          type: c.type,
          date: c.date,
          qty: c.qty,
          amount: c.amount,
          ...(acct ? { account: acct } : {}),
        };
        await addTrade(t);
      }
      onImported();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
         onClick={onClose}>
      <div className="bg-white w-full max-w-2xl max-h-[92vh] rounded-t-2xl sm:rounded-xl shadow-xl flex flex-col"
           onClick={e => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <div className="text-base font-bold text-gray-800">📥 토스 거래 가져오기</div>
          <div className="flex items-center gap-3">
            <button onClick={async () => {
                      if (!confirm("저장된 모든 거래기록을 삭제할까요?\n(보유 수량/평단엔 영향 없음 — 거래 로그만 초기화)")) return;
                      await replaceAllTrades([]);
                      onImported();
                    }}
                    title="거래 로그 전체 삭제 — 깨끗이 다시 가져오기용"
                    className="px-2 py-1 rounded text-[11px] font-bold border border-rose-200 text-rose-600 bg-rose-50 hover:bg-rose-100">전체 거래 삭제</button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-sm">닫기</button>
          </div>
        </div>

        <div className="px-4 py-3 overflow-y-auto space-y-3">
          {!cands && (
            <div className="text-[12px] text-gray-700 leading-relaxed">
              <b>1.</b> 먼저{" "}
              <a href="https://www.tossinvest.com/" target="_blank" rel="noopener noreferrer"
                 className="font-bold text-blue-600 underline">토스에서 로그인 ↗</a>{" "}
              하세요.
            </div>
          )}
          {/* 조회기간 + 직접 날짜 */}
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[11px] text-gray-500">조회
              <select value={period} onChange={e => applyPeriod(e.target.value as PeriodKey)}
                      className="block border border-gray-300 rounded px-1.5 py-1 text-xs bg-white">
                {PERIODS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </label>
            <label className="text-[11px] text-gray-500">시작
              <input type="date" value={from} onChange={e => { setFrom(e.target.value); setPeriod("custom"); setDoneRanges(new Set()); }}
                     className="block border border-gray-300 rounded px-1.5 py-1 text-xs" />
            </label>
            <label className="text-[11px] text-gray-500">종료
              <input type="date" value={to} onChange={e => { setTo(e.target.value); setPeriod("custom"); setDoneRanges(new Set()); }}
                     className="block border border-gray-300 rounded px-1.5 py-1 text-xs" />
            </label>
          </div>
          {/* 구간 버튼 안내 + 그리드 */}
          <div className="text-[12px] text-gray-700 leading-relaxed">
            <b>{cands ? "" : "2. "}</b>아래 <b>기간 버튼</b>을 눌러 팝업을 열고 → <b>전체복사</b>(Ctrl+A→Ctrl+C) → 맨 아래 칸에 <b>붙여넣기</b> → <b>분석</b>.
            <span className="block">구간마다 반복하면 완료된 구간은 <span className="text-emerald-600 font-bold">초록색 ✓</span> 로 바뀝니다.</span>
            <span className="block text-[10px] text-gray-400 mt-0.5">※ 브라우저 보안상 앱이 자동으로 가져올 수 없어요 — 열린 창에서 직접 복사·붙여넣기 해주세요.</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {windows.map(w => {
              const done = doneRanges.has(rangeKey(w));
              return (
                <button key={rangeKey(w)} type="button" disabled={done}
                        onClick={() => openToss(buildUrl(w.from, w.to))}
                        title={`${w.from} ~ ${w.to}`}
                        className={`px-2 py-1 rounded text-[11px] font-bold border tabular-nums
                                    ${done ? "bg-emerald-100 text-emerald-700 border-emerald-300 cursor-default"
                                           : "bg-blue-600 text-white border-blue-600 hover:bg-blue-700"}`}>
                  {done ? "✓ " : ""}{ym(w.from)}~{ym(w.to)}
                </button>
              );
            })}
          </div>

          {/* 미리보기 */}
          {cands && cands.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-gray-600">
                  신규 <b className="text-blue-600">{newCount}</b> · 이미있음 <b className="text-gray-400">{dupCount}</b>
                  {skipped > 0 && <> · 제외 {skipped}</>}
                </span>
                {groups.length > 0 && (
                  <label className="text-gray-500">그룹
                    <select value={account} onChange={e => setAccount(e.target.value)}
                            className="ml-1 border border-gray-300 rounded px-1 py-0.5">
                      <option value="">미지정</option>
                      {groups.map(g => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </label>
                )}
              </div>
              <div className="border border-gray-200 rounded max-h-64 overflow-y-auto divide-y divide-gray-100">
                {cands.map(c => {
                  const dup = c.status === "dup";
                  const on = picked.has(c.key);
                  return (
                    <label key={c.key}
                           className={`flex items-center gap-2 px-2 py-1.5 text-[11px] cursor-pointer
                                       ${dup ? "bg-gray-50 text-gray-400" : "hover:bg-blue-50/40"}`}>
                      <input type="checkbox" checked={on} disabled={dup}
                             onChange={() => toggle(c.key)}
                             className="w-3.5 h-3.5 accent-blue-600" />
                      <span className="w-[68px] tabular-nums text-gray-500">{c.date.slice(2)}</span>
                      <span className="flex-1 truncate font-medium text-gray-700">{c.name}</span>
                      <span className={`w-8 font-bold ${c.type === "buy" ? "text-rose-600" : "text-blue-600"}`}>
                        {c.type === "buy" ? "매수" : "매도"}
                      </span>
                      <span className="w-12 text-right tabular-nums">{c.qty}주</span>
                      <span className="w-20 text-right tabular-nums">{won(c.amount)}</span>
                      {dup && <span className="w-10 text-right text-gray-400">있음</span>}
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* 붙여넣기 + 분석/추가분석 — 항상 아래 */}
          <textarea value={raw} onChange={e => setRaw(e.target.value)}
                    placeholder='{"result":{"body":[ ... ]}} — 토스에서 복사한 JSON 전체'
                    className="w-full h-28 border border-gray-300 rounded p-2 text-[11px] font-mono resize-y" />
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={analyze} disabled={!raw.trim()}
                    className="px-3 py-1.5 rounded text-xs font-bold bg-gray-800 hover:bg-black text-white disabled:opacity-40">
              {cands ? "추가분석" : "분석"}
            </button>
            {err && <span className="text-[11px] text-rose-600">{err}</span>}
          </div>
        </div>

        {/* 푸터 */}
        <div className="px-4 py-3 border-t flex items-center justify-end gap-2">
          {cands && (
            <button onClick={reset} title="붙여넣은 내용·미리보기 초기화하고 처음부터"
                    className="mr-auto px-2 py-1 rounded text-[11px] font-bold border border-gray-300 text-gray-600 bg-white hover:bg-gray-50">
              처음부터 다시검색
            </button>
          )}
          <button onClick={onClose} className="px-3 py-1.5 rounded text-xs text-gray-600 hover:bg-gray-100">취소</button>
          <button onClick={doImport} disabled={busy || picked.size === 0}
                  className="px-4 py-1.5 rounded text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40">
            {busy ? "추가 중…" : `${picked.size}건 추가`}
          </button>
        </div>
      </div>
    </div>
  );
}
