import { describe, it, expect } from "vitest";
import { readRealRate } from "../realRate";

describe("명목·실질 금리 읽기", () => {
  it("명목만 오르고 실질은 그대로 → 물가 기대", () => {
    expect(readRealRate(0.06, 0.005).text).toContain("물가 기대");
    expect(readRealRate(0.06, 0.005).tone).toBe("warn");
  });
  it("실질이 같이 오르면 → 성장주·금 부담", () => {
    expect(readRealRate(0.06, 0.05).tone).toBe("bad");
  });
  it("실질이 내리면 → 우호", () => {
    expect(readRealRate(-0.03, -0.04).tone).toBe("good");
  });
  it("명목만 내리고 실질은 그대로 → 물가 기대 하락", () => {
    expect(readRealRate(-0.05, 0.002).tone).toBe("calm");
  });
  it("1bp 미만이면 그대로", () => {
    expect(readRealRate(0.004, -0.003).tone).toBe("flat");
  });
});
