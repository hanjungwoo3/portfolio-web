import { describe, it, expect, vi, afterEach } from "vitest";
import { cached, NOT_FOUND, isNotFound } from "./marketCache";

afterEach(() => { vi.useRealTimers(); });

describe("marketCache.cached", () => {
  it("기간 안이면 다시 받지 않는다", async () => {
    const fn = vi.fn(async () => [1, 2, 3]);
    expect(await cached("t1", 60_000, fn, v => v.length === 0)).toEqual([1, 2, 3]);
    expect(await cached("t1", 60_000, fn, v => v.length === 0)).toEqual([1, 2, 3]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("빈 값은 저장하지 않는다(다음에 다시 묻는다)", async () => {
    const fn = vi.fn(async () => [] as number[]);
    await cached("t2", 60_000, fn, v => v.length === 0);
    await cached("t2", 60_000, fn, v => v.length === 0);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("기간이 지나면 새로 받고, 받다 실패하면 지난 값을 돌려준다", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T00:00:00Z"));
    await cached("t3", 1000, async () => [7], v => v.length === 0);
    vi.setSystemTime(new Date("2026-10-23T00:00:05Z"));
    const fresh = vi.fn(async () => [8]);
    expect(await cached("t3", 1000, fresh, v => v.length === 0)).toEqual([8]);
    vi.setSystemTime(new Date("2026-10-23T00:00:10Z"));
    const fail = vi.fn(async (): Promise<number[]> => { throw new Error("429"); });
    expect(await cached("t3", 1000, fail, v => v.length === 0)).toEqual([8]);
  });

  it("저장된 값이 없는데 실패하면 그대로 던진다", async () => {
    await expect(cached("t4", 1000, async () => { throw new Error("boom"); }, () => false)).rejects.toThrow("boom");
  });

  it("'없음' 확정 표시는 저장한다", async () => {
    const fn = vi.fn(async () => NOT_FOUND as unknown);
    const a = await cached("t5", 60_000, fn, () => false);
    await cached("t5", 60_000, fn, () => false);
    expect(isNotFound(a)).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("같은 키를 동시에 부르면 한 번만 받는다", async () => {
    let n = 0;
    const fn = async () => { n++; await new Promise(r => setTimeout(r, 10)); return [1]; };
    await Promise.all([cached("t6", 60_000, fn, v => v.length === 0), cached("t6", 60_000, fn, v => v.length === 0)]);
    expect(n).toBe(1);
  });
});
