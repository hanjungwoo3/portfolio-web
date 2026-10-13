// 심플 보기 히트맵의 크기·색 기준 — 컴포넌트 파일에서 상수를 내보내면 HMR 이 깨져 lib 로 뺐다.
import type { HeatmapItem } from "./api";

export type HeatSizeBy = "value" | "marketCap" | "traded" | "volume" | "change" | "equal";
export type HeatGroupBy = "none" | "sector" | "dir";
export type HeatColorBy = "pnl" | "d1" | "w" | "m1" | "m3" | "m6" | "ytd" | "y";
export const HEAT_SIZE_OPTS: { key: HeatSizeBy; label: string }[] = [
  { key: "value", label: "보유금액" }, { key: "marketCap", label: "시가총액" },
  { key: "traded", label: "거래대금" }, { key: "volume", label: "거래량" },
  { key: "change", label: "등락률(변동폭)" }, { key: "equal", label: "같은 크기" },
];
// sat = 그 값에서 색이 가장 진해진다 — 히트맵 탭과 같은 값(기간이 길수록 크게)
export const HEAT_COLOR_OPTS: { key: HeatColorBy; label: string; sat: number; field?: (it: HeatmapItem) => number }[] = [
  { key: "pnl", label: "내 수익률(평단 대비)", sat: 20 },   // 보유 종목만 — 관심종목은 회색(2026-10-13)
  { key: "d1", label: "1일 등락률", sat: 3 },
  { key: "w", label: "1주 수익률", sat: 8, field: it => it.perfW },
  { key: "m1", label: "1개월 수익률", sat: 15, field: it => it.perf1M },
  { key: "m3", label: "3개월 수익률", sat: 25, field: it => it.perf3M },
  { key: "m6", label: "6개월 수익률", sat: 30, field: it => it.perf6M },
  { key: "ytd", label: "연초대비(YTD)", sat: 35, field: it => it.perfYTD },
  { key: "y", label: "1년 수익률", sat: 40, field: it => it.perfY },
];
// 그룹 — 히트맵 탭과 같은 셋. 방향은 '색 기준' 값으로 나눈다(색과 묶음이 어긋나지 않게).
export const HEAT_GROUP_OPTS: { key: HeatGroupBy; label: string }[] = [
  { key: "none", label: "없음" }, { key: "sector", label: "섹터" }, { key: "dir", label: "등락 방향" },
];
// 부호 필터 — 색 기준 값이 +인 종목만 / −인 종목만(2026-10-13). 값이 없는 종목은 전체에서만 보인다.
export type HeatSign = "all" | "up" | "down";
export const HEAT_SIGN_OPTS: { key: HeatSign; label: string }[] = [
  { key: "all", label: "전체" }, { key: "up", label: "+만" }, { key: "down", label: "−만" },
];
