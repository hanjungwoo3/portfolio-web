// 한국 세션 구간 — 15:30 이 '마감' 이 아니라는 게 핵심이다(20:00 까지 매매 가능).
import { describe, it, expect, vi, afterEach } from "vitest";
import { krSessionPhase, isKrHoldingClosed, isEtfOrEtnByName } from "../format";

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
  it("체결이 6분 넘게 멈췄으면 마감 — ETF 는 16:00 에 일제히 멈춘다", () => {
    at("16:07");
    expect(isKrHoldingClosed(END_1530, NEXT, false, sec("15:59"))).toBe(true);   // KODEX 반도체
    expect(isKrHoldingClosed(END_1530, NEXT, false, sec("15:45"))).toBe(true);   // KODEX WTI
  });
  it("6분 이내면 아직 열림 — 잠깐 뜸한 것과 멈춘 것을 가른다", () => {
    at("16:07");
    expect(isKrHoldingClosed(END_1530, NEXT, false, sec("16:02"))).toBe(false);
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

describe("ETF·ETN — 정규장 종료 즉시 마감 (애프터 미참여)", () => {
  const at = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 14, h - 9, m, 0)));
  };
  const sec = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return Date.UTC(2026, 8, 14, h - 9, m, 0) / 1000;
  };
  const END = "2026-09-14T06:30:00Z", NEXT = "2026-09-15T00:00:00Z";

  it("15:31 에 바로 마감 — 6분 기다리지 않는다", () => {
    at("15:31");
    expect(isKrHoldingClosed(END, NEXT, false, sec("15:30"), true)).toBe(true);
    expect(isKrHoldingClosed(END, NEXT, false, sec("15:30"), false)).toBe(false);   // 주식은 아직 열림
  });
  it("정규장 중에는 ETF 도 열림", () => {
    at("14:00");
    expect(isKrHoldingClosed(END, NEXT, false, sec("13:59"), true)).toBe(false);
  });
  it("프리마켓은 이 규칙에서 뺀다 — 정체 판정에 맡긴다", () => {
    at("08:30");
    expect(isKrHoldingClosed(END, NEXT, false, sec("08:29"), true)).toBe(false);
  });

  it.each([
    ["KODEX 반도체", true],
    ["TIGER 200", true],
    ["K-방산", true],
    ["삼성 블룸버그 인버스2X WTI원유선물 ETN B", true],
    ["QV 레버리지 WTI원유 ETN", true],
    ["삼성전자", false],
    ["RF머트리얼즈", false],
    ["대우건설", false],
  ])("ETF·ETN 판별: %s → %s", (name, want) => {
    expect(isEtfOrEtnByName(name as string)).toBe(want);
  });
});
