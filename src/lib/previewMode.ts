// 미리보기 모드 — 배포 전 수정을 **쓰고 있는 앱 그대로**(오늘 쌓인 기록 포함) 써 보기(사용자 2026-11-04).
//   미리보기는 같은 사이트의 /portfolio-web/preview/ 에 올린다(npm run deploy:preview) — 출처가 같아 localStorage·IndexedDB 를 같이 쓴다.
//   앱에서 '🧪 미리보기' 를 누르면 표시를 켜고 그 주소로 간다. 앱을 다시 켜도 표시가 있으면 미리보기로(12시간 지나면 끈다).
//   본 배포가 미리보기를 지우면 public/preview/index.html(자리 비움)이 표시를 지우고 원래 화면으로 돌려보낸다.
const KEY = "portfolio_preview";
const TTL = 12 * 3600_000;
const BASE = "/portfolio-web/";
const PREVIEW = "/portfolio-web/preview/";

export const isPreviewBuild = __IS_PREVIEW__;

/** 앱 시작 때 — 미리보기 표시가 있으면 미리보기로, 미리보기 빌드인데 표시가 없으면(직접 들어옴) 표시를 켠다 */
export function routePreview(): void {
  if (typeof window === "undefined" || location.hostname !== "hanjungwoo3.github.io") return;
  let at = 0;
  try { at = Number(localStorage.getItem(KEY) ?? 0); } catch { /* 없음 */ }
  if (isPreviewBuild) { if (!at) try { localStorage.setItem(KEY, String(Date.now())); } catch { /* 이번만 */ } return; }
  if (at && Date.now() - at < TTL) location.replace(PREVIEW);
  else if (at) try { localStorage.removeItem(KEY); } catch { /* noop */ }
}

/** 지금 올라가 있는 미리보기(없으면 null) — 그 빌드 시각이 지금 화면보다 새것일 때만 단추를 보인다 */
export async function fetchPreviewInfo(): Promise<{ buildTime: string; commit?: string } | null> {
  try {
    const r = await fetch(`${PREVIEW}version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return null;
    const j = await r.json() as { buildTime?: string; commit?: string; hash?: string };
    return j.buildTime ? { buildTime: j.buildTime, commit: j.commit ?? j.hash } : null;
  } catch { return null; }
}

export function enterPreview(): void {
  try { localStorage.setItem(KEY, String(Date.now())); } catch { /* noop */ }
  location.replace(PREVIEW);
}
export function leavePreview(): void {
  try { localStorage.removeItem(KEY); } catch { /* noop */ }
  location.replace(BASE);
}
