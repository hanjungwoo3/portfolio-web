// 다중 lightweight-charts 간 crosshair (hover) + time-scale (줌/팬) 동기화 훅.
//   각 차트가 onReady 콜백으로 (chart, anchor, onSyncedHover?) 등록.
//   onSyncedHover 가 있으면 자체 처리, 없으면 vertical line 만 그림.

import { useCallback, useRef } from "react";
import type {
  IChartApi, ISeriesApi, SeriesType, Time, MouseEventParams,
} from "lightweight-charts";

// range 동기화 역할 옵션 — 기본은 양방향(both). 마스터/팔로워 구성에 사용.
//   rangeBroadcast=false: 자기 visible range 변화를 남에게 전파 안 함(희박 차트가 남을 클램프하는 것 방지).
//   rangeReceive=false: 남의 range 전파를 받지 않음(전체 데이터 차트가 클램프당하는 것 방지).
export interface SyncOpts { rangeBroadcast?: boolean; rangeReceive?: boolean }

export type SyncRegistrar = (
  chart: IChartApi,
  anchor: ISeriesApi<SeriesType>,
  onSyncedHover?: (time: Time | null) => void,
  opts?: SyncOpts,
) => () => void;

export function useCrosshairSync(): SyncRegistrar {
  const entriesRef = useRef<Array<{
    chart: IChartApi;
    anchor: ISeriesApi<SeriesType>;
    onSyncedHover?: (time: Time | null) => void;
    rangeReceive: boolean;
  }>>([]);
  const isSyncingRangeRef = useRef(false);

  return useCallback((chart, anchor, onSyncedHover, opts) => {
    const rangeBroadcast = opts?.rangeBroadcast !== false;
    const rangeReceive = opts?.rangeReceive !== false;
    const entry = { chart, anchor, onSyncedHover, rangeReceive };
    entriesRef.current.push(entry);

    // ─── 1) Crosshair sync (hover) ────────────────────────────
    const moveHandler = (param: MouseEventParams) => {
      const time = param.time ?? null;
      for (const other of entriesRef.current) {
        if (other.chart === chart) continue;
        try {
          if (other.onSyncedHover) {
            other.onSyncedHover(time);
          } else {
            if (time != null) {
              other.chart.setCrosshairPosition(NaN, time, other.anchor);
            } else {
              other.chart.clearCrosshairPosition();
            }
          }
        } catch { /* 차트 제거됨 — 무시 */ }
      }
    };
    chart.subscribeCrosshairMove(moveHandler);

    // ─── 2) Time scale sync (줌/팬) ───────────────────────────
    //   ⚠️ logical range(바 인덱스)가 아닌 '시간 범위'로 동기화해야 함.
    //   차트마다 포인트 개수가 달라(코스피/코스닥 vs 선물) 인덱스 기준이면
    //   선물의 남는 봉이 오른쪽 밖으로 밀려 '현재'가 영역 밖으로 나감.
    const rangeHandler = () => {
      if (isSyncingRangeRef.current) return;
      const tr = chart.timeScale().getVisibleRange();
      if (!tr) return;
      isSyncingRangeRef.current = true;
      try {
        for (const other of entriesRef.current) {
          if (other.chart === chart) continue;
          if (!other.rangeReceive) continue;   // receive 거부 차트(예: 전체 일봉 가격차트)는 클램프 안 함
          try { other.chart.timeScale().setVisibleRange(tr); }
          catch { /* 차트 제거됨 / 범위 밖 */ }
        }
      } finally {
        isSyncingRangeRef.current = false;
      }
    };
    // broadcast 거부 차트(예: 희박한 수급 패널)는 range 변화를 전파하지 않음 → 남을 클램프 못 함.
    if (rangeBroadcast) chart.timeScale().subscribeVisibleLogicalRangeChange(rangeHandler);

    return () => {
      entriesRef.current = entriesRef.current.filter(e => e !== entry);
      try { chart.unsubscribeCrosshairMove(moveHandler); } catch { /* noop */ }
      if (rangeBroadcast) {
        try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(rangeHandler); }
        catch { /* noop */ }
      }
    };
  }, []);
}
