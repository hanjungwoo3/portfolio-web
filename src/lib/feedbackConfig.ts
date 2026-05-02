// 피드백 폼 — Tally URL 설정.
//
// ─── 셋업 가이드 ──────────────────────────────────────────
// 1. https://tally.so 접속 → 무료 가입
// 2. New form → 빈 폼에서 시작
// 3. 필드 추가 (예시):
//    - 이름 (Short answer, 선택)
//    - 이메일 (Email, 선택 — 답변 받고 싶을 때)
//    - 카테고리 (Multiple choice: 🐛 버그 / 💡 제안 / ❓ 질문 / 기타)
//    - 내용 (Long answer, 필수)
//    - 디바이스 (Multiple choice: 모바일 / PC, 선택)
//    - 브라우저 (Short answer, 선택)
// 4. Publish → URL 복사 (예: https://tally.so/r/abc123)
// 5. 아래 TALLY_URL 에 붙여넣기 → git commit → 배포
// ──────────────────────────────────────────────────────────

export const TALLY_URL = "https://tally.so/r/81jKPr";

export function isFeedbackEnabled(): boolean {
  return TALLY_URL.includes("tally.so") && !TALLY_URL.includes("REPLACE_ME");
}
