// 안드로이드 앱 — 바깥 링크(뉴스·공시·토스·네이버·구글 AI)를 시스템 브라우저 대신 앱 안 브라우저(Custom Tabs)로.
//   뒤로 가기로 앱에 돌아온다(사용자 요청 2026-10-23). 데스크톱 앱은 desktop/src-tauri 의 보기 창이 같은 일을 한다.
//   웹(브라우저)에선 아무것도 하지 않는다 — 새 탭이 그대로 맞다.
import { Browser } from "@capacitor/browser";
import { isNativeApp } from "./nativeProxy";

const isExternal = (href: string) => {
  try {
    const u = new URL(href, location.href);
    return /^https?:$/.test(u.protocol) && u.origin !== location.origin;
  } catch { return false; }
};

export function installInAppBrowser() {
  if (!isNativeApp()) return;
  const open = (url: string) => { void Browser.open({ url }); };
  const orig = window.open.bind(window);
  // 같은 출처(앱 자신) 창은 원래대로, 바깥 주소만 앱 안 브라우저로
  window.open = ((u?: string | URL, ...rest: unknown[]) => {
    const s = u == null ? "" : String(u);
    if (s && isExternal(s)) { open(new URL(s, location.href).toString()); return null; }
    return (orig as (...a: unknown[]) => Window | null)(u, ...rest);
  }) as typeof window.open;
  // 버블 단계 + 웹이 이미 처리한 클릭(앱 팝업을 여는 링크)은 건너뛴다 — 데스크톱과 같은 규칙
  window.addEventListener("click", e => {
    if (e.defaultPrevented) return;
    const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!a || !isExternal(a.href)) return;
    e.preventDefault();
    open(a.href);
  });
}
