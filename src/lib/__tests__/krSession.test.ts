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

describe("isKrHoldingClosed — 15:30 이후엔 '체결이 멈췄는가' 로 본다", () => {
  const at = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 14, h - 9, m, 0)));
  };
  const END_1530 = "2026-09-14T06:30:00Z";   // 정규장 마감(고정값)
  const NEXT = "2026-09-15T00:00:00Z";
  const sec = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return Date.UTC(2026, 8, 14, h - 9, m, 0) / 1000;
  };

  it("방금 체결됐으면 열림 — tradingEnd 가 지났어도", () => {
    at("16:07");
    expect(isKrHoldingClosed(END_1530, NEXT, false, sec("16:06"))).toBe(false);
  });
  it("체결이 12분 넘게 멈췄으면 마감 — KODEX WTI(15:45 멈춤)", () => {
    at("16:07");
    expect(isKrHoldingClosed(END_1530, NEXT, false, sec("15:45"))).toBe(true);
  });
  it("10분 주기 단일가는 깜빡이지 않는다 — 11분 전 체결도 열림", () => {
    at("16:07");
    expect(isKrHoldingClosed(END_1530, NEXT, false, sec("15:56"))).toBe(false);
  });
  it("정규장 중에는 정체를 보지 않는다", () => {
    at("14:00");
    expect(isKrHoldingClosed(END_1530, NEXT, false, sec("12:00"))).toBe(false);
  });
  it("체결시각이 없으면 기존 tradingEnd 로 폴백", () => {
    at("16:07");
    expect(isKrHoldingClosed(END_1530, NEXT, false)).toBe(true);
  });
  it("세션이 CLOSED 면 무조건 마감 — 밤·주말 안전망", () => {
    at("21:00");
    expect(isKrHoldingClosed(END_1530, NEXT, false, sec("20:59"))).toBe(true);
  });
});
