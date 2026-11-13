// 지수(업종) 페이지 안 탭 — 소부장·2차전지·조선·방산·원전·화장품 중 하나만 보여 준다(사용자 2026-11-03 "내부 탭으로").
//   PC·모바일이 같이 쓴다. 고른 탭은 이 기기에 기억(localStorage).
import { useState } from "react";
import { SECTOR_OVERVIEW_IDS, type DashboardSection } from "../lib/dashboardGroups";
import { avgMarketNow, isOverseasTicker, useAvgMarket } from "../lib/avgMarket";

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
  // 미국 모드 — 칸의 미국 대장주로(간밤·지금 미국장), 애프터 꼬리표 없음(사용자 2026-11-05)
  if (avgMarketNow() === "US") {
    const us = s.rows.flat().filter(isOverseasTicker);
    // 미국 장 밖이면 평균 = 정규장 등락, 꼬리표 = 프리·애프터(정규장 종가 대비) — 국내 "정규장%(애프터%)"와 같은 꼴
    const ext = us.map(x => afterOf?.(x) ?? null);
    const up = us.map((x, i) => ext[i]?.reg ?? pctOf(x)).filter((v): v is number => v != null && Number.isFinite(v));
    const ea = ext.filter((v): v is { reg: number; aft: number } => !!v && Number.isFinite(v.aft) && Math.abs(v.aft) >= 0.005);   // 0 = 값 없음
    return up.length ? { avg: up.reduce((a, v) => a + v, 0) / up.length, up: up.filter(v => v > 0).length, down: up.filter(v => v < 0).length,
      ...(ea.length ? { aft: ea.reduce((a, v) => a + v.aft, 0) / ea.length, aftN: ea.length } : {}) } : null;
  }
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
      ...(() => { const nz = ra.filter(v => Math.abs(v.aft) >= 0.005); return nz.length ? { aft: nz.reduce((a, v) => a + v.aft, 0) / nz.length, aftN: nz.length } : {}; })() };
  }
  return { avg: ps.reduce((a, v) => a + v, 0) / ps.length, up: ps.filter(v => v > 0).length, down: ps.filter(v => v < 0).length };
}

/** 애프터 꼬리표 — 카드 오른쪽 위 배지와 같은 꼴(정규장 종가 대비 지금, 사용자 2026-11-05) */
export function AftPill({ v, n, label }: { v: number; n?: number; label?: string }) {
  return (
    <span className={`tabular-nums ml-1 font-bold text-white px-1 rounded ${v > 0 ? "bg-rose-600/60" : v < 0 ? "bg-blue-600/60" : "bg-gray-400/60"}`}
          title={`정규장 마감 뒤(${label ?? "애프터"}) 등락률 평균 — 정규장 종가 대비 지금 값${n ? `, ${n}종목` : ""}`}>
      {label && <span className="font-normal mr-0.5 opacity-90">{label}</span>}{v > 0 ? "+" : v < 0 ? "−" : ""}{Math.abs(v).toFixed(2)}%
    </span>
  );
}

/** 정규장 평균 + 장외 평균 — 업종 한눈에·타일과 같은 꼴(사용자 2026-11-12 "여기도 통일하자"):
 *  장외 값이 없으면 정규 % 하나, 있으면 '정규 x%' 작게 + 장외 % 크게(구간 이름은 마우스를 올리면).
 *  stacked = 위아래 두 줄(세로 탭), 아니면 한 줄(칸 머리). */
export function RegAftValue({ avg, aft, n, stacked, prefix, className = "" }: { avg: number; aft?: number | null; n?: number; stacked?: boolean; prefix?: string; className?: string }) {
  const tone = (v: number) => v > 0 ? "text-rose-600" : v < 0 ? "text-blue-600" : "text-gray-500";
  const f = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
  if (aft == null) return <span className={`tabular-nums ${tone(avg)} ${className}`}>{prefix ? `${prefix} ` : ""}{f(avg)}</span>;
  const reg = <span className={`text-[9.5px] font-normal opacity-70 ${tone(avg)} ${stacked ? "block" : "mr-1"}`} title="정규장 평균(전일 종가 대비)">정규 {f(avg)}</span>;
  return (
    <span className={`tabular-nums ${stacked ? "inline-flex flex-col items-center leading-tight" : ""} ${className}`}>
      {stacked ? reg : <>{prefix && <span className={tone(aft)}>{prefix} </span>}{reg}</>}
      <span className={tone(aft)} title={`정규장 마감 뒤(프리·애프터) 평균 — 정규장 종가 대비 지금${n ? `, ${n}종목` : ""}`}>{stacked && prefix ? `${prefix} ` : ""}{f(aft)}</span>
    </span>
  );
}

/** 업종 탭 사이에 같은 꼴로 끼는 기준선(KODEX 200·코스닥150 등) — 같은 꼴·상승/하락 수, 맨 위 고정(사용자 2026-11-13) */
export interface TabExtra { id: string; label: string; pct: number | null; aft?: number | null; up: number; down: number; onClick: () => void; hint?: string }   // aft = 장 밖 움직임(있으면 정규 작게·이것 크게)

export function SectorTabBar({ sections, active, onChange, trailing, compact, avgOf, vertical, extras = [] }: {
  extras?: TabExtra[];
  sections: DashboardSection[]; active: string; onChange: (id: string) => void; trailing?: React.ReactNode; compact?: boolean;
  avgOf?: (s: DashboardSection) => SectorStat | null;
  vertical?: boolean;   // PC 왼쪽 세로 탭
}) {
  useAvgMarket();   // 한국/미국 전환에 다시 그리기(평균은 avgOf → sectorAvg 가 avgMarketNow 로 읽는다)
  // 탭마다 평균은 한 번만 — 정렬과 그리기에서 두 번 계산하던 것(무거움 실측, 2026-11-13)
  const stats = new Map(sections.map(x => [x.id, avgOf?.(x) ?? null]));
  return (
    <div className={vertical ? "flex flex-col gap-1" : `flex items-center gap-1 overflow-x-auto ${compact ? "pb-0.5" : ""}`}>
      {/* 업종 탭은 평균 등락률 높은 순(사용자 2026-11-03) — '한눈에' 는 맨 앞 고정, 값 없는 탭은 뒤로 */}
      {(() => {
        const st = new Map(sections.map(x => { const v = stats.get(x.id); return [x.id, v ? (v.aft ?? v.avg) : null]; }));   // 크게 보이는 값(장외 있으면 장외) 순
        type Item = { kind: "sec"; s: DashboardSection; v: number | null } | { kind: "ext"; e: TabExtra; v: number | null };
        const items: Item[] = [...sections.map(s => ({ kind: "sec" as const, s, v: st.get(s.id) ?? null })), ...extras.map(e => ({ kind: "ext" as const, e, v: e.pct }))];
        // 기준선(extras)은 맨 위 고정 — 정렬에 안 섞는다(사용자 2026-11-13 "sort 는 그대로 두고"). 그다음 한눈에, 나머지는 값 순
        const rank = (i: Item) => i.kind === "ext" ? 0 : i.s.id === OVERVIEW ? 1 : 2;
        return items.sort((a, b) => rank(a) - rank(b) || (rank(a) < 2 ? 0 : (b.v ?? -Infinity) - (a.v ?? -Infinity)));
      })().map(it => it.kind === "ext" ? (() => {
        const e = it.e;
        const updown = vertical
          ? <span className="flex flex-col items-start tabular-nums font-normal whitespace-nowrap text-[10.5px] leading-tight"><span className="text-rose-600">상승 {e.up}</span><span className="text-blue-600">하락 {e.down}</span></span>
          : <span className={`tabular-nums font-normal whitespace-nowrap ${compact ? "text-[9.5px]" : "text-[10px]"}`}><span className="text-rose-600">▲{e.up}</span> <span className="text-blue-600">▼{e.down}</span></span>;
        return (
          <button key={e.id} onClick={e.onClick} title={e.hint}
                  className={`shrink-0 inline-flex flex-col items-center leading-tight rounded-xl border border-dashed border-gray-400 bg-gray-50 hover:bg-gray-100 text-gray-700 font-bold ${vertical ? "text-center w-full px-1.5 py-1 text-[13px]" : compact ? "px-2 py-0.5 text-[12px]" : "px-3 py-1 text-sm"}`}>
            <span>📊 {e.label}</span>
            {vertical
              ? <span className="flex items-center justify-center gap-2 w-full">{e.pct != null && <RegAftValue avg={e.pct} aft={e.aft} stacked className="whitespace-nowrap text-[12px]" />}{e.up + e.down > 0 && updown}</span>
              : <>{e.pct != null && <RegAftValue avg={e.pct} aft={e.aft} stacked className={`whitespace-nowrap ${compact ? "text-[10px]" : "text-[11px]"}`} />}{e.up + e.down > 0 && updown}</>}
          </button>
        );
      })() : (() => { const s = it.s;
        const on = s.id === active;
        const emoji = s.label.split(" ")[0];
        const st = stats.get(s.id);
        const avg = st?.avg ?? null;
        return (
          <button key={s.id} onClick={() => onChange(s.id)} title="국내 종목 평균 등락률·오른/내린 종목 수(흐린 종목 제외)"
                  className={`shrink-0 inline-flex flex-col ${vertical ? "items-center text-center w-full px-1.5 py-1" : "items-center"} leading-tight rounded-xl border ${vertical ? "text-[13px]" : compact ? "px-2 py-0.5 text-[12px]" : "px-3 py-1 text-sm"} font-bold transition
                              ${on ? "bg-indigo-50 text-indigo-900 border-indigo-600 ring-2 ring-indigo-600" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}>
            <span className="inline-flex items-center gap-1"><span>{emoji}</span>{s.short}</span>
            {/* 세로 탭 = 왼쪽 등락률 · 오른쪽 상승/하락 두 줄(사용자 2026-11-12 "상승 하락을 오른쪽으로 나누면") */}
            {vertical ? (st || avg != null) && (
              <span className="flex items-center justify-center gap-2 w-full">
                {avg != null && <RegAftValue avg={avg} aft={st?.aft} n={st?.aftN} stacked className="whitespace-nowrap text-[12px]" />}
                {st && <span className="flex flex-col items-start tabular-nums font-normal whitespace-nowrap text-[10.5px] leading-tight">
                  <span className="text-rose-600">상승 {st.up}</span><span className="text-blue-600">하락 {st.down}</span>
                </span>}
              </span>
            ) : (<>
              {avg != null && <RegAftValue avg={avg} aft={st?.aft} n={st?.aftN} stacked className={`whitespace-nowrap ${compact ? "text-[10px]" : "text-[11px]"}`} />}
              {st && <span className={`tabular-nums font-normal whitespace-nowrap ${compact ? "text-[9.5px]" : "text-[10px]"} text-gray-500`}>
                <span className="text-rose-600">▲{st.up}</span> <span className="text-blue-600">▼{st.down}</span>
              </span>}
            </>)}
          </button>
        );
      })())}
      {trailing && <span className="ml-2 shrink-0">{trailing}</span>}
    </div>
  );
}
