import { describe, it, expect } from "vitest";
import { parseKisTicks } from "./kisWs";

// 공식 예제 H0STCNT0 46필드 — 두 건 이어 붙은 메시지
const rec = (code: string, hhmmss: string, price: number, vol: number, cum: number, dvsn: string) => {
  const f = Array(46).fill("0");
  f[0] = code; f[1] = hhmmss; f[2] = String(price); f[12] = String(vol); f[13] = String(cum); f[21] = dvsn;
  return f.join("^");
};
describe("parseKisTicks", () => {
  it("건수만큼 나눠 매수·매도로 바꾼다(장전 3 은 뺀다)", () => {
    const raw = `0|H0STCNT0|003|${rec("005930", "093015", 71000, 10, 1000, "1")}^${rec("005930", "093016", 70900, 5, 1005, "5")}^${rec("005930", "085959", 70000, 1, 1, "3")}`;
    const t = parseKisTicks(raw);
    expect(t.map(x => [x.code, x.tick.time, x.tick.price, x.tick.volume, x.tick.side, x.tick.cum])).toEqual([
      ["005930", "09:30:15", 71000, 10, "BUY", 1000],
      ["005930", "09:30:16", 70900, 5, "SELL", 1005],
    ]);
  });
  it("다른 TR·깨진 메시지는 무시", () => {
    expect(parseKisTicks("0|H0STASP0|001|x^y")).toEqual([]);
    expect(parseKisTicks("garbage")).toEqual([]);
  });
});
