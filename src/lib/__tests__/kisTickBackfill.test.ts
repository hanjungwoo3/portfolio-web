import { describe, it, expect, vi } from "vitest";

// 한투 응답 흉내 — 실측(삼성전자 2026-11-10) 10:14:59·10:15:59 의 누적 거래량·누적 체결강도
const AT: Record<string, { acml_vol: string; tday_rltv: string; stck_prpr: string }> = {
  "101459": { acml_vol: "5412079", tday_rltv: "75.24", stck_prpr: "197000" },
  "101559": { acml_vol: "5443278", tday_rltv: "75.60", stck_prpr: "197100" },
};
let calls = 0;
vi.mock("../broker", () => ({
  isKisLinkOn: () => true,
  kisGet: async (_p: string, _t: string, params: Record<string, string>) => {
    calls++;
    const r = AT[params.FID_INPUT_HOUR_1];
    return { body: { rt_cd: "0", output2: r ? [r] : [] }, trCont: "" };
  },
}));
vi.mock("../kisWs", () => ({ kisWsAvailable: () => false, subscribeKisTicks: () => () => {} }));

describe("한투 누적 체결강도로 빈 분 채우기", () => {
  it("두 분 경계의 차이 = 그 1분 매수·매도(합 = 거래량 증가)", async () => {
    const { backfillTickMinutes } = await import("../kisTickBackfill");
    const { tickBox } = await import("../tickStore");
    const n = await backfillTickMinutes("005930", ["10:15"]);
    expect(n).toBe(1);
    const m = tickBox("005930").minutes.get("10:15")!;
    expect(m.back).toBe(true);
    expect(m.buyVol + m.sellVol).toBe(5443278 - 5412079);   // 31,199
    expect(m.buyVol).toBeGreaterThan(m.sellVol);            // 체결강도가 올랐다 = 사는 쪽이 많았다
    expect(m.close).toBe(197100);
  });
  it("값이 없는 분은 건너뛰고, 한 번 물어본 분은 다시 안 부른다", async () => {
    const { backfillTickMinutes } = await import("../kisTickBackfill");
    calls = 0;
    expect(await backfillTickMinutes("000660", ["09:30"])).toBe(0);
    const first = calls;
    expect(first).toBe(2);   // 09:30 앞뒤 경계 두 번
    expect(await backfillTickMinutes("000660", ["09:30"])).toBe(0);
    expect(calls).toBe(first);   // 두 번째는 0콜
  });
});
