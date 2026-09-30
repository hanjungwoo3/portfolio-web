import { describe, it, expect } from "vitest";
import { buildDashboardSections } from "../dashboardGroups";

// 지수 탭 그룹 순서 — "지금 움직이는 것을 위로" 가 규칙이다.
//   ⚠️ 기대값을 코드에 맞춰 베끼지 말 것. 아래 주석의 **의도**가 먼저다.
describe("지수 탭 섹션 순서", () => {
  it("한국장 시간대 — 한국 시장 → ETF TOP → 섹터 → 현물", () => {
    // 낮엔 한국 것이 위. ETF 등락 TOP 은 한국 ETF 라 한국 시장 바로 아래에 붙고,
    // 현물(금·구리·원유)은 국내 섹터의 선행 신호라 섹터 바로 뒤에 둔다.
    const ids = buildDashboardSections(false, false).map(s => s.id);
    expect(ids.slice(0, 4)).toEqual(["kr", "etftop", "sector", "spot"]);
  });

  it("한국장 마감 — 한국 그룹(한국 시장·ETF TOP)이 맨 아래", () => {
    // 밤엔 한국 ETF 랭킹도 멈춰 있다. 한국 시장과 함께 맨 아래로 내려가야
    // 정작 움직이는 미국 지수가 위로 올라온다.
    const ids = buildDashboardSections(false, true).map(s => s.id);
    expect(ids.slice(-2)).toEqual(["kr", "etftop"]);
    // 섹터는 밤엔 미국 지수 바로 뒤로 따라 붙는다(한·미가 한 판이라).
    expect(ids.indexOf("sector")).toBe(ids.indexOf("macro") + 1);
    // 현물은 밤엔 원래 자리(야간 선물 뒤).
    expect(ids.indexOf("spot")).toBeGreaterThan(ids.indexOf("night"));
  });

  it("섹션이 빠지거나 중복되지 않는다", () => {
    for (const closed of [false, true]) {
      const ids = buildDashboardSections(false, closed).map(s => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toHaveLength(buildDashboardSections(false, false).length);
    }
  });
});
