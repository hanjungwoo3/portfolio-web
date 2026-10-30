// 따라 해 보기 — 처음 온 사용자가 **실제 화면에서** 종목을 검색해 담아 보게 하는 안내(사용자 요청 2026-10-30
//   "설명 페이지만 있는 게 아니라 실제로 검색하고 추가하도록", "설명창이 떠 있는 상태에서 실제로 해볼 수 있게").
//   안내 창(GuideTour)은 화면을 막지 않고, 각 단계는 사용자가 그 동작을 실제로 하면(guideEvent) 넘어간다.
//   단계의 target = 화면에서 테두리로 짚을 요소의 data-guide 값. PC·모바일이 같은 단계 목록을 쓴다(한 벌).
import { useSyncExternalStore } from "react";

export type GuideEvent = "search-open" | "search-results" | "search-applied";
export interface GuideStep {
  target?: string;         // data-guide 값
  doneOn?: GuideEvent;     // 이 이벤트가 오면 다음 단계
  title: string;
  text: string;
  example?: string;        // 검색창에 넣어 볼 예시 종목명(버튼)
}
export const GUIDE_EXAMPLE = "삼성전자";
export const GUIDE_STEPS: GuideStep[] = [
  { target: "search-btn", doneOn: "search-open", title: "검색 열기", text: "위의 [검색] 버튼을 눌러 보세요." },
  { target: "search-input", doneOn: "search-results", title: "종목 이름 쓰기",
    text: `검색창에 종목 이름을 써 보세요. 예) ${GUIDE_EXAMPLE}`, example: GUIDE_EXAMPLE },
  // 따라 해 보기 중엔 검색 결과 첫 종목만 체크해 둔다(SearchDialog) — 처음 쓰는 사람은 원래 결과 전부가 체크돼 ETF 까지 담겼다
  { target: "search-row", title: "종목 고르기",
    text: `${GUIDE_EXAMPLE}에 체크돼 있어요. 다른 종목도 담으려면 왼쪽 □ 를 더 체크하세요.` },
  { target: "search-apply", doneOn: "search-applied", title: "담기",
    text: "[✅ 일괄적용] 을 누르면 '관심' 그룹에 담겨요. (수량 0 = 관심)" },
  { title: "다 됐어요! 🎉",
    text: "담은 종목은 '관심' 탭에 카드로 보여요. 카드의 ⚙️ 로 수량·평단을 넣으면 보유가 되고 손익이 계산돼요." },
];

let state: { active: boolean; step: number } = { active: false, step: 0 };
const listeners = new Set<() => void>();
const set = (s: typeof state) => { state = s; listeners.forEach(l => l()); };

export function startGuide(): void { set({ active: true, step: 0 }); }
export function stopGuide(): void { set({ active: false, step: 0 }); }
export function nextGuide(): void {
  if (!state.active) return;
  set(state.step + 1 >= GUIDE_STEPS.length ? { active: false, step: 0 } : { active: true, step: state.step + 1 });
}
/** 화면에서 사용자가 한 동작 — 지금 단계가 기다리던 것이면 넘어간다(다른 단계의 이벤트는 무시). */
export function guideEvent(e: GuideEvent): void {
  if (!state.active) return;
  const i = GUIDE_STEPS.findIndex(s => s.doneOn === e);
  // 앞 단계를 건너뛰고 뒤 동작을 먼저 해도(검색창을 이미 열어 둔 채 시작 등) 그 다음으로 맞춘다
  if (i >= state.step) set({ active: true, step: i + 1 });
}
export function isGuideActive(): boolean { return state.active; }
export function useGuide(): { active: boolean; step: number } {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => state);
}
/** 예시 종목명을 검색창에 — SearchDialog 가 듣는다 */
export const GUIDE_FILL_EVENT = "guide-fill-search";
export function guideFillSearch(text: string): void {
  window.dispatchEvent(new CustomEvent(GUIDE_FILL_EVENT, { detail: text }));
}
