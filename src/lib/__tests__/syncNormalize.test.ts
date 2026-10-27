// normalize() 누락 방지 — Drive 동기화 지문에 Memo 필드가 빠지면 값이 조용히 사라진다.
//
// 실제로 있었던 일: entryPrice(기대가)가 normalize 에 없어서, 기대가만 고치면 지문이 그대로라
//   autoPush 가 "변경 없음" 으로 건너뛰었다. 그 뒤 autoPull 이 기대가 없는 Drive 버전으로
//   로컬을 덮어써서 기대가가 사라졌다. 필드를 늘릴 때마다 사람이 기억할 수는 없으니 테스트로 막는다.

import { describe, it, expect } from "vitest";
import { normalize } from "../syncManager";
import { memoHasContent } from "../db";
import type { ExportPayload, Trade } from "../db";
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

describe("normalize — 증권사 연동 필드", () => {
  const h = { ticker: "005930", name: "삼성전자", shares: 1, avg_price: 1, account: "토스(연동)" };
  const p = (holding: object, settings?: object): ExportPayload =>
    ({ holdings: [holding as ExportPayload["holdings"][number]], peaks: {}, memos: [], trades: [], exported_at: "2026-01-01T00:00:00.000Z",
       ...(settings ? { settings: settings as ExportPayload["settings"] } : {}) });
  it("보유의 source(연동 표식)가 바뀌면 지문도 바뀐다", () => {
    expect(normalize(p({ ...h, source: "toss" }))).not.toBe(normalize(p(h)));
  });
  it("거래의 fee(수수료·세금)가 바뀌면 지문도 바뀐다 — normalize 에 빠지면 Drive 왕복에서 조용히 사라진다", () => {
    const t = { id: "t1", ticker: "005930", type: "buy" as const, date: "2026-10-06", qty: 1, amount: 70000 };
    const pt = (trade: object): ExportPayload => ({ ...p(h), trades: [trade as Trade] });
    expect(normalize(pt({ ...t, fee: 314 }))).not.toBe(normalize(pt(t)));
  });
  it("settings.linkedGroups 가 바뀌면 지문도 바뀐다", () => {
    expect(normalize(p(h, { linkedGroups: { "토스(연동)": { broker: "toss", accountSeq: "1" } } }))).not.toBe(normalize(p(h, {})));
  });
});

// 앱과 웹을 같이 켜 두면 아무것도 안 고쳤는데 매번 "Drive 와 다르다, 가져올까?" 를 물었다(사용자 2026-10-27).
//   기기가 스스로 바꾸는 값(최고가·연동 갱신 시각)이 지문에 있었기 때문 — 이 값들은 지문을 바꾸면 안 된다.
describe("normalize — 기기가 스스로 바꾸는 값은 지문 밖", () => {
  const h = { ticker: "005930", name: "삼성전자", shares: 1, avg_price: 1, account: "토스" };
  const p = (over: Partial<ExportPayload>): ExportPayload =>
    ({ holdings: [h as ExportPayload["holdings"][number]], peaks: {}, memos: [], trades: [], exported_at: "x", ...over });
  const lg = (meta: object) => ({ settings: { linkedGroups: { "토스": { broker: "toss", accountSeq: "1", ...meta } } } as ExportPayload["settings"] });
  it("최고가가 올라도 지문은 그대로", () => {
    expect(normalize(p({ peaks: { "005930": 90000 } }))).toBe(normalize(p({ peaks: { "005930": 91000 } })));
  });
  it("연동 갱신 시각·오류·평단 환산 기억이 바뀌어도 지문은 그대로", () => {
    expect(normalize(p(lg({ lastSyncAt: "2026-10-27T01:00:00Z", lastTradeSyncAt: "a", usdAvg: { MU: { usd: 1, qty: 1, krw: 1 } } }))))
      .toBe(normalize(p(lg({ lastSyncAt: "2026-10-27T01:05:00Z", lastError: "429" }))));
  });
  it("연결 계좌가 바뀌면 지문도 바뀐다", () => {
    expect(normalize(p(lg({ accountSeq: "2" })))).not.toBe(normalize(p(lg({}))));
  });
});

describe("mergeLinkedGroups — 받을 때 기기 값 지키기", () => {
  it("같은 계좌면 갱신 시각은 최신 쪽, 평단 환산 기억은 이 기기 것", async () => {
    const { mergeLinkedGroups } = await import("../db");
    const local = { "토스": { broker: "toss" as const, accountSeq: "1", lastSyncAt: "2026-10-27T01:05:00Z", usdAvg: { MU: { usd: 1, qty: 1, krw: 1 } } } };
    const remote = { "토스": { broker: "toss" as const, accountSeq: "1", lastSyncAt: "2026-10-26T10:00:00Z", lastError: "옛 오류" } };
    const m = mergeLinkedGroups(local, remote);
    expect(m["토스"].lastSyncAt).toBe("2026-10-27T01:05:00Z");
    expect(m["토스"].lastError).toBeUndefined();
    expect(m["토스"].usdAvg).toEqual(local["토스"].usdAvg);
  });
  it("계좌가 다르거나 이 기기에 없으면 Drive 것 그대로", async () => {
    const { mergeLinkedGroups } = await import("../db");
    const remote = { "한국투자": { broker: "kis" as const, accountSeq: "9", lastSyncAt: "z" } };
    expect(mergeLinkedGroups({}, remote)).toEqual(remote);
  });
});

describe("upgradeSyncedHash — 옛 지문을 새 형식으로", () => {
  it("옛 normalize 결과(peaks·연동 메타 전체)를 바꾸면 지금 normalize 와 같다", async () => {
    const { upgradeSyncedHash } = await import("../syncManager");
    const h = { ticker: "005930", name: "삼성전자", shares: 1, avg_price: 1, account: "토스" };
    const pl: ExportPayload = { holdings: [h as ExportPayload["holdings"][number]], peaks: { "005930": 9 }, memos: [], trades: [], exported_at: "x",
      settings: { independentGroups: true, linkedGroups: { "토스": { broker: "toss", accountSeq: "1", lastSyncAt: "t" } } } as ExportPayload["settings"] };
    const now = JSON.parse(normalize(pl));
    // 옛 형식 재현 — peaks 를 holdings 뒤에, linkedGroups 는 원본 그대로
    const old = JSON.stringify({ holdings: now.holdings, peaks: { "005930": 9 }, memos: now.memos, trades: now.trades,
      settings: { ...now.settings, linkedGroups: pl.settings!.linkedGroups } });
    expect(upgradeSyncedHash(old)).toBe(normalize(pl));
    expect(upgradeSyncedHash(normalize(pl))).toBe(normalize(pl));   // 새 형식은 그대로
  });
});
