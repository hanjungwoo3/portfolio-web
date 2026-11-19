// 지수선물 근월물 코드 — 한투 종목마스터(fo_idx_code_mts.mst, 2026-11-19) 실측값과 같아야 한다
import { describe, it, expect } from "vitest";
import { indexFutFrontCode } from "./kisFutures";

describe("indexFutFrontCode", () => {
  it("분기물만, 만기(둘째 목요일) 다음 날 다음 분기로", () => {
    expect(indexFutFrontCode("k200", "2026-11-19")).toBe("A01612");
    expect(indexFutFrontCode("kq150", "2026-11-19")).toBe("A06612");
    expect(indexFutFrontCode("k200", "2026-12-10")).toBe("A01612");   // 만기일 당일은 12월물
    expect(indexFutFrontCode("k200", "2026-12-11")).toBe("A01703");
    expect(indexFutFrontCode("kq150", "2027-03-12")).toBe("A06706");
  });
});
