import { describe, expect, it } from "vitest";
import { liveRowsToPrices } from "./etfRanking";
import { parseScreenRows } from "./stockScreener";
import { dayChangePct } from "./format";

describe("서버 수집본 → 화면 값", () => {
  it("ETF: 오늘 체결이면 직전 종가 대비, 아니면 기준가=현재가·거래량 0(등락은 prevClose 로)", () => {
    const [a, b] = liveRowsToPrices([["069500", 101, 100, 500, "2026-10-29"], ["102110", 99, 100, 300, "2026-10-28"]], "2026-10-29");
    expect(a).toMatchObject({ ticker: "069500", price: 101, base: 100, volume: 500 });
    expect(dayChangePct(a)).toBeCloseTo(1);
    expect(b).toMatchObject({ price: 99, base: 99, prevClose: 100, volume: 0 });
    expect(dayChangePct(b)).toBeCloseTo(-1);   // 직접 조회(fetchTossPricesBatch)와 같은 값
  });

  it("눌림목: 스캐너 d 배열을 같은 파서로, 지표 빠진 행은 뺀다", () => {
    // COLUMNS: name, description, logoid, close, change, volume, Value.Traded, market_cap_basic, RSI, BB.lower, SMA200, net_income, price_52_week_high, sector
    const rows = parseScreenRows([
      ["005930", "Samsung", "samsung", 100, 1.5, 10, 1e9, 1e12, 35, 98, 90, 5e9, 125, "Electronic Technology"],
      ["000001", "NoSMA", "", 100, 0, 1, 1, 1, 35, 98, null, 1, 125, ""],
    ], "코스피");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code: "005930", market: "코스피", rsi: 35 });
    expect(rows[0].ddFromHigh).toBeCloseTo(-20);
  });
});
