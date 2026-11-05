// 지수(업종) 페이지 안 탭 — 소부장·2차전지·조선·방산·원전·화장품 중 하나만 보여 준다(사용자 2026-11-03 "내부 탭으로").
//   PC·모바일이 같이 쓴다. 고른 탭은 이 기기에 기억(localStorage).
import { useState } from "react";
import { SECTOR_OVERVIEW_IDS, type DashboardSection } from "../lib/dashboardGroups";

const KEY = "portfolio_sector_page_tab";
const OVERVIEW = "overview";
/** 탭 목록 — 맨 앞 '한눈에'(옛 순환매 페이지, 평균은 순환매 줄 종목) + 업종(sobuGrid) */
export function sectorTabsOf(page: DashboardSection[]): DashboardSection[] {
  const rot = page.find(s => s.id === "rotflow");
  const ov = rot ? [{ ...rot, id: OVERVIEW, short: "한눈에", label: "🔄 한눈에" }] : [];
  return [...ov, ...page.filter(s => s.render === "sobuGrid")];
}
/** 고른 탭에 보일 블록 */
export function sectionsForTab(page: DashboardSection[], tab: string): DashboardSection[] {
  return tab === OVERVIEW ? page.filter(s => SECTOR_OVERVIEW_IDS.has(s.id)) : page.filter(s => s.id === tab);
}
export function useSectorTab(sections: DashboardSection[]): [string, (id: string) => void] {
  const [id, setId] = useState<string>(() => { try { return localStorage.getItem(KEY) ?? ""; } catch { return ""; } });
  const cur = sections.some(s => s.id === id) ? id : sections[0]?.id ?? "";
  const set = (v: string) => { setId(v); try { localStorage.setItem(KEY, v); } catch { /* 저장 실패 — 이번만 */ } };
  return [cur, set];
}

// 업종 평균 — 국내 종목(.KS) 등락률 단순 평균, 흐린 종목(장 안 열림)은 빼고(다 흐리면 전부). 탭 아래 작게(사용자 2026-11-03)
//   aft = 정규장 마감 뒤(NXT 애프터) 등락률 평균 — 정규장 종가 대비 지금 값(사용자 2026-11-05 "정규장 이후 등락율 평균도"). 애프터 값 있는 종목만
export interface SectorStat { avg: number; up: number; down: number; aft?: number; aftN?: number }
export function sectorAvg(s: DashboardSection, pctOf: (sym: string) => number | null, dimOf?: (sym: string) => boolean, afterOf?: (sym: string) => { reg: number; aft: number } | null): SectorStat | null {
  const kr = s.rows.flat().filter(x => /\.KS$/.test(x));
  const live = kr.filter(x => !dimOf?.(x));
  const ps = (live.length ? live : kr).map(pctOf).filter((v): v is number => v != null && Number.isFinite(v));
  if (!ps.length) return null;
  // ▲▼ 종목 수도 같이(사용자 2026-11-03 "+- 개수도 탭에")
  // 정규장 마감 뒤 — 평균은 정규장 등락률로, 애프터는 따로(사용자 2026-11-05 "정규장%(애프터%) 이렇게")
  const ra = afterOf ? kr.map(afterOf).filter((v): v is { reg: number; aft: number } => !!v && Number.isFinite(v.reg) && Number.isFinite(v.aft)) : [];
  if (ra.length) {
    const rp = ra.map(v => v.reg);
    return { avg: rp.reduce((a, v) => a + v, 0) / rp.length, up: rp.filter(v => v > 0).length, down: rp.filter(v => v < 0).length,
      aft: ra.reduce((a, v) => a + v.aft, 0) / ra.length, aftN: ra.length };
  }
  return { avg: ps.reduce((a, v) => a + v, 0) / ps.length, up: ps.filter(v => v > 0).length, down: ps.filter(v => v < 0).length };
}

/** 애프터 꼬리표 — 카드 오른쪽 위 배지와 같은 꼴(정규장 종가 대비 지금, 사용자 2026-11-05) */
export function AftPill({ v, n }: { v: number; n?: number }) {
  return (
    <span className={`tabular-nums ml-1 font-bold text-white px-1 rounded ${v > 0 ? "bg-rose-600/60" : v < 0 ? "bg-blue-600/60" : "bg-gray-400/60"}`}
          title={`정규장 마감 뒤(NXT 애프터) 등락률 평균 — 정규장 종가 대비 지금 값${n ? `, ${n}종목` : ""}`}>
      {v > 0 ? "+" : v < 0 ? "−" : ""}{Math.abs(v).toFixed(2)}%
    </span>
  );
}

export function SectorTabBar({ sections, active, onChange, trailing, compact, avgOf, vertical }: {
  sections: DashboardSection[]; active: string; onChange: (id: string) => void; trailing?: React.ReactNode; compact?: boolean;
  avgOf?: (s: DashboardSection) => SectorStat | null;
  vertical?: boolean;   // PC 왼쪽 세로 탭
}) {
  return (
    <div className={vertical ? "flex flex-col gap-1" : `flex items-center gap-1 overflow-x-auto ${compact ? "pb-0.5" : ""}`}>
      {/* 업종 탭은 평균 등락률 높은 순(사용자 2026-11-03) — '한눈에' 는 맨 앞 고정, 값 없는 탭은 뒤로 */}
      {(() => {
        const st = new Map(sections.map(x => [x.id, avgOf?.(x)?.avg ?? null]));
        return [...sections].sort((a, b) => (a.id === OVERVIEW ? -1 : b.id === OVERVIEW ? 1 : (st.get(b.id) ?? -Infinity) - (st.get(a.id) ?? -Infinity)));
      })().map(s => {
        const on = s.id === active;
        const emoji = s.label.split(" ")[0];
        const st = avgOf?.(s);
        const avg = st?.avg ?? null;
        const tone = avg == null ? "" : avg > 0 ? "text-rose-600" : avg < 0 ? "text-blue-600" : "text-gray-500";
        return (
          <button key={s.id} onClick={() => onChange(s.id)} title="국내 종목 평균 등락률·오른/내린 종목 수(흐린 종목 제외)"
                  className={`shrink-0 inline-flex flex-col ${vertical ? "items-center text-center w-full px-1.5 py-1" : "items-center"} leading-tight rounded-xl border ${vertical ? "text-[13px]" : compact ? "px-2 py-0.5 text-[12px]" : "px-3 py-1 text-sm"} font-bold transition
                              ${on ? "bg-indigo-50 text-indigo-900 border-indigo-600 ring-2 ring-indigo-600" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}>
            <span className="inline-flex items-center gap-1"><span>{emoji}</span>{s.short}</span>
            {avg != null && <span className={`tabular-nums whitespace-nowrap ${vertical ? "text-[12px]" : compact ? "text-[10px]" : "text-[11px]"} ${tone}`}>{avg > 0 ? "+" : ""}{avg.toFixed(2)}%{st?.aft != null && <AftPill v={st.aft} n={st.aftN} />}</span>}
            {st && <span className={`tabular-nums font-normal whitespace-nowrap ${vertical ? "text-[11px]" : compact ? "text-[9.5px]" : "text-[10px]"} text-gray-500`}>
              {vertical   /* 세로 탭은 폭이 넉넉해 글자로(사용자 2026-11-03 "상승·하락 글자도") */
                ? <><span className="text-rose-600">상승 {st.up}</span> · <span className="text-blue-600">하락 {st.down}</span></>
                : <><span className="text-rose-600">▲{st.up}</span> <span className="text-blue-600">▼{st.down}</span></>}
            </span>}
          </button>
        );
      })}
      {trailing && <span className="ml-2 shrink-0">{trailing}</span>}
    </div>
  );
}
