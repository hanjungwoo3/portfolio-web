import { describe, it, expect } from "vitest";
import { signalsAt, backtest, type Bar } from "../scalpSignals";

const flat = (n: number, price = 100, vol = 100): Bar[] => Array.from({ length: n }, (_, k) => ({ t: `09:${String(k).padStart(2, "0")}`, close: price, vol }));

describe("scalpSignals", () => {
  it("거래량 급증 + 양봉", () => {
    const b = flat(25); b[22] = { t: "09:22", close: 101, vol: 400 };
    expect(signalsAt(b, 22).map(s => s.kind)).toContain("volSpike");
  });
  it("30분 고점 돌파는 거래량 2배가 있어야", () => {
    const b = flat(35); b[32] = { t: "09:32", close: 102, vol: 150 };
    expect(signalsAt(b, 32).map(s => s.kind)).not.toContain("breakout");
    b[32].vol = 250;
    expect(signalsAt(b, 32).map(s => s.kind)).toContain("breakout");
  });
  it("앞 봉이 모자라면 신호 없음", () => {
    const b = flat(10); b[9] = { t: "09:09", close: 110, vol: 9999 };
    expect(signalsAt(b, 9)).toEqual([]);
  });
  it("백테스트 — 돌파 뒤 오르면 승, 비용 빼고 평균", () => {
    const b = flat(45); b[32] = { t: "09:32", close: 102, vol: 300 };
    for (let k = 33; k < 45; k++) b[k] = { ...b[k], close: 104 };
    const r = backtest([b], 5).find(x => x.kind === "breakout")!;
    expect(r.n).toBe(1);
    expect(r.win).toBe(1);
    expect(r.avg).toBeCloseTo((104 / 102 - 1) * 100, 5);
  });
});
