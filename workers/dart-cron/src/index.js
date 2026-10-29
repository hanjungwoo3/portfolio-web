// 수집 깨우기 — Cloudflare 예약 실행(Cron Trigger)으로 10분마다 GitHub 워크플로(portfolio-etf-index)를 실행시킨다.
//   GitHub 자체 예약(schedule)은 붐비면 몇 시간씩 밀리거나 건너뛰어(2026-10-28 10분 예약이 하루 2번), Cloudflare 가 대신 깨운다.
//   토큰(GH_TOKEN)은 워커 비밀값으로만(wrangler secret put GH_TOKEN) — 저장소 하나·Actions 쓰기 권한만 준 fine-grained PAT.
//   · dart.yml — DART 공시: 평일 07:00~20:50 KST
//   · live.yml — ETF 랭킹·눌림목·실적 일정·히트맵(2026-10-29~): 국내 평일 08:00~20:20 KST 또는 미국 뉴욕 평일 04:00~20:20
//   cron 은 UTC 라 요일·시각을 여기서 한 번 더 거른다(서머타임은 Intl 이 맞춰 준다).
const REPO = "hanjungwoo3/portfolio-etf-index";

function zoned(tz, d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, weekday: "short", hour: "2-digit", minute: "2-digit" })
    .formatToParts(d).map(x => [x.type, x.value]));
  return { dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday), min: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}
const weekday = (z) => z.dow >= 1 && z.dow <= 5;
function windows(now = new Date()) {
  const k = zoned("Asia/Seoul", now), n = zoned("America/New_York", now);
  return {
    dart: weekday(k) && k.min >= 7 * 60 && k.min < 21 * 60,
    live: (weekday(k) && k.min >= 8 * 60 && k.min <= 20 * 60 + 20) || (weekday(n) && n.min >= 4 * 60 && n.min <= 20 * 60 + 20),
  };
}

async function dispatch(env, workflow) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/dispatches`, {
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
  return `${workflow} ${r.status}`;   // 204 = 성공
}

export default {
  async scheduled(_event, env, ctx) {
    if (!env.GH_TOKEN) { console.error("GH_TOKEN 비밀값이 없다"); return; }
    const w = windows();
    const jobs = [];
    if (w.dart) jobs.push(dispatch(env, "dart.yml"));
    if (w.live) jobs.push(dispatch(env, "live.yml"));
    if (jobs.length) ctx.waitUntil(Promise.all(jobs).then(s => console.log(s.join(" · "))));
  },
  // 확인용 — GET / 는 상태만(토큰 노출 없음). 실행은 예약으로만.
  async fetch(_req, env) {
    return new Response(JSON.stringify({ ok: true, token: !!env.GH_TOKEN, window: windows() }), { headers: { "Content-Type": "application/json" } });
  },
};
