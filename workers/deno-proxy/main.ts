// Deno Deploy — Cloudflare Worker / Vercel Edge Function 동등 로직
// 사용:  GET /?url=<encoded_target_url>
// 무료 한도: 100k requests/day · 100GB transfer/month

const ALLOWED_HOSTS = new Set<string>([
  "wts-info-api.tossinvest.com",
  "wts-cert-api.tossinvest.com",
  "tossinvest.com",
  "finance.naver.com",
  "m.stock.naver.com",
  "navercomp.wisereport.co.kr",
  "query1.finance.yahoo.com",
  "query2.finance.yahoo.com",
]);

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

// Yahoo crumb 인증 (인스턴스 메모리 캐시 30분)
let cachedAuth: { crumb: string; cookies: string; ts: number } | null = null;
const AUTH_TTL_MS = 30 * 60 * 1000;

async function getYahooAuth(): Promise<{ crumb: string; cookies: string } | null> {
  const now = Date.now();
  if (cachedAuth && now - cachedAuth.ts < AUTH_TTL_MS) {
    return { crumb: cachedAuth.crumb, cookies: cachedAuth.cookies };
  }
  try {
    const sessionResp = await fetch("https://fc.yahoo.com/", {
      headers: { "User-Agent": UA, "Accept": "*/*" },
      redirect: "manual",
    });
    const setCookie = sessionResp.headers.get("set-cookie") ?? "";
    const cookies = setCookie
      .split(/,\s*(?=[A-Za-z]+=)/)
      .map(c => c.split(";")[0])
      .filter(c => c.includes("="))
      .join("; ");
    if (!cookies) return null;

    const crumbResp = await fetch(
      "https://query1.finance.yahoo.com/v1/test/getcrumb",
      { headers: { "User-Agent": UA, "Cookie": cookies, "Accept": "*/*" } }
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

async function handler(request: Request): Promise<Response> {
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
}

Deno.serve(handler);
