// Cloudflare Worker — CORS 프록시 (Toss/Naver/Yahoo 화이트리스트)
//
// 사용:  GET /?url=<encoded_target_url>
//
// Yahoo quoteSummary API 는 crumb 인증 필요 — Worker 가 자동 처리.
// 무료 티어: 100,000 req/day.

const ALLOWED_HOSTS = new Set<string>([
  "wts-info-api.tossinvest.com",
  "wts-cert-api.tossinvest.com",
  "tossinvest.com",
  "finance.naver.com",
  "m.stock.naver.com",
  "polling.finance.naver.com",
  "navercomp.wisereport.co.kr",
  "query1.finance.yahoo.com",
  "query2.finance.yahoo.com",
  "api.investing.com",        // VKOSPI 등 — investing financialdata chart API
  "yasun.gg",                 // 코스피200/코스닥150 야간선물 1분봉 캔들
  "scanner.tradingview.com",  // KOSPI/KOSDAQ 히트맵 — TradingView scanner (POST)
]);

// 응답 캐시 TTL (초). 클라이언트 5초 폴링이라 캐시는 짧게.
// 너무 짧으면 (= 0) 동일 시점 다중 사용자 fanout 시 부담 ↑.
const DEFAULT_CACHE_TTL = 3;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// ─── Yahoo crumb 인증 ───
// 1) fc.yahoo.com 접속해 세션 쿠키 받기
// 2) query1.../v1/test/getcrumb 로 crumb 문자열 받기
// 3) quoteSummary 등 인증 필요 호출에 ?crumb=... + Cookie 헤더 동봉
//
// 동일 worker instance 내 메모리 캐시 — 인스턴스 재시작 시 재발급.
let cachedAuth: { crumb: string; cookies: string; ts: number } | null = null;
const AUTH_TTL_MS = 30 * 60 * 1000;  // 30분

async function getYahooAuth(): Promise<{ crumb: string; cookies: string } | null> {
  const now = Date.now();
  if (cachedAuth && now - cachedAuth.ts < AUTH_TTL_MS) {
    return { crumb: cachedAuth.crumb, cookies: cachedAuth.cookies };
  }
  try {
    // 1) 세션 쿠키 발급 — fc.yahoo.com 또는 finance.yahoo.com
    const sessionResp = await fetch("https://fc.yahoo.com/", {
      headers: { "User-Agent": UA, "Accept": "*/*" },
      redirect: "manual",
    });
    const setCookie = sessionResp.headers.get("set-cookie") ?? "";
    // Cookie 헤더로 보낼 때는 "name=value; name=value" 형식
    const cookies = setCookie
      .split(/,\s*(?=[A-Za-z]+=)/)
      .map(c => c.split(";")[0])
      .filter(c => c.includes("="))
      .join("; ");
    if (!cookies) return null;

    // 2) crumb 발급
    const crumbResp = await fetch(
      "https://query1.finance.yahoo.com/v1/test/getcrumb",
      {
        headers: {
          "User-Agent": UA,
          "Cookie": cookies,
          "Accept": "*/*",
        },
      }
    );
    if (!crumbResp.ok) return null;
    const crumb = (await crumbResp.text()).trim();
    if (!crumb || crumb.length > 50) return null;

    cachedAuth = { crumb, cookies, ts: now };
    return { crumb, cookies };
  } catch {
    return null;
  }
}

function needsYahooAuth(url: URL): boolean {
  return url.hostname.includes("yahoo.com") &&
         (url.pathname.includes("/quoteSummary") ||
          url.pathname.includes("/v7/finance/quote") ||
          url.pathname.includes("/v6/finance/quote"));
}

// 허용 클라이언트 — 내 GitHub Pages 도메인 + 로컬 개발만 (fork·외부 무단 호출 차단).
const ALLOWED_ORIGINS = new Set<string>([
  "https://hanjungwoo3.github.io",
]);
function clientAllowed(request: Request): boolean {
  const origin = request.headers.get("Origin");
  const referer = request.headers.get("Referer");
  let host = "";
  try {
    if (origin) host = new URL(origin).hostname;
    else if (referer) host = new URL(referer).hostname;
  } catch { /* noop */ }
  if (host === "localhost" || host === "127.0.0.1") return true;
  if (origin) return ALLOWED_ORIGINS.has(origin);
  if (referer) { try { return ALLOWED_ORIGINS.has(new URL(referer).origin); } catch { return false; } }
  return false;   // Origin/Referer 둘 다 없으면 차단 (브라우저 fetch 는 항상 Origin 전송)
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== "GET" && request.method !== "POST") {
      return jsonError(405, "Method not allowed (GET/POST only)");
    }
    const url = new URL(request.url);
    const target = url.searchParams.get("url");
    // ?url= 없는 직접 접속(루트/헬스체크) — origin 검사 전에 안내. 브라우저로 살아있는지 확인용.
    if (!target) {
      return new Response(JSON.stringify({
        ok: true,
        message: "포트폴리오 프록시 워커가 정상 작동 중입니다. 이 워커는 앱에서만 시세를 가져올 수 있어요(브라우저 직접 호출은 차단). 앱 ⚙️ 설정 → '내 전용 프록시 URL' 에 이 주소를 등록해 사용하세요.",
      }, null, 2), {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS },
      });
    }
    // 실제 우회(?url=)는 허용된 앱 origin 에서만
    if (!clientAllowed(request)) {
      return jsonError(403, "Forbidden origin");
    }

    let targetUrl: URL;
    try {
      targetUrl = new URL(target);
    } catch {
      return jsonError(400, "Invalid target URL");
    }

    if (!ALLOWED_HOSTS.has(targetUrl.hostname)) {
      return jsonError(403, `Host not allowed: ${targetUrl.hostname}`);
    }

    // 헤더 — Yahoo 의 경우 quoteSummary 면 crumb 자동 부착
    const headers: Record<string, string> = {
      "User-Agent": UA,
      "Accept": "application/json, text/html, */*",
    };
    if (targetUrl.hostname.includes("toss")) {
      headers["Origin"] = "https://tossinvest.com";
      headers["Referer"] = "https://tossinvest.com/";
    } else if (targetUrl.hostname.includes("yahoo")) {
      headers["Origin"] = "https://finance.yahoo.com";
      headers["Referer"] = "https://finance.yahoo.com/";
    } else if (targetUrl.hostname.includes("wisereport")) {
      headers["Referer"] = "https://finance.naver.com/";
      headers["Accept-Language"] = "ko-KR,ko;q=0.9";
    } else if (targetUrl.hostname.includes("naver")) {
      headers["Referer"] = "https://finance.naver.com/";
      headers["Accept-Language"] = "ko-KR,ko;q=0.9";
    } else if (targetUrl.hostname.includes("yasun.gg")) {
      headers["Referer"] = "https://yasun.gg/";
      headers["Accept"] = "application/json";
    } else if (targetUrl.hostname.includes("investing")) {
      // investing financialdata API — domain-id 필수, 브라우저 UA/Referer 로 Cloudflare 통과 시도
      headers["domain-id"] = "www";
      headers["Origin"] = "https://www.investing.com";
      headers["Referer"] = "https://www.investing.com/";
      headers["Accept"] = "application/json, text/plain, */*";
      headers["Accept-Language"] = "en-US,en;q=0.9";
    }

    if (needsYahooAuth(targetUrl)) {
      const auth = await getYahooAuth();
      if (auth) {
        targetUrl.searchParams.set("crumb", auth.crumb);
        headers["Cookie"] = auth.cookies;
      }
    }

    // POST: body forward + Content-Type 헤더 전달. 캐시는 GET 만.
    const isPost = request.method === "POST";
    let postBody: ArrayBuffer | undefined;
    if (isPost) {
      postBody = await request.arrayBuffer();
      const reqCt = request.headers.get("Content-Type");
      if (reqCt) headers["Content-Type"] = reqCt;
    }

    try {
      const upstream = await fetch(targetUrl.toString(), isPost ? {
        method: "POST",
        headers,
        body: postBody,
      } : {
        method: "GET",
        headers,
        cf: {
          cacheTtl: DEFAULT_CACHE_TTL,
          cacheEverything: true,
        },
      });

      const body = await upstream.arrayBuffer();
      const contentType =
        upstream.headers.get("Content-Type") ?? "application/octet-stream";

      return new Response(body, {
        status: upstream.status,
        headers: {
          "Content-Type": contentType,
          // POST 는 무동적 응답일 수 있어 캐시 X
          "Cache-Control": isPost ? "no-store" : `public, max-age=${DEFAULT_CACHE_TTL}`,
          ...CORS_HEADERS,
        },
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown fetch error";
      return jsonError(502, `Upstream fetch failed: ${msg}`);
    }
  },
};
