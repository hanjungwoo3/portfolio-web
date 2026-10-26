import { describe, it, expect } from "vitest";
import { mapTossMarketFlow, type TossMarketFlowRecord } from "../tossMarketFlow";

// 공식 문서 예시 모양(2026-10-26) — 원화 정수 문자열, 최신순
const rec = (date: string, over: Partial<TossMarketFlowRecord> = {}): TossMarketFlowRecord => ({
  date, updatedAt: `${date}T18:10:00+09:00`,
  individual: { buyAmount: "5200000000000", sellAmount: "5350000000000" },
  foreigner: { buyAmount: "3800000000000", sellAmount: "3600000000000" },
  institution: { buyAmount: "2100000000000", sellAmount: "2180000000000", breakdown: {
    financialInvestment: { buyAmount: "900000000000", sellAmount: "950000000000" },
    insurance: { buyAmount: "150000000000", sellAmount: "140000000000" },
    trust: { buyAmount: "280000000000", sellAmount: "300000000000" },
    privateEquityFund: { buyAmount: "120000000000", sellAmount: "130000000000" },
    bank: { buyAmount: "50000000000", sellAmount: "40000000000" },
    otherFinancialInstitution: { buyAmount: "30000000000", sellAmount: "20000000000" },
    pensionFund: { buyAmount: "570000000000", sellAmount: "600000000000" },
  } },
  otherCorporation: { buyAmount: "100000000000", sellAmount: "70000000000" },
  ...over,
});

describe("mapTossMarketFlow — 원화 매수·매도 → 억원 순매수, 오름차순", () => {
  it("순매수 = (매수−매도)/1e8, 투신은 사모 포함, 최신순을 오름차순으로", () => {
    const out = mapTossMarketFlow([rec("2026-06-11"), rec("2026-06-04")], "2026-06-12");
    expect(out.map(p => p.date)).toEqual(["2026-06-04", "2026-06-11"]);
    const p = out[1];
    expect(p.individuals).toBe(-1500); expect(p.foreigners).toBe(2000); expect(p.institutions).toBe(-800);
    expect(p.trust).toBe(-300);                 // 투신 −200 + 사모 −100
    expect(p.pensionFund).toBe(-300); expect(p.otherCorp).toBe(300); expect(p.provisional).toBe(false);
  });
  it("오늘(이후) 날짜 구간은 잠정치, 빠진 항목은 0, 날짜 이상은 버림", () => {
    const out = mapTossMarketFlow([rec("2026-06-12", { institution: null, otherCorporation: undefined }), { date: "bad" } as TossMarketFlowRecord], "2026-06-12");
    expect(out).toHaveLength(1);
    expect(out[0].provisional).toBe(true); expect(out[0].institutions).toBe(0); expect(out[0].trust).toBe(0); expect(out[0].otherCorp).toBe(0);
  });
});
