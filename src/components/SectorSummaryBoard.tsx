// 업종 한눈에 대시보드 — 지수(업종) '한눈에' 탭(사용자 2026-11-07 "한눈에는 요약만, 카드는 섹터별로" → "한눈에 보는 대시보드").
//   표 한 줄 = 업종 하나:  [업종 이름 / 해외 / 국내]  [칸1 이름 / 해외 / 국내]  [칸2 …] …
//            주기기·건설   설계·정비
//   원전 해외  해외 x      해외 y
//        국내  국내 x      국내 y
//   값 = 평균 등락(장 밖이면 정규장 % + 프리·애프터·데이 꼬리표) · ▲▼. 업종 이름 = 그 탭(카드 보기)으로.
//   줄 순서 = 지금 고른 국내/해외 평균 큰 순. PC·모바일이 같이 쓴다(compact = 모바일 — 칸이 줄 바꿈).
import type { DashboardSection } from "../lib/dashboardGroups";
import { isMarketOpen } from "../lib/format";
import { avgOfSyms, rotRowAvg, isOverseasTicker, useAvgMarket, usSessionLabel, type RowAvg, type Ses } from "../lib/avgMarket";

type RegExt = (s: string) => { reg: number; aft: number; ses?: Ses } | null;
const tone = (v: number) => (v > 0 ? "text-rose-600" : v < 0 ? "text-blue-600" : "text-gray-600");
const fmt = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;

/** 한 칸 값 — 위 = 정규장 평균, 아래 = 프리·애프터·데이 꼬리표(정규장 종가 대비, 카드 배지와 같은 꼴)
 *  — 둘 다 늘 보이게, 같은 세로줄(사용자 2026-11-07 "정규장과 프리/애프터 둘 다, 해외·국내 둘 다, 꼬리표처럼") */
function Val({ label, v, strong, big, dim }: { label: string; v: RowAvg | null; strong?: boolean; big?: boolean; dim?: boolean }) {
  return (
    <span className={`flex flex-col items-end whitespace-nowrap tabular-nums leading-[17px] min-w-0 ${dim ? "opacity-40" : ""}`}
          title={v ? `${label} — 정규장 ${fmt(v.avg)}${v.aft != null ? ` · ${v.ses ?? "장외"} ${fmt(v.aft)}(정규장 종가 대비)` : ""} · ▲${v.up}·▼${v.n - v.up}` : undefined}>
      {!v ? <span className="text-gray-300 text-[12px]">—</span> : (
        <>
          <b className={`${tone(v.avg)} ${big ? "text-[19px] leading-[22px]" : strong ? "text-[13px]" : "text-[12.5px]"}`}>{fmt(v.avg)}</b>
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
/** 해외 · 국내 — 부모 격자의 두 칸에 하나씩(세로줄 맞춤, 사용자 2026-11-07 "세로 줄 맞추자") */
function Pair({ ov, kr, strong }: { ov: RowAvg | null; kr: RowAvg | null; strong?: "US" | "KR" }) {
  return (
    <>
      <Val label="해외" v={ov} strong={strong === "US"} dim={strong === "KR"} /><Val label="국내" v={kr} strong={strong === "KR"} dim={strong === "US"} />
    </>
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
  // 업종마다 카드 하나(사용자 2026-11-07 "업종별로 레이어를 분리") — 맨 위 업종 이름·해외·국내(크게), 아래 칸마다 한 줄씩.
  //   카드 안은 [이름 | 해외 | 국내] 고정 격자라 칸 줄끼리 세로줄이 맞는다. 카드 순서 = 고른 국내/해외 평균 큰 순.
  const G = "grid grid-cols-[minmax(0,1fr)_4.2rem_4.2rem] items-start gap-x-1.5";
  return (
    <div className="space-y-1.5">
      <div className="px-1 text-[10.5px] text-gray-400">숫자 = 정규장 평균 · 아래 꼬리표 = 그 뒤({isMarketOpen("US_INDEX") ? "미국은 지금 정규장 중" : `미국 지금 '${usSessionLabel()}'`} · 국내 NXT 애프터) 정규장 종가 대비 — 장중이면 꼬리표 없음 </div>
      <div className={`grid gap-2 ${compact ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"}`}>
        {rows.map(({ s, ov, kr, boxes }) => {
          const emoji = s.label.split(" ")[0];
          return (
            <div key={s.id} className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
              {/* 머리 — 업종 이름·해외·국내 크게 */}
              <div className={`${G} px-2.5 py-1.5 bg-gray-50 border-b border-gray-200`}>
                <div className="min-w-0">
                  <button onClick={() => onOpen(s.id)} className="block font-bold text-[15px] text-gray-900 hover:text-indigo-700 hover:underline whitespace-nowrap truncate text-left" title={`${s.short} 탭으로 — 종목 카드 보기`}>
                    {emoji} {s.short} <span className="text-[10px] font-normal text-indigo-400">→</span>
                  </button>
                  {/* 상승·하락 종목 수 — 왼쪽 탭과 같은 기준(국내/해외 단추)(사용자 2026-11-07 "아래에 넣어도") */}
                  {(() => { const v = mkt === "US" ? ov : kr; return v && (
                    <UpDnBar up={v.up} dn={v.n - v.up} scale={1} />
                  ); })()}
                </div>
                {/* 정렬 기준(국내/해외 단추) 숫자만 크게(사용자 2026-11-07) */}
                <Val label="해외" v={ov} big={mkt === "US"} strong dim={mkt === "KR"} /><Val label="국내" v={kr} big={mkt === "KR"} strong dim={mkt === "US"} />   {/* 고르지 않은 쪽은 흐리게(사용자 2026-11-07) */}
              </div>
              {/* 열 이름 */}
              <div className={`${G} px-2.5 pt-1 text-[10px] text-gray-400`}><span /><span className="text-right">해외</span><span className="text-right">국내</span></div>
              {/* 칸 줄 */}
              <div className="px-2.5 pb-1.5 divide-y divide-gray-100">
                {boxes.map(b => (
                  <div key={b.lb} className={`${G} py-1`}>
                    <span className="min-w-0">
                      <span className="block text-[12.5px] font-bold text-gray-600 truncate" title={b.lb}>{b.lb}</span>
                      {/* 칸도 상승·하락 수(국내/해외 단추 기준, 사용자 2026-11-07 "여기도") */}
                      {(() => { const v = mkt === "US" ? b.ov : b.kr; return v && (
                        <UpDnBar up={v.up} dn={v.n - v.up} small
                                 scale={(() => { const all = mkt === "US" ? ov : kr; return all && all.n > 0 ? v.n / all.n : 1; })()} />
                      ); })()}
                    </span>
                    <Pair ov={b.ov} kr={b.kr} strong={mkt} />
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
function UpDnBar({ up, dn, scale, small = false }: { up: number; dn: number; scale: number; small?: boolean }) {
  const tot = Math.max(1, up + dn);
  return (
    <span className={`flex items-center gap-1 tabular-nums font-bold whitespace-nowrap ${small ? "text-[10.5px]" : "text-[11px]"}`} title={`상승 ${up} · 하락(보합 포함) ${dn}`}>
      {/* 0 은 안 쓴다, ▼ 는 막대 바로 뒤에(사용자 2026-11-10) */}
      {/* ▲ 칸 폭 고정 — 한 자리·두 자리 숫자여도 막대 시작이 같은 줄에(사용자 2026-11-10 "두 자리 숫자 때문에 줄이 안 맞아") */}
      <span className="inline-block w-[2.4em] text-rose-600">{up > 0 ? `▲${up}` : ""}</span>
      <span className="inline-flex h-1.5 rounded-full overflow-hidden bg-gray-200" style={{ width: `${Math.max(5, Math.round(Math.min(1, scale) * 80))}px` }}>
        <span className="bg-rose-300" style={{ width: `${(up / tot) * 100}%` }} />   {/* 연하게(사용자 2026-11-10) */}
        <span className="bg-blue-300" style={{ width: `${(dn / tot) * 100}%` }} />
      </span>
      {dn > 0 && <span className="text-blue-600">▼{dn}</span>}
    </span>
  );
}
