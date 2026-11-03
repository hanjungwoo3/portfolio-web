import { describe, it, expect } from "vitest";
import { radarHitOf } from "../kisRadar";
import { toInfo } from "../kisVi";

// KST 2026-11-04 hh:mm → epoch ms
const at = (hh: number, mm: number) => Date.UTC(2026, 10, 4, hh - 9, mm);

describe("거래대금 급증 레이더", () => {
  // 구간 시작(09:00, 프리장 누적 10억) 기준
  const st = { t: at(9, 0), v: 10e8 };
  it("구간 평균의 3배 이상 + 3억 이상이면 급증", () => {
    // 09:00~10:30 90분 동안 90억(분당 1억) → 최근 5분에 20억(분당 4억) = 4배
    const arr = [{ t: at(10, 25), v: 80e8 }, { t: at(10, 30), v: 100e8 }];
    const h = radarHitOf(arr, at(10, 30), st);
    expect(h).not.toBeNull();
    expect(h!.ratio).toBeCloseTo((20e8 / 5) / (90e8 / 90), 5);
    expect(h!.windowMin).toBe(5);
  });
  it("평소 페이스면 아니다", () => {
    const arr = [{ t: at(10, 25), v: 95e8 }, { t: at(10, 30), v: 100e8 }];
    expect(radarHitOf(arr, at(10, 30), st)).toBeNull();
  });
  it("배수는 커도 금액이 작으면(3억 미만) 거른다", () => {
    const arr = [{ t: at(10, 25), v: 11e8 }, { t: at(10, 30), v: 13e8 }];
    expect(radarHitOf(arr, at(10, 30), st)).toBeNull();
  });
  it("스냅숏 간격이 2분 미만이면 아직 재지 않는다", () => {
    const arr = [{ t: at(10, 29), v: 80e8 }, { t: at(10, 30), v: 100e8 }];
    expect(radarHitOf(arr, at(10, 30), st)).toBeNull();
  });
  it("구간 시작 10분 안은 재지 않는다", () => {
    const arr = [{ t: at(9, 3), v: 11e8 }, { t: at(9, 8), v: 60e8 }];
    expect(radarHitOf(arr, at(9, 8), st)).toBeNull();
  });
  it("프리장 누적이 커도 정규장 9시에 일제히 뜨지 않는다(구간 기준)", () => {
    // 프리장에 50억 쌓인 뒤 09:00 구간 시작 → 09:10~09:15 분당 2억 = 구간 평균(분당 2억)과 같다
    const s2 = { t: at(9, 0), v: 50e8 };
    const arr = [{ t: at(9, 10), v: 70e8 }, { t: at(9, 15), v: 80e8 }];
    expect(radarHitOf(arr, at(9, 15), s2)).toBeNull();
  });
});

describe("VI 해석(실측 행)", () => {
  it("동적 VI 상승 — LS네트웍스 2026-11-03 19:59", () => {
    const v = toInfo({ cntg_vi_hour: "195958", vi_cncl_hour: "200201", vi_count: "1", vi_kind_code: "2", vi_prc: "2825", vi_stnd_prc: "0", vi_dmc_stnd_prc: "2650", vi_dmc_dprt: "6.60", vi_dprt: "0.00" });
    expect(v).toMatchObject({ dir: "up", kind: "동적", at: "19:59:58", until: "20:02:01", count: 1 });
    expect(v!.pct).toBeCloseTo(6.6);
  });
  it("발동가가 기준가 아래면 하락", () => {
    const v = toInfo({ cntg_vi_hour: "101500", vi_cncl_hour: "101700", vi_count: "2", vi_kind_code: "1", vi_prc: "9000", vi_stnd_prc: "10000", vi_dprt: "10.00" });
    expect(v).toMatchObject({ dir: "down", kind: "정적", count: 2 });
  });
});
