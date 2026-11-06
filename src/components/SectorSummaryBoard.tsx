// 업종 요약판 — 지수(업종) '한눈에' 탭(사용자 2026-11-07 "한눈에는 종목카드를 다 넣지 않고 요약만, 실제 종목카드는 섹터별로").
//   업종 탭 하나 = 한 덩어리: 위 = 업종 전체 해외·국내 평균(정규 x% + 프리·애프터·데이 꼬리표, ▲▼, 이름 누르면 그 탭),
//   아래 = 그 업종 탭의 칸 제목들 그대로(국내·해외 평균, 5일·20일 외국인·기관 — renderDetail = SobuGrid headersOnly)
//   (사용자 2026-11-07 "한눈에 이거 다 넣으면", "가장 오름/내림보다 더 중요" → 오름·내림은 뺐다).
//   덩어리 순서 = 지금 고른 국내/해외 평균 큰 순. PC·모바일이 같이 쓴다(compact = 모바일).
import type { ReactNode } from "react";
import type { DashboardSection } from "../lib/dashboardGroups";
import { avgOfSyms, isOverseasTicker, useAvgMarket, type RowAvg, type Ses } from "../lib/avgMarket";
import { AftPill } from "./SectorTabBar";

type RegExt = (s: string) => { reg: number; aft: number; ses?: Ses } | null;
const tone = (v: number) => (v > 0 ? "text-rose-600" : v < 0 ? "text-blue-600" : "text-gray-600");
const fmt = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;

function Avg({ label, v, big }: { label: string; v: RowAvg | null; big?: boolean }) {
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap tabular-nums">
      <span className="text-[11px] text-gray-500">{label}</span>
      {!v ? <span className="text-gray-300">—</span> : (
        <>
          {v.aft != null && <span className="text-[10px] text-gray-400">정규</span>}
          <b className={`${tone(v.avg)} ${big ? "text-[14px]" : "text-[13px]"}`}>{fmt(v.avg)}</b>
          {v.aft != null && <AftPill v={v.aft} label={v.ses ?? "장외"} />}
          <span className="text-[10.5px] text-gray-400">▲{v.up}·▼{v.n - v.up}</span>
        </>
      )}
    </span>
  );
}

export function SectorSummaryBoard({ sections, pctOf, regExtOf, onOpen, renderDetail, compact }: {
  sections: DashboardSection[];                 // 업종 탭(한눈에 제외)
  pctOf: (s: string) => number | null;
  regExtOf: RegExt;
  nameOf?: (s: string) => string;               // (예전 가장 오름·내림용 — 지금은 안 쓴다)
  onOpen: (sectionId: string) => void;
  renderDetail?: (s: DashboardSection) => ReactNode;   // 칸 제목들(업종 탭과 같은 것)
  compact?: boolean;
}) {
  const mkt = useAvgMarket();
  const rows = sections.map(s => {
    const all = s.rows.flat();
    return { s, ov: avgOfSyms(all.filter(isOverseasTicker), pctOf, regExtOf), kr: avgOfSyms(all.filter(x => /\.(KS|KQ)$/.test(x)), pctOf, regExtOf) };
  }).sort((a, b) => {
    const k = (r: typeof a) => (mkt === "US" ? r.ov?.avg : r.kr?.avg) ?? -Infinity;
    return k(b) - k(a);
  });

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      {rows.map(({ s, ov, kr }) => {
        const emoji = s.label.split(" ")[0];
        return (
          <div key={s.id} className="rounded-lg border border-gray-200 bg-gray-50/40 p-1.5">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 px-1 pb-1">
              <button onClick={() => onOpen(s.id)} className="font-bold text-[14px] text-gray-800 hover:text-indigo-700 hover:underline" title={`${s.short} 탭으로 — 종목 카드 보기`}>
                {emoji} {s.short} <span className="text-[11px] font-normal text-indigo-500">카드 보기 →</span>
              </button>
              <Avg label="해외" v={ov} big={mkt === "US"} />
              <Avg label="국내" v={kr} big={mkt === "KR"} />
            </div>
            {renderDetail?.(s)}
          </div>
        );
      })}
      <div className="px-1 text-[10.5px] text-gray-400">
        해외 = 해외 대장주(미국은 장 밖이면 '정규' 등락 + 꼬리표 = 프리·애프터·데이, 일본은 지금 장중) · 국내 = 국내 종목(마감 뒤면 정규 + 애프터 꼬리표) · 순서 = {mkt === "US" ? "해외" : "국내"} 평균 큰 순(왼쪽 국내/해외 단추)
      </div>
    </div>
  );
}
