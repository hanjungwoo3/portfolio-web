// 안드로이드 앱 위아래 시스템 막대(상태 표시줄·내비게이션 막대) — 전체 화면(숨김) 켜기·끄기(사용자 요청 2026-10-25).
//   Capacitor 8 내장 SystemBars 를 쓴다 — APK 1.2.2 에 이미 들어 있어 웹 배포만으로 동작한다.
//   웹·데스크톱에서는 아무것도 하지 않는다.
import { Capacitor, SystemBars, SystemBarsStyle, registerPlugin } from "@capacitor/core";
import { isNativeApp } from "./nativeProxy";
import { getNightBg, onNightBgApply } from "./nightBg";

const KEY = "app_fullscreen";
export function getAppFullscreen(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}
export function setAppFullscreen(on: boolean): void {
  try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* 이번 실행만 */ }
  applySystemBars();
}

// 앱 창 바탕색 플러그인(APK 1.2.3+, SystemUiPlugin.java) — 막대 뒤·카메라 구멍 띠는 웹이 아니라 창 바탕이 보인다
const SystemUi = registerPlugin<{ setBackground(o: { color: string }): Promise<void> }>("SystemUi");
const NIGHT_BAR = "#23272c";   // index.css 야간 메뉴(pg-menu)와 같은 색

export function applySystemBars(): void {
  if (!isNativeApp()) return;
  // 야간이면 창 바탕을 어둡게 + 막대 아이콘을 밝게. 바탕을 못 바꾸는 옛 APK(1.2.2)는 아이콘도 그대로(흰 바탕에 흰 아이콘이 되지 않게)
  const night = getNightBg();
  const canBg = Capacitor.isPluginAvailable("SystemUi");
  if (canBg) void SystemUi.setBackground({ color: night ? NIGHT_BAR : "#ffffff" }).catch(() => {});
  void SystemBars.setStyle({ style: night && canBg ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => {});
  // 전체 화면 — 위아래 막대를 숨긴다(화면 끝을 쓸면 잠깐 나타났다 다시 숨는다)
  void (getAppFullscreen() ? SystemBars.hide() : SystemBars.show()).catch(() => {});
}

// 야간 배경이 바뀔 때마다 막대 스타일도 같이
export function installSystemBars(): void {
  if (!isNativeApp()) return;
  onNightBgApply(applySystemBars);
  // 전체 화면에서 화면 끝을 쓸어 막대를 꺼내면 계속 남았다 — '잠깐 보였다 숨기'(BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE)를
  //   샤오미(HyperOS)가 따르지 않았다(실기기 2026-10-25). 켜져 있는 동안 3초마다 다시 숨긴다(숨어 있으면 아무 일 없음)
  setInterval(() => {
    if (getAppFullscreen() && document.visibilityState === "visible") void SystemBars.hide().catch(() => {});
  }, 3000);
}
