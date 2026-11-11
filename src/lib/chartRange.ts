// 카드 배경 차트 기간 — 앱 전체 설정 하나. 3개월(일봉) | 24시간(토스 10분봉).
//   지수 카드·종목 카드·PC·모바일 어디서 바꿔도 화면의 모든 카드가 같이 바뀐다.
//   24시간 시계열이 없는 카드(국고채, 토스 코드 모르는 종목 등)는 3개월로 그린다.
import { useSyncExternalStore } from "react";

// "all" = 3개월(옛 이름 그대로 — 저장값 호환), "week" = 7일(사용자 2026-11-12 "1년 빼고 7일 추가" — 옛 '1년' 저장값은 3개월로)
export type ChartRange = "all" | "week" | "day";
const KEY = "dashboard_chart_range";
const EVENT = "chart-range-change";

// 기본 = 24시간(사용자 결정 2026-10-22). 직접 3개월을 고른 적이 있으면("all" 저장) 그 선택을 따른다.
function read(): ChartRange {
  try { const v = localStorage.getItem(KEY); return v === "all" || v === "week" ? v : v === "year" ? "all" : "day"; } catch { return "day"; }
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
export function historyRange(_range: ChartRange): "3mo" | "1y" {
  return "3mo";   // 7일도 3개월 일봉을 받아 뒤 7개만(trimByRange) — 같은 캐시를 쓴다
}
/** 7일이면 일봉 뒤 7개(거래일 7일)만 */
export function trimByRange<T>(arr: T[], range: ChartRange): T[] {
  return range === "week" ? arr.slice(-7) : arr;
}

/** 고른 기간의 배경 차트 — 24시간이면 당일 시계열, 없으면 3개월로 폴백. */
export function pickCardChart(range: ChartRange, full: number[], day: number[] | undefined): number[] {
  return range === "day" && day && day.length > 1 ? day : trimByRange(full, range);
}
