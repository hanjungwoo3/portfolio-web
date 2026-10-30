// 리튬·니켈 24시간 카드 — 시나 분봉 두 형식(국내 5분봉 배열 / 해외 당일 1분봉 minLine_1d)을 같은 [시각, 가격] 으로
import { describe, expect, it } from "vitest";
import { parseSinaMinLine } from "../api";

describe("parseSinaMinLine", () => {
  it("국내 선물 5분봉(리튬 LC0) — 베이징 시각", () => {
    const t = `/*<script>location.href='//sina.com';</script>*/\nx=([{"d":"2026-10-30 09:05:00","o":"1","h":"1","l":"1","c":"88400.000","v":"1"},{"d":"2026-10-30 09:00:00","c":"88500.000"}]);`;
    const r = parseSinaMinLine(t);
    expect(r).toHaveLength(2);
    expect(r[0]).toEqual([Date.parse("2026-10-30T01:00:00Z"), 88500]);   // 시각 순으로 정렬
    expect(r[1][1]).toBe(88400);
  });
  it("해외 선물 당일 1분봉(니켈 NID) — 첫 줄은 날짜가 앞에, 시각은 마지막 칸", () => {
    const t = `x=({"minLine_1d":[["2026-10-30","15536.000","lme","","09:00","15475.000","34","0","15512.485","2026-10-30 09:00:00"],["09:01","15460.000","20","0","15494.971","2026-10-30 09:01:00"]]});`;
    const r = parseSinaMinLine(t);
    expect(r.map(x => x[1])).toEqual([15536, 15460]);
    expect(r[1][0] - r[0][0]).toBe(60_000);
  });
});
