import { describe, it, expect } from "vitest";
import { tossCandleSymbol, mapTossCandles, TOSS_RANGE_BARS } from "../tossCandles";

describe("tossCandleSymbol — 야후 심볼 → 토스 심볼", () => {
  it("국내 .KS/.KQ 는 코드만(신형 영숫자 코드 포함), 미국 티커는 그대로", () => {
    expect(tossCandleSymbol("005930.KS")).toBe("005930");
    expect(tossCandleSymbol("0101N0.KQ")).toBe("0101N0");
    expect(tossCandleSymbol("005930")).toBe("005930");
    expect(tossCandleSymbol("AAPL")).toBe("AAPL");
    expect(tossCandleSymbol("BRK-B")).toBe("BRK-B");
  });
  it("지수·환율·선물·해외 거래소·가상 심볼은 토스로 안 간다", () => {
    for (const s of ["^KS11", "^VIX", "KRW=X", "NQ=F", "7203.T", "0700.HK", "CNNFG", "DRAM=ML", "LITHIUM=F", "ABCDEF.KS"])
      expect(tossCandleSymbol(s), s).toBeNull();
  });
  it("10y·max 는 지원 range 가 아니다(페이지 폭주 방지)", () => {
    expect(TOSS_RANGE_BARS["1y"]).toBe(252); expect(TOSS_RANGE_BARS["max"]).toBeUndefined(); expect(TOSS_RANGE_BARS["10y"]).toBeUndefined();
  });
});

describe("mapTossCandles — 최신순 페이지 → 오름차순 PricePoint", () => {
  const c = (d: string, close: string) => ({ timestamp: `${d}T00:00:00+09:00`, openPrice: "71600", highPrice: "72300", lowPrice: "71500", closePrice: close, volume: "3521000", currency: "KRW" });
  it("문자열 숫자를 수로, 날짜는 앞 10자, 오름차순, 중복 날짜는 하나", () => {
    const out = mapTossCandles([[c("2026-03-25", "72000"), c("2026-03-24", "71600")], [c("2026-03-24", "71600"), c("2026-03-23", "71000")]]);
    expect(out.map(p => p.date)).toEqual(["2026-03-23", "2026-03-24", "2026-03-25"]);
    expect(out[2]).toMatchObject({ close: 72000, open: 71600, high: 72300, low: 71500, volume: 3521000 });
  });
  it("종가 0·날짜 이상은 버린다", () => {
    expect(mapTossCandles([[c("2026-03-25", "0"), { ...c("2026-03-24", "1"), timestamp: "bad" }]])).toHaveLength(0);
  });
});
