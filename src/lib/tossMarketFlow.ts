// 토스 Open API — 시장(코스피·코스닥) 투자자별 매매대금 **주·월·연 집계** (`/api/v1/market-indicators/{KOSPI|KOSDAQ}/investor-trading`).
//   왜: 일별·시간별은 네이버로 되지만 주·월·연 합계는 KRX 로그인이 필요해 못 하던 것(계획서 §4 "새로 가능"). 데스크톱 앱 + 토스 연동일 때만.
//   응답(공식 문서 2026-10-26): records[] **최신순**, 금액은 원화 정수 문자열(buyAmount/sellAmount), 기관 breakdown 7개
//   (financialInvestment·insurance·trust·privateEquityFund·bank·otherFinancialInstitution·pensionFund), nextUntil 로 이어받기(최대 100건).
//   화면 컬럼은 기존 시간별·일별(네이버)과 같은 정의로 맞춘다 — 투신 = 투신+사모, 기관계 = institution 합계. 단위 억원(순매수 = 매수 − 매도).
import { brokerGet } from "./broker";
import type { IntradayKey } from "./intradayInvestor";

export type LongFlowInterval = "1w" | "1mo" | "1y";
export type LongFlowMarket = "kospi" | "kosdaq";

interface Amt { buyAmount?: string | null; sellAmount?: string | null }
export interface TossMarketFlowRecord {
  date: string; updatedAt?: string;
  individual?: Amt | null; foreigner?: Amt | null; otherCorporation?: Amt | null;
  institution?: (Amt & { breakdown?: Record<string, Amt | null> | null }) | null;
}
interface Page { records?: TossMarketFlowRecord[]; nextUntil?: string | null }

/** 한 집계 구간(주·월·연)의 투자자별 순매수(억원). date = 그 구간의 기준일(토스가 주는 날짜, 최신 구간은 잠정치) */
export type LongFlowPoint = { date: string; updatedAt?: string; provisional: boolean } & Record<IntradayKey, number>;

const EOK = 1e8;
const net = (a: Amt | null | undefined): number => {
  const b = Number(a?.buyAmount), s = Number(a?.sellAmount);
  if (!Number.isFinite(b) || !Number.isFinite(s)) return 0;
  return Math.round((b - s) / EOK * 10) / 10;
};

/** 최신순 레코드 → 오름차순 포인트. 순수 함수(테스트). today = 잠정치 판정용(KST YYYY-MM-DD) */
export function mapTossMarketFlow(records: TossMarketFlowRecord[], today?: string): LongFlowPoint[] {
  const out: LongFlowPoint[] = [];
  for (const r of records) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date ?? "")) continue;
    const bd = r.institution?.breakdown ?? {};
    out.push({
      date: r.date, updatedAt: r.updatedAt,
      provisional: !!today && r.date >= today,
      individuals: net(r.individual), foreigners: net(r.foreigner), institutions: net(r.institution),
      financialInvestment: net(bd.financialInvestment), insurance: net(bd.insurance),
      trust: Math.round((net(bd.trust) + net(bd.privateEquityFund)) * 10) / 10,   // 구 네이버 화면 정의: 투신(사모 포함)
      bank: net(bd.bank), otherFinancial: net(bd.otherFinancialInstitution), pensionFund: net(bd.pensionFund),
      otherCorp: net(r.otherCorporation),
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** 주·월·연 투자자 매매대금 — count 개(최대 100, 한 페이지면 충분). 실패는 던진다(호출 쪽 React Query 가 보여 준다) */
export async function fetchTossMarketFlow(market: LongFlowMarket, interval: LongFlowInterval, count = 60): Promise<LongFlowPoint[]> {
  const sym = market === "kosdaq" ? "KOSDAQ" : "KOSPI";
  const r = await brokerGet<Page>("toss", `/api/v1/market-indicators/${sym}/investor-trading?interval=${interval}&count=${Math.min(100, Math.max(1, count))}`);
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  return mapTossMarketFlow(r?.records ?? [], today);
}
