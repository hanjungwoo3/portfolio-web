// 서비스워커 — 앱을 대신해 시세를 가져온다(가정용 IP).
//
// Yahoo 는 목록에 없다. 가정용 IP 를 429("Edge: Too Many Requests")로 막기 때문에
// 확장으로 보내면 오히려 실패한다 — 앱이 Yahoo 만 클라우드 프록시로 보낸다.
const ALLOWED_HOSTS = new Set([
  "wts-info-api.tossinvest.com",
  "wts-cert-api.tossinvest.com",
  "tossinvest.com",
  "finance.naver.com",
  "m.stock.naver.com",
  "polling.finance.naver.com",
  "navercomp.wisereport.co.kr",
  "api.investing.com",
  "yasun.gg",
  "scanner.tradingview.com",
]);

// ─── 요청 헤더 재작성 ────────────────────────────────────────
// Origin·Referer 는 fetch() 로 못 바꾼다(브라우저 금지 헤더). 확장 서비스워커도 마찬가지라
// declarativeNetRequest 로 갈아끼운다. 토스는 Origin 이 tossinvest.com 이 아니면 403 이다
// (실측: Origin 없음 200 / chrome-extension:// 403 / tossinvest.com 200).
//
// ⚠️ condition.tabIds = [-1] — '탭에서 나오지 않은 요청', 즉 이 확장이 보낸 것만 대상.
//    이게 없으면 사용자가 브라우저로 토스·네이버를 볼 때까지 헤더가 바뀐다.
const HEADER_GROUPS = [
  {
    domains: ["wts-info-api.tossinvest.com", "wts-cert-api.tossinvest.com", "tossinvest.com"],
    headers: { Origin: "https://tossinvest.com", Referer: "https://tossinvest.com/" },
  },
  {
    domains: ["finance.naver.com", "m.stock.naver.com", "polling.finance.naver.com",
              "navercomp.wisereport.co.kr"],
    headers: { Referer: "https://finance.naver.com/", "Accept-Language": "ko-KR,ko;q=0.9" },
  },
  { domains: ["yasun.gg"], headers: { Referer: "https://yasun.gg/" } },
  {
    domains: ["api.investing.com"],
    headers: {
      "domain-id": "www",
      Origin: "https://www.investing.com",
      Referer: "https://www.investing.com/",
      "Accept-Language": "en-US,en;q=0.9",
    },
  },
];

async function installRules() {
  const rules = HEADER_GROUPS.map((g, i) => ({
    id: i + 1,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: Object.entries(g.headers).map(([header, value]) => ({
        header, operation: "set", value,
      })),
    },
    condition: {
      requestDomains: g.domains,
      tabIds: [-1],                                  // 확장이 보낸 요청만
      resourceTypes: ["xmlhttprequest", "other"],
    },
  }));
  try {
    const old = await chrome.declarativeNetRequest.getSessionRules();
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: old.map(r => r.id),
      addRules: rules,
    });
  } catch (e) {
    console.error("[포트폴리오 프록시] 헤더 규칙 등록 실패", e);
  }
}
chrome.runtime.onInstalled.addListener(installRules);
chrome.runtime.onStartup.addListener(installRules);
installRules();   // 서비스워커가 깨어날 때마다 (세션 규칙은 재시작 시 사라진다)

// ArrayBuffer → base64. 응답을 텍스트로 넘기면 네이버 자금동향(EUC-KR) 이 깨지므로
// 바이트를 그대로 옮기고 디코딩은 앱에 맡긴다. 큰 응답에서 스택이 터지지 않게 청크 단위.
function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

async function doFetch(msg) {
  let u;
  try { u = new URL(msg.url); } catch { return { error: "invalid-url" }; }
  if (!ALLOWED_HOSTS.has(u.hostname)) return { error: `host-not-allowed: ${u.hostname}` };
  try {
    const init = msg.method === "POST"
      ? { method: "POST", body: msg.body,
          headers: msg.contentType ? { "Content-Type": msg.contentType } : {} }
      : { method: "GET" };
    const r = await fetch(msg.url, init);
    return {
      status: r.status,
      contentType: r.headers.get("Content-Type") || "application/octet-stream",
      b64: toBase64(await r.arrayBuffer()),
    };
  } catch (e) {
    return { error: String(e && e.message ? e.message : e) };
  }
}

// 툴바 아이콘 클릭 → 사이드 패널 열기.
//   팝업은 크롬 상한이 800×600 이라 세로가 부족했다. 사이드 패널은 창 높이 전체를 쓰고
//   폭도 사용자가 끌어서 조절할 수 있다.
chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true })
  .catch(e => console.error("[포트폴리오] 사이드 패널 설정 실패", e));

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return;
  if (msg.type === "ping") { sendResponse({ ok: true }); return; }
  if (msg.type === "fetch") {
    doFetch(msg).then(sendResponse);
    return true;   // 비동기 응답
  }
});
