// AI 하드웨어 vs 소프트웨어 — 미국 AI 섹터의 순환은 섹터 하나하나가 아니라 **두 진영 사이**에서 일어난다.
//   (국내 상장 미국 ETF 13종 15개월 실측, 2026-10-12)
//   - 하드웨어·인프라끼리 일별 상관 0.6~0.8, 소프트웨어끼리 0.8, 진영 사이 0.1~0.3
//   - 하드웨어가 크게 빠진 달(26.3월·26.7월)에 소프트웨어가 1등 — 'AI 안에서 피신'
//   - 진영 안 A→B 순서·월간 1등 지속은 통계로 안 보였다(순위 상관 +0.04) → 이 카드는 '어느 쪽으로 기울었나'만 본다
//   빅테크·휴머노이드는 양쪽 다 0.4~0.8 이라 어느 진영에도 넣지 않고 참고로만 둔다.
import type { PricePoint } from "./api";

// short = 카드 꼬리표, sector = 평균 낼 때 묶는 섹터(없으면 short). 같은 섹터 ETF 가 여럿이면
//   섹터 안에서 먼저 평균 → 섹터끼리 평균 — ETF 수가 많은 섹터가 진영 평균을 끌고 가지 않게.
export interface CampEtf { code: string; name: string; short: string; sector?: string }
export type CampKey = "hw" | "sw" | "ref";
export const AI_CAMPS: Record<CampKey, { label: string; etfs: CampEtf[] }> = {
  hw: { label: "하드웨어·인프라", etfs: [
    { code: "381180", name: "TIGER 미국필라델피아반도체나스닥", short: "반도체" },
    { code: "442580", name: "PLUS 글로벌HBM반도체", short: "HBM메모리" },
    { code: "487230", name: "KODEX 미국AI전력핵심인프라", short: "AI전력" },
    { code: "0173Y0", name: "KODEX 미국AI광통신네트워크", short: "광통신" },
    { code: "0142D0", name: "TIGER 미국AI데이터센터TOP4Plus", short: "데이터센터" },
    { code: "442320", name: "RISE 글로벌원자력", short: "원자력" },
  ] },
  // 하드웨어와 같은 6개(사용자 요청 2026-10-12). 추가 셋은 일별 상관으로 진영 확인(200일):
  //   KODEX AI SW 소프트 0.85·하드 0.30 / TIGER AI SW 0.81·0.32 / PLUS AI에이전트 0.88·0.08.
  //   뺀 것: AI플랫폼액티브(0.53·0.68)·글로벌플랫폼(0.55·0.64)은 중간, RISE AI클라우드인프라는 하드(0.90).
  sw: { label: "소프트웨어", etfs: [
    { code: "481180", name: "SOL 미국AI소프트웨어", short: "AI SW(SOL)", sector: "AI소프트웨어" },
    { code: "0041D0", name: "KODEX 미국AI소프트웨어TOP10", short: "AI SW(KODEX)", sector: "AI소프트웨어" },
    { code: "0102A0", name: "TIGER 미국AI소프트웨어TOP4Plus", short: "AI SW(TIGER)", sector: "AI소프트웨어" },
    { code: "418670", name: "TIGER 글로벌AI사이버보안", short: "사이버보안" },
    { code: "371450", name: "TIGER 글로벌클라우드컴퓨팅INDXX", short: "클라우드" },
    { code: "0050E0", name: "PLUS 미국AI에이전트", short: "AI에이전트" },   // 규모·거래가 작다(시총 약 40억)
  ] },
  ref: { label: "양쪽에 걸침(참고)", etfs: [
    { code: "381170", name: "TIGER 미국테크TOP10 INDXX", short: "빅테크" },
    { code: "0038A0", name: "KODEX 미국휴머노이드로봇", short: "휴머노이드" },
  ] },
};
export const AI_CAMP_CODES = Object.values(AI_CAMPS).flatMap(c => c.etfs.map(e => e.code));

export type Period = "d1" | "w1" | "m1" | "m3";
export const PERIOD_BARS: Record<Period, number> = { d1: 1, w1: 5, m1: 21, m3: 63 };
export const PERIOD_LABEL: Record<Period, string> = { d1: "오늘", w1: "1주", m1: "1개월", m3: "3개월" };

/** 일봉(과거→최신)에서 n봉 전 종가 대비 수익률(%). 봉이 모자라면 null. */
export function retOf(c: PricePoint[] | undefined, n: number): number | null {
  if (!c || c.length <= n) return null;
  const last = c[c.length - 1].close, base = c[c.length - 1 - n].close;
  return base > 0 ? (last / base - 1) * 100 : null;
}

/** 기간 수익률 기준 봉 — '오늘' 은 오늘 봉까지, 1주·1개월·3개월은 **지난 거래일 종가까지**.
 *  ETF 카드의 기간 수익률(크롤러, 새벽에 계산)과 같은 기준이다 — 예전엔 오늘 봉까지 넣어
 *  칩 +21.2% · 카드 +13.61% 로 엇갈렸다(사이버보안 2026-10-12, 오늘 +5.39%).
 *  오늘 봉 = 날짜가 오늘(KST)인 마지막 봉. 장 전·휴일엔 마지막 봉이 이미 지난 거래일이다. */
export function barsFor(c: PricePoint[] | undefined, p: Period, todayYmd: string): PricePoint[] | undefined {
  if (!c?.length || p === "d1") return c;
  return c[c.length - 1].date === todayYmd ? c.slice(0, -1) : c;
}

/** 진영 평균(동일가중) — 그 기간 값이 있는 ETF만. 상장이 짧아 값이 없는 ETF는 빠진다. */
/** 카드가 보여 주는 크롤러 기간 수익률(코드 → w1·m1·m3). 있으면 이걸 쓴다 — 크롤러가 늦게 돌면
 *  (2026-10-12 09:16 실측) 장중 가격이 섞여 기준이 흔들린다. 일봉으로 따로 계산하면 카드와 또 엇갈리므로
 *  **카드에 보이는 그 값**을 그대로 평균 낸다. 크롤러에 없는 ETF(신규 상장 등)만 일봉으로 계산. */
export type CrawledReturns = Record<string, { w1?: number | null; m1?: number | null; m3?: number | null } | undefined>;

export function campReturn(key: CampKey, candles: Map<string, PricePoint[]>, p: Period, todayYmd = "", crawled?: CrawledReturns): number | null {
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  const bySector = new Map<string, number[]>();
  for (const e of AI_CAMPS[key].etfs) {
    const fromCard = p === "d1" ? null : crawled?.[e.code]?.[p];
    const r = fromCard ?? retOf(barsFor(candles.get(e.code), p, todayYmd), PERIOD_BARS[p]);
    if (r == null) continue;
    const s = e.sector ?? e.short;
    bySector.set(s, [...(bySector.get(s) ?? []), r]);
  }
  const sectors = [...bySector.values()].map(mean);
  return sectors.length ? mean(sectors) : null;
}

/** 기울기 판정 — 1개월 차이로 방향, 1주가 반대로 크게 돌면 '전환 조짐'. 기준(%p)은 화면 문구와 같이 쓴다. */
export const LEAN_GAP = 3;
export type Lean = "hw" | "sw" | "even";
export function leanOf(m1Gap: number | null, w1Gap: number | null): { lean: Lean; turning: boolean } {
  const lean: Lean = m1Gap == null || Math.abs(m1Gap) < LEAN_GAP ? "even" : m1Gap > 0 ? "hw" : "sw";
  const turning = lean !== "even" && w1Gap != null && Math.abs(w1Gap) >= LEAN_GAP && Math.sign(w1Gap) !== Math.sign(m1Gap!);
  return { lean, turning };
}
