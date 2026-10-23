// 지금 보는 기기 — 첫 방문 안내에서 그 기기에 맞는 앱 하나만 크게 보여 주려고(사용자 요청 2026-10-23).
//   userAgentData(크롬 계열) → userAgent 순. 아이패드 사파리는 "Mac" 이라고 답해 터치 여부로 한 번 더 가른다.
export type Platform = "mac" | "windows" | "android" | "ios" | "other";

export function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "other";
  const uad = (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData?.platform ?? "";
  const ua = navigator.userAgent || "";
  const s = `${uad} ${ua}`;
  if (/Android/i.test(s)) return "android";
  if (/iPhone|iPad|iPod/i.test(s)) return "ios";
  if (/Mac/i.test(s)) return navigator.maxTouchPoints > 1 ? "ios" : "mac";   // 아이패드(데스크톱 모드)
  if (/Win/i.test(s)) return "windows";
  return "other";
}

// 앱 받기 — 고정 릴리스 apps(파일 이름 고정, .github/workflows/desktop.yml)
export const APPS_PAGE = "https://github.com/hanjungwoo3/portfolio-web/releases/tag/apps";
export const APPS_DL = "https://github.com/hanjungwoo3/portfolio-web/releases/download/apps";
// 개인정보·안전 안내 — 정적 페이지(public/privacy.html). 같은 출처의 상대 주소라 로컬(localhost)·배포·앱 어디서든 그 환경의 파일을 연다
//   (절대 주소로 적었더니 로컬에서 눌러도 아직 없는 배포 사이트로 갔다, 2026-10-23). 릴리스 설명(desktop.yml)만 절대 주소.
export const PRIVACY_URL = `${import.meta.env.BASE_URL}privacy.html`;
