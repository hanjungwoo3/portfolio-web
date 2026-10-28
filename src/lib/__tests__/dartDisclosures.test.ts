import { describe, expect, it } from "vitest";
import { parseDartList, normCorp } from "../dartDisclosures";
import html from "./fixtures/dart_list_20261027_p1.html?raw";
describe("parseDartList — DART 오늘의 공시 실제 응답(2026-10-27 1페이지)", () => {
  const { rows, total } = parseDartList(html, "2026-10-27");
  it("전체 건수·줄", () => {
    expect(total).toBe(431);
    expect(rows.length).toBe(12);
  });
  it("줄 필드 — 시각·시장·회사·제목·제출인·링크", () => {
    const r = rows.find(x => x.corp === "스모트로닉")!;
    expect(r.time).toBe("18:04");
    expect(r.market).toBe("코스닥");
    expect(r.corpCode).toBe("00301422");
    expect(r.title).toBe("불성실공시법인미지정 (지정유예)");
    expect(r.submitter).toBe("코스닥시장본부");
    expect(r.url).toBe("https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20261027900703");
  });
  it("회사명 정규화 — (주)·공백 무시", () => {
    expect(normCorp("(주) 현대 자동차")).toBe(normCorp("현대자동차"));
  });
});
