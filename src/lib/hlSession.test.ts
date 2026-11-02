import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchHlPerpSession } from "./api";

// 5분봉 가짜 — 가격 = 시각(분)이라 기준가 위치를 바로 확인
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const kst = (s: string) => Date.parse(`${s}+09:00`);
function stub(from: number, to: number) {
  const out: { t: number; c: string }[] = [];
  for (let t = from; t < to; t += 300_000) out.push({ t, c: String(100 + (t - from) / 60_000) });
  vi.stubGlobal("fetch", vi.fn(async (_u: string, init: { body: string }) => {
    const { req } = JSON.parse(init.body);
    return { ok: true, json: async () => out.filter(k => k.t >= req.startTime && k.t <= req.endTime) };
  }));
}
describe("fetchHlPerpSession", () => {
  it("월 21시 — 기준 = 오늘 15:30", async () => {
    vi.useFakeTimers(); vi.setSystemTime(kst("2026-11-02T21:00:00"));
    stub(kst("2026-10-28T00:00:00"), kst("2026-11-02T21:00:00"));
    const r = await fetchHlPerpSession("xyz:SKHY");
    expect(r?.sessionStart).toBe(kst("2026-11-02T15:30:00"));
    // 15:25 시작 봉(15:30 끝)의 종가
    expect(r?.sessionBase).toBe(100 + (kst("2026-11-02T15:25:00") - kst("2026-10-28T00:00:00")) / 60_000);
    expect(r?.markXs?.some(m => m.close)).toBe(true);
  });
  it("월 11시(한국 장중) — 기준 = 어제(일) 15:30 — 매일 24시간 세션", async () => {
    vi.useFakeTimers(); vi.setSystemTime(kst("2026-11-02T11:00:00"));
    stub(kst("2026-10-28T00:00:00"), kst("2026-11-02T11:00:00"));
    const r = await fetchHlPerpSession("xyz:SKHY");
    expect(r?.sessionStart).toBe(kst("2026-11-01T15:30:00"));
  });
});
