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

export function SectorTabBar({ sections, active, onChange, trailing, compact }: {
  sections: DashboardSection[]; active: string; onChange: (id: string) => void; trailing?: React.ReactNode; compact?: boolean;
}) {
  return (
    <div className={`flex items-center gap-1 overflow-x-auto ${compact ? "pb-0.5" : ""}`}>
      {sections.map(s => {
        const on = s.id === active;
        const emoji = s.label.split(" ")[0];
        return (
          <button key={s.id} onClick={() => onChange(s.id)}
                  className={`shrink-0 inline-flex items-center gap-1 rounded-full border ${compact ? "px-2 py-0.5 text-[12px]" : "px-3 py-1 text-sm"} font-bold transition
                              ${on ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}>
            <span>{emoji}</span>{s.short}
          </button>
        );
      })}
      {trailing && <span className="ml-2 shrink-0">{trailing}</span>}
    </div>
  );
}
