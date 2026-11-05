// 안드로이드 앱 뒤로 키 — 2초 안에 두 번 누르면 종료(사용자 제보 2026-11-05 "back키로 앱 종료가 안 되네요, recent 화면에서 죽여야").
//   Capacitor 기본은 웹뷰 '이전 페이지'로 가서(미리보기 이동·리다이렉트가 쌓인다) 앱이 안 꺼졌다.
//   첫 번째: 열린 창이 있으면 Esc 로 닫고, 아래에 "한 번 더 누르면 종료" 안내. 두 번째: 종료.
import { App as CapApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";

let last = 0;
function hint() {
  const el = document.createElement("div");
  el.textContent = "뒤로 키를 한 번 더 누르면 종료합니다";
  el.style.cssText = "position:fixed;left:50%;bottom:72px;transform:translateX(-50%);z-index:4000;background:rgba(17,24,39,.9);color:#fff;font-size:13px;padding:8px 14px;border-radius:999px;pointer-events:none";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1800);
}

export function startAndroidBack(): void {
  try { if (Capacitor.getPlatform() !== "android") return; } catch { return; }
  void CapApp.addListener("backButton", () => {
    const now = Date.now();
    if (now - last < 2000) { void CapApp.exitApp(); return; }
    last = now;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    hint();
  });
}
