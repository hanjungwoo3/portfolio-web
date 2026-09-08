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
function toBody(data: unknown): BodyInit {
  if (data == null) return "";
  if (typeof data === "string") return data;
  try { return JSON.stringify(data); } catch { return ""; }
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

  const res = await CapacitorHttp.request({
    url: targetUrl,
    method: init?.method ?? "GET",
    headers,
    data: typeof init?.body === "string" ? init.body : undefined,
    // 바이너리 안전 경로 — 네이티브는 base64 문자열로 돌려준다(EUC-KR 보존).
    responseType: "arraybuffer",
    connectTimeout: TIMEOUT_MS,
    readTimeout: TIMEOUT_MS,
  });

  const body = toBody(res.data);
  return new Response(body, {
    status: res.status ?? 502,
    headers: { "Content-Type": pickContentType(res.headers as Record<string, string>) },
  });
}
