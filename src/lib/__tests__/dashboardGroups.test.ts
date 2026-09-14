import { describe, it, expect } from "vitest";
import { buildDashboardSections } from "../dashboardGroups";
describe("지수 탭 섹션 순서", () => {
  it("한국장 시간대 — 한국 시장 → 현물 → 한국 섹터", () => {
    const ids = buildDashboardSections(false, false).map(s => s.id);
    expect(ids.slice(0, 3)).toEqual(["kr", "spot", "sector"]);
  });
  it("한국장 마감 — 한국 그룹은 맨 아래, 현물은 원래 자리", () => {
    const ids = buildDashboardSections(false, true).map(s => s.id);
    expect(ids.slice(-2)).toEqual(["kr", "sector"]);
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
