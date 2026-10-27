// 같은 증권사 순매매 — 양쪽 상위 5에 다 든 곳만 계산, 한쪽만이면 지어내지 않는다(사용자 화면 2026-10-27 값).
import { describe, expect, it } from "vitest";
import { brokerNets } from "../../components/StockPopupRow";
const E = 1e8;
const side = (name: string, val: number) => ({ name, vol: 0, val: val * E, foreign: false });
const br = {
  rows: [
    { ask: side("키움증권", 169), bid: side("키움증권", 245) },
    { ask: side("신한증권", 141), bid: side("신한증권", 93) },
    { ask: side("한국증권", 89), bid: side("한국증권", 84) },
    { ask: side("미래에셋증권", 59), bid: side("미래에셋증권", 82) },
    { ask: side("NH투자증권", 41), bid: side("삼성증권", 54) },
  ],
  foreign: { askVol: 0, askVal: 0, bidVol: 0, bidVal: 0 }, updatedAt: "",
};
describe("brokerNets", () => {
  it("양쪽에 다 든 4곳은 매수−매도, 큰 순매수부터", () => {
    const r = brokerNets(br);
    expect(r.both.map(x => [x.name, Math.round(x.net / E)])).toEqual([["키움증권", 76], ["미래에셋증권", 23], ["한국증권", -5], ["신한증권", -48]]);
  });
  it("한쪽에만 든 곳은 따로", () => {
    const r = brokerNets(br);
    expect(r.onlyAsk.map(x => x.name)).toEqual(["NH투자증권"]);
    expect(r.onlyBid.map(x => x.name)).toEqual(["삼성증권"]);
  });
});
