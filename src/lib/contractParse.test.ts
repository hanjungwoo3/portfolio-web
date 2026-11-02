import { describe, it, expect } from "vitest";
import { parseContract } from "./dartDisclosures";

const body = `정정신고(보고)
4. 정정사항
2. 계약내역 - 계약금액(원) - 매출액대비(%)
- -
308,560,797,394 20.3
단일판매ㆍ공급계약 체결
1. 판매ㆍ공급계약 구분
상품공급
- 체결계약명
풍력발전기 구조물 공급계약 체결
2. 계약내역
계약금액(원)
308,560,797,394
최근매출액(원)
1,520,162,115,494
매출액대비(%)
20.3
대규모법인여부
해당
3. 계약상대
Vattenfall
- 회사와의 관계
-
5. 계약기간
시작일
2024-12-24
종료일
2026-10-31`;
describe("parseContract", () => {
  it("금액·비율·상대·기간", () => {
    const c = parseContract(body)!;
    expect(c.name).toBe("풍력발전기 구조물 공급계약 체결");
    expect(Math.round(c.amountEok!)).toBe(3086);
    expect(c.ratio).toBe(20.3);
    expect(c.party).toBe("Vattenfall");
    expect([c.from, c.to]).toEqual(["2024-12-24", "2026-10-31"]);
  });
  it("빈 본문", () => { expect(parseContract("")).toBe(null); });
});
