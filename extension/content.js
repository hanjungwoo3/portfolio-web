// 콘텐트 스크립트 — 앱 페이지(탭이든 팝업 iframe 이든)와 서비스워커를 잇는다.
//   페이지 JS 는 chrome.* 에 접근할 수 없으므로 window.postMessage 로 주고받는다.
//   all_frames: true 라 팝업 안의 iframe 에도 주입된다.
const TAG = "__pfx";
// 개발자 모드 확장은 자동 업데이트가 없다 → 앱이 낡은 버전을 감지해 안내할 수 있도록
// 핸드셰이크에 manifest 버전을 실어 보낸다.
const VERSION = chrome.runtime.getManifest().version;

window.addEventListener("message", (e) => {
  if (e.source !== window) return;              // 다른 프레임/창에서 온 건 무시
  const m = e.data;
  if (!m || typeof m !== "object") return;

  if (m[TAG] === "ping") {
    window.postMessage({ [TAG]: "ready", version: VERSION }, "*");
    return;
  }
  if (m[TAG] !== "req") return;

  // 확장을 새로고침·업데이트하면 이미 열려 있던 탭의 콘텐트 스크립트는 끊긴다
  // ("Extension context invalidated"). 그때 sendMessage 는 동기적으로 던진다 →
  // 잡아서 즉시 에러를 돌려줘야 앱이 20초 타임아웃을 기다리지 않고 바로 프록시로 넘어간다.
  try {
    chrome.runtime.sendMessage(
      { type: "fetch", url: m.url, method: m.method, body: m.body, contentType: m.contentType },
      (res) => {
        const err = chrome.runtime.lastError;
        window.postMessage(
          { [TAG]: "res", id: m.id, ...(err ? { error: err.message } : res || { error: "no-response" }) },
          "*",
        );
      },
    );
  } catch (e) {
    window.postMessage(
      { [TAG]: "res", id: m.id, error: "extension-context-invalidated", detail: String(e) },
      "*",
    );
  }
});

// 앱이 늦게 로드돼도, 콘텐트 스크립트가 늦게 붙어도 만나도록 양쪽에서 알린다.
window.postMessage({ [TAG]: "ready", version: VERSION }, "*");
