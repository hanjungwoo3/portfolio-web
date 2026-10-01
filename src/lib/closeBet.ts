// 종가배팅 — 오늘 종가 근처에 사서 **다음 날 시가**에 판다. 조건은 백테스트로 고른 세 가지만.
//
// 백테스트(2026-10-01, 토스 일봉 450일 = 2025-02~2026-09 389거래일, 거래대금 20일 평균 10억+):
//   종목 2,633 · ETF 1,537(레버리지·인버스 제외). 매수 = 그날 종가, 매도 = 다음 날 시가.
//   ⚠️ 상한가(+29%↑) 마감은 뺐다 — 평균 +6.2% 로 결과를 통째로 부풀렸는데, 잠긴 상한가는
//      종가에 사려 해도 파는 사람이 없어 **실제로는 체결이 거의 안 된다**(이걸 넣으면 +1.9%, 빼면 +0.5%).
//   수급(외국인·기관)·신고가·오버나잇 모멘텀은 조합에 더하면 오히려 줄거나 표본이 너무 작아져 뺐다.
//   토스 일봉은 KRX+NXT 통합 — 종목의 종가·시가에 시간외(NXT)가 섞인다(종목 20:00 마감 매수와 가깝다).
//
// 호출: 스캐너 1콜(등락률로 후보만 추림) + 후보별 토스 일봉 1콜. 후보는 보통 수십 종.

import { fetchProxied, fetchTossKrCandles, ProxyHostError, type PricePoint } from "./api";

export type BetKind = "stock" | "etfStrong" | "etfDip";

export interface BetRule {
  kind: BetKind;
  title: string;
  desc: string;          // 조건(사람 말로)
  // 백테스트 성적 — 화면 표와 설명에 그대로 쓴다
  n: number; avg: number; net: number; win: number; thirds: [number, number, number]; months: string;
}

// 왕복 비용(%) — 종목: 매도세 0.15 + 수수료·슬리피지, ETF: 수수료(매도세 없음)
export const COST = { stock: 0.23, etf: 0.03 } as const;

export const RULES: BetRule[] = [
  { kind: "stock", title: "종목 — 강하게 마감",
    desc: "고가 근처 마감(하루 범위의 90%+) · 거래대금 20일 평균 3배+ · 오늘 +10% ~ +29%(상한가 제외)",
    n: 1018, avg: 0.90, net: 0.67, win: 45, thirds: [0.64, 0.45, 0.71], months: "16/20" },
  { kind: "etfStrong", title: "ETF — 강하게 마감",
    desc: "고가 근처 마감(90%+) · 거래대금 20일 평균 3배+ · 오늘 +5% 이상",
    n: 273, avg: 0.99, net: 0.96, win: 65, thirds: [0.77, 0.62, 0.81], months: "12/18" },
  { kind: "etfDip", title: "ETF — 급락 반등",
    desc: "오늘 -5% 이하로 급락 (금요일엔 성적이 나빠 빼고 쟀다)",
    n: 3593, avg: 1.48, net: 1.45, win: 63, thirds: [0.93, 1.45, 0.38], months: "13/19" },
];

// 시장 전체 — 같은 기간 '아무거나 다 샀을 때' 밤 평균. 종목은 요일·나스닥 차이가 작고 ETF 는 크다.
export const MARKET_NOTES = {
  etfFriday: -0.06, etfMonThu: 0.23,       // ETF: 금요일 매수(→월) vs 월~목
  etfNqUp: 0.33, etfNqRest: 0.14,          // ETF: 15:20 나스닥 선물 +0.5%↑ 날 vs 나머지
  stockFriday: 0.12, stockMonThu: 0.33,
};

export interface BetRow {
  code: string;
  name: string;           // 스캐너 영문명(화면에선 한글 사전으로 바꾼다)
  kind: BetKind;
  isEtf: boolean;
  date: string;           // 오늘 봉 날짜(KST) — 장 전·휴장일엔 직전 거래일
  close: number;
  changePct: number;      // 전일 종가 대비
  pos: number;            // (종가-저가)/(고가-저가) 0~1
  tvRatio: number;        // 오늘 거래대금 / 직전 20일 평균
  value: number;          // 오늘 거래대금(원)
  avg20: number;          // 직전 20일 평균 거래대금(원)
}

const LEV = /레버리지|인버스|2X|leverage|inverse|bear|bull|선물|futures/i;

interface ScanItem { code: string; name: string; isEtf: boolean; change: number }

// 등락률로 후보만 추린다 — 종목 +10%↑, ETF +5%↑ 또는 -5%↓. 정확한 판정은 토스 일봉으로 다시 한다.
async function scanCandidates(): Promise<ScanItem[]> {
  const resp = await fetchProxied("https://scanner.tradingview.com/korea/scan", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filter: [
        { left: "exchange", operation: "equal", right: "KRX" },
        { left: "type", operation: "in_range", right: ["stock", "fund"] },
        { left: "change", operation: "not_in_range", right: [-4.5, 4.5] },
        { left: "Value.Traded", operation: "greater", right: 1e9 },
      ],
      columns: ["name", "description", "type", "subtype", "change"],
      sort: { sortBy: "Value.Traded", sortOrder: "desc" }, range: [0, 1500],
    }),
  });
  const text = await resp.text();
  let j: { error?: string; data?: { s: string; d: unknown[] }[] };
  try { j = JSON.parse(text); } catch { throw new Error("스캐너 응답 파싱 실패"); }
  if (typeof j.error === "string" && j.error) {
    if (/host not allowed/i.test(j.error)) throw new ProxyHostError(j.error);
    throw new Error(j.error);
  }
  const out: ScanItem[] = [];
  for (const row of j.data ?? []) {
    const [code, desc, type, subtype, change] = row.d as [string, string, string, string, number];
    const isEtf = type === "fund" && subtype === "etf";
    const isCommon = type === "stock" && subtype === "common";
    if (!isEtf && !isCommon) continue;
    if (isEtf && LEV.test(desc)) continue;
    if (!/^[\dA-Za-z]{6}$/.test(code) || typeof change !== "number") continue;
    if (isCommon && change < 9.5) continue;            // 종목은 +10% 근처부터만
    out.push({ code, name: desc, isEtf, change });
  }
  return out;
}

/** 일봉으로 오늘 판정 — 백테스트와 **같은 계산**(전일 종가 대비 등락·하루 범위 위치·직전 20일 평균 거래대금). */
export function judge(bars: PricePoint[], isEtf: boolean): Omit<BetRow, "code" | "name" | "isEtf"> | null {
  if (bars.length < 22) return null;
  const t = bars[bars.length - 1], p = bars[bars.length - 2];
  const h = t.high ?? t.close, l = t.low ?? t.close;
  if (!(t.close > 0 && p.close > 0 && h > l)) return null;
  const prior = bars.slice(-21, -1);
  const avg20 = prior.reduce((s, b) => s + b.close * b.volume, 0) / prior.length;
  if (avg20 < 1e9) return null;                                   // 유동성 하한 — 백테스트와 같다
  const value = t.close * t.volume;
  const changePct = (t.close / p.close - 1) * 100;
  const pos = (t.close - l) / (h - l);
  const tvRatio = value / avg20;
  let kind: BetKind | null = null;
  if (!isEtf) {
    if (pos >= 0.9 && tvRatio >= 3 && changePct >= 10 && changePct < 29) kind = "stock";
  } else if (pos >= 0.9 && tvRatio >= 3 && changePct >= 5) kind = "etfStrong";
  else if (changePct <= -5) kind = "etfDip";
  if (!kind) return null;
  return { kind, date: t.date, close: t.close, changePct, pos, tvRatio, value, avg20 };
}

export interface BetSnapshot { fetchedAt: number; scanned: number; rows: BetRow[] }
const LS_KEY = "close_bet_v1";

export function loadCachedBet(): BetSnapshot | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as BetSnapshot;
    if (!Array.isArray(s.rows) || !s.scanned) return null;   // 빈 스캔은 캐시로 치지 않는다
    return s;
  } catch { return null; }
}

export async function fetchCloseBet(): Promise<BetSnapshot> {
  const cands = await scanCandidates();
  const rows: BetRow[] = [];
  const queue = [...cands];
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (;;) {
      const c = queue.shift();
      if (!c) return;
      try {
        const bars = await fetchTossKrCandles(c.code, "day", 25);
        const r = judge(bars, c.isEtf);
        if (r) rows.push({ code: c.code, name: c.name, isEtf: c.isEtf, ...r });
      } catch { /* 한 종목 실패는 건너뛴다 */ }
    }
  }));
  rows.sort((a, b) => b.value - a.value);
  const snap: BetSnapshot = { fetchedAt: Date.now(), scanned: cands.length, rows };
  if (cands.length > 0) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(snap)); } catch { /* 용량 — 캐시 없이 동작 */ }
  }
  return snap;
}
