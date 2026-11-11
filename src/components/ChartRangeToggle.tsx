// 카드 배경 차트 기간 토글 [3개월|24시간] — 앱 전체 설정(lib/chartRange). 어디 달아도 같은 값을 바꾼다.
import { setChartRange, useChartRange, CHART_RANGES, type ChartRange } from "../lib/chartRange";

import { useAvgMarket, setAvgMarket } from "../lib/avgMarket";

export function ChartRangeToggle({ small = false, className = "" }: { small?: boolean; className?: string }) {
  const range = useChartRange();
  // 선택 상자 하나로(사용자 2026-11-12 "select box 로 5년 1년 6개월 3개월 1개월 24시간")
  return (
    <select value={range} onChange={e => setChartRange(e.target.value as ChartRange)}
            title="카드 배경 차트 기간 (전체 설정) — 5년은 점을 솎아 그린다"
            className={`align-middle rounded border border-indigo-300 bg-white text-indigo-700 font-bold ${small ? "text-[11px] px-0.5 py-0" : "text-[11px] px-1 py-0.5"} ${className}`}>
      {CHART_RANGES.map(r => <option key={r.v} value={r.v}>{r.label}</option>)}
    </select>
  );
}

/** 평균 시장 — 한국(국내 종목) / 미국(미국 대장주). 기본은 시간 자동(평일 08~20시 한국)(사용자 2026-11-05) */
export function AvgMarketToggle({ className = "" }: { className?: string }) {
  const m = useAvgMarket();
  return (
    <span className={`inline-flex rounded border border-gray-300 overflow-hidden align-middle font-bold text-[11px] ${className}`}
          title="왼쪽 업종 탭 평균을 국내 종목으로 낼지 해외 대장주(미국·일본)로 낼지 — 기본은 시간 자동(평일 08:00~20:00 국내, 그 밖·주말 해외)">
      {(["US", "KR"] as const).map(v => (   // 해외 | 국내 순(표의 왼쪽 해외·오른쪽 국내와 맞춤, 사용자 2026-11-10)
        <button key={v} onClick={() => setAvgMarket(v)}
                className={`px-1.5 py-0 whitespace-nowrap ${m === v ? "bg-indigo-600 text-white" : "bg-white text-gray-500 hover:bg-gray-100"}`}>
          {v === "KR" ? "국내" : "해외"}
        </button>
      ))}
    </span>
  );
}
