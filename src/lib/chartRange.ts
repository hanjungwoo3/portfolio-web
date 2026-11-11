// 카드 배경 차트 기간 — 앱 전체 설정 하나. 3개월(일봉) | 24시간(토스 10분봉).
//   지수 카드·종목 카드·PC·모바일 어디서 바꿔도 화면의 모든 카드가 같이 바뀐다.
//   24시간 시계열이 없는 카드(국고채, 토스 코드 모르는 종목 등)는 3개월로 그린다.
import { useSyncExternalStore } from "react";

// 기간 — 5년·1년·6개월·3개월·1개월·24시간(사용자 2026-11-12 "select box 로 5년 1년 6개월 3개월 1개월 24시간").
//   저장값 호환: "all" = 3개월, "week" = 1개월(옛 이름 그대로), 옛 "year" = 1년
export type ChartRange = "5y" | "1y" | "6mo" | "all" | "week" | "day";
export const CHART_RANGES: { v: ChartRange; label: string }[] = [
  { v: "5y", label: "5년" }, { v: "1y", label: "1년" }, { v: "6mo", label: "6개월" },
  { v: "all", label: "3개월" }, { v: "week", label: "1개월" }, { v: "day", label: "24시간" },
];
const KEY = "dashboard_chart_range";
const EVENT = "chart-range-change";

// 기본 = 24시간(사용자 결정 2026-10-22). 직접 고른 적이 있으면 그 선택을 따른다.
function read(): ChartRange {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "year") return "1y";
    return CHART_RANGES.some(r => r.v === v) ? (v as ChartRange) : "day";
  } catch { return "day"; }
}
let current: ChartRange = read();

export function setChartRange(v: ChartRange): void {
  current = v;
  try { localStorage.setItem(KEY, v); } catch { /* 이번 세션만 */ }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

export function useChartRange(): ChartRange {
  return useSyncExternalStore(subscribe, () => current);
}

export type HistRange = "3mo" | "6mo" | "1y" | "5y";
/** 받을 일봉 기간 — 1개월·24시간(폴백)은 3개월을 받아 쓴다(같은 캐시) */
export function historyRange(range: ChartRange): HistRange {
  return range === "5y" ? "5y" : range === "1y" ? "1y" : range === "6mo" ? "6mo" : "3mo";
}
/** 받은 일봉 → 그릴 점. 1개월이면 뒤 21개, 5년이면 260점쯤으로 솎는다(점이 1,200개면 선이 뭉개지고 무겁다) */
export function trimByRange<T>(arr: T[], range: ChartRange): T[] {
  if (range === "week") return arr.slice(-21);
  if (range === "5y" && arr.length > 300) {
    const k = Math.ceil(arr.length / 260), out: T[] = [];
    for (let i = arr.length - 1; i >= 0; i -= k) out.unshift(arr[i]);   // 마지막(오늘)은 꼭 넣는다
    return out;
  }
  return arr;
}
/** 기간별 일봉 개수(직접 자르는 출처용) */
export const HIST_BARS: Record<HistRange, number> = { "3mo": 63, "6mo": 126, "1y": 252, "5y": 1260 };

/** 고른 기간의 배경 차트 — 24시간이면 당일 시계열, 없으면 3개월로 폴백. */
export function pickCardChart(range: ChartRange, full: number[], day: number[] | undefined): number[] {
  return range === "day" && day && day.length > 1 ? day : trimByRange(full, range);
}
