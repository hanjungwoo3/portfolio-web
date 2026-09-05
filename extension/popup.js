// 팝업 — 앱을 iframe 으로 띄운다. 오리진이 hanjungwoo3.github.io 그대로라
// 보유·거래 데이터(IndexedDB)와 구글 로그인 상태를 웹에서 쓰던 그대로 공유한다.
// 폭 420px 이라 앱이 모바일 뷰로 뜬다 — 크롬 팝업 상한(800×600)에 데스크톱 표는 안 들어간다.
// 표를 넓게 보려면 '넓게 보기' 로 탭에서 연다(탭에서도 확장 프록시는 그대로 동작).
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
  st.textContent = ok ? "● 프록시 사용 중" : "● 프록시 미연결";
});
