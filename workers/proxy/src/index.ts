// Cloudflare Worker — CORS 프록시 (Toss/Naver API 화이트리스트)
//
// 사용:  GET /?url=<encoded_target_url>
// 예:    /?url=https%3A%2F%2Fwts-info-api.tossinvest.com%2Fapi%2Fv3%2Fstock-prices%2Fdetails%3FproductCodes%3DA005930
//
// 무료 티어: 100,000 req/day. 사용자 수십~100명 규모까지 안전.

const ALLOWED_HOSTS = new Set<string>([
  "wts-info-api.tossinvest.com",
  "wts-cert-api.tossinvest.com",
  "tossinvest.com",
  "finance.naver.com",
  "m.stock.naver.com",
]);

// 응답 캐시 TTL (초). 가격/투자자/뉴스 등 짧게.
const DEFAULT_CACHE_TTL = 30;

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
    if (!target) {
      return jsonError(400, "Missing 'url' query parameter");
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

    try {
      const upstream = await fetch(targetUrl.toString(), {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
          Origin: "https://tossinvest.com",
          Referer: "https://tossinvest.com/",
          Accept: "application/json, text/html, */*",
        },
        cf: {
          // Cloudflare 엣지 캐싱 — 동일 URL 짧게 캐시
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
