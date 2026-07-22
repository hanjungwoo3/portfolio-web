// 히트맵 탭 딥링크 — 카드(ValueupCard 등)에서 특정 소스/크기모드로 히트맵을 열도록 요청.
//   ValueupMiniCard 는 트리 깊숙이 있어 prop 쓰레딩이 번거로우므로 전역 이벤트로 결합.
//   App / MobileSimpleView 가 "goto-heatmap" 을 듣고 히트맵 탭으로 전환,
//   HeatmapTab 은 마운트 시 takePendingHeatmap() 으로 초기 소스·크기모드를 집어온다.
import type { HeatmapSource } from "./api";

export const GOTO_HEATMAP_EVENT = "goto-heatmap";
export type HeatmapSizeMode = "marketCap" | "volume" | "value";
export interface HeatmapRequest { source: HeatmapSource; sizeMode?: HeatmapSizeMode; }

// 지수 카드 → 히트맵 소스 매핑. 이 심볼들은 카드의 🔍AI 버튼 대신 히트맵 링크를 노출.
//   KODEX 200 → KOSPI 200 히트맵 / KODEX 코스닥150 → KOSDAQ 150 히트맵.
export const CARD_HEATMAP_LINK: Record<string, HeatmapSource> = {
  "069500.KS": "kospi200",
  "229200.KS": "kosdaq150",
};

let pending: HeatmapRequest | null = null;

// 히트맵 탭을 특정 소스로 열도록 요청 (탭 전환은 리스너가 수행).
export function requestHeatmap(source: HeatmapSource, opts?: { sizeMode?: HeatmapSizeMode }): void {
  pending = { source, sizeMode: opts?.sizeMode };
  window.dispatchEvent(new CustomEvent(GOTO_HEATMAP_EVENT));
}
// HeatmapTab 마운트 시 1회 소비 (없으면 null).
export function takePendingHeatmap(): HeatmapRequest | null {
  const p = pending;
  pending = null;
  return p;
}
