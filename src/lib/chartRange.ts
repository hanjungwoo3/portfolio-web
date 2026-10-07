// 카드 배경 차트 기간 — 앱 전체 설정 하나. 3개월(일봉) | 24시간(토스 10분봉).
//   지수 카드·종목 카드·PC·모바일 어디서 바꿔도 화면의 모든 카드가 같이 바뀐다.
//   24시간 시계열이 없는 카드(국고채, 토스 코드 모르는 종목 등)는 3개월로 그린다.
import { useSyncExternalStore } from "react";

export type ChartRange = "all" | "day";
const KEY = "dashboard_chart_range";
const EVENT = "chart-range-change";

function read(): ChartRange {
  try { return localStorage.getItem(KEY) === "day" ? "day" : "all"; } catch { return "all"; }
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

/** 고른 기간의 배경 차트 — 24시간이면 당일 시계열, 없으면 3개월로 폴백. */
export function pickCardChart(range: ChartRange, full: number[], day: number[] | undefined): number[] {
  return range === "day" && day && day.length > 1 ? day : full;
}
