import { describe, it, expect } from "vitest";
import { futuresGauge, verdict, optionGauge } from "./marketPressure";

const day = (i: number, price: number, oi: number, foreign: number) => ({ date: `2026-11-${String(i).padStart(2, "0")}`, price, oi, foreign, institution: 0, individual: 0 });

describe("marketPressure", () => {
  it("외국인 순매도 + 미결제↑가격↓ = 하방 강화", () => {
    const d = [day(1, 800, 150000, 0), ...[2, 3, 4, 5, 6].map(i => day(i, 800 - i * 5, 150000 + i * 2000, -1500))];
    expect(futuresGauge(d)?.tone).toBe("worse");
  });
  it("외국인 순매수인데 미결제는 신규 매도 = 그대로(엇갈림)", () => {
    const d = [day(1, 800, 150000, 0), ...[2, 3, 4, 5, 6].map(i => day(i, 800 - i * 5, 150000 + i * 2000, 1500))];
    expect(futuresGauge(d)?.tone).toBe("flat");
  });
  it("풋 미결제 감소 = 완화", () => {
    expect(optionGauge({ callOi: 1000, putOi: 1100, callOiChg: 50, putOiChg: -40 })?.tone).toBe("better");
  });
  it("결론 — 완화가 2개 이상 많으면 완화 쪽", () => {
    const g = (tone: "better" | "worse" | "flat") => ({ key: tone + Math.random(), title: "", tone, value: "", text: "" });
    expect(verdict([g("better"), g("better"), g("better"), g("worse")]).tone).toBe("better");
  });
});
