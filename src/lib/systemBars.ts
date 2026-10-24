// 안드로이드 앱 위아래 시스템 막대(상태 표시줄·내비게이션 막대) — 전체 화면(숨김) 켜기·끄기(사용자 요청 2026-10-25).
//   Capacitor 8 내장 SystemBars 를 쓴다 — APK 1.2.2 에 이미 들어 있어 웹 배포만으로 동작한다.
//   웹·데스크톱에서는 아무것도 하지 않는다.
import { SystemBars, SystemBarsStyle } from "@capacitor/core";
import { isNativeApp } from "./nativeProxy";
import { onNightBgApply } from "./nightBg";

const KEY = "app_fullscreen";
export function getAppFullscreen(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}
export function setAppFullscreen(on: boolean): void {
  try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* 이번 실행만 */ }
  applySystemBars();
}

export function applySystemBars(): void {
  if (!isNativeApp()) return;
  // 전체 화면 — 위아래 막대를 숨긴다(화면 끝을 쓸면 잠깐 나타났다 다시 숨는다).
  //   ★ 막대 '색'은 못 바꾼다 — 막대 뒤는 웹 화면이 아니라 앱 창 바탕(흰색)이라, 스타일만 Dark 로 하면
  //     흰 바탕에 흰 아이콘이 된다. 야간에 막대가 밝은 건 전체 화면으로 푼다(막대 뒤를 웹으로 채우려면 레이아웃 전면 수정 필요).
  void SystemBars.setStyle({ style: SystemBarsStyle.Light }).catch(() => {});
  void (getAppFullscreen() ? SystemBars.hide() : SystemBars.show()).catch(() => {});
}

// 야간 배경이 바뀔 때마다 막대 스타일도 같이
export function installSystemBars(): void {
  if (!isNativeApp()) return;
  onNightBgApply(applySystemBars);
}
