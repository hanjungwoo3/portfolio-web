// 종목 실시간 체결 팝업 — 종목 카드 ⚡ 버튼·반도체 탭 체결 칸 제목에서 연다(사용자 요청 2026-10-22).
//   전역 하나만 — App 루트의 StockTickPopupHost 가 이 값을 보고 띄운다.
import { useSyncExternalStore } from "react";

export interface TickPopupTarget { code: string; name: string }
let cur: TickPopupTarget | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach(f => f());

export function openTickPopup(code: string, name: string): void { cur = { code, name }; emit(); }
export function closeTickPopup(): void { cur = null; emit(); }
export function useTickPopup(): TickPopupTarget | null {
  return useSyncExternalStore(f => { subs.add(f); return () => { subs.delete(f); }; }, () => cur);
}
/** 체결 팝업을 열 수 있는 종목인가 — 국내 종목·ETF(6자리, 숫자 포함)만. 미국은 토스 체결 형식이 달라 뺀다 */
export const canTickPopup = (ticker: string) => /^[\dA-Za-z]{6}$/.test(ticker) && /\d/.test(ticker);
