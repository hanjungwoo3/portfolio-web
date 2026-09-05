// 사이드 패널 — 앱을 iframe 으로 띄운다. 오리진이 hanjungwoo3.github.io 그대로라
// 보유·거래 데이터(IndexedDB)와 구글 로그인 상태를 웹에서 쓰던 그대로 공유한다.
//
// 팝업(크롬 상한 800×600)과 달리 창 높이 전체를 쓰고 폭도 끌어서 조절할 수 있다.
// 좁을 땐 앱이 모바일 뷰로, 넓히면 데스크톱 표 화면으로 바뀐다(App.tsx matchMedia 640px).
const APP_URL = "https://hanjungwoo3.github.io/portfolio-web/";

// 새 탭으로 열기 — 패널은 그대로 둔다(팝업과 달리 닫을 이유가 없다).
document.getElementById("tab").addEventListener("click", () => {
  chrome.tabs.create({ url: APP_URL });
});

// 콘텐트 스크립트가 붙었는지 확인 — 붙어야 프록시가 동작한다.
const st = document.getElementById("st");
chrome.runtime.sendMessage({ type: "ping" }, (res) => {
  const ok = !chrome.runtime.lastError && res && res.ok;
  st.className = ok ? "on" : "off";
  st.textContent = ok ? "● 프록시 사용 중" : "● 프록시 미연결";
});
