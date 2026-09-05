// 콘텐트 스크립트 — 앱 페이지(탭이든 팝업 iframe 이든)와 서비스워커를 잇는다.
//   페이지 JS 는 chrome.* 에 접근할 수 없으므로 window.postMessage 로 주고받는다.
//   all_frames: true 라 팝업 안의 iframe 에도 주입된다.
const TAG = "__pfx";

window.addEventListener("message", (e) => {
  if (e.source !== window) return;              // 다른 프레임/창에서 온 건 무시
  const m = e.data;
  if (!m || typeof m !== "object") return;

  if (m[TAG] === "ping") {
    window.postMessage({ [TAG]: "ready" }, "*");
    return;
  }
  if (m[TAG] !== "req") return;

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
});

// 앱이 늦게 로드돼도, 콘텐트 스크립트가 늦게 붙어도 만나도록 양쪽에서 알린다.
window.postMessage({ [TAG]: "ready" }, "*");
