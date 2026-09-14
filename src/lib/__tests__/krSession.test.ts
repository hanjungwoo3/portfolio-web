// 한국 세션 구간 — 15:30 이 '마감' 이 아니라는 게 핵심이다(20:00 까지 매매 가능).
import { describe, it, expect, vi, afterEach } from "vitest";
import { krSessionPhase, isKrHoldingClosed } from "../format";

// KST 기준 시각으로 고정. 2026-09-14 는 월요일.
const atKst = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  vi.setSystemTime(new Date(Date.UTC(2026, 8, 14, h - 9, m, 0)));
};

afterEach(() => vi.useRealTimers());

describe("krSessionPhase", () => {
  it.each([
    ["07:59", "CLOSED"],
    ["08:00", "EXTENDED"],   // 프리마켓
    ["08:49", "EXTENDED"],
    ["08:50", "CLOSED"],     // 프리마켓과 정규장 사이 공백
    ["09:00", "REGULAR"],
    ["15:29", "REGULAR"],
    ["15:30", "EXTENDED"],   // 종가 고정가
    ["16:00", "EXTENDED"],   // 애프터장
    ["19:59", "EXTENDED"],
    ["20:00", "CLOSED"],
  ])("%s → %s", (hhmm, want) => {
    vi.useFakeTimers();
    atKst(hhmm as string);
    expect(krSessionPhase()).toBe(want);
  });

  it("주말은 장중 시각이어도 CLOSED", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 12, 2, 0, 0)));   // 토 11:00 KST
    expect(krSessionPhase()).toBe("CLOSED");
  });
});

describe("isKrHoldingClosed — 실시간 거래가능 플래그 우선", () => {
  const at = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 14, h - 9, m, 0)));
  };
  const END_1530 = "2026-09-14T06:30:00Z";   // 정규장 마감(고정값)
  const NEXT = "2026-09-15T00:00:00Z";

  it("tradingEnd 가 지나도 거래 가능하면 열림 — 16:00 이후 KRX 시간외 재개", () => {
    at("16:01");
    expect(isKrHoldingClosed(END_1530, NEXT, false, { krx: false, nxt: false })).toBe(false);
  });
  it("둘 다 막혀야 마감", () => {
    at("16:01");
    expect(isKrHoldingClosed(END_1530, NEXT, false, { krx: true, nxt: true })).toBe(true);
    expect(isKrHoldingClosed(END_1530, NEXT, false, { krx: true, nxt: false })).toBe(false);
  });
  it("플래그가 없으면 기존 tradingEnd 로 폴백", () => {
    at("16:01");
    expect(isKrHoldingClosed(END_1530, NEXT, false)).toBe(true);
    expect(isKrHoldingClosed(END_1530, NEXT, false, {})).toBe(true);
  });
  it("세션이 CLOSED 면 플래그와 무관하게 마감 — 밤·주말 안전망", () => {
    at("21:00");
    expect(isKrHoldingClosed(END_1530, NEXT, false, { krx: false, nxt: false })).toBe(true);
  });
});
