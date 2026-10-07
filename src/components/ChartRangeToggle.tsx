// 카드 배경 차트 기간 토글 [3개월|24시간] — 앱 전체 설정(lib/chartRange). 어디 달아도 같은 값을 바꾼다.
import { setChartRange, useChartRange } from "../lib/chartRange";

export function ChartRangeToggle({ small = false, className = "" }: { small?: boolean; className?: string }) {
  const range = useChartRange();
  return (
    <span className={`inline-flex rounded border border-gray-300 overflow-hidden align-middle font-bold
                      ${small ? "text-[10px]" : "text-[11px]"} ${className}`}
          title="카드 배경 차트 기간 (전체 설정)">
      {(["all", "day"] as const).map(v => (
        <button key={v} onClick={() => setChartRange(v)}
                className={`${small ? "px-1" : "px-1.5"} py-0
                            ${range === v ? "bg-indigo-600 text-white" : "bg-white text-gray-500 hover:bg-gray-100"}`}>
          {v === "all" ? "3개월" : "24시간"}
        </button>
      ))}
    </span>
  );
}
