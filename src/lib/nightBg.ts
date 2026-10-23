// 야간 배경 — 카드 바깥(페이지 바탕·그룹 상자·위아래 메뉴)만 회색 계열로 어둡게(사용자 요청 2026-10-23).
//   카드는 밝기만 80% 로(pg-card, 색은 그대로): 흐린 카드(장 마감, opacity 60%)는 어두운 바탕이 비쳐 더 가라앉고,
//   열린 시장 카드가 상대적으로 밝게 떠 보인다. 표시는 <html class="night-bg"> + index.css 의 pg-* 클래스.
//   pg-bg = 페이지 바탕, pg-box = 그룹 상자, pg-title = 그룹 상자 제목, pg-menu = 헤더·탭·칩 줄·아래 지수 띠, pg-card = 지수 탭 카드.
import { useSyncExternalStore } from "react";

const KEY = "night_bg";
const subs = new Set<() => void>();

export function getNightBg(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}
export function applyNightBg(): void {
  document.documentElement.classList.toggle("night-bg", getNightBg());
}
export function setNightBg(on: boolean): void {
  try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* 저장 실패 — 이번 화면만 */ }
  applyNightBg();
  subs.forEach(f => f());
}
// 헤더 토글·설정 체크박스가 같은 값을 보게
export function useNightBg(): boolean {
  return useSyncExternalStore(f => { subs.add(f); return () => { subs.delete(f); }; }, getNightBg);
}
