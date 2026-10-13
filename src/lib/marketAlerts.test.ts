import { describe, it, expect } from "vitest";
import { activeAlerts, type MarketAlertFile } from "./marketAlerts";

const NOW = Date.parse("2026-10-13T06:10:00Z");   // KST 10/13 15:10
const file = (builtAt: string): MarketAlertFile => ({
  meta: { version: "2026-10-13", builtAt },
  alerts: {
    "319660": { level: "투자경고", from: "2026-09-28", name: "피에스케이" },
    "199730": { level: "투자주의", from: "2026-10-13", name: "바이오인프라" },
    "000001": { level: "투자주의", from: "2026-10-12", name: "어제주의" },
  },
});

describe("activeAlerts", () => {
  it("투자경고는 지정일이 지나도 남고, 투자주의는 오늘 지정만 남는다", () => {
    const m = activeAlerts(file("2026-10-12T21:05:00Z"), NOW);
    expect(m.get("319660")).toBe("투자경고");
    expect(m.get("199730")).toBe("투자주의");
    expect(m.has("000001")).toBe(false);
  });
  it("크롤이 5일 넘게 멈췄으면 아무것도 안 보여준다", () => {
    expect(activeAlerts(file("2026-10-07T21:05:00Z"), NOW).size).toBe(0);
  });
  it("파일이 없거나 깨졌으면 빈 맵", () => {
    expect(activeAlerts(null, NOW).size).toBe(0);
    expect(activeAlerts({ meta: { version: "", builtAt: "" }, alerts: {} }, NOW).size).toBe(0);
  });
});
