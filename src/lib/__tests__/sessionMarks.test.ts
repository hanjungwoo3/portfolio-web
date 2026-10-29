// 24시간 카드 세로선 = 시장 시간표 위치(봉 번호 아님, 사용자 결정 2026-10-27 "같은 분류는 다 동일하지 않아?").
//   봉이 빠지거나 드문 종목도 같은 시장이면 같은 x 에 서야 한다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTwoDaySeries, rollDay } from "../api";
import jnj from "./fixtures/toss_us_5m_jnj_20261026.json";
import unison from "./fixtures/toss_kr_5m_unison_halted_20261027.json";

// 토스 미국 축 = 00:00~24:00 ET. 09:30 = 0.3958, 16:00 = 0.6667
const OPEN = 9.5 / 24, CLOSE = 16 / 24;

describe("rollDay 시간표 세로선", () => {
  it("오늘 절반 지점: 어제 선은 창 안에 있을 때만, 오늘 시작선은 지났을 때만", () => {
    const r = rollDay({ closes: [1, 2, 3, 4] }, [0.2, 0.8, 0.1, 0.4], 2, 0.5,
      { open: 0.3, close: 0.7, todayOpen: true, todayClose: false, prevOpen: true, prevClose: true });
    // 창 = 어제 0.5 ~ 오늘 0.5 → 어제 시작(0.3)은 밖, 어제 종가(0.7)·오늘 시작(0.3)은 안
    expect(r.markXs?.length).toBe(2);
    expect(r.markXs?.[0].close).toBe(true);
    expect(r.markXs?.[1].close).toBeUndefined();
  });
  it("최신 날이 오늘이 아니면(fNow=1) 그날 하루만 — 어제 선은 모두 빠진다", () => {
    const r = rollDay({ closes: [1, 2, 3] }, [0.5, 0.2, 0.9], 1, 1,
      { open: 0.3, close: 0.7, todayOpen: true, todayClose: true, prevOpen: true, prevClose: true });
    expect(r.markXs?.map(m => +m.x.toFixed(3))).toEqual([0.3, 0.7]);
  });
});

describe("토스 5분봉 실제 응답(JNJ, 2026-10-26)", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-27T00:25:00Z")); });   // = 10/26 20:25 ET(월)
  afterEach(() => { vi.useRealTimers(); });
  const fNow = (20 * 60 + 25) / (24 * 60);
  const W = 1 + 0.04 / 0.96;
  const xOfToday = (f: number) => (1 + 0.04 / 0.96 + f - fNow) / W;

  it("오늘 시작·종가 두 선이 시간표 자리에 선다", () => {
    const s = buildTwoDaySeries(jnj, false)!;
    const xs = s.markXs!.map(m => m.x);
    expect(s.markXs!.length).toBe(2);
    expect(xs[0]).toBeCloseTo(xOfToday(OPEN), 4);
    expect(xs[1]).toBeCloseTo(xOfToday(CLOSE), 4);
    expect(s.markXs![1].close).toBe(true);
  });
  it("봉이 드문드문 빠져도(같은 시장) 선 위치는 그대로", () => {
    const sparse = jnj.filter((_, i) => i % 3 === 0 || i % 7 === 0);
    const a = buildTwoDaySeries(jnj, false)!.markXs!.map(m => m.x);
    const b = buildTwoDaySeries(sparse, false)!.markXs!.map(m => m.x);
    expect(b).toEqual(a);
  });
  it("장 시작 전(같은 날 08:00 ET)이면 오늘 선은 아직 없다", () => {
    vi.setSystemTime(new Date("2026-10-26T12:00:00Z"));   // 08:00 ET
    const early = jnj.filter(c => c.dt.slice(0, 10) !== "2026-10-26" || c.dt.slice(11, 16) <= "08:00");
    const s = buildTwoDaySeries(early, false)!;
    expect((s.markXs ?? []).filter(m => m.x > 0.5)).toEqual([]);   // 오른쪽(오늘) 칸엔 선 없음
  });
});

describe("거래정지(체결 0) — 유니슨 실제 응답 2026-10-27", () => {
  it("모든 봉이 거래량 0 이면 24시간 시계열을 만들지 않는다(3개월로) — 선이 기준선에 묻히고 세로선만 서던 문제", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-27T01:10:00Z"));   // 10:10 KST
    expect(buildTwoDaySeries(unison, true)).toBeNull();
    vi.useRealTimers();
  });
  it("오늘만 체결이 없으면(장 시작 전 빈 봉) 오늘 세로선은 안 선다", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-27T00:25:00Z"));   // 20:25 ET 월
    const rows = jnj.map(c => c.dt.slice(0, 10) === "2026-10-26" ? { ...c, volume: 0 } : c);
    const s = buildTwoDaySeries(rows, false)!;
    expect((s.markXs ?? []).filter(m => m.x > 0.5)).toEqual([]);
    vi.useRealTimers();
  });
});

import nvda from "./fixtures/toss_us_5m_nvda_20261027.json";
describe("어제 기준선(그저께 종가) — 토스 오버나이트 봉의 base 교체", () => {
  it("월요일 20:00 ET 뒤 봉의 base(=월 종가)가 아니라 정규장 봉의 base(=금 종가)를 쓴다 — NVDA 실제 응답", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-27T08:20:00Z"));   // 화 04:20 ET
    const s = buildTwoDaySeries(nvda, false)!;
    expect(s.base).toBe(216);
    expect(s.prevBase).toBe(210.96);
    vi.useRealTimers();
  });
});

// 마이크론 10/28 20:45 ET(= 10/29 09:45 KST) — 토스는 20:00 ET 오버나이트부터 base 를 오늘 종가(983.23)로 바꾼다.
//   오늘 칸 색 기준은 어제 종가(928.76) 그대로, 오늘 종가 983.23 은 카드 % 기준이라 종가 세로선부터 점선으로 더 긋는다
//   (사용자 2026-10-29 "그제 종가, 어제 종가 가로 점선이 이상해").
import mu from "./fixtures/toss_us_5m_mu_20261028_post.json";
describe("토스 5분봉 — 정규장 끝난 뒤(MU 2026-10-28 20:45 ET)", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-29T00:46:00Z")); });
  afterEach(() => { vi.useRealTimers(); });
  it("오늘 기준 = 어제 종가, 새 기준 = 오늘 종가, 왼쪽 = 그저께 종가", () => {
    const s = buildTwoDaySeries(mu, false)!;
    expect(s.base).toBe(928.76);
    expect(s.nextBase).toBe(983.23);
    expect(s.prevBase).toBe(903.7);
  });
  it("한국은 새 기준을 만들지 않는다(20:00 까지 어제 종가 기준)", () => {
    const s = buildTwoDaySeries(unison, true);
    expect(s?.nextBase).toBeUndefined();
  });
});
