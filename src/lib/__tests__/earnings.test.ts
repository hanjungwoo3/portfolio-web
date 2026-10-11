import { describe, it, expect } from "vitest";
import { toKst, cleanUsName } from "../earnings";

describe("영어 회사명 꼬리 정리", () => {
  it("ADR·Inc.·Class 가 겹쳐 붙어도 다 떼어 낸다", () => {
    expect(cleanUsName("SAP SE Sponsored ADR")).toBe("SAP");
    expect(cleanUsName("Alphabet Inc. Class C")).toBe("Alphabet");
    expect(cleanUsName("Interactive Brokers Group, Inc.")).toBe("Interactive Brokers Group");
    expect(cleanUsName("UnitedHealth Group Incorporated")).toBe("UnitedHealth Group");
    expect(cleanUsName("JPMorgan Chase & Co.")).toBe("JPMorgan Chase & Co.");   // "& Co." 는 이름의 일부 — Co. 만 떼면 "Chase &" 가 된다
  });
});

const utc = (s: string) => Date.parse(s) / 1000;

describe("실적 발표 — 한국 시간", () => {
  it("미국 장 후 발표(16:00 ET = 20:00 UTC)는 한국 다음 날 새벽 5시", () => {
    expect(toKst(utc("2026-10-28T20:00:00Z"), 1)).toEqual({ kstDate: "2026-10-29", kstTime: "05:00", session: "post" });
  });
  it("미국 장 전 발표(08:00 ET = 12:30 UTC)는 한국 같은 날 밤", () => {
    expect(toKst(utc("2026-10-13T12:30:00Z"), -1)).toEqual({ kstDate: "2026-10-13", kstTime: "21:30", session: "pre" });
  });
  it("시각 미정(12:00 UTC 자리채움)은 날짜만 — 한국 시간으로 옮기면 날이 밀린다", () => {
    expect(toKst(utc("2026-10-27T12:00:00Z"), 0)).toEqual({ kstDate: "2026-10-27", kstTime: null, session: "unknown" });
    // 시각은 모르는데 미국 장 후 → 한국은 다음 날. 한국 종목은 그 날 그대로
    expect(toKst(utc("2026-10-27T12:00:00Z"), 1, "US")).toEqual({ kstDate: "2026-10-28", kstTime: null, session: "post" });
    expect(toKst(utc("2026-10-27T12:00:00Z"), 1, "KR")).toEqual({ kstDate: "2026-10-27", kstTime: null, session: "post" });
  });
});

describe("한국 증시 영향 태그", () => {
  it("순환매 미국 대장주는 그 단계 이름 — 카드·통계와 같은 목록", async () => {
    const { krImpactOf } = await import("../earnings");
    expect(krImpactOf({ country: "US", code: "MU", marketCap: 0 })).toBe("반도체");
    expect(krImpactOf({ country: "US", code: "LRCX", marketCap: 0 })).toBe("전공정");
    expect(krImpactOf({ country: "US", code: "MSFT", marketCap: 0 })).toBe("AI 투자");
    expect(krImpactOf({ country: "US", code: "JPM", marketCap: 0 })).toBeNull();
  });
  it("한국은 시가총액 20조↑ 만 '대형주'", async () => {
    const { krImpactOf } = await import("../earnings");
    expect(krImpactOf({ country: "KR", code: "005930", marketCap: 900e12 })).toBe("대형주");
    expect(krImpactOf({ country: "KR", code: "000000", marketCap: 5e12 })).toBeNull();
  });
});
