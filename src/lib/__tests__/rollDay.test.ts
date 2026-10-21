// 최근 하루치 밀어 보기(rollDay) — 어제가 지금 위치만큼 왼쪽으로 밀려 잘리고, 인덱스(끊김·시작·종가선)가 같이 당겨지는지.
import { describe, it, expect } from "vitest";
import { rollDay } from "../api";

// 어제 5점(0, .25, .5, .75, 1) + 오늘 3점(0, .25, .5) — 오늘 정규장 시작 = 오늘 둘째 점(인덱스 6)
const base = { closes: [1, 2, 3, 4, 5, 6, 7, 8], openIdx: 6, prevOpenIdx: 1, prevCloseIdx: 3, breakIdx: 5 };
const fr = [0, 0.25, 0.5, 0.75, 1, 0, 0.25, 0.5];

describe("rollDay", () => {
  it("오늘이 절반 지났으면 어제 앞쪽 절반이 잘리고 오른쪽 끝이 지금", () => {
    const r = rollDay(base, fr, 5, 0.5);
    expect(r.closes).toEqual([3, 4, 5, 6, 7, 8]);      // 어제 0·0.25 는 창 밖
    expect(r.breakIdx).toBe(3);                         // 오늘 첫 점이 당겨진 위치
    expect(r.openIdx).toBe(4);
    expect(r.prevOpenIdx).toBeUndefined();              // 어제 시작선은 잘려 나갔다
    expect(r.prevCloseIdx).toBe(1);
    expect(r.xs[0]).toBeCloseTo(0);
    expect(r.xs[r.xs.length - 1]).toBeCloseTo(1);       // 오늘 0.5 = 지금 = 오른쪽 끝
    expect(r.rolling).toBe(true);
  });
  it("오늘이 끝났으면(fNow=1) 오늘 하루만 꽉 찬다", () => {
    const r = rollDay(base, fr, 5, 1);
    expect(r.closes).toEqual([6, 7, 8]);
    expect(r.breakIdx).toBeUndefined();
    expect(r.xs[0]).toBeCloseTo(0);
  });
  it("장 시작 전(fNow=0)엔 어제 하루가 통째로 보인다", () => {
    const r = rollDay(base, fr, 5, 0);
    expect(r.closes.length).toBe(8);
    expect(r.breakIdx).toBe(5);
  });
});
