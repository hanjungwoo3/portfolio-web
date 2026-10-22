// 데스크톱 앱(맥·윈도우, Tauri) 업데이트 — 앱 쪽 명령(desktop/src-tauri app_update_*)을 부른다.
//   새 버전은 고정 릴리스 'apps' 의 latest.json 으로 앱이 직접 확인한다(서명 검증 포함).
//   웹 화면은 사이트를 그대로 띄우니 웹 배포로 바로 바뀐다 — 이건 앱 자체가 바뀔 때만 뜬다.
import { isDesktopApp } from "./nativeProxy";

export interface DesktopUpdate { current: string; latest: string | null; canInstall: boolean; page: string }

function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const t = (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<T> } }).__TAURI_INTERNALS__;
  return t.invoke(cmd, args);
}

export async function checkDesktopUpdate(): Promise<DesktopUpdate | null> {
  if (!isDesktopApp()) return null;
  try {
    const r = await invoke<{ current: string; latest: string | null; can_install: boolean; page: string }>("app_update_check");
    return { current: r.current, latest: r.latest, canInstall: r.can_install, page: r.page };
  } catch {
    return null;   // 업데이트 앱이 없는 옛 빌드·네트워크 실패 — 조용히
  }
}

// 맥·윈도우 설치판 = 받아서 바꾸고 재시작. 윈도우 실행형 = 다운로드 페이지를 연다.
export function installDesktopUpdate(): Promise<void> {
  return invoke<void>("app_update_install");
}
