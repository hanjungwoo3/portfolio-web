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
// 이름 색 = 지금 상승률(국내/해외 단추 기준) — 3% 넘으면 진하게(사용자 2026-11-10 "현재 상승률에 맞춰서 색깔")
// 이름 뒤 배경 — 모두 같은 폭, 색 = 지금 상승률(사용자 2026-11-10 "동일한 사이즈로 배경을 넣어 볼까")
const nameBg = (v: number | null | undefined) => v == null ? "bg-gray-100" : v >= 3 ? "bg-rose-100" : v > 0 ? "bg-rose-50" : v <= -3 ? "bg-blue-100" : v < 0 ? "bg-blue-50" : "bg-gray-100";
const nameTone = (v: number | null | undefined) => v == null ? "text-gray-700" : v >= 3 ? "text-rose-700" : v > 0 ? "text-rose-500" : v <= -3 ? "text-blue-700" : v < 0 ? "text-blue-500" : "text-gray-700";
const fmt = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;

/** 한 칸 값 — 위 = 정규장 평균, 아래 = 프리·애프터·데이 꼬리표(정규장 종가 대비, 카드 배지와 같은 꼴)
 *  — 둘 다 늘 보이게, 같은 세로줄(사용자 2026-11-07 "정규장과 프리/애프터 둘 다, 해외·국내 둘 다, 꼬리표처럼") */
function Val({ label, v, strong, big, dim }: { label: string; v: RowAvg | null; strong?: boolean; big?: boolean; dim?: boolean }) {
  return (
    <span className={`flex flex-col items-end whitespace-nowrap tabular-nums leading-[17px] min-w-0 ${dim ? "opacity-40" : ""}`}
          title={v ? `${label} — 정규장 ${fmt(v.avg)}${v.aft != null ? ` · ${v.ses ?? "장외"} ${fmt(v.aft)}(정규장 종가 대비)` : ""} · ▲${v.up}·▼${v.n - v.up}` : undefined}>
      {!v ? <span className="text-gray-300 text-[12px]">—</span> : (
        <>
          <b className={`${tone(v.avg)} ${big ? "text-[19px] leading-[22px]" : strong ? "text-[15px] leading-[19px]" : "text-[12.5px]"}`}>   {/* 고른 쪽 줄 숫자 크게(사용자 2026-11-10) */}{fmt(v.avg)}</b>
          {v.aft != null && (
            <span className={`text-[10px] font-bold text-white px-1 rounded leading-[14px] ${v.aft > 0 ? "bg-rose-600/60" : v.aft < 0 ? "bg-blue-600/60" : "bg-gray-400/60"}`}>
              {v.aft > 0 ? "+" : v.aft < 0 ? "−" : ""}{Math.abs(v.aft).toFixed(2)}%
            </span>
          )}
        </>
      )}
    </span>
  );
}
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
            <div key={s.id} className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
              {/* 머리 — 업종 이름 + 해외 | 국내 두 칸(이름은 여기 한 번만). 줄마다 칸 이름 아래 왼쪽 해외 · 오른쪽 국내
                  (사용자 2026-11-10 "기판 / 해외 국내", "줄마다 해외 국내 넣지 말고 카드 상단에 하나씩만") */}
              <div className="px-2.5 pt-1.5 pb-1.5 bg-gray-50 border-b border-gray-200">
                <button onClick={() => onOpen(s.id)} className={`block mx-auto w-[11em] max-w-full rounded-md py-0.5 ${nameBg((mkt === "US" ? ov : kr)?.avg)} font-bold text-[15px] ${nameTone((mkt === "US" ? ov : kr)?.avg)} hover:text-indigo-700 hover:underline whitespace-nowrap truncate text-center`} title={`${s.short} 탭으로 — 종목 카드 보기`}>
                  {emoji} {s.short} <span className="text-[10px] font-normal text-indigo-400">→</span>
                </button>
                <div className="grid grid-cols-2 gap-x-2">
                  {([["해외", ov, "US"], ["국내", kr, "KR"]] as const).map(([lb, all, m]) => (
                    <div key={lb} className={`min-w-0 ${m === "US" ? "pr-2 border-r border-gray-300" : ""} ${mkt !== m ? "opacity-45" : ""}`}>   {/* 왼쪽·오른쪽 구분선(사용자 2026-11-10) */}
                      <div className="flex items-baseline justify-between gap-1">
                        <span className={`text-[11px] font-bold ${lb === "해외" ? "text-violet-700" : "text-gray-600"}`}>{lb}</span>
                        <Val label={lb} v={all} big={mkt === m} strong />
                      </div>
                      {all && all.n > 0 && <UpDnBar up={all.up} dn={all.n - all.up} scale={1} max={60} />}
                    </div>
                  ))}
                </div>
              </div>
              {/* 칸 줄 */}
              <div className="px-2.5 pb-1.5 divide-y divide-gray-100">
                {boxes.map(b => (
                  <div key={b.lb} className="py-1">
                    {/* 칸 이름을 누르면 그 칸 종목만 타일로(사용자 2026-11-10) */}
                    <button type="button" onClick={() => openTilePopup({ title: `${s.short} · ${b.lb}`, items: b.syms.map(x => { const e = regExtOf(x); return { sym: x, name: nameOf?.(x) ?? x, pct: pctOf(x), reg: e?.reg ?? null, aft: e && Math.abs(e.aft) >= 0.005 ? e.aft : null, ses: e?.ses }; }) })}
                            className={`block mx-auto w-[9em] max-w-full rounded py-px ${nameBg((mkt === "US" ? b.ov : b.kr)?.avg)} text-[12.5px] font-bold ${nameTone((mkt === "US" ? b.ov : b.kr)?.avg)} truncate hover:text-indigo-700 hover:underline text-center`}   /* 가운데(사용자 2026-11-10) */
                            title={(() => { const k = b.syms.filter(x => /\.(KS|KQ)$/.test(x)).length; return `${b.lb} 종목 ${b.syms.length}개(국내 ${k} · 해외 ${b.syms.length - k})를 타일로 보기`; })()}>{b.lb}</button>
                    <div className="grid grid-cols-2 gap-x-2">
                      {([[b.ov, ov, "US"], [b.kr, kr, "KR"]] as const).map(([v, all, m], j) => (
                        <div key={j} className={`min-w-0 flex items-center justify-between gap-1 ${m === "US" ? "pr-2 border-r border-gray-300 bg-violet-50/50 -my-0.5 py-0.5 pl-1 rounded-l" : ""} ${mkt !== m ? "opacity-45" : ""}`}>
                          {v && v.n > 0 ? <UpDnBar up={v.up} dn={v.n - v.up} small={mkt !== m} scale={all && all.n > 0 ? v.n / all.n : 1} max={60} /> : <span className="text-[10px] text-gray-300">—</span>}
                          <Val label={m === "US" ? "해외" : "국내"} v={v} strong={mkt === m} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
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

// 상승·하락 종목 수 막대 — 지수 카드 위 시장 폭 막대와 같은 꼴(▲N ━━ ▼M, 사용자 2026-11-10 "여기 상승/하락도 막대 그래프로")
//   길이 = 업종 전체를 100% 로 놓고 그 안 종목 수 비율(사용자 2026-11-10 "소부장 78 이 100% 크기") — 제목·칸 줄 최대 길이 같게
function UpDnBar({ up, dn, scale, small = false, max = 80 }: { up: number; dn: number; scale: number; small?: boolean; max?: number }) {
  const tot = Math.max(1, up + dn);
  return (
    <span className={`flex items-center gap-1 tabular-nums font-bold whitespace-nowrap ${small ? "text-[10.5px]" : "text-[12.5px]"}`} title={`상승 ${up} · 하락(보합 포함) ${dn}`}>
      {/* 0 은 안 쓴다, ▼ 는 막대 바로 뒤에(사용자 2026-11-10) */}
      {/* ▲ 칸 폭 고정 — 한 자리·두 자리 숫자여도 막대 시작이 같은 줄에(사용자 2026-11-10 "두 자리 숫자 때문에 줄이 안 맞아") */}
      <span className="inline-block w-[2.2em] text-rose-600">{up > 0 ? `▲${up}` : ""}</span>
      <span className="inline-flex h-1.5 rounded-full overflow-hidden bg-gray-200" style={{ width: `${Math.max(5, Math.round(Math.min(1, scale) * max))}px` }}>
        <span className="bg-rose-300" style={{ width: `${(up / tot) * 100}%` }} />   {/* 연하게(사용자 2026-11-10) */}
        <span className="bg-blue-300" style={{ width: `${(dn / tot) * 100}%` }} />
      </span>
      {dn > 0 && <span className="text-blue-600">▼{dn}</span>}
    </span>
  );
}

