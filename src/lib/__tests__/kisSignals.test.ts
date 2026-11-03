import { describe, it, expect } from "vitest";
import { radarHitOf } from "../kisRadar";
import { toInfo } from "../kisVi";

// KST 2026-11-04 hh:mm → epoch ms
const at = (hh: number, mm: number) => Date.UTC(2026, 10, 4, hh - 9, mm);

describe("거래대금 급증 레이더", () => {
  it("오늘 평균의 3배 이상 + 3억 이상이면 급증", () => {
    // 10:30 까지 90분 동안 90억(분당 1억) → 최근 5분에 20억(분당 4억) = 4배
    const arr = [{ t: at(10, 25), v: 70e8 }, { t: at(10, 30), v: 90e8 }];
    const h = radarHitOf(arr, at(10, 30));
    expect(h).not.toBeNull();
    expect(h!.ratio).toBeCloseTo((20e8 / 5) / (90e8 / 90), 5);
    expect(h!.windowMin).toBe(5);
  });
  it("평소 페이스면 아니다", () => {
    const arr = [{ t: at(10, 25), v: 85e8 }, { t: at(10, 30), v: 90e8 }];
    expect(radarHitOf(arr, at(10, 30))).toBeNull();
  });
  it("배수는 커도 금액이 작으면(3억 미만) 거른다", () => {
    const arr = [{ t: at(10, 25), v: 1e8 }, { t: at(10, 30), v: 3e8 }];
    expect(radarHitOf(arr, at(10, 30))).toBeNull();
  });
  it("스냅숏 간격이 2분 미만이면 아직 재지 않는다", () => {
    const arr = [{ t: at(10, 29), v: 70e8 }, { t: at(10, 30), v: 90e8 }];
    expect(radarHitOf(arr, at(10, 30))).toBeNull();
  });
  it("장 시작 10분 안은 재지 않는다", () => {
    const arr = [{ t: at(9, 3), v: 1e8 }, { t: at(9, 8), v: 50e8 }];
    expect(radarHitOf(arr, at(9, 8))).toBeNull();
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
