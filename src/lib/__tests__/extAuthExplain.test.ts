import { describe, it, expect } from "vitest";
import { explainExtAuthFailure } from "../googleAuth";

// 확장 인증 실패 → 사용자가 할 일. 크롬 원문(영어)을 그대로 보여 주면 못 읽는다(사용자 문의 2026-10-12).
describe("확장 인증 실패 안내", () => {
  it("크롬 프로필 로그인이 없으면 로그인하라고", () => {
    expect(explainExtAuthFailure("The user is not signed in.")).toMatch(/크롬 프로필에 구글 계정 로그인/);
  });
  it("동의를 안 했으면 허용하라고", () => {
    expect(explainExtAuthFailure("The user did not approve access.")).toMatch(/허용/);
  });
  it("응답이 없으면 새로고침·업데이트", () => {
    expect(explainExtAuthFailure("extension timeout")).toMatch(/새로고침/);
  });
  it("모르는 사유는 원문을 붙여 보여 준다", () => {
    expect(explainExtAuthFailure("weird")).toContain("weird");
  });
});
