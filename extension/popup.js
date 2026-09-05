// 팝업 — 앱을 iframe 으로 띄운다. 오리진이 hanjungwoo3.github.io 그대로라
// 보유·거래 데이터(IndexedDB)와 구글 로그인 상태를 웹에서 쓰던 그대로 공유한다.
const APP_URL = "https://hanjungwoo3.github.io/portfolio-web/";

document.getElementById("tab").addEventListener("click", () => {
  chrome.tabs.create({ url: APP_URL });
  window.close();
});

// 콘텐트 스크립트가 붙었는지 확인 — 붙어야 프록시가 동작한다.
const st = document.getElementById("st");
chrome.runtime.sendMessage({ type: "ping" }, (res) => {
  const ok = !chrome.runtime.lastError && res && res.ok;
  st.className = ok ? "on" : "off";
  st.textContent = ok ? "● 프록시 사용 중 (내 브라우저)" : "● 프록시 미연결";
});
