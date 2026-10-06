import { describe, it, expect } from "vitest";
import { sectorPresets } from "../sectorPresets";

describe("성적표 섹터 묶음", () => {
  it("모든 종목에 표시 이름이 있다 (네이버 조회가 비면 코드만 보이던 문제)", () => {
    const missing = sectorPresets().flatMap(p => p.tickers.filter(t => !p.names[t]).map(t => `${p.label}/${t}`));
    expect(missing).toEqual([]);
  });
  it("반도체·반도체 소부장 + 대장주 페이지 섹터가 다 있다", () => {
    const labels = sectorPresets().map(p => p.label);
    expect(labels.slice(0, 2)).toEqual(["반도체", "반도체 소부장"]);
    for (const l of ["2차전지", "조선", "은행", "제약·바이오", "엔터"]) expect(labels).toContain(l);
  });
});
