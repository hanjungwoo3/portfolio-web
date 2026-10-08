import { describe, it, expect } from "vitest";
import { detectBreakout, BREAKOUT_BASE } from "../breakout";
import type { PricePoint } from "../api";

// 박스(100~110 사이 횡보, 거래량 1000) 뒤에 최근 봉들을 붙인다.
const box = (n = BREAKOUT_BASE): PricePoint[] =>
  Array.from({ length: n }, (_, i) => ({ date: `d${i}`, close: 105, high: 110, low: 100, volume: 1000 }));
const bar = (close: number, volume: number, i: number): PricePoint =>
  ({ date: `r${i}`, close, high: close, low: close, volume });
const tail = (...b: [number, number][]) => b.map(([c, v], i) => bar(c, v, i));

describe("횡보 돌파", () => {
  it("좁은 박스 뒤 최근 5일 안에 거래량 2배 이상 싣고 상단을 넘었고, 아직 위에 있으면 돌파", () => {
    const r = detectBreakout([...box(), ...tail([106, 900], [107, 900], [118, 3500], [120, 2000], [121, 1500])]);
    expect(r).not.toBeNull();
    expect(r!.daysAgo).toBe(2);          // 셋째 봉(118)이 돌파일
    expect(r!.volX).toBeCloseTo(3.5);
    expect(r!.aboveTop).toBeCloseTo((121 / 110 - 1) * 100);
  });

  it("거래량 없이 넘은 건 돌파가 아니다", () => {
    expect(detectBreakout([...box(), ...tail([106, 900], [107, 900], [118, 1500], [120, 1200], [121, 1100])])).toBeNull();
  });

  it("넘었다가 다시 박스 안으로 밀리면(실패 돌파) 뺀다", () => {
    expect(detectBreakout([...box(), ...tail([106, 900], [118, 3500], [112, 2000], [109, 1500], [108, 1200])])).toBeNull();
  });

  it("박스가 넓으면(이미 크게 움직이던 종목) 횡보가 아니다", () => {
    const wide = box().map((c, i) => (i === 10 ? { ...c, low: 70 } : c));   // 70~110 = 57% 폭
    expect(detectBreakout([...wide, ...tail([106, 900], [107, 900], [118, 3500], [120, 2000], [121, 1500])])).toBeNull();
  });

  it("봉이 모자라면 판단하지 않는다", () => {
    expect(detectBreakout(box(30))).toBeNull();
    expect(detectBreakout(undefined)).toBeNull();
  });
});
