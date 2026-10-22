// 확인창·입력창 — 맥 데스크톱 앱에서도 뜨게.
//   맥 앱의 화면 엔진(WKWebView)은 window.confirm·prompt 를 띄우지 않고 바로 false·null 을 돌려준다
//   → Drive 가져오기·삭제 확인이 조용히 '취소'로 끝났다(2026-10-22). 앱에 물어 맥 기본 대화상자를 띄운다.
//   웹·안드로이드·윈도우 앱은 원래 되므로 window.confirm/prompt 그대로. alert 는 앱이 직접 바꿔 끼운다(main.rs).
//   ★ 새 confirm·prompt 는 이 함수로 — window.confirm 을 직접 쓰면 맥 앱에서 늘 '취소'다.
import { isDesktopApp } from "./nativeProxy";

const isMacApp = () => isDesktopApp() && /Mac/.test(navigator.platform);

function dialog(kind: "confirm" | "prompt", msg: string, def = ""): Promise<string> {
  const t = (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a: unknown) => Promise<string> } }).__TAURI_INTERNALS__;
  return t.invoke("app_dialog", { kind, msg, def });
}

export async function appConfirm(msg: string): Promise<boolean> {
  if (!isMacApp()) return window.confirm(msg);
  try { return (await dialog("confirm", msg)) === "1"; } catch { return false; }
}

// 취소 = null (빈 문자열 입력과 구분)
export async function appPrompt(msg: string, def = ""): Promise<string | null> {
  if (!isMacApp()) return window.prompt(msg, def);
  try {
    const r = await dialog("prompt", msg, def);
    return r === "\u0000" ? null : r;
  } catch { return null; }
}
