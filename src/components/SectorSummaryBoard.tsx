// 업종 요약판 — 지수(업종) '한눈에' 탭의 AI 순환매 카드 줄을 대신한다(사용자 2026-11-07 "한눈에는 종목카드를 다 넣지 않고 요약만,
//   실제 종목카드는 섹터별로 들어가서"). 왼쪽 업종 탭 하나 = 한 줄: 해외·국내 평균(정규장% + 애프터·프리 꼬리표), ▲▼, 가장 오른·내린 국내 종목.
//   줄을 누르면 그 업종 탭으로, ▸ 를 누르면 칸별(기판·전공정…) 평균을 펼친다. 줄 순서 = 지금 고른 국내/해외 평균 큰 순.
//   PC·모바일이 같이 쓴다(compact = 모바일).
import { useState } from "react";
import type { DashboardSection } from "../lib/dashboardGroups";
import { avgOfSyms, rotRowAvg, isOverseasTicker, useAvgMarket, type RowAvg } from "../lib/avgMarket";
import { AftPill } from "./SectorTabBar";

type RegExt = (s: string) => { reg: number; aft: number; ses?: "프리" | "애프터" | "데이" } | null;
const tone = (v: number) => (v > 0 ? "text-rose-600" : v < 0 ? "text-blue-600" : "text-gray-600");
const fmt = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;

function Avg({ v, big }: { v: RowAvg | null; big?: boolean }) {
  if (!v) return <span className="text-gray-300">—</span>;
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap tabular-nums">
      {v.aft != null && <span className="text-[10px] text-gray-400">정규</span>}
      <b className={`${tone(v.avg)} ${big ? "text-[13px]" : ""}`}>{fmt(v.avg)}</b>
      {v.aft != null && <AftPill v={v.aft} label={v.ses ?? "장외"} />}
      <span className="text-[10px] text-gray-400">▲{v.up}·▼{v.n - v.up}</span>
    </span>
  );
}

export function SectorSummaryBoard({ sections, pctOf, regExtOf, nameOf, onOpen, compact }: {
  sections: DashboardSection[];                 // 업종 탭(한눈에 제외)
  pctOf: (s: string) => number | null;
  regExtOf: RegExt;
  nameOf: (s: string) => string;
  onOpen: (sectionId: string) => void;
  compact?: boolean;
}) {
  const mkt = useAvgMarket();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const rows = sections.map(s => {
    const all = s.rows.flat();
    const kr = all.filter(x => /\.(KS|KQ)$/.test(x)), ov = all.filter(isOverseasTicker);
    const val = (x: string) => regExtOf(x)?.reg ?? pctOf(x);
    const ranked = (xs: string[]) => xs.map(x => ({ x, v: val(x) })).filter((t): t is { x: string; v: number } => t.v != null && Number.isFinite(t.v)).sort((a, b) => b.v - a.v);
    const krv = ranked(kr), ovv = ranked(ov);   // 해외 가장 오름·내림도(사용자 2026-11-07 "자리 있으면 해외도")
    return { s, ov: avgOfSyms(ov, pctOf, regExtOf), kr: avgOfSyms(kr, pctOf, regExtOf),
      best: krv[0], worst: krv.length > 1 ? krv[krv.length - 1] : undefined,
      ovBest: ovv[0], ovWorst: ovv.length > 1 ? ovv[ovv.length - 1] : undefined };
  }).sort((a, b) => {
    const k = (r: typeof a) => (mkt === "US" ? r.ov?.avg : r.kr?.avg) ?? -Infinity;
    return k(b) - k(a);
  });
  const toggle = (id: string) => setOpen(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const mover = (t?: { x: string; v: number }) => t && (
    <span className="whitespace-nowrap"><span className="text-gray-700">{nameOf(t.x)}</span> <b className={`tabular-nums ${tone(t.v)}`}>{fmt(t.v)}</b></span>
  );

  return (
    <div className="space-y-1">
      {!compact && (
        <div className="grid grid-cols-[150px_240px_240px_1fr_1fr] gap-x-3 px-2 text-[10.5px] text-gray-400">
          <span>업종 (누르면 그 탭)</span><span>해외 대장주 — 정규장 · 프리/애프터</span><span>국내 종목 — 정규장 · 애프터</span><span>가장 오름 (해외 / 국내)</span><span>가장 내림 (해외 / 국내)</span>
        </div>
      )}
      {rows.map(({ s, ov, kr, best, worst, ovBest, ovWorst }) => {
        const isOpen = open.has(s.id), multi = (s.rowLabels?.length ?? 0) > 1;
        const emoji = s.label.split(" ")[0];
        return (
          <div key={s.id} className="rounded-lg border border-gray-200 bg-white hover:border-indigo-300">
            <div className={compact ? "px-2 py-1.5 space-y-0.5" : "grid grid-cols-[150px_240px_240px_1fr_1fr] gap-x-3 items-center px-2 py-1 text-[12px]"}>
              <span className="inline-flex items-center gap-1 min-w-0">
                {multi
                  ? <button onClick={() => toggle(s.id)} className="w-4 text-gray-400 hover:text-gray-700" title="칸별 평균 펼치기">{isOpen ? "▾" : "▸"}</button>
                  : <span className="w-4" />}
                <button onClick={() => onOpen(s.id)} className="font-bold text-gray-800 hover:text-indigo-700 hover:underline truncate" title={`${s.short} 탭으로 — 종목 카드 보기`}>
                  {emoji} {s.short}
                </button>
              </span>
              {compact ? (
                <>
                  <div className="flex flex-wrap gap-x-3 text-[11.5px]"><span className="text-gray-400">해외</span><Avg v={ov} /><span className="text-gray-400">국내</span><Avg v={kr} /></div>
                  <div className="flex flex-wrap gap-x-3 text-[11px] text-gray-500"><span className="text-gray-400">해외</span>{ovBest && <span>▲ {mover(ovBest)}</span>}{ovWorst && <span>▼ {mover(ovWorst)}</span>}</div>
                  <div className="flex flex-wrap gap-x-3 text-[11px] text-gray-500"><span className="text-gray-400">국내</span>{best && <span>▲ {mover(best)}</span>}{worst && <span>▼ {mover(worst)}</span>}</div>
                </>
              ) : (
                <>
                  <Avg v={ov} big={mkt === "US"} />
                  <Avg v={kr} big={mkt === "KR"} />
                  <span className="min-w-0 flex flex-col leading-snug">
                    <span className="truncate"><span className="text-[10px] text-gray-400 mr-1">해외</span>{mover(ovBest) ?? <span className="text-gray-300">—</span>}</span>
                    <span className="truncate"><span className="text-[10px] text-gray-400 mr-1">국내</span>{mover(best) ?? <span className="text-gray-300">—</span>}</span>
                  </span>
                  <span className="min-w-0 flex flex-col leading-snug">
                    <span className="truncate"><span className="text-[10px] text-gray-400 mr-1">해외</span>{mover(ovWorst) ?? <span className="text-gray-300">—</span>}</span>
                    <span className="truncate"><span className="text-[10px] text-gray-400 mr-1">국내</span>{mover(worst) ?? <span className="text-gray-300">—</span>}</span>
                  </span>
                </>
              )}
            </div>
            {isOpen && multi && (
              <div className="border-t border-gray-100 px-2 py-1 space-y-0.5 text-[11.5px]">
                {s.rowLabels!.map((lb, i) => {
                  const r = rotRowAvg(s, i, pctOf, regExtOf);
                  return (
                    <div key={lb} className={compact ? "flex flex-wrap gap-x-3 pl-5" : "grid grid-cols-[150px_240px_240px] gap-x-3 items-baseline"}>
                      <span className="pl-5 text-gray-600">{lb}</span>
                      <Avg v={r.ov} /><Avg v={r.kr} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      <div className="px-1 text-[10.5px] text-gray-400">
        해외 = 업종 칸의 해외 대장주(미국은 장 밖이면 정규장 등락 + 꼬리표 = 프리·애프터, 일본은 지금 장중) · 국내 = 국내 종목(마감 뒤면 정규장 + 애프터 꼬리표) · 줄 순서 = {mkt === "US" ? "해외" : "국내"} 평균 큰 순(왼쪽 국내/해외 단추)
      </div>
    </div>
  );
}
