import { describe, it, expect } from "vitest";
import { rankFlows, type FlowStock } from "../investorFlows";

const mk = (code: string, fo: number, inn: number, pe: number, ret = 1): FlowStock => ({
  code, name: code, market: "코스피", capEok: 10000, close: 1000, date: "2026-09-30",
  w: { "20": { fo, in: inn, pe, foR: fo / 100, inR: inn / 100, peR: pe / 100, ret } },
  streak: { fo: 0, in: 0, pe: 0 },
});
// A 는 셋 다 크게, B 는 외국인만, C 는 셋 다 조금. Y 들은 한 주체씩만 C 보다 많이 산다(C 를 상위 30% 밖으로).
const stocks = [
  mk("A", 90, 90, 90), mk("B", 99, -10, -10), mk("C", 5, 5, 5),
  ...Array.from({ length: 3 }, (_, i) => mk(`YF${i}`, 20 + i, -1, -1)),
  ...Array.from({ length: 3 }, (_, i) => mk(`YI${i}`, -1, 20 + i, -1)),
  ...Array.from({ length: 3 }, (_, i) => mk(`YP${i}`, -1, -1, 20 + i)),
  ...Array.from({ length: 4 }, (_, i) => mk(`Z${i}`, -i - 2, -i - 2, -i - 2)),
];

describe("수급 매집 순위", () => {
  it("셋 다 공통 — 셋 다 순매수인 종목만, 셋 중 가장 약한 순위로 줄 세운다", () => {
    const r = rankFlows(stocks, 20, "all");
    expect(r.map(x => x.s.code)).toEqual(["A", "C"]);
  });
  it("셋 다 상위 30% 표시는 셋 모두 상위권일 때만", () => {
    const r = rankFlows(stocks, 20, "all");
    expect(r.find(x => x.s.code === "A")!.all3Top30).toBe(true);
    expect(r.find(x => x.s.code === "C")!.all3Top30).toBe(false);
  });
  it("한 주체 — 그 주체가 순매수인 종목만, 시총 대비 비율 순", () => {
    const r = rankFlows(stocks, 20, "fo");
    expect(r[0].s.code).toBe("B");
    expect(r.every(x => x.win.fo > 0)).toBe(true);
  });
  it("그 기간 데이터가 없는 종목은 뺀다", () => {
    expect(rankFlows(stocks, 60, "all")).toEqual([]);
  });
});
