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
  "query1.finance.yahoo.com",
  "query2.finance.yahoo.com",
]);

// 응답 캐시 TTL (초). 클라이언트 5초 폴링이라 캐시는 짧게.
// 너무 짧으면 (= 0) 동일 시점 다중 사용자 fanout 시 부담 ↑.
const DEFAULT_CACHE_TTL = 3;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
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

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== "GET") {
      return jsonError(405, "Method not allowed (GET only)");
    }

    const url = new URL(request.url);
    const target = url.searchParams.get("url");
    if (!target) return jsonError(400, "Missing 'url' query parameter");

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
    }

    if (needsYahooAuth(targetUrl)) {
      const auth = await getYahooAuth();
      if (auth) {
        targetUrl.searchParams.set("crumb", auth.crumb);
        headers["Cookie"] = auth.cookies;
      }
    }

    try {
      const upstream = await fetch(targetUrl.toString(), {
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
          "Cache-Control": `public, max-age=${DEFAULT_CACHE_TTL}`,
          ...CORS_HEADERS,
        },
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown fetch error";
      return jsonError(502, `Upstream fetch failed: ${msg}`);
    }
  },
};
