import { describe, it, expect, vi } from "vitest";
vi.mock("../broker", () => ({ isKisLinkOn: () => false }));
import { parseKisMembers } from "../kisWs";

// 실시간 거래원 한 건 — 공식 예제 member_total 필드 78개 순서로 만든다
function rec(o: Partial<Record<number, string>>): string {
  const f = Array.from({ length: 78 }, (_, i) => o[i] ?? (i >= 1 && i <= 10 ? "" : "0"));   // 창구명 빈 칸은 ""
  return f.join("^");
}

describe("한투 실시간 거래원 H0UNMBC0 읽기", () => {
  it("창구 이름·누적 수량·외국계 여부·외국계 합계", () => {
    const raw = `0|H0UNMBC0|001|${rec({
      0: "005930", 1: "키움증권", 2: "삼성증권", 6: "모간서울", 7: "KB증권",
      11: "120000", 12: "90000", 16: "341347", 17: "200000",
      26: "Y", 27: "N", 61: "1877000", 62: "2460000", 65: "583000",
    })}`;
    const [m] = parseKisMembers(raw);
    expect(m.code).toBe("005930");
    expect(m.buy[0]).toEqual({ name: "모간서울", qty: 341347, foreign: true });
    expect(m.buy[1].foreign).toBe(false);
    expect(m.sell.map(x => x.name)).toEqual(["키움증권", "삼성증권"]);   // 이름 빈 칸은 뺀다
    expect([m.globBuy, m.globSell, m.globNet]).toEqual([2460000, 1877000, 583000]);
  });
  it("다른 실시간 항목은 무시", () => {
    expect(parseKisMembers("0|H0UNCNT0|001|a^b^c")).toEqual([]);
  });
});
