// account 정규화 — 빈/공백/"보유" 문자열은 모두 "" (default group) 로 통일.
// "보유" 는 표시용 라벨이지 저장값이 아니지만, 과거 데이터/import 등으로
// account="보유" 가 섞이면 빈 문자열 그룹과 별개로 취급되어 "보유" 탭이 2개로
// 보이는 버그가 생김 — 런타임 정규화로 해결.
export function normalizeAccount(acc: string | null | undefined): string {
  const s = (acc ?? "").trim();
  if (s === "보유") return "";
  return s;
}
