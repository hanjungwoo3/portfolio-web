// 시간별 투자자 순매수 — 공통 정의 (차트 컴포넌트 lazy 로드와 무관하게 토글 UI 에서 사용).
import type { IntradayFlowPoint } from "./api";

export type IntradayKey = keyof Omit<IntradayFlowPoint, "time">;

// 투자자 정의 — 공통 토글(Section)과 차트(Chart)가 공유. on=기본 표시.
export const INTRADAY_SERIES: { key: IntradayKey; label: string; color: string; on: boolean }[] = [
  { key: "individuals",         label: "개인",     color: "#7c3aed", on: true },
  { key: "foreigners",          label: "외국인",   color: "#ea580c", on: true },
  { key: "institutions",        label: "기관계",   color: "#2563eb", on: true },
  { key: "financialInvestment", label: "금융투자", color: "#0891b2", on: false },
  { key: "pensionFund",         label: "연기금",   color: "#c2410c", on: false },
  { key: "trust",               label: "투신",     color: "#db2777", on: false },
  { key: "insurance",           label: "보험",     color: "#ca8a04", on: false },
  { key: "bank",                label: "은행",     color: "#0d9488", on: false },
  { key: "otherFinancial",      label: "기타금융", color: "#65a30d", on: false },
  { key: "otherCorp",           label: "기타법인", color: "#9333ea", on: false },
];
