// 업종 한눈에 대시보드 — 지수(업종) '한눈에' 탭(사용자 2026-11-07 "한눈에는 요약만, 카드는 섹터별로" → "한눈에 보는 대시보드").
//   표 한 줄 = 업종 하나:  [업종 이름 / 해외 / 국내]  [칸1 이름 / 해외 / 국내]  [칸2 …] …
//            주기기·건설   설계·정비
//   원전 해외  해외 x      해외 y
//        국내  국내 x      국내 y
//   값 = 평균 등락(장 밖이면 정규장 % + 프리·애프터·데이 꼬리표) · ▲▼. 업종 이름 = 그 탭(카드 보기)으로.
//   줄 순서 = 지금 고른 국내/해외 평균 큰 순. PC·모바일이 같이 쓴다(compact = 모바일 — 칸이 줄 바꿈).
import type { DashboardSection } from "../lib/dashboardGroups";
import { avgOfSyms, rotRowAvg, isOverseasTicker, useAvgMarket, type RowAvg, type Ses } from "../lib/avgMarket";
import { AftPill } from "./SectorTabBar";

type RegExt = (s: string) => { reg: number; aft: number; ses?: Ses } | null;
const tone = (v: number) => (v > 0 ? "text-rose-600" : v < 0 ? "text-blue-600" : "text-gray-600");
const fmt = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;

/** 한 줄 값 — 라벨 · 평균(정규) · 꼬리표 · ▲▼ */
function Val({ label, v, strong }: { label: string; v: RowAvg | null; strong?: boolean }) {
  return (
    <div className="flex items-baseline gap-1 whitespace-nowrap tabular-nums leading-[18px]">
      <span className="w-6 shrink-0 text-[10.5px] text-gray-400">{label}</span>
      {!v ? <span className="text-gray-300 text-[12px]">—</span> : (
        <>
          <b className={`${tone(v.avg)} ${strong ? "text-[13px]" : "text-[12px]"}`}>{fmt(v.avg)}</b>
          {v.aft != null && <AftPill v={v.aft} label={v.ses ?? "장외"} />}
          <span className="text-[10px] text-gray-400">▲{v.up}·▼{v.n - v.up}</span>
        </>
      )}
    </div>
  );
}

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
      {rows.map(({ s, ov, kr, boxes }) => {
        const emoji = s.label.split(" ")[0];
        return (
          <div key={s.id} className={`rounded-lg border border-gray-200 bg-white ${compact ? "p-1.5 space-y-1" : "grid items-stretch"}`}
               style={compact ? undefined : { gridTemplateColumns: `170px repeat(${maxBoxes}, minmax(0, 1fr))` }}>
            {/* 업종 칸 — 이름 + 업종 전체 해외·국내 */}
            <div className={`px-2 py-1 ${compact ? "" : "border-r border-gray-200 bg-gray-50/70 rounded-l-lg"}`}>
              <button onClick={() => onOpen(s.id)} className="font-bold text-[13px] text-gray-800 hover:text-indigo-700 hover:underline whitespace-nowrap" title={`${s.short} 탭으로 — 종목 카드 보기`}>
                {emoji} {s.short} <span className="text-[10px] font-normal text-indigo-400">→</span>
              </button>
              <Val label="해외" v={ov} strong={mkt === "US"} />
              <Val label="국내" v={kr} strong={mkt === "KR"} />
            </div>
            {/* 칸들 — 이름 + 해외·국내 */}
            {compact
              ? <div className="grid grid-cols-2 gap-1">
                  {boxes.map(b => (
                    <div key={b.lb} className="rounded border border-gray-100 px-1.5 py-0.5">
                      <div className="text-[11px] font-bold text-gray-600 truncate">{b.lb}</div>
                      <Val label="해외" v={b.ov} /><Val label="국내" v={b.kr} />
                    </div>
                  ))}
                </div>
              : boxes.map((b, i) => (
                  <div key={b.lb} className={`px-2 py-1 min-w-0 ${i > 0 ? "border-l border-gray-100" : ""}`}>
                    <div className="text-[12px] font-bold text-gray-600 truncate">{b.lb}</div>
                    <Val label="해외" v={b.ov} /><Val label="국내" v={b.kr} />
                  </div>
                ))}
          </div>
        );
      })}
      <div className="px-1 text-[10.5px] text-gray-400">
        해외 = 해외 대장주(미국은 장 밖이면 정규장 등락 + 꼬리표 = 프리·애프터·데이, 일본은 지금 장중) · 국내 = 국내 종목(마감 뒤면 정규장 + 애프터 꼬리표) · 업종 이름을 누르면 그 탭(카드) · 순서 = {mkt === "US" ? "해외" : "국내"} 평균 큰 순
      </div>
    </div>
  );
}
