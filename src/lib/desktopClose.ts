// 데스크톱 앱 창 ✕ 동작 — 바로 종료(기본) | 트레이(맥 메뉴 막대·윈도우 알림 영역)에 남기기(사용자 2026-11-18 "트레이에 남길지 바로 종료할지 옵션").
//   값은 이 기기 localStorage, 앱 네이티브(set_close_to_tray)에 켤 때마다 알려 준다. 옛 앱(명령 없음)은 조용히 무시 — 늘 바로 종료.
import { isDesktopApp } from "./nativeProxy";

const KEY = "desktop_close_to_tray";
type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
const invoke = (): Invoke | null => {
  const t = (window as unknown as { __TAURI_INTERNALS__?: { invoke: Invoke } }).__TAURI_INTERNALS__;
  return t?.invoke ? t.invoke.bind(t) : null;
};

export function getCloseToTray(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}

/** 앱이 이 설정을 받을 수 있나(0.1.17 이상) — 실패하면 false */
export async function setCloseToTray(on: boolean): Promise<boolean> {
  try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* 이번만 */ }
  const inv = isDesktopApp() ? invoke() : null;
  if (!inv) return false;
  try { await inv("set_close_to_tray", { on }); return true; } catch { return false; }
}

/** 앱 시작 때 한 번 — 저장된 값을 네이티브에 */
export function applyCloseToTray(): void {
  if (!isDesktopApp()) return;
  void setCloseToTray(getCloseToTray());
}
