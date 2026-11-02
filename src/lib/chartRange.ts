// 카드 배경 차트 기간 — 앱 전체 설정 하나. 3개월(일봉) | 24시간(토스 10분봉).
//   지수 카드·종목 카드·PC·모바일 어디서 바꿔도 화면의 모든 카드가 같이 바뀐다.
//   24시간 시계열이 없는 카드(국고채, 토스 코드 모르는 종목 등)는 3개월로 그린다.
import { useSyncExternalStore } from "react";

// "all" = 3개월(옛 이름 그대로 — 저장값 호환), "year" = 1년(사용자 2026-11-02 "3개월에 추가로 1년도")
export type ChartRange = "all" | "year" | "day";
const KEY = "dashboard_chart_range";
const EVENT = "chart-range-change";

// 기본 = 24시간(사용자 결정 2026-10-22). 직접 3개월을 고른 적이 있으면("all" 저장) 그 선택을 따른다.
function read(): ChartRange {
  try { const v = localStorage.getItem(KEY); return v === "all" || v === "year" ? v : "day"; } catch { return "day"; }
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

/** 일봉 기간 — 3개월이면 "3mo", 1년이면 "1y"(24시간이어도 폴백용 일봉은 3개월) */
export function historyRange(range: ChartRange): "3mo" | "1y" {
  return range === "year" ? "1y" : "3mo";
}

/** 고른 기간의 배경 차트 — 24시간이면 당일 시계열, 없으면 3개월로 폴백. */
export function pickCardChart(range: ChartRange, full: number[], day: number[] | undefined): number[] {
  return range === "day" && day && day.length > 1 ? day : full;
}
