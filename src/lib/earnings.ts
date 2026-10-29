// 실적 발표 일정 — TradingView 스캐너의 다음 실적일(earnings_release_next_date).
//   (사용자 요청 2026-10-11: 주요 기업 어닝 일정을 주별·요일별 달력으로, **한국 시간**으로)
//
//   - 미국: 시가총액 상위 + 내 관심 미국 종목 / 한국: 시가총액 상위 + 내 관심 한국 종목
//   - 우선주·다른 주식 종류(GOOGM 등)는 뺀다 — 보통주 + 대표 종목만, ADR(type "dr")은 넣는다
//   - 시각: earnings_release_next_time = -1 장 전 / 1 장 후 / 0 미정.
//     미정이면 타임스탬프가 그날 12:00 UTC 로 채워져 온다 → 날짜만 쓴다(한국 시간으로 바꾸면 날이 밀린다).
//     확정이면 실제 UTC 시각이 온다 → 그대로 한국 시간으로(미국 장 후 발표는 한국 다음 날 새벽).
//   - 회사가 확정 공시하기 전엔 추정일이라 하루쯤 어긋날 수 있다(알파벳 실측: 스캐너 10/27, 공지 10/28).
//   ⚠️ scanner.tradingview.com 은 워커 화이트리스트 필요(히트맵과 같은 호스트라 이미 등록돼 있다).
import { fetchProxied } from "./api";
import { STAGES } from "./rotation";
import { fetchLive, preferServer } from "./liveServer";

export type EarningsSession = "pre" | "post" | "unknown";

// 한국 증시에 영향이 큰 실적 — 무슨 한국 섹터로 번지는지 태그(사용자 요청 2026-10-11).
//   ① 순환매 블록(lib/rotation STAGES)의 미국 대장주 — 카드·통계와 같은 목록이라 따로 관리하지 않는다
//   ② 순환매 밖이지만 한국 섹터를 움직이는 곳(아래 손으로 적은 목록)
//   ③ 한국 시가총액 20조↑ — 지수 자체를 움직인다
const KR_IMPACT_EXTRA: Record<string, string> = {
  NVDA: "반도체", TSM: "반도체", AVGO: "반도체",
  MSFT: "AI 투자", GOOGL: "AI 투자", GOOG: "AI 투자", META: "AI 투자", AMZN: "AI 투자", ORCL: "AI 투자",   // 데이터센터 투자 → HBM 수요
  AAPL: "IT부품",                                // 삼성전기·LG이노텍
  TSLA: "2차전지", GM: "2차전지",                 // 셀·소재 고객사
  LMT: "방산", NOC: "방산", GD: "방산",
  ETN: "전력기기", VRT: "전력기기",
};
const KR_BIG_CAP = 20e12;   // 원
const usImpact = new Map<string, string>([
  ...STAGES.flatMap(st => [st.us, st.us2, st.us3].filter((u): u is { symbol: string; name: string } => !!u)
    .filter(u => !/^(LIT|ITA|BOTZ)$/.test(u.symbol))   // ETF 는 실적이 없다
    .map(u => [u.symbol, st.label] as [string, string])),
  ...Object.entries(KR_IMPACT_EXTRA),
]);
/** 한국 증시 영향 태그 — 없으면 null. */
export function krImpactOf(e: Pick<EarningsEvent, "country" | "code" | "marketCap">): string | null {
  if (e.country === "KR") return e.marketCap >= KR_BIG_CAP ? "대형주" : null;
  return usImpact.get(e.code) ?? null;
}
export interface EarningsEvent {
  code: string;            // 미국 티커 / 한국 6자리
  name: string;
  country: "US" | "KR";
  kstDate: string;         // YYYY-MM-DD (한국 날짜)
  kstTime: string | null;  // "05:00" — 시각을 모르면 null
  session: EarningsSession;
  marketCap: number;       // 정렬용(현지 통화)
  reported?: boolean;      // 이미 발표함(최근 발표일로 잡힌 것)
  logo?: string;           // 회사 로고 주소(TradingView logoid — 같은 스캔 응답, 추가 호출 0)
}

const KST = 9 * 3600_000;
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** 스캐너 값 → 한국 날짜·시각. 내보내는 건 테스트용. */
export function toKst(ts: number, timeCode: number | null | undefined, country: "US" | "KR" = "US"): { kstDate: string; kstTime: string | null; session: EarningsSession } {
  const ms = ts * 1000;
  const session: EarningsSession = timeCode === -1 ? "pre" : timeCode === 1 ? "post" : "unknown";
  const isPlaceholder = new Date(ms).getUTCHours() === 12 && new Date(ms).getUTCMinutes() === 0;
  if (session === "unknown" || isPlaceholder) {
    // 시각은 모르지만 미국 장 후라면 한국은 다음 날(새벽) — 장 전·미정·한국 종목은 그 날짜 그대로
    const shift = isPlaceholder && session === "post" && country === "US" ? 86400_000 : 0;
    return { kstDate: ymd(ms + shift), kstTime: null, session };
  }
  const k = new Date(ms + KST);
  return { kstDate: ymd(ms + KST), kstTime: `${String(k.getUTCHours()).padStart(2, "0")}:${String(k.getUTCMinutes()).padStart(2, "0")}`, session };
}

interface ScanRow { s: string; d: unknown[] }
// earnings_release_date/_time = **최근(이미 한) 발표**. 발표가 끝나면 next_date 는 다음 분기로 넘어가 이번 주 칸에서 사라졌다
//   (사용자 2026-10-29 "오늘 마이크로소프트, 알파벳 실적 있었는데" — MSFT next 2027-01-26 / last 2026-10-28 20:08 UTC 실측).
const COLS = ["name", "description", "earnings_release_next_date", "earnings_release_next_time", "market_cap_basic", "is_primary", "typespecs", "type", "exchange",
  "earnings_release_date", "earnings_release_time", "logoid"];   // logoid → 로고(사용자 요청 2026-10-29 "기업로고 있으면 로고를")

async function scan(endpoint: "america" | "korea", body: object): Promise<ScanRow[]> {
  const resp = await fetchProxied(`https://scanner.tradingview.com/${endpoint}/scan`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ columns: COLS, options: { lang: "ko" }, ...body }),
  });
  if (!resp.ok) throw new Error(`earnings scan ${endpoint}: HTTP ${resp.status}`);
  const j = await resp.json() as { error?: string; data?: ScanRow[] };
  if (typeof j.error === "string") throw new Error(j.error);
  return Array.isArray(j.data) ? j.data : [];
}

// 영어 회사명 꼬리 정리 — "SAP SE Sponsored ADR", "Alphabet Inc. Class C", "Interactive Brokers Group, Inc." → 앞부분만.
//   꼬리가 여러 개 겹쳐 붙으니 더 안 바뀔 때까지 반복한다.
const NAME_TAIL = /(?:,?\s+(?:Sponsored|Unsponsored)(?:\s+ADR)?|,?\s+ADR|\s+Class\s+[A-Z]|,?\s+(?:Inc\.?|Incorporated|Corporation|Corp\.?|Ltd\.?|Limited|plc|N\.V\.|S\.A\.|SE|AG))\s*$/i;
export function cleanUsName(s: string): string {
  let prev = "";
  let out = s.trim();
  while (out !== prev) { prev = out; out = out.replace(NAME_TAIL, "").trim(); }
  return out || s;
}

function toEvents(rows: ScanRow[], country: "US" | "KR", fromYmd: string, toYmd: string, names: Map<string, string>): EarningsEvent[] {
  const out: EarningsEvent[] = [];
  for (const { d } of rows) {
    const [code, desc, tsNext, tmNext, mc, primary, specs, type, exch, tsLast, tmLast, logoid] = d as [string, string, number | null, number | null, number | null, boolean, string[] | null, string, string, number | null, number | null, string | null];
    // 보통주(대표 상장) 또는 ADR — ADR(TSMC·ASML·SAP·SK하이닉스 ADR)은 type "dr" 에 is_primary false 로 와서 따로 허용
    //   장외(OTC) 비공식 ADR(중국 은행·일본 상사 등 "Unsponsored")은 뺀다 — 본국 발표일이 섞여 엉뚱한 날(토요일)에 몰린다
    const isStock = exch !== "OTC" && ((primary && (specs ?? []).includes("common")) || type === "dr");
    if (!isStock) continue;
    // 범위 안에 드는 발표 — 다음 발표일 먼저, 아니면 최근(이미 한) 발표일
    const pick = ([[tsNext, tmNext, false], [tsLast, tmLast, true]] as const)
      .map(([ts, tm, done]) => typeof ts === "number" ? { k: toKst(ts, tm, country), done } : null)
      .find(x => x && x.k.kstDate >= fromYmd && x.k.kstDate <= toYmd);
    if (!pick) continue;
    const k = pick.k;
    const local = names.get(code);
    const name = local || (country === "KR" ? String(desc).replace(/보통주$/, "") : cleanUsName(String(desc)));
    out.push({ code, name, country, ...k, marketCap: mc ?? 0, ...(pick.done ? { reported: true } : {}),
      ...(logoid ? { logo: `https://s3-symbol-logo.tradingview.com/${logoid}.svg` } : {}) });
  }
  return out;
}

/** fromYmd~toYmd(한국 날짜) 사이 실적 발표. names = 코드→한글 이름(관심종목·대시보드), watch = 시총이 작아도 넣을 내 종목. */
export async function fetchEarningsCalendar(
  fromYmd: string, toYmd: string, names: Map<string, string>, watch: string[],
): Promise<EarningsEvent[]> {
  // 한국 날짜 범위를 넉넉히 UTC 초로(미국 장 후 발표는 한국 다음 날이라 하루 앞뒤로 더 받는다)
  const lo = Date.parse(`${fromYmd}T00:00:00Z`) / 1000 - 2 * 86400;
  const hi = Date.parse(`${toYmd}T23:59:59Z`) / 1000 + 86400;
  const inRange = { left: "earnings_release_next_date", operation: "in_range", right: [lo, hi] };
  const lastInRange = { left: "earnings_release_date", operation: "in_range", right: [lo, hi] };
  const usWatch = watch.filter(t => !/^\d/.test(t) && /^[A-Z.]{1,6}$/.test(t));
  const krWatch = watch.filter(t => /^[\dA-Za-z]{6}$/.test(t) && /\d/.test(t));
  const watchScans = () => Promise.all([
    usWatch.length ? scan("america", { symbols: { tickers: usWatch.flatMap(t => [`NASDAQ:${t}`, `NYSE:${t}`, `AMEX:${t}`]) } }) : Promise.resolve([]),
    krWatch.length ? scan("korea", { symbols: { tickers: krWatch.map(t => `KRX:${t}`) } }) : Promise.resolve([]),
  ]);
  // 웹은 시총 상위(다음·최근 발표)를 서버 수집본(1시간마다)에서 — 내 관심종목(시총이 작을 수 있다)만 직접 2콜.
  //   서버본의 창(오늘-7 ~ +28일)이 요청 범위를 못 덮으면 전부 직접.
  const live = preferServer()
    ? await fetchLive<{ fetchedAt: number; from: string; to: string; us: unknown[][]; kr: unknown[][] }>("earnings")
    : null;
  let usTop: ScanRow[], krTop: ScanRow[], usMine: ScanRow[], krMine: ScanRow[], usDone: ScanRow[] = [], krDone: ScanRow[] = [];
  if (live && live.from <= fromYmd && live.to >= toYmd && Array.isArray(live.us) && Array.isArray(live.kr)) {
    usTop = live.us.map(d => ({ s: "", d }));
    krTop = live.kr.map(d => ({ s: "", d }));
    [usMine, krMine] = await watchScans();
  } else {
    [usTop, krTop, [usMine, krMine], usDone, krDone] = await Promise.all([
      scan("america", { filter: [inRange, { left: "market_cap_basic", operation: "greater", right: 40e9 }],
        sort: { sortBy: "market_cap_basic", sortOrder: "desc" }, range: [0, 300] }),
      scan("korea", { filter: [inRange, { left: "market_cap_basic", operation: "greater", right: 3e12 }],
        sort: { sortBy: "market_cap_basic", sortOrder: "desc" }, range: [0, 200] }),
      watchScans(),
      // 이미 발표한 것(최근 발표일이 범위 안) — 같은 시총 기준. 실패해도 다음 발표 쪽은 살린다
      scan("america", { filter: [lastInRange, { left: "market_cap_basic", operation: "greater", right: 40e9 }],
        sort: { sortBy: "market_cap_basic", sortOrder: "desc" }, range: [0, 300] }).catch(() => [] as ScanRow[]),
      scan("korea", { filter: [lastInRange, { left: "market_cap_basic", operation: "greater", right: 3e12 }],
        sort: { sortBy: "market_cap_basic", sortOrder: "desc" }, range: [0, 200] }).catch(() => [] as ScanRow[]),
    ]);
  }
  const seen = new Set<string>();
  const all = [
    ...toEvents([...usTop, ...usMine, ...usDone], "US", fromYmd, toYmd, names),
    ...toEvents([...krTop, ...krMine, ...krDone], "KR", fromYmd, toYmd, names),
  ].filter(e => { const k = `${e.country}:${e.code}`; if (seen.has(k)) return false; seen.add(k); return true; });
  if (all.length === 0) throw new Error("실적 일정 0건");   // 일시 실패를 빈 결과로 캐시하지 않게
  return all;
}
