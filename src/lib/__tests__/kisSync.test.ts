import { describe, it, expect } from "vitest";
import { mapKisDomesticHoldings, mapKisOverseasHoldings, mapKisDomesticCcld, mapKisOverseasCcld } from "../kisSync";

describe("한국투자 응답 → 보유·거래 (공식 예제 필드명 기준)", () => {
  it("국내 보유: A 접두 제거·수량 0 제외·평단 반올림·새 행은 오늘 매수일", () => {
    const rows = mapKisDomesticHoldings([
      { pdno: "005930", prdt_name: "삼성전자", hldg_qty: "10", pchs_avg_pric: "70123.4567" },
      { pdno: "A000660", prdt_name: "SK하이닉스", hldg_qty: "0", pchs_avg_pric: "100000" },
    ], "한국투자", new Map(), "2026-10-26");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ticker: "005930", shares: 10, avg_price: 70123, invested: 701230, buy_date: "2026-10-26", source: "kis", account: "한국투자" });
  });
  it("해외 보유: 외화 평단 × 기준환율, 같은 외화 평단·수량이면 기억값 유지", () => {
    const usdAvg: Record<string, { usd: number; qty: number; krw: number }> = { TSLA: { usd: 426.58, qty: 1, krw: 600000 } };
    const rows = mapKisOverseasHoldings([
      { pdno: "TSLA", prdt_name: "테슬라", cblc_qty13: "1", avg_unpr3: "426.58", buy_crcy_cd: "USD", bass_exrt: "1390" },
      { pdno: "AAPL", prdt_name: "애플", cblc_qty13: "2", avg_unpr3: "200", buy_crcy_cd: "USD", bass_exrt: "1390" },
    ], "한국투자", new Map(), "2026-10-26", usdAvg);
    expect(rows.find(r => r.ticker === "TSLA")?.avg_price).toBe(600000);
    expect(rows.find(r => r.ticker === "AAPL")).toMatchObject({ avg_price: 278000, market: "US" });
    expect(usdAvg.AAPL).toEqual({ usd: 200, qty: 2, krw: 278000 });
  });
  it("국내 체결: 02 매수/01 매도, 체결 0 제외, id = kisapi_<주문일>_<주문번호>", () => {
    const rows = mapKisDomesticCcld([
      { ord_dt: "20261006", odno: "0000012345", pdno: "069500", prdt_name: "KODEX 200", sll_buy_dvsn_cd: "02", tot_ccld_qty: "19", tot_ccld_amt: "2095700" },
      { ord_dt: "20261006", odno: "0000012346", pdno: "069500", prdt_name: "KODEX 200", sll_buy_dvsn_cd: "01", tot_ccld_qty: "0", tot_ccld_amt: "0" },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "kisapi_20261006_0000012345", ticker: "069500", date: "2026-10-06", type: "buy", qty: 19, amount: 2095700 });
  });
  it("해외 체결: 외화 × 체결일 환율, 환율 없으면 건너뜀", () => {
    const r = mapKisOverseasCcld([
      { ord_dt: "20260910", odno: "1", pdno: "TSLA", sll_buy_dvsn_cd: "02", ft_ccld_qty: "1", ft_ccld_amt3: "400", tr_crcy_cd: "USD" },
      { ord_dt: "20260911", odno: "2", pdno: "TSLA", sll_buy_dvsn_cd: "01", ft_ccld_qty: "1", ft_ccld_amt3: "410", tr_crcy_cd: "USD" },
    ], d => (d === "2026-09-10" ? 1390 : undefined));
    expect(r.rows).toHaveLength(1); expect(r.rows[0]).toMatchObject({ amount: 556000, fx: 1390, type: "buy" }); expect(r.noFx).toBe(1);
  });
});
