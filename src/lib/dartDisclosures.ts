// DART 오늘의 공시(dart.fss.or.kr/dsac001) — 📋 최신공시 페이지의 출처(사용자 결정 2026-10-28 "오늘의 공시로 바꿔서 이것만").
//   GET /dsac001/search.ax?selectDate=YYYY.MM.DD&currentPage=N — 한 페이지 100건(maxResults 는 무시된다), 최신순,
//   전체 건수는 <input id="totalCnt">. 하루 보통 5~15페이지. 종목코드가 없어 정식 회사명으로 맞춘다 —
//   회사명→종목코드 표는 크롤러가 KIND 상장법인목록으로 매일 내보낸다(portfolio-etf-index data/listed-corps.json).
//   브라우저에선 CORS 가 없어 프록시를 거친다(허용 목록에 dart.fss.or.kr — 프록시 8곳).
import { fetchProxied } from "./api";

export type DartMarket = "유가" | "코스닥" | "코넥스" | "기타";
export interface DartRow {
  rcpNo: string; date: string; time: string;   // date = YYYY-MM-DD(KST), time = HH:MM
  market: DartMarket; corp: string; corpCode: string; title: string; submitter: string; url: string;
  code?: string;   // 종목코드 — 크롤러 파일엔 들어 있다(KIND 상장사 표로 미리 붙임)
}

const MARKET: Record<string, DartMarket> = { kospi: "유가", kosdaq: "코스닥", konex: "코넥스", etc: "기타" };
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

/** search.ax 응답 HTML → 줄들 + 전체 건수. 순수 함수(테스트) */
export function parseDartList(html: string, ymd: string): { rows: DartRow[]; total: number } {
  const total = Number((/id="totalCnt"[^>]*value="(\d+)"/.exec(html) ?? /value="(\d+)"[^>]*id="totalCnt"/.exec(html))?.[1] ?? 0);
  const rows: DartRow[] = [];
  for (const tr of html.match(/<tr>[\s\S]*?<\/tr>/g) ?? []) {
    const tds = tr.match(/<td[^>]*>[\s\S]*?<\/td>/g) ?? [];
    if (tds.length < 4) continue;
    const [tdTime = "", tdCorp = "", tdTitle = "", tdSub = ""] = tds;
    const rcp = /rcpNo=(\d+)/.exec(tr)?.[1];
    if (!rcp) continue;
    const mk = /tagCom_(kospi|kosdaq|konex|etc)"/.exec(tdCorp)?.[1] ?? "etc";
    const corpA = /<a[^>]*openCorpInfoNew\('(\d+)'[^>]*>([\s\S]*?)<\/a>/.exec(tdCorp);
    const titleA = /<a[^>]*rcpNo=\d+[^>]*>([\s\S]*?)<\/a>/.exec(tdTitle);
    rows.push({
      rcpNo: rcp, date: ymd, time: text(tdTime).slice(0, 5), market: MARKET[mk] ?? "기타",
      corp: text(corpA?.[2] ?? ""), corpCode: corpA?.[1] ?? "", title: text(titleA?.[1] ?? ""),
      submitter: /title="([^"]*)"/.exec(tdSub)?.[1] ?? text(tdSub),
      url: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rcp}`,
    });
  }
  return { rows, total };
}

const PAGE = 100, MAX_PAGES = 20, POOL = 3;
// 시장별 — pageGrouping Y = 유가증권, K = 코스닥(사용자 제안 2026-10-28: mainY·mainK). 비상장 '기타' 법인은 처음부터 안 받는다
//   (실측 10/27: 전체 431건·5쪽 → 유가 160 + 코스닥 116 = 4쪽, 공시가 많은 날일수록 차이가 크다)
const GROUPS = ["Y", "K"] as const;
/** 그날 유가·코스닥 공시 전부(최신순). ymd = YYYY-MM-DD(KST, 기본 오늘) */
export async function fetchDartDay(ymd = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)): Promise<DartRow[]> {
  const sel = ymd.replace(/-/g, ".");
  const page = async (g: string, n: number) => {
    const r = await fetchProxied(`https://dart.fss.or.kr/dsac001/search.ax?currentPage=${n}&maxResults=${PAGE}&maxLinks=10&sort=&series=&mdayCnt=0&selectDate=${sel}&pageGrouping=${g}`);
    // 403 = 공용 프록시 허용 목록에 dart.fss.or.kr 가 아직 없다(워커 배포 전) — 앱은 프록시를 안 거쳐 상관없다
    if (!r.ok) throw new Error(r.status === 403
      ? "DART 공시를 받지 못했습니다 (HTTP 403) — 공용 프록시에 DART 허용이 아직 배포되지 않았습니다. 데스크톱·안드로이드 앱에서는 바로 됩니다."
      : `DART 공시 조회 실패 (HTTP ${r.status})`);
    return parseDartList(await r.text(), ymd);
  };
  const firsts = await Promise.all(GROUPS.map(g => page(g, 1)));
  const jobs: [string, number][] = GROUPS.flatMap((g, i) =>
    Array.from({ length: Math.max(0, Math.min(MAX_PAGES, Math.ceil(firsts[i].total / PAGE)) - 1) }, (_, k) => [g, k + 2] as [string, number]));
  const rest: DartRow[][] = [];
  let j = 0;
  await Promise.all(Array.from({ length: Math.min(POOL, jobs.length) }, async () => {
    while (j < jobs.length) { const [g, n] = jobs[j++]; try { rest.push((await page(g, n)).rows); } catch { /* 한 쪽 실패는 건너뛴다 */ } }
  }));
  const seen = new Set<string>();
  return [...firsts.map(f => f.rows), ...rest].flat()
    .filter(r => !seen.has(r.rcpNo) && seen.add(r.rcpNo))
    .sort((a, b) => b.time.localeCompare(a.time) || b.rcpNo.localeCompare(a.rcpNo));
}

// ── 서버(크롤러) 파일 먼저 — 사용자 제안 2026-10-28 "조회하면 서버에 저장하고 다른 조회들은 서버에서, 일정 시간으로 갱신".
//   portfolio-etf-index 의 dart 브랜치에 크롤러가 평일 07~20시 10분마다 날짜별 JSON 을 쓴다(scripts/dart.js).
//   사용자 수와 무관하게 DART 호출은 크롤러 한 곳 + 웹은 GitHub raw(프록시 불필요). 파일이 없거나 오늘 것이
//   30분 넘게 묵었으면(크롤 지연·실패) 직접 받는다(앱 = 네이티브, 웹 = 프록시).
const SERVER = "https://raw.githubusercontent.com/hanjungwoo3/portfolio-etf-index/dart/data/dart";
const STALE_MS = 30 * 60_000;
export interface DartDay { rows: DartRow[]; source: "server" | "live"; builtAt?: string }
export async function fetchDartDayPreferServer(ymd: string): Promise<DartDay> {
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  try {
    const r = await fetch(`${SERVER}/${ymd}.json?t=${Math.floor(Date.now() / 120_000)}`);   // raw CDN 은 5분 캐시 — 2분 단위로 키를 바꿔 너무 묵지 않게
    if (r.ok) {
      const j = await r.json() as { meta?: { builtAt?: string; final?: boolean }; rows?: Omit<DartRow, "date" | "url" | "corpCode">[] };
      const built = Date.parse(j.meta?.builtAt ?? "");
      const fresh = j.meta?.final || ymd !== today || (Number.isFinite(built) && Date.now() - built < STALE_MS);
      if (fresh && Array.isArray(j.rows)) return {
        source: "server", builtAt: j.meta?.builtAt,
        rows: j.rows.map(x => ({ ...x, date: ymd, corpCode: "", url: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${x.rcpNo}` })),
      };
    }
  } catch { /* 서버 파일 실패 → 직접 */ }
  return { source: "live", rows: await fetchDartDay(ymd) };
}

// 회사명 → 종목코드(KIND 상장법인목록, 크롤러가 매일). 공백·(주) 무시하고 맞춘다
const CORPS_URL = "https://raw.githubusercontent.com/hanjungwoo3/portfolio-etf-index/main/data/listed-corps.json";
export const normCorp = (n: string) => n.replace(/\(주\)|㈜|주식회사|\s+/g, "").toUpperCase();
export async function loadListedCorps(): Promise<Map<string, string>> {
  const r = await fetch(CORPS_URL, { cache: "no-store" });
  if (!r.ok) throw new Error(`상장사 표 HTTP ${r.status}`);
  const j = await r.json() as { corps?: Record<string, string> };
  return new Map(Object.entries(j.corps ?? {}).map(([n, c]) => [normCorp(n), c]));
}
