// 히트맵 색 — 한국식(빨강 상승 / 파랑 하락), sat(%) 에서 포화. 히트맵 탭·심플 보기 히트맵이 같은 색을 쓴다.
const mix = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
export function heatColor(pct: number, sat = 3): string {
  const t = Math.max(-1, Math.min(1, pct / sat));
  const g = [71, 85, 105];   // slate-600 (보합)
  if (t >= 0) { const r = [190, 30, 45]; const k = t; return `rgb(${mix(g[0], r[0], k)},${mix(g[1], r[1], k)},${mix(g[2], r[2], k)})`; }
  const b = [29, 78, 216];   // blue-700
  const k = -t; return `rgb(${mix(g[0], b[0], k)},${mix(g[1], b[1], k)},${mix(g[2], b[2], k)})`;
}

// TradingView 섹터(영문) → 한글
const SECTOR_KR: Record<string, string> = {
  "Commercial Services": "상업 서비스",
  "Communications": "커뮤니케이션",
  "Consumer Durables": "소비자 내구재",
  "Consumer Non-Durables": "소비재 비내구재",
  "Consumer Services": "소비자 서비스",
  "Distribution Services": "유통 서비스",
  "Electronic Technology": "전자 기술",
  "Energy Minerals": "에너지 광물",
  "Finance": "금융",
  "Health Services": "의료 서비스",
  "Health Technology": "의료 기술",
  "Industrial Services": "산업 서비스",
  "Miscellaneous": "기타",
  "Non-Energy Minerals": "비에너지 광물",
  "Process Industries": "공정 산업",
  "Producer Manufacturing": "생산자 제조",
  "Retail Trade": "소매업",
  "Technology Services": "기술 서비스",
  "Transportation": "운송",
  "Utilities": "유틸리티",
};
export const sectorKr = (s: string) => SECTOR_KR[s] ?? s;
