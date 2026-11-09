// 등락률 비교 차트 — 어디서든 "이 종목들 한 그래프로" 를 연다(업종 칸·종목정보 등, 사용자 2026-11-10 "여러 종목 일별 상승률을 그래프로 한 번에").
//   실제 창(EtfCompareChartDialog)은 CompareHost 하나 — App·Mobile 최상위. valuationNav 와 같은 전역 이벤트 방식.
export const OPEN_COMPARE_EVENT = "open-compare-chart";
export interface CompareRequest { title: string; items: { ticker: string; name: string }[] }

/** 야후·지수 탭 심볼 → 비교 차트 티커. 000660.KS·035720.KQ → 6자리, 그 밖(NVDA·8035.T)은 그대로 */
export const compareTicker = (sym: string) => (/^[\dA-Za-z]{6}\.(KS|KQ)$/.test(sym) ? sym.slice(0, 6) : sym);

export function openCompare(title: string, items: { ticker: string; name: string }[]): void {
  window.dispatchEvent(new CustomEvent<CompareRequest>(OPEN_COMPARE_EVENT, { detail: { title, items } }));
}
