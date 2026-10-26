import { describe, it, expect } from "vitest";
import { computeRealizedByTrade } from "../tradeCalc";
import type { Trade } from "../db";

// 수수료·세금(fee) — 매수는 원가에, 매도는 실현에서 뺀다(세후). fee 없으면 예전 계산과 같아야 한다.
const buy = (over: Partial<Trade> = {}): Trade => ({ id: "b", ticker: "A", type: "buy", date: "2026-10-01", qty: 10, amount: 100_000, ...over });
const sell = (over: Partial<Trade> = {}): Trade => ({ id: "s", ticker: "A", type: "sell", date: "2026-10-02", qty: 10, amount: 110_000, ...over });

describe("computeRealizedByTrade — fee", () => {
  it("fee 없으면 매도총액 − 원가", () => {
    const r = computeRealizedByTrade([buy(), sell()], false).get("s")!;
    expect(r.realized).toBe(10_000); expect(r.pct).toBeCloseTo(10);
  });
  it("매수 수수료는 원가에, 매도 수수료·세금은 실현에서 뺀다", () => {
    const r = computeRealizedByTrade([buy({ fee: 100 }), sell({ fee: 250 })], false).get("s")!;
    expect(r.realized).toBe(110_000 - 100_100 - 250);
    expect(r.cost).toBe(100_100);
  });
  it("부분 매도는 매도분 수수료만 그 건에서 뺀다", () => {
    const r = computeRealizedByTrade([buy({ fee: 100 }), sell({ qty: 5, amount: 55_000, fee: 120 })], false).get("s")!;
    expect(r.realized).toBe(55_000 - 50_050 - 120);
  });
});
