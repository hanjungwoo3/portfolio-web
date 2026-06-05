// Cloudflare Worker — CORS 프록시 (Toss/Naver/Yahoo 화이트리스트)
//
// 사용:  GET /?url=<encoded_target_url>
//
// Yahoo quoteSummary API 는 crumb 인증 필요 — Worker 가 자동 처리.
// 무료 티어: 100,000 req/day.
//
// 이 파일은 Cloudflare 웹 에디터(.js 파일)에 붙여넣기 전용 — 타입 제거된 순수 JS.
// TypeScript 원본은 ./index.ts 참고.

const ALLOWED_HOSTS = new Set([
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
  "yasun.gg",                 // 코스피200/코스닥150 야간선물 (1분봉 캔들 API)
]);

const DEFAULT_CACHE_TTL = 3;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

let cachedAuth = null;
const AUTH_TTL_MS = 30 * 60 * 1000;  // 30분

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

function needsYahooAuth(url) {
  return url.hostname.includes("yahoo.com") &&
         (url.pathname.includes("/quoteSummary") ||
          url.pathname.includes("/v7/finance/quote") ||
          url.pathname.includes("/v6/finance/quote"));
}

// 사용량 — GET /usage. env 에 CF_API_TOKEN(Account Analytics:Read) + CF_ACCOUNT_ID 설정 시
// 오늘 이 워커(또는 계정)의 요청수를 Cloudflare GraphQL Analytics 로 조회해 반환.
// 미설정이면 {error:"not-configured"} (앱은 "사용량 미지원"으로 처리 → 안내 표시).
async function handleUsage(env) {
  const out = (obj, status = 200) => new Response(JSON.stringify(obj), {
    status, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
  const token = env && env.CF_API_TOKEN;
  const account = env && env.CF_ACCOUNT_ID;
  if (!token || !account) return out({ error: "not-configured" });
  const today = new Date().toISOString().slice(0, 10);
  const scriptFilter = env.CF_SCRIPT_NAME ? `, scriptName: "${env.CF_SCRIPT_NAME}"` : "";
  const query = `query { viewer { accounts(filter: { accountTag: "${account}" }) {`
    + ` workersInvocationsAdaptive(limit: 1000, filter: { datetime_geq: "${today}T00:00:00Z"${scriptFilter} })`
    + ` { sum { requests } } } } }`;
  try {
    const r = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const d = await r.json();
    const rows = (((d || {}).data || {}).viewer || {}).accounts;
    const list = rows && rows[0] && rows[0].workersInvocationsAdaptive || [];
    let requests = 0;
    for (const row of list) requests += (row && row.sum && row.sum.requests) || 0;
    return out({ requests, limit: 100000, date: today });
  } catch (e) {
    return out({ error: "fetch-failed", message: String(e) });
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    // 사용량 엔드포인트 (신버전) — ?url= 프록시와 별개
    if (url.pathname === "/usage") return handleUsage(env);

    if (request.method !== "GET" && request.method !== "POST") {
      return jsonError(405, "Method not allowed (GET/POST only)");
    }

    const target = url.searchParams.get("url");
    if (!target) return jsonError(400, "Missing 'url' query parameter");

    let targetUrl;
    try {
      targetUrl = new URL(target);
    } catch {
      return jsonError(400, "Invalid target URL");
    }

    if (!ALLOWED_HOSTS.has(targetUrl.hostname)) {
      return jsonError(403, `Host not allowed: ${targetUrl.hostname}`);
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
    } else if (targetUrl.hostname.includes("yasun.gg")) {
      headers["Referer"] = "https://yasun.gg/";
      headers["Accept"] = "application/json";
    } else if (targetUrl.hostname.includes("investing")) {
      // investing financialdata API — domain-id 필수, 브라우저 헤더로 Cloudflare 통과
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
    let postBody;
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
          "Cache-Control": isPost ? "no-store" : `public, max-age=${DEFAULT_CACHE_TTL}`,
          ...CORS_HEADERS,
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown fetch error";
      return jsonError(502, `Upstream fetch failed: ${msg}`);
    }
  },
};
