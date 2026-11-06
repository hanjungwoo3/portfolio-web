import { describe, it, expect } from "vitest";
import { describeNormDiff } from "../syncDiff";

const base = JSON.stringify({ holdings: [{ ticker: "005930", name: "삼성전자", shares: 10, avg_price: 50000, buy_date: "", market: "", account: "토스", source: "toss" }], memos: [], trades: [{ id: "t1", ticker: "005930", account: "토스", type: "buy", date: "2026-11-01", qty: 10, amount: 500000, fee: 0 }], settings: { deposits: { 토스: 1000 }, independentGroups: false } });

describe("describeNormDiff", () => {
  it("같으면 빈 목록", () => expect(describeNormDiff(base, base)).toEqual([]));
  it("예수금·평단·거래 변경을 사람 말로", () => {
    const n = JSON.parse(base);
    n.settings.deposits.토스 = 1200;
    n.holdings[0].avg_price = 51000;
    n.trades.push({ id: "t2", ticker: "000660", account: "토스", type: "buy", date: "2026-11-02", qty: 1, amount: 1, fee: 0 });
    const d = describeNormDiff(base, JSON.stringify(n));
    expect(d).toContain("예수금 토스: 1,000→1,200");
    expect(d.some(x => x.includes("평단 50,000→51,000"))).toBe(true);
    expect(d).toContain("거래 추가 1건");
  });
  it("깨진 입력은 빈 목록", () => expect(describeNormDiff("x", base)).toEqual([]));
});
