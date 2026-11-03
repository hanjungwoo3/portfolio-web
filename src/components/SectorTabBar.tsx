// 지수(업종) 페이지 안 탭 — 소부장·2차전지·조선·방산·원전·화장품 중 하나만 보여 준다(사용자 2026-11-03 "내부 탭으로").
//   PC·모바일이 같이 쓴다. 고른 탭은 이 기기에 기억(localStorage).
import { useState } from "react";
import type { DashboardSection } from "../lib/dashboardGroups";

const KEY = "portfolio_sector_page_tab";
export function useSectorTab(sections: DashboardSection[]): [string, (id: string) => void] {
  const [id, setId] = useState<string>(() => { try { return localStorage.getItem(KEY) ?? ""; } catch { return ""; } });
  const cur = sections.some(s => s.id === id) ? id : sections[0]?.id ?? "";
  const set = (v: string) => { setId(v); try { localStorage.setItem(KEY, v); } catch { /* 저장 실패 — 이번만 */ } };
  return [cur, set];
}

// 업종 평균 — 국내 종목(.KS) 등락률 단순 평균, 흐린 종목(장 안 열림)은 빼고(다 흐리면 전부). 탭 아래 작게(사용자 2026-11-03)
export function sectorAvg(s: DashboardSection, pctOf: (sym: string) => number | null, dimOf?: (sym: string) => boolean): number | null {
  const kr = s.rows.flat().filter(x => /\.KS$/.test(x));
  const live = kr.filter(x => !dimOf?.(x));
  const ps = (live.length ? live : kr).map(pctOf).filter((v): v is number => v != null && Number.isFinite(v));
  return ps.length ? ps.reduce((a, v) => a + v, 0) / ps.length : null;
}

export function SectorTabBar({ sections, active, onChange, trailing, compact, avgOf, vertical }: {
  sections: DashboardSection[]; active: string; onChange: (id: string) => void; trailing?: React.ReactNode; compact?: boolean;
  avgOf?: (s: DashboardSection) => number | null;
  vertical?: boolean;   // PC 왼쪽 세로 탭
}) {
  return (
    <div className={vertical ? "flex flex-col gap-1" : `flex items-center gap-1 overflow-x-auto ${compact ? "pb-0.5" : ""}`}>
      {sections.map(s => {
        const on = s.id === active;
        const emoji = s.label.split(" ")[0];
        const avg = avgOf?.(s);
        const tone = avg == null ? "" : avg > 0 ? (on ? "text-rose-200" : "text-rose-600") : avg < 0 ? (on ? "text-sky-200" : "text-blue-600") : (on ? "text-white/80" : "text-gray-500");
        return (
          <button key={s.id} onClick={() => onChange(s.id)} title="국내 종목 평균 등락률(흐린 종목 제외)"
                  className={`shrink-0 inline-flex flex-col ${vertical ? "items-start w-full px-1 py-0.5" : "items-center"} leading-tight rounded-xl border ${vertical ? "text-[11px]" : compact ? "px-2 py-0.5 text-[12px]" : "px-3 py-1 text-sm"} font-bold transition
                              ${on ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}>
            <span className="inline-flex items-center gap-1"><span>{emoji}</span>{s.short}</span>
            {avg != null && <span className={`tabular-nums ${compact ? "text-[10px]" : "text-[11px]"} ${tone}`}>{avg > 0 ? "+" : ""}{avg.toFixed(2)}%</span>}
          </button>
        );
      })}
      {trailing && <span className="ml-2 shrink-0">{trailing}</span>}
    </div>
  );
}
