// normalize() 누락 방지 — Drive 동기화 지문에 Memo 필드가 빠지면 값이 조용히 사라진다.
//
// 실제로 있었던 일: entryPrice(기대가)가 normalize 에 없어서, 기대가만 고치면 지문이 그대로라
//   autoPush 가 "변경 없음" 으로 건너뛰었다. 그 뒤 autoPull 이 기대가 없는 Drive 버전으로
//   로컬을 덮어써서 기대가가 사라졌다. 필드를 늘릴 때마다 사람이 기억할 수는 없으니 테스트로 막는다.

import { describe, it, expect } from "vitest";
import { normalize } from "../syncManager";
import { memoHasContent } from "../db";
import type { ExportPayload } from "../db";
import type { Memo } from "../../types";

const base: Memo = {
  ticker: "005930",
  text: "메모",
  targetPrice: 100,
  stopPrice: 50,
  entryPrice: 70,
  priceBasis: "current",
  tag: "태그",
  color: "red",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const payload = (memo: Memo): ExportPayload => ({
  holdings: [], peaks: {}, memos: [memo], trades: [], exported_at: "2026-01-01T00:00:00.000Z",
});

describe("normalize — 메모 필드 누락 감지", () => {
  // updatedAt 은 저장 시점 차이라 일부러 제외한다. 그 외 모든 필드는 지문에 반영돼야 한다.
  const tracked = (Object.keys(base) as (keyof Memo)[]).filter(k => k !== "ticker" && k !== "updatedAt");

  it.each(tracked)("%s 가 바뀌면 지문도 바뀐다", key => {
    const changed: Memo = { ...base };
    const cur = base[key];
    // 값 하나만 바꾼다 — 숫자는 +1, 그 외는 다른 문자열로.
    (changed as unknown as Record<string, unknown>)[key] =
      typeof cur === "number" ? cur + 1 : key === "color" ? "blue" : "다른값";
    expect(normalize(payload(changed))).not.toBe(normalize(payload(base)));
  });

  it("updatedAt 만 다르면 지문은 같다 (저장 시점은 noise)", () => {
    const later: Memo = { ...base, updatedAt: "2026-06-01T00:00:00.000Z" };
    expect(normalize(payload(later))).toBe(normalize(payload(base)));
  });
});

// 저장·불러오기 양쪽이 쓰는 '빈 메모' 판정. 여기 필드가 빠지면 그 값만 넣은 메모가
//   저장 시 지워지거나 불러올 때 버려진다 — 실제로 entryPrice 가 그랬다.
describe("memoHasContent — 값 하나만 있어도 내용으로 친다", () => {
  const cases: [string, Partial<Memo>][] = [
    ["text", { text: "메모" }],
    ["targetPrice", { targetPrice: 100 }],
    ["stopPrice", { stopPrice: 50 }],
    ["entryPrice", { entryPrice: 70 }],
    ["tag", { tag: "태그" }],
    ["color", { color: "red" }],
  ];
  it.each(cases)("%s 만 있어도 내용 있음", (_label, m) => {
    expect(memoHasContent({ ticker: "005930", ...m })).toBe(true);
  });

  it("아무것도 없으면 빈 메모", () => {
    expect(memoHasContent({ ticker: "005930" })).toBe(false);
  });

  it("priceBasis 만 있으면 빈 메모 (기준 메타데이터라 내용이 아니다)", () => {
    expect(memoHasContent({ ticker: "005930", priceBasis: "current" })).toBe(false);
  });

  it("공백뿐인 text·tag 는 내용이 아니다", () => {
    expect(memoHasContent({ ticker: "005930", text: "   ", tag: "  " })).toBe(false);
  });
});
