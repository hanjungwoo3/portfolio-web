// DART 공시 수집 깨우기 — Cloudflare 예약 실행(Cron Trigger)으로 10분마다 GitHub 워크플로(portfolio-etf-index dart.yml)를 실행시킨다.
//   GitHub 자체 예약(schedule)은 붐비면 몇 시간씩 밀리거나 건너뛰어(2026-10-28 10분 예약이 하루 2번), Cloudflare 가 대신 깨운다.
//   토큰(GH_TOKEN)은 워커 비밀값으로만(wrangler secret put GH_TOKEN) — 저장소 하나·Actions 쓰기 권한만 준 fine-grained PAT.
//   평일 07:00~20:50 KST 만(cron 이 UTC 라 요일·시각을 여기서 한 번 더 거른다).
const REPO = "hanjungwoo3/portfolio-etf-index";
const WORKFLOW = "dart.yml";

function inWindowKst(now = new Date()) {
  const k = new Date(now.getTime() + 9 * 3600_000);
  const dow = k.getUTCDay(), h = k.getUTCHours();
  return dow >= 1 && dow <= 5 && h >= 7 && h <= 20;
}

async function dispatch(env) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "dart-cron-worker",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: "main" }),
  });
  return r.status;   // 204 = 성공
}

export default {
  async scheduled(_event, env, ctx) {
    if (!inWindowKst()) return;
    if (!env.GH_TOKEN) { console.error("GH_TOKEN 비밀값이 없다"); return; }
    ctx.waitUntil(dispatch(env).then(s => console.log(`dispatch ${s}`)));
  },
  // 확인용 — GET / 는 상태만(토큰 노출 없음). 실행은 예약으로만.
  async fetch(_req, env) {
    return new Response(JSON.stringify({ ok: true, token: !!env.GH_TOKEN, window: inWindowKst() }), { headers: { "Content-Type": "application/json" } });
  },
};
