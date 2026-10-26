import { describe, it, expect } from "vitest";
import { mapTossOrders, findOverlaps, feeOf, type TossOrder } from "../tossTrades";

// 2026-10-26 실측 응답 모양 그대로
const filled = (over: Partial<TossOrder> = {}): TossOrder => ({
  orderId: "a0WO", symbol: "069500", side: "BUY", status: "FILLED", currency: "KRW",
  orderedAt: "2026-10-06T13:04:06.123+09:00",
  execution: { filledQuantity: "19", averageFilledPrice: "110300", filledAmount: "2095700", commission: "314", tax: "0", filledAt: "2026-10-06T13:38:49.842+09:00" },
  ...over,
});

describe("mapTossOrders — 토스 주문 → 거래", () => {
  it("체결된 주문은 체결 수량·총액·체결일로, id 는 tossapi_<orderId>", () => {
    const { rows } = mapTossOrders([filled()], { "069500": "KODEX 200" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "tossapi_a0WO", ticker: "069500", name: "KODEX 200", date: "2026-10-06", type: "buy", qty: 19, amount: 2095700, commission: 314 });
  });
  it("거절·취소(체결 0)는 건너뛴다", () => {
    const { rows, skipped } = mapTossOrders([filled({ status: "REJECTED", execution: { filledQuantity: "0", averageFilledPrice: null, filledAmount: "0" } })], {});
    expect(rows).toHaveLength(0); expect(skipped.noFill).toBe(1);
  });
  it("부분 체결 뒤 취소된 주문은 체결분만 넣는다", () => {
    const { rows } = mapTossOrders([filled({ status: "CANCELED", execution: { filledQuantity: "7", averageFilledPrice: "110000", filledAmount: "770000", filledAt: "2026-10-06T13:10:00+09:00" } })], {});
    expect(rows[0]).toMatchObject({ qty: 7, amount: 770000 });
  });
  it("미국(USD)은 체결일 환율로 원화 환산, 환율 없으면 건너뛴다", () => {
    const us = filled({ orderId: "u1", symbol: "TSLA", currency: "USD", execution: { filledQuantity: "0.000855", averageFilledPrice: "426.58", filledAmount: "0.364726", filledAt: "2026-09-10T23:30:00+09:00" } });
    const ok = mapTossOrders([us], {}, d => (d === "2026-09-10" ? 1390 : undefined));
    expect(ok.rows[0]).toMatchObject({ ticker: "TSLA", amount: Math.round(0.364726 * 1390), fx: 1390, qty: 0.000855 });
    // 수수료도 같은 환율로 원화
    const usFee = filled({ orderId: "u2", symbol: "TSLA", currency: "USD", execution: { filledQuantity: "1", averageFilledPrice: "400", filledAmount: "400", commission: "0.4", tax: "0.01", filledAt: "2026-09-10T23:30:00+09:00" } });
    const r2 = mapTossOrders([usFee], {}, () => 1390).rows[0];
    expect(r2.commission).toBe(Math.round(0.4 * 1390)); expect(r2.tax).toBe(Math.round(0.01 * 1390));
    expect(feeOf(r2)).toEqual({ fee: Math.round(0.4 * 1390) + Math.round(0.01 * 1390) });
    const none = mapTossOrders([us], {}, () => undefined);
    expect(none.rows).toHaveLength(0); expect(none.skipped.noFx).toBe(1);
  });
  it("매도는 sell", () => {
    expect(mapTossOrders([filled({ side: "SELL" })], {}).rows[0].type).toBe("sell");
  });
});

describe("findOverlaps — 수동 기록과 겹침", () => {
  const { rows } = mapTossOrders([filled()], {});
  it("같은 종목·날짜·방향·수량이고 금액이 0.1% 이내면 겹침으로 표시", () => {
    const m = findOverlaps(rows, [{ id: "manual1", ticker: "069500", type: "buy", date: "2026-10-06", qty: 19, amount: 2095000 }]);
    expect(m.get("tossapi_a0WO")).toBe("manual1");
  });
  it("tossapi_ 거래는 겹침 비교 대상이 아니다(자기 자신)", () => {
    const m = findOverlaps(rows, [{ id: "tossapi_a0WO", ticker: "069500", type: "buy", date: "2026-10-06", qty: 19, amount: 2095700 }]);
    expect(m.size).toBe(0);
  });
  it("수량이 다르면 겹침 아님", () => {
    const m = findOverlaps(rows, [{ id: "manual2", ticker: "069500", type: "buy", date: "2026-10-06", qty: 10, amount: 1103000 }]);
    expect(m.size).toBe(0);
  });
});
