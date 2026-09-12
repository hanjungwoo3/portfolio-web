// 사양서 §9 중 "수치 계산·상태 전이·저장 직렬화" 에 해당하는 단위 테스트.
import { describe, it, expect, vi } from "vitest";
import { fibLevelPrice, fibLevels, distToSegment, parsePriceInput, isDegenerate, snapToBar, smaAligned } from "../geometry";
import { DrawingHistory } from "../history";
import { isValidDrawing, loadDrawings, saveDrawings, storageKey } from "../storage";
import { normalizeCandles, isValidCandle, MockMarketDataProvider, SUPPORTED_INTERVALS } from "../provider";
import { barTimeToSortable, FIB_LEVELS, type Drawing, type BarTime, type Candle } from "../types";

const anchor = (v: string, price: number) => ({ time: { kind: "date", value: v } as BarTime, price });

describe("피보나치 — A05", () => {
  it("A=100000, B=200000 이면 0%=100000, 50%=150000, 100%=200000", () => {
    expect(fibLevelPrice(100_000, 200_000, 0)).toBe(100_000);
    expect(fibLevelPrice(100_000, 200_000, 0.5)).toBe(150_000);
    expect(fibLevelPrice(100_000, 200_000, 1)).toBe(200_000);
  });
  it("역방향도 같은 정의 — A 가 0%, B 가 100%", () => {
    expect(fibLevelPrice(200_000, 100_000, 0)).toBe(200_000);
    expect(fibLevelPrice(200_000, 100_000, 0.5)).toBe(150_000);
    expect(fibLevelPrice(200_000, 100_000, 1)).toBe(100_000);
  });
  it("기본 7단계를 모두 계산한다", () => {
    const out = fibLevels(0, 1000, FIB_LEVELS);
    expect(out.map(o => o.price)).toEqual([0, 236, 382, 500, 618, 786, 1000]);
  });
});

describe("숫자 입력 검증 — §5.6", () => {
  it.each([["", null], ["  ", null], ["-1", null], ["0", null], ["abc", null], ["Infinity", null], ["NaN", null]])(
    "%s → 거부", (raw, want) => expect(parsePriceInput(raw as string)).toBe(want));
  it("천 단위 구분자를 받아들인다", () => expect(parsePriceInput("300,000")).toBe(300_000));
  it("A04 — 300000 을 그대로 반영한다", () => expect(parsePriceInput("300000")).toBe(300_000));
});

describe("선 판정·스냅", () => {
  it("점-선분 거리", () => {
    expect(distToSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
    expect(distToSegment({ x: -5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
  });
  it("길이 0 인 추세선은 확정하지 않는다", () => {
    expect(isDegenerate("trend", anchor("2026-01-02", 100), anchor("2026-01-02", 100))).toBe(true);
    expect(isDegenerate("trend", anchor("2026-01-02", 100), anchor("2026-01-03", 100))).toBe(false);
  });
  it("가격이 같은 피보나치는 확정하지 않는다", () => {
    expect(isDegenerate("fibonacci", anchor("2026-01-02", 100), anchor("2026-01-09", 100))).toBe(true);
  });
  it("시간은 가장 가까운 실제 봉으로 스냅한다", () => {
    const times: BarTime[] = [
      { kind: "date", value: "2026-01-02" },
      { kind: "date", value: "2026-01-05" },
      { kind: "date", value: "2026-01-06" },
    ];
    const target = barTimeToSortable({ kind: "date", value: "2026-01-04" });
    expect(snapToBar(times, target)).toEqual({ kind: "date", value: "2026-01-05" });
  });
});

describe("실행취소 이력 — A08", () => {
  const d = (id: string): Drawing => ({
    id, schemaVersion: 1, symbol: "005930", interval: "1d",
    style: { color: "#000", width: 2, line: "solid" }, type: "horizontal", price: 70_000,
  });
  it("추가·삭제·전체 지우기를 각각 되돌린다", () => {
    const h = new DrawingHistory([]);
    h.commit([d("a")]);
    h.commit([d("a"), d("b")]);
    h.commit([]);                       // 전체 지우기
    expect(h.value).toHaveLength(0);
    expect(h.undo().map(x => x.id)).toEqual(["a", "b"]);   // 한 번에 복구
    expect(h.undo().map(x => x.id)).toEqual(["a"]);
    expect(h.redo().map(x => x.id)).toEqual(["a", "b"]);
    expect(h.redo()).toHaveLength(0);
  });
  it("새 변경은 redo 를 버린다", () => {
    const h = new DrawingHistory([]);
    h.commit([d("a")]);
    h.undo();
    expect(h.canRedo).toBe(true);
    h.commit([d("z")]);
    expect(h.canRedo).toBe(false);
  });
  it("reset 은 이력을 남기지 않는다(종목·주기 전환)", () => {
    const h = new DrawingHistory([d("a")]);
    h.reset([d("b")]);
    expect(h.canUndo).toBe(false);
    expect(h.value.map(x => x.id)).toEqual(["b"]);
  });
});

describe("저장 직렬화 — A09", () => {
  const base = {
    id: "x", schemaVersion: 1 as const, symbol: "005930", interval: "1d" as const,
    style: { color: "#000", width: 2, line: "solid" as const },
  };
  it("형식 검증 — 버전·필드가 어긋나면 버린다", () => {
    expect(isValidDrawing({ ...base, type: "horizontal", price: 1 })).toBe(true);
    expect(isValidDrawing({ ...base, schemaVersion: 2, type: "horizontal", price: 1 })).toBe(false);
    expect(isValidDrawing({ ...base, type: "horizontal", price: -1 })).toBe(false);
    expect(isValidDrawing({ ...base, type: "horizontal", price: Number.NaN })).toBe(false);
    expect(isValidDrawing({ ...base, type: "trend", a: { time: { kind: "date", value: "2026-01-02" }, price: 1 } })).toBe(false);
    expect(isValidDrawing({ ...base, type: "unknown" })).toBe(false);
  });
  it("키가 종목·주기별로 갈린다", () => {
    expect(storageKey("005930", "1d")).toBe("stock-chart:v1:005930:1d");
    expect(storageKey("005930", "5m")).toBe("stock-chart:v1:005930:5m");
  });
  it("손상된 항목은 건너뛰고 원본은 지우지 않는다", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    });
    const key = storageKey("005930", "1d");
    store.set(key, JSON.stringify([{ ...base, type: "horizontal", price: 100 }, { junk: true }]));
    const r = loadDrawings("005930", "1d");
    expect(r.drawings).toHaveLength(1);
    expect(r.skipped).toBe(1);
    expect(store.get(key)).toContain("junk");     // 원본을 덮어쓰지 않았다
    vi.unstubAllGlobals();
  });
  it("저장이 막히면 false 를 돌려 호출부가 안내할 수 있게 한다", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => { throw new Error("QuotaExceeded"); },
      removeItem: () => {},
    });
    expect(saveDrawings("005930", "1d", [])).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe("캔들 정규화 — A14", () => {
  const c = (t: BarTime, o: number, h: number, l: number, cl: number, v = 1): Candle =>
    ({ time: t, open: o, high: h, low: l, close: cl, volume: v });
  it("low ≤ min(o,c) ≤ max(o,c) ≤ high 를 지키지 않으면 버린다", () => {
    expect(isValidCandle(c({ kind: "date", value: "2026-01-02" }, 10, 12, 9, 11))).toBe(true);
    expect(isValidCandle(c({ kind: "date", value: "2026-01-02" }, 10, 9, 9, 11))).toBe(false);
    expect(isValidCandle(c({ kind: "date", value: "2026-01-02" }, 10, 12, 9, -1))).toBe(false);
  });
  it("시간순 정렬 + 같은 시간 중복 제거", () => {
    const out = normalizeCandles([
      c({ kind: "date", value: "2026-01-05" }, 10, 12, 9, 11),
      c({ kind: "date", value: "2026-01-02" }, 10, 12, 9, 11),
      c({ kind: "date", value: "2026-01-05" }, 20, 22, 19, 21),
    ]);
    expect(out.map(x => (x.time as { value: string }).value)).toEqual(["2026-01-02", "2026-01-05"]);
    expect(out[1].open).toBe(20);     // 뒤에 온 값이 남는다
  });
  it("일봉은 날짜 의미를 유지한다(초로 바꿔 하루 밀리지 않는다)", () => {
    const t = barTimeToSortable({ kind: "date", value: "2026-01-02" });
    expect(new Date(t * 1000).toISOString().slice(0, 10)).toBe("2026-01-02");
  });
  it("분봉 unix 는 초 단위다(밀리초 혼동 없음)", () => {
    const sec = barTimeToSortable({ kind: "unix", value: 1_767_225_600 });
    expect(String(sec)).toHaveLength(10);
  });
});

describe("예제 데이터 — 고정 seed", () => {
  it("두 번 호출해도 같은 값이 나온다", async () => {
    const p = new MockMarketDataProvider();
    const a = await p.getCandles({ symbol: "005930", interval: "1d", limit: 30 });
    const b = await p.getCandles({ symbol: "005930", interval: "1d", limit: 30 });
    expect(a.candles).toEqual(b.candles);
    expect(a.mode).toBe("mock");
    expect(a.candles.every(isValidCandle)).toBe(true);
  });
  it("45분봉은 지원 목록에 없다(토스가 400)", () => {
    expect(SUPPORTED_INTERVALS).not.toContain("45m");
    expect(SUPPORTED_INTERVALS).toContain("1d");
    expect(SUPPORTED_INTERVALS).toContain("5m");
  });
});

describe("SMA — A14 고정 fixture", () => {
  it("MA5 는 5번째 봉부터 나오고 앞은 null 이다", () => {
    const closes = [10, 20, 30, 40, 50, 60, 70];
    expect(smaAligned(closes, 5)).toEqual([null, null, null, null, 30, 40, 50]);
  });
  it("MA3 기대값", () => {
    expect(smaAligned([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });
  it("봉이 기간보다 적으면 전부 null (N개 미만 구간은 그리지 않는다)", () => {
    expect(smaAligned([1, 2], 5)).toEqual([null, null]);
  });
  it("길이가 입력과 같다 — 캔들 인덱스와 1:1", () => {
    const closes = Array.from({ length: 240 }, (_, i) => i + 1);
    const out = smaAligned(closes, 120);
    expect(out).toHaveLength(240);
    expect(out[119]).toBeCloseTo(60.5, 10);
    expect(out[239]).toBeCloseTo(180.5, 10);
  });
});
