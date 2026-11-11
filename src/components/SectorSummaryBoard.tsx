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
            <div key={s.id} className="relative mt-3 rounded-lg border border-gray-200 bg-white shadow-sm px-2.5 pt-3 pb-1.5">
              {/* 업종 이름 = 카드 위 테두리에 걸친 책갈피(사용자 2026-11-11 "종목명을 한 줄 위로", "책갈피로") */}
              <button type="button" onClick={() => onOpen(s.id)} title={`${s.short} 탭으로 — 종목 카드 보기`}
                      className={`absolute -top-3 left-2 max-w-[80%] px-1.5 rounded-md border border-gray-300 bg-white shadow-sm font-bold text-[13px] leading-[22px] whitespace-nowrap truncate hover:text-indigo-700 hover:underline text-left ${(mkt === "US" ? ov : kr) ? tone((mkt === "US" ? ov : kr)!.avg) : "text-gray-800"}`}>
                {emoji} {s.short} <span className="text-[10px] font-normal text-indigo-400">→</span>
              </button>
              {/* 카드 전체가 한 격자 — 이름 칸은 가장 긴 이름에 맞춰 늘고(안 잘린다), 증감률·(해외)·선이 줄마다 세로로 맞는다(사용자 2026-11-11) */}
              {/*   칸 폭은 모든 카드가 같게 고정 — 카드끼리도 세로줄이 맞는다(사용자 2026-11-11 "전체적으로 정렬을 고정하자") */}
              <div className="grid grid-cols-[7.6em_4.9em_6.2em_minmax(3.5rem,1fr)] gap-x-1.5 items-center text-[12.5px]">
              <SimpleRow onClick={() => onOpen(s.id)} hint={`${s.short} 탭으로 — 종목 카드 보기`}
                         name={<span className="text-[11px] font-bold text-gray-500">{mkt === "US" ? "해외" : "국내"}</span>}
                         main={mkt === "US" ? ov : kr} other={mkt === "US" ? kr : ov} otherLb={mkt === "US" ? "국내" : "해외"} scale={1} big />
              <div className="col-span-4 my-0.5 border-t border-gray-100" />
                {/* 칸 줄은 증감률 큰 순(고른 쪽 기준, 값 없으면 뒤로)(사용자 2026-11-11 "증감순으로 소팅") */}
                {[...boxes].sort((x, y) => ((mkt === "US" ? y.ov : y.kr)?.avg ?? -Infinity) - ((mkt === "US" ? x.ov : x.kr)?.avg ?? -Infinity)).map(b => {
                  const main = mkt === "US" ? b.ov : b.kr, all = mkt === "US" ? ov : kr;
                  return (
                    <SimpleRow key={b.lb}
                               onClick={() => openTilePopup({ title: `${s.short} · ${b.lb}`, items: b.syms.map(x => { const e = regExtOf(x); return { sym: x, name: nameOf?.(x) ?? x, pct: pctOf(x), reg: e?.reg ?? null, aft: e && Math.abs(e.aft) >= 0.005 ? e.aft : null, ses: e?.ses }; }) })}
                               hint={(() => { const k = b.syms.filter(x => /\.(KS|KQ)$/.test(x)).length; return `${b.lb} 종목 ${b.syms.length}개(국내 ${k} · 해외 ${b.syms.length - k})를 타일로 보기`; })()}
                               name={<span className="text-[12.5px] font-medium">{b.lb}</span>}
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
function SimpleRow({ name, main, other, otherLb, scale, big, onClick, hint }: { name: React.ReactNode; main: RowAvg | null; other: RowAvg | null; otherLb: string; scale: number; big?: boolean; onClick?: () => void; hint?: string }) {
  const tot = main ? Math.max(1, main.n) : 1;
  // 네 칸(이름 · 증감률 · (해외/국내) · 상승·하락 선)을 부모 격자에 그대로 — 줄 전체를 누른다(사용자 2026-11-11 "클릭을 줄 전체에")
  const cell = `py-0.5 ${onClick ? "cursor-pointer" : ""}`;
  const title = `${hint ? hint + " — " : ""}${main ? `상승 ${main.up} · 하락(보합 포함) ${main.n - main.up}` : ""}`;
  return (
    <div role="button" tabIndex={0} onClick={onClick} onKeyDown={e => { if (e.key === "Enter") onClick?.(); }} title={title}
         className="contents [&:hover>*]:bg-indigo-50/60">
      <span className={`${cell} min-w-0 truncate rounded-l pl-1 ${main ? tone(main.avg) : "text-gray-700"}`}>{name}</span>
      <span className={`${cell} text-right leading-tight`}>
        {main ? <b className={`tabular-nums ${tone(main.avg)} ${big ? "text-[14px]" : "text-[13px]"}`}>{fmt(main.avg)}</b> : <span className="text-gray-300 text-[12px]">—</span>}
        {main?.aft != null && <span className={`block ml-auto w-fit text-[9px] font-bold px-1 rounded leading-[12px] ${main.aft > 0 ? "bg-rose-100 text-rose-700" : main.aft < 0 ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"}`}   /* 연한 바탕·진한 글자(사용자 2026-11-11) */ title={`${main.ses ?? "장외"} — 정규장 종가 대비`}>{main.ses && <span className="mr-0.5 text-[8px] font-normal opacity-60">{main.ses}</span>}{main.aft > 0 ? "+" : main.aft < 0 ? "−" : ""}{Math.abs(main.aft).toFixed(2)}%</span>}
      </span>
      <span className={`${cell} text-[9.5px] text-gray-400 tabular-nums whitespace-nowrap`}>{other ? <>({otherLb} <span className={tone(other.avg)}>{fmt(other.avg)}</span>)</> : ""}</span>
      <span className={`${cell} rounded-r pr-1 min-w-0`}>
        {main && main.n > 0 ? (
          <span className="flex items-center gap-1 text-[10px] tabular-nums font-bold min-w-0">
            <span className="w-[1.6em] shrink-0 text-right text-rose-500">{main.up || ""}</span>
            <span className={`flex ${big ? "h-[9px]" : "h-[7px]"} rounded-full overflow-hidden bg-gray-100 shrink-0`} style={{ width: `calc((100% - 3.6em) * ${Math.max(0.04, Math.min(1, scale))})` }}>
              <span className="bg-rose-300" style={{ width: `${(main.up / tot) * 100}%` }} />
              <span className="bg-blue-300" style={{ width: `${((main.n - main.up) / tot) * 100}%` }} />
            </span>
            {main.n - main.up > 0 && <span className="shrink-0 text-blue-500">{main.n - main.up}</span>}
          </span>
        ) : null}
      </span>
    </div>
  );
}
