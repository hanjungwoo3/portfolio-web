// 탭 딥링크 — 카드에서 다른 탭으로 보내달라고 요청한다.
//   히트맵 전용이던 heatmapNav 와 같은 이유로 전역 이벤트를 쓴다: 카드가 트리 깊숙이 있어
//   prop 쓰레딩이 번거롭고, PC(App)·모바일(MobileSimpleView) 두 곳이 각자 탭 상태를 들고 있다.
//
// ⚠️ 숨겨진 탭으로 보내면 안 된다 — App 의 가드가 "목록에 없는 탭" 을 첫 탭으로 되돌려 버려서
//   엉뚱한 화면으로 튄다. 링크를 그리기 전에 isTabVisible() 로 먼저 물어본다.
import { getTabVisibility, type TabVisibility } from "./tabVisibility";

export const GOTO_TAB_EVENT = "goto-tab";

export function requestTab(key: string): void {
  window.dispatchEvent(new CustomEvent(GOTO_TAB_EVENT, { detail: key }));
}

export function isTabVisible(k: keyof TabVisibility): boolean {
  return getTabVisibility()[k] ?? true;
}
