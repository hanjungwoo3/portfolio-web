// Render.com Web Service — Cloudflare/Vercel/Deno proxy 와 동등 로직 (Node 18+)
// 무료: 750h/월 always-on · 100GB 대역폭 · 요청 수 제한 X
// 사용:  GET /?url=<encoded_target_url>

import http from "node:http";

const PORT = process.env.PORT || 10000;

const ALLOWED_HOSTS = new Set([
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

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function jsonError(res, status, message) {
  res.writeHead(status, { "Content-Type": "application/json", ...CORS_HEADERS });
  res.end(JSON.stringify({ error: message }));
}

// Yahoo crumb 인증 (인스턴스 메모리 캐시 30분)
let cachedAuth = null;
const AUTH_TTL_MS = 30 * 60 * 1000;

async function getYahooAuth() {
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

function needsYahooAuth(url) {
  return url.hostname.includes("yahoo.com") &&
         (url.pathname.includes("/quoteSummary") ||
          url.pathname.includes("/v7/finance/quote") ||
          url.pathname.includes("/v6/finance/quote"));
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    return res.end();
  }
  if (req.method !== "GET") {
    return jsonError(res, 405, "Method not allowed (GET only)");
  }

  // /health endpoint — Render keep-alive
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain", ...CORS_HEADERS });
    return res.end("ok");
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const target = url.searchParams.get("url");
  if (!target) return jsonError(res, 400, "Missing 'url' query parameter");

  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch {
    return jsonError(res, 400, "Invalid target URL");
  }

  if (!ALLOWED_HOSTS.has(targetUrl.hostname)) {
    return jsonError(res, 403, `Host not allowed: ${targetUrl.hostname}`);
  }

  const headers = {
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
    const buf = Buffer.from(await upstream.arrayBuffer());
    const contentType = upstream.headers.get("Content-Type") ?? "application/octet-stream";
    res.writeHead(upstream.status, {
      "Content-Type": contentType,
      "Cache-Control": `public, max-age=${DEFAULT_CACHE_TTL}`,
      ...CORS_HEADERS,
    });
    res.end(buf);
  } catch (e) {
    jsonError(res, 502, `Upstream fetch failed: ${e.message || "Unknown"}`);
  }
});

server.listen(PORT, () => {
  console.log(`portfolio-render-proxy listening on :${PORT}`);
});
