// 업종 한눈에 대시보드 — 지수(업종) '한눈에' 탭(사용자 2026-11-07 "한눈에는 요약만, 카드는 섹터별로" → "한눈에 보는 대시보드").
//   표 한 줄 = 업종 하나:  [업종 이름 / 해외 / 국내]  [칸1 이름 / 해외 / 국내]  [칸2 …] …
//            주기기·건설   설계·정비
//   원전 해외  해외 x      해외 y
//        국내  국내 x      국내 y
//   값 = 평균 등락(장 밖이면 정규장 % + 프리·애프터·데이 꼬리표) · ▲▼. 업종 이름 = 그 탭(카드 보기)으로.
//   줄 순서 = 지금 고른 국내/해외 평균 큰 순. PC·모바일이 같이 쓴다(compact = 모바일 — 칸이 줄 바꿈).
import { openTilePopup } from "../lib/tilePopupNav";
import type { DashboardSection } from "../lib/dashboardGroups";
import { isMarketOpen } from "../lib/format";
import { avgOfSyms, rotRowAvg, isOverseasTicker, useAvgMarket, usSessionLabel, type RowAvg, type Ses } from "../lib/avgMarket";

type RegExt = (s: string) => { reg: number; aft: number; ses?: Ses } | null;
const tone = (v: number) => (v > 0 ? "text-rose-600" : v < 0 ? "text-blue-600" : "text-gray-600");
const fmt = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;

export function SectorSummaryBoard({ sections, pctOf, regExtOf, onOpen, compact, nameOf }: {
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
      boxes: (s.rowLabels ?? []).map((lb, i) => ({ lb, syms: s.rows[i] ?? [], ...rotRowAvg(s, i, pctOf, regExtOf) })),
    };
  }).sort((a, b) => {
    const k = (r: typeof a) => (mkt === "US" ? r.ov?.avg : r.kr?.avg) ?? -Infinity;
    return k(b) - k(a);
  });
  // 업종마다 카드 하나(사용자 2026-11-07 "업종별로 레이어를 분리") — 맨 위 업종 이름·해외·국내(크게), 아래 칸마다 한 줄씩.
  //   카드 안은 [이름 | 해외 | 국내] 고정 격자라 칸 줄끼리 세로줄이 맞는다. 카드 순서 = 고른 국내/해외 평균 큰 순.
  return (
    <div className="space-y-1.5">
      <div className="px-1 text-[10.5px] text-gray-400">숫자 = 정규장 평균 · 아래 꼬리표 = 그 뒤({isMarketOpen("US_INDEX") ? "미국은 지금 정규장 중" : `미국 지금 '${usSessionLabel()}'`} · 국내 NXT 애프터) 정규장 종가 대비 — 장중이면 꼬리표 없음 </div>
      <div className={`grid gap-2 ${compact ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"}`}>
        {rows.map(({ s, ov, kr, boxes }) => {
          const emoji = s.label.split(" ")[0];
          return (
            // 거래원 칸처럼 단순하게 — 줄마다 "이름 +11.33% (해외 +8.10%)" + 아래 얇은 상승·하락 선(사용자 2026-11-11 "업종 카드 구성이 너무 산만해")
            <div key={s.id} className="rounded-lg border border-gray-200 bg-white shadow-sm px-2.5 py-1.5">
              <SimpleRow name={<button onClick={() => onOpen(s.id)} className="font-bold text-[14px] hover:text-indigo-700 hover:underline whitespace-nowrap truncate" title={`${s.short} 탭으로 — 종목 카드 보기`}>{emoji} {s.short}</button>}
                         main={mkt === "US" ? ov : kr} other={mkt === "US" ? kr : ov} otherLb={mkt === "US" ? "국내" : "해외"} scale={1} big />
              <div className="mt-1 pt-0.5 border-t border-gray-100">
                {boxes.map(b => {
                  const main = mkt === "US" ? b.ov : b.kr, all = mkt === "US" ? ov : kr;
                  return (
                    <SimpleRow key={b.lb}
                               name={<button type="button" onClick={() => openTilePopup({ title: `${s.short} · ${b.lb}`, items: b.syms.map(x => { const e = regExtOf(x); return { sym: x, name: nameOf?.(x) ?? x, pct: pctOf(x), reg: e?.reg ?? null, aft: e && Math.abs(e.aft) >= 0.005 ? e.aft : null, ses: e?.ses }; }) })}
                                             className="text-[12.5px] font-medium truncate hover:text-indigo-700 hover:underline text-left"
                                             title={(() => { const k = b.syms.filter(x => /\.(KS|KQ)$/.test(x)).length; return `${b.lb} 종목 ${b.syms.length}개(국내 ${k} · 해외 ${b.syms.length - k})를 타일로 보기`; })()}>{b.lb}</button>}
                               main={main} other={mkt === "US" ? b.kr : b.ov} otherLb={mkt === "US" ? "국내" : "해외"}
                               scale={main && all && all.n > 0 ? main.n / all.n : 1} />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="px-1 text-[10.5px] text-gray-400">
        해외 = 해외 대장주 평균(미국·일본) · 국내 = 국내 종목 평균 · 업종 이름을 누르면 그 탭(카드) · 카드 순서 = {mkt === "US" ? "해외" : "국내"} 평균 큰 순(왼쪽 국내/해외 단추)
      </div>
    </div>
  );
}


/** 한 줄 — 이름 · 고른 쪽 평균(크게) · 장외 꼬리표 · (다른 쪽 평균, 작게) + 바로 아래 얇은 상승·하락 선(길이 = 업종 전체 대비 종목 수) */
function SimpleRow({ name, main, other, otherLb, scale, big }: { name: React.ReactNode; main: RowAvg | null; other: RowAvg | null; otherLb: string; scale: number; big?: boolean }) {
  const tot = main ? Math.max(1, main.n) : 1;
  return (
    <div className="py-0.5 min-w-0" title={main ? `상승 ${main.up} · 하락(보합 포함) ${main.n - main.up}` : undefined}>
      <div className="flex items-baseline gap-1.5 min-w-0 leading-tight">
        <span className={`min-w-0 truncate ${main ? tone(main.avg) : "text-gray-700"}`}>{name}</span>   {/* 이름도 오르면 빨강·내리면 파랑(거래원 칸과 같은 꼴) */}
        {main ? <b className={`shrink-0 tabular-nums ${tone(main.avg)} ${big ? "text-[15px]" : "text-[13px]"}`}>{fmt(main.avg)}</b> : <span className="text-gray-300 text-[12px]">—</span>}
        {main?.aft != null && <span className={`shrink-0 text-[9.5px] font-bold text-white px-1 rounded leading-[13px] ${main.aft > 0 ? "bg-rose-600/60" : main.aft < 0 ? "bg-blue-600/60" : "bg-gray-400/60"}`} title={`${main.ses ?? "장외"} — 정규장 종가 대비`}>{main.ses ?? ""} {main.aft > 0 ? "+" : main.aft < 0 ? "−" : ""}{Math.abs(main.aft).toFixed(2)}%</span>}
        {other && <span className="shrink-0 text-[10px] text-gray-400 tabular-nums">({otherLb} <span className={tone(other.avg)}>{fmt(other.avg)}</span>)</span>}
      </div>
      {main && main.n > 0 && (
        <span className="mt-px flex h-[3px] rounded-full overflow-hidden bg-gray-100" style={{ width: `${Math.max(4, Math.min(1, scale) * 100)}%` }}>
          <span className="bg-rose-300" style={{ width: `${(main.up / tot) * 100}%` }} />
          <span className="bg-blue-300" style={{ width: `${((main.n - main.up) / tot) * 100}%` }} />
        </span>
      )}
    </div>
  );
}
