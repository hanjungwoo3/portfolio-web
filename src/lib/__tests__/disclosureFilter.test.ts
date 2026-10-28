import { describe, expect, it } from "vitest";
import { classifyDisclosure } from "../disclosureFilter";

describe("classifyDisclosure — 실제 공시 제목(사용자 화면 2026-10-28)", () => {
  it.each([
    ["연결재무제표기준영업(잠정)실적(공정공시)", "실적"],
    ["현금ㆍ현물배당 결정", "배당"],
    ["현금ㆍ현물배당을 위한 주주명부폐쇄(기준일) 결정", "배당"],
    ["자기주식 취득 결정", "자사주"],
    ["(정정)주식 소각 결정", "자사주"],
    ["(정정)기업설명회(IR) 개최(안내공시)", "IR"],
    ["풍문 또는 보도에 대한 해명(미확정)", "해명"],
    ["단일판매ㆍ공급계약체결", "계약"],
    ["주식등의대량보유상황보고서(일반)", "지분"],
  ])("%s → %s, 중요", (title, cat) => {
    const r = classifyDisclosure(title);
    expect(r.cat).toBe(cat);
    expect(r.noise).toBe(false);
  });
  it.each([
    "주식선물ㆍ주식옵션 2단계 가격제한폭 확대요건 도달(하락)",
    "삼성 KODEX 코스닥150증권상장지수투자신탁[주식] ETF기타시장안내",
    "임원ㆍ주요주주특정증권등소유상황보고서",
    "증권발행실적보고서",
    "[기재정정]분기보고서 (2026.06)",
  ])("%s → 잡음(기본 숨김)", title => {
    expect(classifyDisclosure(title).noise).toBe(true);
  });
  it("정정 표시", () => {
    expect(classifyDisclosure("(정정)기업설명회(IR) 개최(안내공시)").corrected).toBe(true);
  });
});
