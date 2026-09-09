// 안드로이드 앱(Capacitor) 전송 계층 — 프록시 없이 시세를 직접 받아온다.
//
//   브라우저에서 프록시가 필요한 이유는 IP 차단이 아니라 CORS 다. 토스·네이버는 응답에
//   Access-Control-Allow-Origin 을 주지 않아 브라우저가 읽기 자체를 막는다.
//   네이티브 HTTP(OkHttp)에는 CORS 가 없으므로 앱에서는 그냥 직접 부르면 된다.
//   → 프록시 서버가 아예 필요 없다. 호출 한도도, 남의 IP 를 공유하는 문제도 사라진다.
//
//   계약은 확장(extensionProxy.fetchViaExtension)과 똑같이 맞췄다 — (url, init) => Response.
//   그래야 api.ts 의 fetchProxied 가 게이트 한 줄만 늘리고 64 곳이 전부 따라온다.
//
//   Yahoo 도 통과한다 — 실측(2026-09-08, 안드로이드 실기기): query1.finance.yahoo.com 68건 200.
//      로컬 Node 프록시가 429 를 맞아서 OkHttp 도 막힐 줄 알았는데 아니었다. 폰의 통신망 IP 라
//      가정용과 구분되지 않는 덕으로 보인다. 토스·네이버·yasun 도 전부 200.
//      다만 crumb 이 필요한 Yahoo 엔드포인트는 401 이 난다(확장은 background.js 가 crumb 을
//      처리한다 — 네이티브엔 아직 없다). 그건 아래 폴백이 받는다.
//
//   실패는 삼키고 기존 프록시 경로로 넘어가게 둔다 — fetchProxied 가 ok 아닌 응답이면
//      다음 경로로 계속한다. 앱이 단일 실패점이 되지 않게 하는 것이 원칙.
//
//   CapacitorHttp 의 fetch/XHR 패치(plugins.CapacitorHttp.enabled)는 꺼 둔다.
//   전역 패치는 어디로 나가는지 흐려지고, raw.githubusercontent.com 처럼 CORS 가 열려 있어
//   웹뷰가 직접 받아도 되는 요청까지 네이티브로 끌고 간다. 여기서 명시적으로만 부른다.

import { Capacitor, CapacitorHttp } from "@capacitor/core";

const TIMEOUT_MS = 20_000;

// 로컬 프록시(server.mjs)와 같은 UA — 데스크톱 크롬 행세. 소스가 UA 로 거르는 경우 대비.
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

// 네이티브 앱 안에서 도는가. 웹(브라우저)에서는 항상 false 라 기존 경로가 그대로 쓰인다.
//   동기 상수라 확장처럼 핸드셰이크를 기다릴 필요가 없다(구독 훅도 필요 없음).
export function isNativeApp(): boolean {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
}

// 네이티브 플랫폼 이름 — 설정 화면 표시용 ("android" / "ios"), 웹이면 null.
export function nativePlatform(): string | null {
  try { return Capacitor.isNativePlatform() ? Capacitor.getPlatform() : null; } catch { return null; }
}

// 네이티브 응답 본문 → Response 에 넣을 값.
//   ★ CapacitorHttp 는 responseType 을 요청해도 그대로 주지 않는다. 실측(안드로이드):
//     JSON 응답은 responseType:"arraybuffer" 를 줘도 **파싱된 객체**로 돌아온다(type=object).
//     그래서 "문자열이면 base64" 라는 가정만 두면 본문을 통째로 잃는다 —
//     빈 본문이 200 으로 통과해 호출측이 조용히 실패한다(티커바·미니차트가 비던 원인).
//   · object  → JSON 텍스트로 되돌린다 (대부분의 시세 API)
//   · string  → 그대로 텍스트 본문
// base64 문자열 후보인가 — 마크업/JSON 텍스트에는 <, >, {, ", 공백이 있어 base64 알파벳과 겹치지 않는다.
const B64_LIKE = /^[A-Za-z0-9+/\s]+={0,2}$/;

function b64ToBuf(b64: string): ArrayBuffer {
  const bin = atob(b64.replace(/\s+/g, ""));
  const buf = new ArrayBuffer(bin.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  return buf;
}

// 디코딩 결과가 우리가 다루는 본문처럼 보이는가(HTML/JSON/텍스트). base64 오판을 막는 확인.
function looksLikeBody(buf: ArrayBuffer): boolean {
  const head = new Uint8Array(buf.slice(0, 4));
  if (head.length === 0) return false;
  const c = head[0];
  return c === 0x3c /* < */ || c === 0x7b /* { */ || c === 0x5b /* [ */
      || c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09;   // 앞 공백/개행
}

function toBody(data: unknown): BodyInit {
  if (data == null) return "";
  if (typeof data === "string") {
    // ★ responseType:"arraybuffer" 를 요청하므로 비-JSON 응답은 base64 문자열로 온다.
    //   그대로 본문에 넣으면 호출측이 base64 를 HTML 로 읽는다 — 네이버 EUC-KR 페이지
    //   (투자자 순매수·자금동향)가 그래서 파싱에 실패했다.
    //   바이트로 되돌려야 decodeHtmlBuf 가 EUC-KR 을 제대로 푼다.
    if (data.length > 0 && B64_LIKE.test(data)) {
      try {
        const buf = b64ToBuf(data);
        if (looksLikeBody(buf)) return buf;
      } catch { /* base64 가 아니었다 → 아래에서 텍스트로 */ }
    }
    return data;
  }
  try { return JSON.stringify(data); } catch { return ""; }
}

// ─── Yahoo crumb 인증 ────────────────────────────────────────
// v7/quote·quoteSummary 는 crumb 없이 401. v8/chart 는 필요 없다(확장에서 실측된 것과 동일,
//   네이티브에서도 v8 는 200·v7 는 401 로 재확인).
// 쿠키는 CapacitorCookies 가 네이티브 쿠키 저장소에 유지해 주므로 확장처럼 직접 나를 필요가 없다.
const CRUMB_TTL_MS = 30 * 60 * 1000;
let crumbCache: { crumb: string; ts: number } | null = null;

function needsCrumb(u: URL): boolean {
  return u.hostname.endsWith("yahoo.com") &&
         (u.pathname.includes("/quoteSummary") ||
          u.pathname.includes("/v7/finance/quote") ||
          u.pathname.includes("/v6/finance/quote"));
}

async function getYahooCrumb(): Promise<string | null> {
  if (crumbCache && Date.now() - crumbCache.ts < CRUMB_TTL_MS) return crumbCache.crumb;
  try {
    // 1) 세션 쿠키 발급 — 응답은 안 본다. 쿠키만 저장소에 들어가면 된다.
    try {
      await CapacitorHttp.get({ url: "https://fc.yahoo.com/", headers: { "User-Agent": UA } });
    } catch { /* 쿠키만 목적이라 실패해도 진행 */ }
    // 2) crumb 발급 — 위에서 받은 쿠키가 자동으로 실려 나간다.
    const r = await CapacitorHttp.get({
      url: "https://query1.finance.yahoo.com/v1/test/getcrumb",
      headers: { "User-Agent": UA },
      responseType: "text",
    });
    if (r.status !== 200) return null;
    const c = (typeof r.data === "string" ? r.data : String(r.data ?? "")).trim();
    if (!c || c.length > 50) return null;   // 에러 페이지를 crumb 으로 오인하지 않게
    crumbCache = { crumb: c, ts: Date.now() };
    return c;
  } catch {
    return null;
  }
}

// 응답 헤더에서 Content-Type 찾기 — 네이티브가 돌려주는 헤더 키의 대소문자가 제각각이다.
function pickContentType(headers: Record<string, string> | undefined): string {
  if (!headers) return "application/octet-stream";
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === "content-type" && v) return v;
  }
  return "application/octet-stream";
}

export async function fetchViaNative(targetUrl: string, init?: RequestInit): Promise<Response> {
  const given = (init?.headers ?? {}) as Record<string, string>;
  const headers: Record<string, string> = { "User-Agent": UA, ...given };

  // crumb 이 필요한 Yahoo 엔드포인트면 쿼리에 붙여 보낸다(없으면 401).
  let url = targetUrl;
  let crumbUsed = false;
  try {
    const u = new URL(targetUrl);
    if (needsCrumb(u)) {
      const crumb = await getYahooCrumb();
      if (crumb) {
        const w = new URL(url);
        w.searchParams.set("crumb", crumb);
        url = w.toString();
        crumbUsed = true;
      }
    }
  } catch { /* URL 파싱 실패 — 원본 그대로 보낸다 */ }

  const res = await CapacitorHttp.request({
    url,
    method: init?.method ?? "GET",
    headers,
    data: typeof init?.body === "string" ? init.body : undefined,
    // 바이너리 안전 경로 — 네이티브는 base64 문자열로 돌려준다(EUC-KR 보존).
    responseType: "arraybuffer",
    connectTimeout: TIMEOUT_MS,
    readTimeout: TIMEOUT_MS,
  });

  // crumb 을 붙였는데도 401 이면 만료된 것 — 캐시를 버려 다음 호출이 새로 받게 한다.
  //   (TTL 만 믿으면 조기 만료 시 30분 내내 401 이 반복된다)
  if (crumbUsed && res.status === 401) crumbCache = null;

  const body = toBody(res.data);
  return new Response(body, {
    status: res.status ?? 502,
    headers: { "Content-Type": pickContentType(res.headers as Record<string, string>) },
  });
}
