// 업종 한눈에 대시보드 — 지수(업종) '한눈에' 탭(사용자 2026-11-07 "한눈에는 요약만, 카드는 섹터별로" → "한눈에 보는 대시보드").
//   표 한 줄 = 업종 하나:  [업종 이름 / 해외 / 국내]  [칸1 이름 / 해외 / 국내]  [칸2 …] …
//            주기기·건설   설계·정비
//   원전 해외  해외 x      해외 y
//        국내  국내 x      국내 y
//   값 = 평균 등락(장 밖이면 정규장 % + 프리·애프터·데이 꼬리표) · ▲▼. 업종 이름 = 그 탭(카드 보기)으로.
//   줄 순서 = 지금 고른 국내/해외 평균 큰 순. PC·모바일이 같이 쓴다(compact = 모바일 — 칸이 줄 바꿈).
import type { DashboardSection } from "../lib/dashboardGroups";
import { useState } from "react";
import { avgOfSyms, rotRowAvg, isOverseasTicker, useAvgMarket, usSessionLabel, type RowAvg, type Ses } from "../lib/avgMarket";

type RegExt = (s: string) => { reg: number; aft: number; ses?: Ses } | null;
const tone = (v: number) => (v > 0 ? "text-rose-600" : v < 0 ? "text-blue-600" : "text-gray-600");
const fmt = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;

/** 한 칸 값 — 정규장 평균 또는 그 뒤(프리·애프터·데이) 평균. 표 위 단추로 표 전체를 바꾼다(칸이 좁아 꼬리표 대신, 사용자 2026-11-07 "정규장 프리/애프터 구분") */
type Mode = "reg" | "ext";
function Val({ label, v, strong, mode }: { label: string; v: RowAvg | null; strong?: boolean; mode: Mode }) {
  const x = !v ? null : mode === "ext" ? v.aft : v.avg;
  return (
    <span className="whitespace-nowrap tabular-nums leading-[18px] text-right min-w-0 overflow-hidden"
          title={v ? `${label} — 정규장 ${fmt(v.avg)}${v.aft != null ? ` · ${v.ses ?? "장외"} ${fmt(v.aft)}(정규장 종가 대비)` : " · 장외 값 없음"} · ▲${v.up}·▼${v.n - v.up}` : undefined}>
      {x == null ? <span className="text-gray-300 text-[12px]">—</span>
        : <b className={`${tone(x)} ${strong ? "text-[13px]" : "text-[12px]"}`}>{fmt(x)}</b>}
    </span>
  );
}
/** 해외 · 국내 — 부모 격자의 두 칸에 하나씩(세로줄 맞춤, 사용자 2026-11-07 "세로 줄 맞추자") */
function Pair({ ov, kr, strong, mode }: { ov: RowAvg | null; kr: RowAvg | null; strong?: "US" | "KR"; mode: Mode }) {
  return (
    <>
      <Val label="해외" v={ov} strong={strong === "US"} mode={mode} /><Val label="국내" v={kr} strong={strong === "KR"} mode={mode} />
    </>
  );
}
// 칸 안 격자 — [이름 | 해외 | 국내], 같은 열의 칸 폭이 같아 줄마다 숫자가 같은 세로선에 선다
const CELL = "grid grid-cols-[minmax(0,1fr)_3.9rem_3.9rem] items-baseline gap-x-1";
// 칸(기판·전공정…) — 한 줄 [이름 | 해외 | 국내](사용자 2026-11-07 "주기기/건설 해외 국내처럼 다 한 줄로").
//   숫자 칸 폭 고정·오른쪽 정렬 → 줄마다 같은 세로선. 칸이 좁아 프리·애프터 꼬리표는 ● 점 + 마우스 설명으로
const BOX = "grid grid-cols-[minmax(0,1fr)_3.7rem_3.7rem] items-baseline gap-x-1";

export function SectorSummaryBoard({ sections, pctOf, regExtOf, onOpen, compact }: {
  sections: DashboardSection[];                 // 업종 탭(한눈에 제외)
  pctOf: (s: string) => number | null;
  regExtOf: RegExt;
  nameOf?: (s: string) => string;
  onOpen: (sectionId: string) => void;
  renderDetail?: unknown;                        // (예전 칸 제목 펼치기 — 지금은 표가 대신)
  compact?: boolean;
}) {
  const mkt = useAvgMarket();
  const [mode, setMode] = useState<Mode>("reg");
  const rows = sections.map(s => {
    const all = s.rows.flat();
    return {
      s,
      ov: avgOfSyms(all.filter(isOverseasTicker), pctOf, regExtOf),
      kr: avgOfSyms(all.filter(x => /\.(KS|KQ)$/.test(x)), pctOf, regExtOf),
      boxes: (s.rowLabels ?? []).map((lb, i) => ({ lb, ...rotRowAvg(s, i, pctOf, regExtOf) })),
    };
  }).sort((a, b) => {
    const k = (r: typeof a) => (mkt === "US" ? r.ov?.avg : r.kr?.avg) ?? -Infinity;
    return k(b) - k(a);
  });
  const maxBoxes = Math.max(1, ...rows.map(r => r.boxes.length));

  return (
    <div className="space-y-1">
      {/* 정규장 ↔ 프리·애프터 — 표 전체 숫자를 바꾼다. 장외 = 정규장 종가 대비 지금(미국 프리·애프터·데이, 국내 NXT 애프터) */}
      <div className="flex items-center gap-2 px-1 text-[11px]">
        <span className="inline-flex rounded border border-gray-300 overflow-hidden font-bold">
          {([["reg", "정규장"], ["ext", "프리·애프터"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setMode(k)} className={`px-2 py-0.5 ${mode === k ? "bg-indigo-600 text-white" : "bg-white text-gray-500 hover:bg-gray-100"}`}>{l}</button>
          ))}
        </span>
        <span className="text-gray-400">{mode === "reg" ? "마지막 정규장 등락(장중이면 지금)" : `정규장 종가 대비 그 뒤 움직임 — 미국 지금 '${usSessionLabel()}', 국내 NXT 애프터(15:30~20:00) · 값 없으면 —`}</span>
      </div>
      {/* 표 머리 — 해외 · 국내(칸마다 같은 자리) */}
      {!compact && (
        <div className="grid sticky top-0 z-10 bg-white/95 text-[11px] font-bold text-gray-500 border-b border-gray-200" style={{ gridTemplateColumns: `250px repeat(${maxBoxes}, minmax(0, 1fr))` }}>
          <div className={`px-2 py-0.5 ${CELL}`}><span>업종</span><span className="text-right">해외</span><span className="text-right">국내</span></div>
          {Array.from({ length: maxBoxes }, (_, i) => (
            <div key={i} className={`px-1.5 py-0.5 ${BOX} ${i > 0 ? "border-l border-gray-100" : ""}`}><span /><span className="text-right">해외</span><span className="text-right">국내</span></div>
          ))}
        </div>
      )}
      {rows.map(({ s, ov, kr, boxes }) => {
        const emoji = s.label.split(" ")[0];
        return (
          <div key={s.id} className={`rounded-lg border border-gray-200 bg-white ${compact ? "p-1.5 space-y-1" : "grid items-stretch"}`}
               style={compact ? undefined : { gridTemplateColumns: `250px repeat(${maxBoxes}, minmax(0, 1fr))` }}>
            {/* 업종 칸 — 이름 + 업종 전체 해외·국내 */}
            <div className={`px-2 py-1 ${CELL} ${compact ? "" : "border-r border-gray-200 bg-gray-50/70 rounded-l-lg"}`}>   {/* 이름·해외·국내 한 줄(사용자 2026-11-07) */}
              <button onClick={() => onOpen(s.id)} className="font-bold text-[13px] text-gray-800 hover:text-indigo-700 hover:underline whitespace-nowrap truncate text-left" title={`${s.short} 탭으로 — 종목 카드 보기`}>
                {emoji} {s.short} <span className="text-[10px] font-normal text-indigo-400">→</span>
              </button>
              <Pair ov={ov} kr={kr} strong={mkt} mode={mode} />
            </div>
            {/* 칸들 — 이름 + 해외·국내 */}
            {compact
              ? <div className="grid grid-cols-1 gap-0.5">
                  {boxes.map(b => (
                    <div key={b.lb} className={`rounded border border-gray-100 px-1.5 py-0.5 ${CELL}`}>
                      <span className="text-[11px] font-bold text-gray-600 truncate">{b.lb}</span>
                      <Pair ov={b.ov} kr={b.kr} mode={mode} />
                    </div>
                  ))}
                </div>
              : boxes.map((b, i) => (
                  <div key={b.lb} className={`px-1.5 py-1 min-w-0 ${BOX} ${i > 0 ? "border-l border-gray-100" : ""}`}>
                    <span className="text-[11.5px] font-bold text-gray-600 truncate tracking-tight" title={b.lb}>{b.lb}</span>
                    <Pair ov={b.ov} kr={b.kr} mode={mode} />
                  </div>
                ))}
          </div>
        );
      })}
      <div className="px-1 text-[10.5px] text-gray-400">
        해외 = 해외 대장주 평균(미국·일본) · 국내 = 국내 종목 평균 · 숫자에 마우스를 올리면 정규장·장외 둘 다와 ▲▼ 개수 · 업종 이름을 누르면 그 탭(카드) · 순서 = {mkt === "US" ? "해외" : "국내"} 평균 큰 순(왼쪽 국내/해외 단추)
      </div>
    </div>
  );
}
