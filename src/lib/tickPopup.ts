// 📊 종목정보 팝업 — 종목 카드·지수 카드·반도체 탭 체결 칸에서 연다(2026-10-23 ⚡체결 + 📊기업가치 → 버튼 하나로).
//   탭 두 개: ⚡ 실시간(체결·호가·거래원·새 소식 — 이 파일의 전역 상태, StockInfoPopupHost 가 띄움)
//            📊 기업가치(쌓인 자료 — 기존 ValuationModal, requestValuation 이벤트로 연다)
//   기본은 실시간. 두 창은 머리의 탭(StockInfoTabs)으로 서로 오간다.
import { useSyncExternalStore } from "react";
import { requestValuation } from "./valuationNav";

export type StockInfoTab = "live" | "value";
export interface StockInfoTarget { code: string; name: string }
let cur: StockInfoTarget | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach(f => f());

/** 종목정보 열기 — tab 생략 = 실시간. 기업가치는 기존 모달로 넘긴다(그쪽이 평단·메모 등 App 상태를 안다) */
export function openStockInfo(code: string, name: string, tab: StockInfoTab = "live"): void {
  if (tab === "value") { cur = null; emit(); requestValuation(code, name); return; }
  cur = { code, name }; emit();
}
export function closeStockInfo(): void { cur = null; emit(); }
export function useStockInfo(): StockInfoTarget | null {
  return useSyncExternalStore(f => { subs.add(f); return () => { subs.delete(f); }; }, () => cur);
}
/** 실시간 탭을 열 수 있는 종목인가 — 국내 종목·ETF(6자리, 숫자 포함)만. 미국은 토스 체결 형식이 달라 기업가치만 */
export const canStockInfo = (ticker: string) => /^[\dA-Za-z]{6}$/.test(ticker) && /\d/.test(ticker);

// 옛 이름 — 호출처가 많아 남겨 둔다
export const openTickPopup = (code: string, name: string) => openStockInfo(code, name, "live");
export const closeTickPopup = closeStockInfo;
export const canTickPopup = canStockInfo;
