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
/** 지금 크게 보이는 값 — 장 밖이면 그 구간 %, 아니면 정규장 %(정렬 기준도 이것) */
const shown = (v: RowAvg | null | undefined) => (v ? (v.aft ?? v.avg) : -Infinity);
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
      // 종목 수(흐린 것 포함) — 막대의 회색 = 흐린(장 안 열림·체결 없음) 종목(사용자 2026-11-12 "흐림도 표시하자, 회색으로")
      nKr: all.filter(x => /\.(KS|KQ)$/.test(x)).length, nOv: all.filter(isOverseasTicker).length,
    };
  }).sort((a, b) => {
    const k = (r: typeof a) => shown(mkt === "US" ? r.ov : r.kr);   // 카드 순서도 지금 크게 보이는 값
    return k(b) - k(a);
  });
  // 업종마다 카드 하나(사용자 2026-11-07 "업종별로 레이어를 분리") — 맨 위 업종 이름·해외·국내(크게), 아래 칸마다 한 줄씩.
  //   카드 안은 [이름 | 해외 | 국내] 고정 격자라 칸 줄끼리 세로줄이 맞는다. 카드 순서 = 고른 국내/해외 평균 큰 순.
  return (
    <div className="space-y-1.5">
      <div className="px-1 text-[10.5px] text-gray-400">숫자 = 정규장 평균 · 아래 꼬리표 = 그 뒤({isMarketOpen("US_INDEX") ? "미국은 지금 정규장 중" : `미국 지금 '${usSessionLabel()}'`} · 국내 NXT 애프터) 정규장 종가 대비 — 장중이면 꼬리표 없음 </div>
      <div className={`grid gap-2 ${compact ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"}`}>
        {rows.map(({ s, ov, kr, boxes, nKr, nOv }) => {
          const emoji = s.label.split(" ")[0];
          return (
            // 거래원 칸처럼 단순하게 — 줄마다 "이름 +11.33% (해외 +8.10%)" + 아래 얇은 상승·하락 선(사용자 2026-11-11 "업종 카드 구성이 너무 산만해")
            <div key={s.id} className="relative mt-3 rounded-lg border border-gray-200 bg-white shadow-sm px-2.5 pt-3 pb-1.5">
              {/* 업종 이름 = 카드 위 테두리에 걸친 책갈피(사용자 2026-11-11 "종목명을 한 줄 위로", "책갈피로") */}
              <button type="button" onClick={() => onOpen(s.id)} title={`${s.short} 탭으로 — 종목 카드 보기`}
                      className={`absolute -top-3 left-2 max-w-[80%] px-1.5 rounded-md border border-gray-300 bg-white shadow-sm font-bold text-[13px] leading-[22px] whitespace-nowrap truncate hover:text-indigo-700 hover:underline text-left ${(mkt === "US" ? ov : kr) ? tone((mkt === "US" ? ov : kr)!.aft ?? (mkt === "US" ? ov : kr)!.avg) : "text-gray-800"}`}>
                {emoji} {s.short} <span className="text-[10px] font-normal text-indigo-400">→</span>
              </button>
              {/* 카드 전체가 한 격자 — 이름 칸은 가장 긴 이름에 맞춰 늘고(안 잘린다), 증감률·(해외)·선이 줄마다 세로로 맞는다(사용자 2026-11-11) */}
              {/*   칸 폭은 모든 카드가 같게 고정 — 카드끼리도 세로줄이 맞는다(사용자 2026-11-11 "전체적으로 정렬을 고정하자") */}
              <div className="grid grid-cols-[7.6em_4.9em_6.2em_minmax(3.5rem,1fr)] gap-x-1.5 items-center text-[12.5px]">
              <SimpleRow onClick={() => onOpen(s.id)} hint={`${s.short} 탭으로 — 종목 카드 보기`}
                         name={<span className="text-[11px] font-bold text-gray-500">{mkt === "US" ? "해외" : "국내"}</span>}
                         main={mkt === "US" ? ov : kr} other={mkt === "US" ? kr : ov} otherLb={mkt === "US" ? "국내" : "해외"} scale={1} total={mkt === "US" ? nOv : nKr} big />
              <div className="col-span-4 my-0.5 border-t border-gray-100" />
                {/* 칸 줄은 증감률 큰 순(고른 쪽 기준, 값 없으면 뒤로)(사용자 2026-11-11 "증감순으로 소팅") */}
                {[...boxes].sort((x, y) => shown(mkt === "US" ? y.ov : y.kr) - shown(mkt === "US" ? x.ov : x.kr)).map(b => {
                  const main = mkt === "US" ? b.ov : b.kr;
                  const tot = mkt === "US" ? b.syms.filter(isOverseasTicker).length : b.syms.filter(x => /\.(KS|KQ)$/.test(x)).length;
                  const allTot = mkt === "US" ? nOv : nKr;
                  return (
                    <SimpleRow key={b.lb}
                               onClick={() => openTilePopup({ title: `${s.short} · ${b.lb}`, items: b.syms.map(x => { const e = regExtOf(x); return { sym: x, name: nameOf?.(x) ?? x, pct: pctOf(x), reg: e?.reg ?? null, aft: e && Math.abs(e.aft) >= 0.005 ? e.aft : null, ses: e?.ses }; }) })}
                               hint={(() => { const k = b.syms.filter(x => /\.(KS|KQ)$/.test(x)).length; return `${b.lb} 종목 ${b.syms.length}개(국내 ${k} · 해외 ${b.syms.length - k})를 타일로 보기`; })()}
                               name={<span className="text-[12.5px] font-medium">{b.lb}</span>}
                               main={main} other={mkt === "US" ? b.kr : b.ov} otherLb={mkt === "US" ? "국내" : "해외"}
                               total={tot} scale={allTot > 0 ? tot / allTot : 1} />
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
function SimpleRow({ name, main, other, otherLb, scale, total, big, onClick, hint }: { name: React.ReactNode; main: RowAvg | null; other: RowAvg | null; otherLb: string; scale: number; total: number; big?: boolean; onClick?: () => void; hint?: string }) {
  const up = main?.up ?? 0, dn = main ? main.n - main.up : 0, dim = Math.max(0, total - (main?.n ?? 0));
  const tot = Math.max(1, up + dn + dim);
  // 네 칸(이름 · 증감률 · (해외/국내) · 상승·하락 선)을 부모 격자에 그대로 — 줄 전체를 누른다(사용자 2026-11-11 "클릭을 줄 전체에")
  const cell = `py-0.5 ${onClick ? "cursor-pointer" : ""}`;
  const title = `${hint ? hint + " — " : ""}상승 ${up} · 하락(보합 포함) ${dn}${dim ? ` · 흐림(장 안 열림·체결 없음) ${dim}` : ""}`;
  return (
    <div role="button" tabIndex={0} onClick={onClick} onKeyDown={e => { if (e.key === "Enter") onClick?.(); }} title={title}
         className="contents [&:hover>*]:bg-indigo-50/60">
      <span className={`${cell} min-w-0 truncate rounded-l pl-1 ${main ? tone(main.aft ?? main.avg) : "text-gray-700"}`}>{name}</span>
      {/* 정규장 중 = 정규장 % 크게. 장 밖(프리·애프터·데이) = 위에 정규장 % 작게, 아래에 그 구간 %(정규장 종가 대비) 크게
          (사용자 2026-11-11 "정규장 시간엔 정규장이 메인, 프리장엔 전날 정규장 위 작게·프리장 아래 메인, 애프터엔 오늘 정규장 위 작게·애프터 아래 메인") */}
      <span className={`${cell} text-right leading-tight`}>
        {!main ? <span className="text-gray-300 text-[12px]">—</span>
          : main.aft == null ? <b className={`tabular-nums ${tone(main.avg)} ${big ? "text-[14px]" : "text-[13px]"}`}>{fmt(main.avg)}</b>
          : (<>
              <span className={`block text-[9.5px] tabular-nums ${tone(main.avg)} opacity-70`} title="정규장 등락(전일 종가 대비)">정규 {fmt(main.avg)}</span>
              <b className={`block tabular-nums ${tone(main.aft)} ${big ? "text-[14px]" : "text-[13px]"}`} title={`${main.ses ?? "장외"} — 정규장 종가 대비 지금`}>
{fmt(main.aft)}   {/* 구간 이름(데이 등)은 안 쓴다 — 마우스를 올리면(title)(사용자 2026-11-11) */}
              </b>
            </>)}
      </span>
      <span className={`${cell} text-[9.5px] text-gray-400 tabular-nums whitespace-nowrap`}>{other ? <>({otherLb} <span className={tone(other.avg)}>{fmt(other.avg)}</span>)</> : ""}</span>
      <span className={`${cell} rounded-r pr-1 min-w-0`}>
        {total > 0 ? (
          // 얇은 선 + 각 조각 위에 그 수(빨강 상승 · 파랑 하락 · 회색 흐림)(사용자 2026-11-12 "바를 얇게, 숫자를 바 위에, 3가지 색")
          <span className="flex min-w-0 tabular-nums font-bold leading-[11px]" style={{ width: `${Math.max(6, Math.min(1, scale) * 100)}%` }}>
            {([[up, "bg-rose-300", "text-rose-500"], [dn, "bg-blue-300", "text-blue-500"], [dim, "bg-gray-300", "text-gray-400"]] as const).map(([v, bg, tx], i) => v > 0 && (
              <span key={i} className="flex flex-col min-w-[1.3em] pr-px" style={{ width: `${(v / tot) * 100}%` }}>   {/* 작은 조각도 숫자가 겹치지 않게 최소 폭 */}
                <span className={`text-[9.5px] ${tx} whitespace-nowrap text-center`}>{v}</span>   {/* 숫자는 조각 가운데(사용자 2026-11-12) */}
                <span className={`${big ? "h-[4px]" : "h-[3px]"} ${bg} ${i === 0 ? "rounded-l-full" : ""} ${(i === 2 || (i === 1 && !dim) || (i === 0 && !dn && !dim)) ? "rounded-r-full" : ""}`} />
              </span>
            ))}
          </span>
        ) : null}
      </span>
    </div>
  );
}
