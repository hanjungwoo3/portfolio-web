// 기업가치 팝업 딥링크 — 어디서든 "이 종목 기업가치 열어줘" 를 요청한다.
//   ValuationModal 은 App / MobileSimpleView 최상위에만 있는데, ETF 구성 팝업처럼
//   깊이 중첩된 화면에서도 열어야 한다. prop 을 몇 겹씩 내리는 대신 전역 이벤트로 잇는다
//   (히트맵 딥링크 heatmapNav, 탭 이동 tabNav 와 같은 방식).
export const OPEN_VALUATION_EVENT = "open-valuation";

export interface ValuationRequest { ticker: string; name: string }

export function requestValuation(ticker: string, name: string): void {
  window.dispatchEvent(new CustomEvent<ValuationRequest>(OPEN_VALUATION_EVENT, {
    detail: { ticker, name },
  }));
}
