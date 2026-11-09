// 지수 서랍 — 지수 탭이 아닌 화면에서 오른쪽 가장자리 '📈 지수' 손잡이를 누르면(올리면) 미끄러져 나오는 판
//   (사용자 2026-11-09 "지수 상단 부분을 다른 탭들에서 side 에 숨겨 놓고 슬라이드로 열어 볼 수 있게", "레이어 팝업도 괜찮고").
//   내용 = 지수(미국/야간) 페이지 위쪽 네 묶음 — 미국 지수 · 환율·금리·투심 · 선물 · 현물(원자재). 카드 대신 한 줄씩(이름·값·등락·구간).
//   이 종목들만 따로 받는다(열려 있을 때만, 지수 탭과 같은 출처 fetchYahooBatch). 손잡이 위치·열림은 기억하지 않는다.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchYahooBatch } from "../lib/api";
import { buildDashboardPage } from "../lib/dashboardGroups";
import { US_PAIRS } from "../lib/usMarketData";
import { displayPctOf, isSymbolSleeping } from "../lib/format";
import { indicatorBand, indicatorHelp } from "../lib/indicatorHelp";
import { HoverTip } from "./HoverTip";

const SECTION_IDS = ["macro", "krfx", "krnight", "dayfut", "spot"];   // 선물은 시간대에 따라 둘 중 하나만 페이지에 있다

export function IndexSideDrawer() {
  const [open, setOpen] = useState(false);
  const sections = useMemo(() => buildDashboardPage("night").filter(s => SECTION_IDS.includes(s.id)), []);
  const keep = (x: string) => !/-PERP$/.test(x);   // 하이퍼리퀴드 24h 가상 심볼은 이 출처에 없다
  const syms = useMemo(() => [...new Set(sections.flatMap(s => s.rows.flat()).filter(keep))], [sections]);
  const pairs = useMemo(() => syms.map(s => ({ symbol: s, name: US_PAIRS.find(p => p.symbol === s)?.name ?? s })), [syms]);
  const { data } = useQuery({
    queryKey: ["side-index", syms.join(",")], queryFn: () => fetchYahooBatch(pairs),
    enabled: open, refetchInterval: open ? 15_000 : false, staleTime: 10_000,
  });
  const map = useMemo(() => new Map(data ?? []), [data]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open]);

  const fmt = (sym: string, v: number) => sym === "CNNFG" ? Math.round(v).toString()
    : sym === "HYSPREAD" ? `${v.toFixed(2)}%`
    : v >= 1000 ? Math.round(v).toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 2 });

  return (
    <>
      {/* 손잡이 — 오른쪽 가장자리 가운데 */}
      <button type="button" onClick={() => setOpen(o => !o)}
              className={`fixed right-0 top-1/2 -translate-y-1/2 z-[70] rounded-l-lg border border-r-0 border-indigo-300 bg-indigo-50 text-indigo-700 shadow px-1 py-2 text-[11px] font-bold [writing-mode:vertical-rl] hover:bg-indigo-100 ${open ? "hidden" : ""}`}
              title="지수·환율·금리·선물·원자재 한눈에 (Esc 로 닫기)">📈 지수</button>
      {open && <div className="fixed inset-0 z-[70] bg-black/10" onClick={() => setOpen(false)} />}
      <aside className={`fixed top-0 right-0 bottom-0 z-[71] w-[min(380px,92vw)] bg-white border-l border-gray-300 shadow-2xl overflow-y-auto transition-transform duration-200 pg-card ${open ? "translate-x-0" : "translate-x-full"}`}>
        <div className="sticky top-0 bg-white/95 border-b border-gray-200 px-3 py-2 flex items-center gap-2">
          <b className="text-gray-800">📈 지수 한눈에</b>
          <span className="text-[10.5px] text-gray-400">15초마다</span>
          <button onClick={() => setOpen(false)} className="ml-auto px-1.5 text-gray-400 hover:text-gray-700" title="닫기 (Esc)">✕</button>
        </div>
        {sections.map(s => (
          <div key={s.id} className="px-3 py-1.5 border-b border-gray-100">
            <div className="text-[12px] font-bold text-gray-600 mb-0.5">{s.label}</div>
            {s.rows.flat().filter(keep).map(sym => {
              const q = map.get(sym), name = US_PAIRS.find(p => p.symbol === sym)?.name ?? sym;
              const pct = sym === "HYSPREAD" ? q?.diff ?? null : q ? displayPctOf(sym, q) : null;
              const cls = pct == null ? "text-gray-400" : pct > 0 ? "text-rose-600" : pct < 0 ? "text-blue-600" : "text-gray-500";   // 지수 카드와 같은 색(오름 빨강·내림 파랑)
              const bd = indicatorBand(sym, q?.price);
              const help = indicatorHelp(sym);
              return (
                <div key={sym} className={`grid grid-cols-[minmax(0,1fr)_auto_4.5rem] items-baseline gap-x-2 py-[3px] text-[12.5px] ${isSymbolSleeping(sym) ? "opacity-70" : ""}`}>
                  <span className="truncate text-gray-800 flex items-center gap-1 min-w-0">
                    <span className="truncate">{name}</span>
                    {bd && <span className={`shrink-0 px-1 rounded border text-[9.5px] font-bold leading-tight ${bd.level === 0 ? "border-emerald-300 bg-emerald-50 text-emerald-700" : bd.level === 1 ? "border-gray-300 bg-gray-50 text-gray-600" : bd.level === 2 ? "border-amber-300 bg-amber-50 text-amber-700" : "border-rose-400 bg-rose-600 text-white"}`}>{bd.name}</span>}
                    {help && <HoverTip tip={help} width={300}><span className="shrink-0 w-3.5 h-3.5 inline-flex items-center justify-center rounded-full border border-gray-300 text-[9px] text-gray-500 cursor-help">?</span></HoverTip>}
                  </span>
                  <span className="tabular-nums text-gray-700">{q?.price != null ? fmt(sym, q.price) : "—"}</span>
                  <b className={`tabular-nums text-right ${cls}`}>{pct == null ? "—" : sym === "CNNFG" && q ? `${Math.round(q.price - (q.prevClose ?? q.price)) >= 0 ? "+" : ""}${Math.round(q.price - (q.prevClose ?? q.price))}점` : `${pct > 0 ? "+" : ""}${pct.toFixed(2)}${sym === "HYSPREAD" ? "%p" : "%"}`}</b>
                </div>
              );
            })}
          </div>
        ))}
        <div className="px-3 py-2 text-[10.5px] text-gray-400">오름 빨강 · 내림 파랑(지수 카드와 같다) · 꼬리표 = 지금 구간 · ? = 설명 · 자세히는 지수 탭</div>
      </aside>
    </>
  );
}
