import { describe, it, expect } from "vitest";
import { readFutures, oiKind } from "../futuresRead";

describe("외국인 선물 그래프 읽기", () => {
  it("최고에서 많이 되판 매수 + 최근 15분 매도 + 미결제↑가격↓ → 파는 쪽·하락 베팅 유입", () => {
    const r = readFutures({ cum: 750, ext: { v: 2302, t: "10:00" }, recov: 67, d15: -777, oi: { doi: 400, dp: -1.2, min: 30 }, spot: -5404 });
    expect(r.head.tone).toBe("down");
    expect(r.head.text).toContain("파는 쪽");
    expect(r.head.text).toContain("하락 베팅");
    expect(r.lines.find(l => l.label === "외국인")!.text).toContain("67%를 되팔아");
    expect(r.lines.find(l => l.label === "현물")!.tone).toBe("warn");   // 선물 +, 현물 − → 엇갈림
  });
  it("15분 변화가 작으면 관망", () => {
    expect(readFutures({ cum: 1200, d15: 40 }).head.tone).toBe("flat");
  });
  it("숏커버 = 미결제↓·가격↑", () => {
    expect(oiKind(-300, 1)).toBe("cover");
    expect(oiKind(-300, -1)).toBe("liq");
    expect(oiKind(50, 1)).toBe("flat");
  });
  it("동반 매도", () => {
    const r = readFutures({ cum: -900, d15: -200, spot: -3000 });
    expect(r.lines.find(l => l.label === "현물")!.text).toContain("동반 매도");
  });
});
