// 야간 배경 — 카드 바깥(페이지 바탕·그룹 상자)만 어둡게(사용자 요청 2026-10-23).
//   카드는 손대지 않는다: 흐린 카드(장 마감, opacity 60%)는 어두운 바탕이 비쳐 저절로 가라앉고,
//   열린 시장 카드만 밝게 떠 보인다. 표시는 <html class="night-bg"> + index.css 의 pg-* 클래스.
//   pg-bg = 페이지 바탕, pg-box = 그룹 상자, pg-title = 그룹 상자 제목 책갈피.
const KEY = "night_bg";

export function getNightBg(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}
export function applyNightBg(): void {
  document.documentElement.classList.toggle("night-bg", getNightBg());
}
export function setNightBg(on: boolean): void {
  try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* 저장 실패 — 이번 화면만 */ }
  applyNightBg();
}
