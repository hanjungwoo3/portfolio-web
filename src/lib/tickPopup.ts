// 📊 종목정보 — 종목 카드·지수 카드·반도체 탭 체결 칸에서 연다(2026-10-23 ⚡체결 + 📊기업가치 → 버튼 하나, 한 페이지).
//   창은 하나(ValuationModal): 맨 위 ⚡ 실시간(국내 종목) → 요약 → 실적·재무 → 차트·수급 → 공시 이력. 위 칩으로 그 자리로.
//   이 파일은 '어디서든 연다' 만 — 실제 상태는 App/Mobile 이 가진다(requestValuation 이벤트).
import { requestValuation } from "./valuationNav";

export type StockInfoTab = "live" | "value";

/** 종목정보 열기 — tab 생략 = 실시간 자리에서, "value" = 요약 자리에서 */
export function openStockInfo(code: string, name: string, tab: StockInfoTab = "live"): void {
  requestValuation(code, name, tab === "value" ? "summary" : "live");
}
/** 실시간 자리를 그릴 수 있는 종목인가 — 국내 종목·ETF(6자리, 숫자 포함)만 */
export const canStockInfo = (ticker: string) => /^[\dA-Za-z]{6}$/.test(ticker) && /\d/.test(ticker);

// 옛 이름 — 호출처가 많아 남겨 둔다
export const openTickPopup = (code: string, name: string) => openStockInfo(code, name, "live");
export const canTickPopup = canStockInfo;
