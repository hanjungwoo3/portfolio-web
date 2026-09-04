#!/usr/bin/env node
// 내 PC 로컬 프록시 — Cloudflare Worker(workers/proxy/src/index.ts)와 같은 계약을 Node 로 구현.
//
//   실행:  npm run proxy          (기본 127.0.0.1:8787)
//          npm run proxy -- --port 9000
//
// 왜 로컬인가: 토스는 egress IP 풀 단위로 스로틀링한다. 클라우드 워커는 IP 가 공유라
//   남의 호출까지 합산돼 400 이 나지만, 집 PC 는 가정용 IP 라 실사용자와 구분되지 않는다.
//   호출 한도도 없어 폴링 주기를 자유롭게 줄일 수 있다.
//
// 브라우저 제약 (문서에도 적어둠):
//   · https 페이지 → http://localhost 는 Chrome/Edge/Firefox 만 허용. Safari 는 차단한다.
//   · 휴대폰에서 PC 의 LAN IP(http://192.168.x.x)로 붙는 건 mixed content 로 막힌다.
//     localhost 예외는 localhost/127.0.0.1 에만 적용되기 때문. → 사실상 PC 전용.
//   · Chrome 의 Private Network Access 는 공인 origin → 사설망 요청에 preflight 를 요구하고
//     응답에 Access-Control-Allow-Private-Network: true 가 있어야 통과한다. 아래에서 붙인다.

import http from "node:http";

// 워커와 동일한 화이트리스트 — 여기 없는 호스트는 403.
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
  "api.investing.com",
  "yasun.gg",
  "scanner.tradingview.com",
]);

// 허용 클라이언트 — 배포 도메인 + 로컬 개발. 워커의 clientAllowed 와 같은 정책.
const ALLOWED_ORIGINS = new Set(["https://hanjungwoo3.github.io"]);

const DEFAULT_CACHE_TTL_MS = 3000;   // 워커 cf.cacheTtl=3초와 동일
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function parseArgs(argv) {
  const out = { port: 8787, host: "127.0.0.1" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--port" && argv[i + 1]) out.port = Number(argv[++i]);
    else if (argv[i] === "--host" && argv[i + 1]) out.host = argv[++i];
  }
  return out;
}
const ARGS = parseArgs(process.argv.slice(2));

// PNA 헤더는 preflight 에서 요청한 경우에만 붙인다(불필요하게 항상 노출하지 않음).
function corsHeaders(req) {
  const h = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
  if (req.headers["access-control-request-private-network"] === "true") {
    h["Access-Control-Allow-Private-Network"] = "true";
  }
  return h;
}

function sendJson(req, res, status, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders(req),
  });
  res.end(body);
}
const jsonError = (req, res, status, message) => sendJson(req, res, status, { error: message });

function clientAllowed(req) {
  const origin = req.headers.origin;
  const referer = req.headers.referer;
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

// ─── Yahoo crumb 인증 (워커와 동일) ───
let cachedAuth = null;
const AUTH_TTL_MS = 30 * 60 * 1000;

async function getYahooAuth() {
  const now = Date.now();
  if (cachedAuth && now - cachedAuth.ts < AUTH_TTL_MS) return cachedAuth;
  try {
    const sessionResp = await fetch("https://fc.yahoo.com/", {
      headers: { "User-Agent": UA, "Accept": "*/*" }, redirect: "manual",
    });
    // Node 는 set-cookie 를 getSetCookie() 로 배열 제공 — 구버전은 단일 문자열 폴백.
    const raw = typeof sessionResp.headers.getSetCookie === "function"
      ? sessionResp.headers.getSetCookie()
      : String(sessionResp.headers.get("set-cookie") ?? "").split(/,\s*(?=[A-Za-z]+=)/);
    const cookies = raw.map(c => c.split(";")[0]).filter(c => c.includes("=")).join("; ");
    if (!cookies) return null;

    const crumbResp = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": UA, "Cookie": cookies, "Accept": "*/*" },
    });
    if (!crumbResp.ok) return null;
    const crumb = (await crumbResp.text()).trim();
    if (!crumb || crumb.length > 50) return null;

    cachedAuth = { crumb, cookies, ts: now };
    return cachedAuth;
  } catch { return null; }
}

const needsYahooAuth = (u) =>
  u.hostname.includes("yahoo.com") &&
  (u.pathname.includes("/quoteSummary") ||
   u.pathname.includes("/v7/finance/quote") ||
   u.pathname.includes("/v6/finance/quote"));

// 업스트림별 헤더 — 워커와 동일하게 맞춰야 같은 응답이 온다.
function upstreamHeaders(t) {
  const h = { "User-Agent": UA, "Accept": "application/json, text/html, */*" };
  if (t.hostname.includes("toss")) {
    h["Origin"] = "https://tossinvest.com";
    h["Referer"] = "https://tossinvest.com/";
  } else if (t.hostname.includes("yahoo")) {
    h["Origin"] = "https://finance.yahoo.com";
    h["Referer"] = "https://finance.yahoo.com/";
  } else if (t.hostname.includes("wisereport")) {
    h["Referer"] = "https://finance.naver.com/";
    h["Accept-Language"] = "ko-KR,ko;q=0.9";
  } else if (t.hostname.includes("naver")) {
    h["Referer"] = "https://finance.naver.com/";
    h["Accept-Language"] = "ko-KR,ko;q=0.9";
  } else if (t.hostname.includes("yasun.gg")) {
    h["Referer"] = "https://yasun.gg/";
    h["Accept"] = "application/json";
  } else if (t.hostname.includes("investing")) {
    h["domain-id"] = "www";
    h["Origin"] = "https://www.investing.com";
    h["Referer"] = "https://www.investing.com/";
    h["Accept"] = "application/json, text/plain, */*";
    h["Accept-Language"] = "en-US,en;q=0.9";
  }
  return h;
}

// GET 3초 캐시 — 워커의 엣지 캐시 대체. 여러 탭이 같은 URL 을 동시에 칠 때 업스트림 부담을 줄인다.
const cache = new Map();   // url → { ts, status, contentType, body }
function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > DEFAULT_CACHE_TTL_MS) { cache.delete(key); return null; }
  return hit;
}
function cachePut(key, v) {
  cache.set(key, { ...v, ts: Date.now() });
  // 무한 증가 방지 — 넘치면 오래된 것부터 버린다(삽입 순서 = Map 순회 순서).
  if (cache.size > 500) {
    for (const k of cache.keys()) { cache.delete(k); if (cache.size <= 400) break; }
  }
}

let served = 0;          // 기동 후 처리한 우회 요청 수 (/usage)
const startedAt = Date.now();

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(req));
    res.end();
    return;
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return jsonError(req, res, 405, "Method not allowed (GET/POST only)");
  }

  const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);

  // 사용량 — 로컬은 일일 한도가 없다. limit=0 으로 '무제한' 을 표현(앱이 이 값을 해석).
  if (url.pathname === "/usage") {
    return sendJson(req, res, 200, {
      requests: served,
      limit: 0,
      local: true,
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    });
  }

  const target = url.searchParams.get("url");
  if (!target) {
    return sendJson(req, res, 200, {
      ok: true,
      local: true,
      message: "내 PC 로컬 프록시가 정상 작동 중입니다. 앱 ⚙️ 설정 → '내 전용 프록시' 에 이 주소를 등록하세요.",
    });
  }
  if (!clientAllowed(req)) return jsonError(req, res, 403, "Forbidden origin");

  let targetUrl;
  try { targetUrl = new URL(target); }
  catch { return jsonError(req, res, 400, "Invalid target URL"); }

  if (!ALLOWED_HOSTS.has(targetUrl.hostname)) {
    return jsonError(req, res, 403, `Host not allowed: ${targetUrl.hostname}`);
  }

  const isPost = req.method === "POST";
  const headers = upstreamHeaders(targetUrl);

  if (needsYahooAuth(targetUrl)) {
    const auth = await getYahooAuth();
    if (auth) {
      targetUrl.searchParams.set("crumb", auth.crumb);
      headers["Cookie"] = auth.cookies;
    }
  }

  const key = targetUrl.toString();
  if (!isPost) {
    const hit = cacheGet(key);
    if (hit) {
      served++;
      res.writeHead(hit.status, {
        "Content-Type": hit.contentType,
        "Cache-Control": `public, max-age=${DEFAULT_CACHE_TTL_MS / 1000}`,
        "X-Local-Cache": "hit",
        ...corsHeaders(req),
      });
      res.end(hit.body);
      return;
    }
  }

  let postBody;
  if (isPost) {
    postBody = await readBody(req);
    if (req.headers["content-type"]) headers["Content-Type"] = req.headers["content-type"];
  }

  try {
    const upstream = await fetch(key, isPost
      ? { method: "POST", headers, body: postBody }
      : { method: "GET", headers });

    const buf = Buffer.from(await upstream.arrayBuffer());
    const contentType = upstream.headers.get("Content-Type") ?? "application/octet-stream";
    served++;
    if (!isPost && upstream.ok) cachePut(key, { status: upstream.status, contentType, body: buf });

    res.writeHead(upstream.status, {
      "Content-Type": contentType,
      "Cache-Control": isPost ? "no-store" : `public, max-age=${DEFAULT_CACHE_TTL_MS / 1000}`,
      ...corsHeaders(req),
    });
    res.end(buf);
  } catch (e) {
    jsonError(req, res, 502, `Upstream fetch failed: ${e instanceof Error ? e.message : "unknown"}`);
  }
});

server.listen(ARGS.port, ARGS.host, () => {
  const base = `http://${ARGS.host === "0.0.0.0" ? "127.0.0.1" : ARGS.host}:${ARGS.port}`;
  console.log(`✅ 로컬 프록시 실행 중 — ${base}`);
  console.log(`   앱 설정 → '내 전용 프록시' 에 등록:  ${base}`);
  console.log(`   중지: Ctrl+C   ·   상태 확인: ${base}/usage`);
  console.log(`   ⚠️  Safari 는 https→http://localhost 를 막습니다. Chrome/Edge/Firefox 를 쓰세요.`);
});
