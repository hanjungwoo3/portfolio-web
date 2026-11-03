import { describe, it, expect } from "vitest";
import { readBreadth } from "./breadth";
describe("readBreadth", () => {
  it("쏠림·고른 흐름 구분", () => {
    expect(readBreadth(2.36, 1.47).tone).toBe("warn");          // 반도체가 끌어올림
    expect(readBreadth(-3.35, -0.86).tone).toBe("calm");        // 반도체가 끌어내림
    expect(readBreadth(1.2, 1.0).tone).toBe("good");            // 고르게 상승
    expect(readBreadth(-1.2, -1.0).tone).toBe("bad");           // 고르게 하락
    expect(readBreadth(1.0, -0.3).text).toContain("대형주(반도체)만 오르고");
    expect(readBreadth(0.05, -0.1).tone).toBe("flat");
  });
});
import { readAsia, readVkospi } from "./breadth";
describe("readVkospi·readAsia", () => {
  it("V-KOSPI 구간", () => {
    expect(readVkospi(53, 5).tone).toBe("bad");
    expect(readVkospi(18, -1).tone).toBe("good");
  });
  it("아시아 비교", () => {
    expect(readAsia(-3, [-0.3, 1.1]).text).toContain("한국만 더 약합니다");
    expect(readAsia(-1.2, [-1, -0.8]).text).toContain("함께 내립니다");
  });
});
