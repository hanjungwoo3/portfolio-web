// 일별 순매수 다이버징 스택 막대 — lightweight-charts 커스텀 시리즈.
//   체크된 주체를 각자 색으로 쌓되, 양수는 0 위로 / 음수는 0 아래로 쌓음(제로섬 시각화).
//   ⚠️ 표준 HistogramSeries 는 base=0 고정이라 세그먼트별 시작점(스택)을 못 줌 →
//      겹치기 트릭은 반투명 시 혼색이 생김. 여기선 각 세그먼트가 자기 [b0,b1] 구간만 그려
//      세그먼트끼리 안 겹치므로 globalAlpha 0.5(반투명)여도 각자 자기색이 깔끔히 유지됨.
import {
  customSeriesDefaultOptions,
  type ICustomSeriesPaneView,
  type ICustomSeriesPaneRenderer,
  type PaneRendererCustomData,
  type CustomSeriesPricePlotValues,
  type CustomData,
  type CustomSeriesWhitespaceData,
  type CustomSeriesOptions,
  type PriceToCoordinateConverter,
  type Time,
} from "lightweight-charts";
import type { CanvasRenderingTarget2D } from "fancy-canvas";

export interface StackSegment { value: number; color: string }
export interface StackBarData extends CustomData<Time> {
  time: Time;
  segments: StackSegment[];   // 스택 순서(INTRADAY_SERIES 순, 개인이 맨 안쪽=0쪽)
}

class StackedNetRenderer implements ICustomSeriesPaneRenderer {
  private _data: PaneRendererCustomData<Time, StackBarData> | null = null;
  update(data: PaneRendererCustomData<Time, StackBarData>): void { this._data = data; }

  draw(target: CanvasRenderingTarget2D, priceToCoordinate: PriceToCoordinateConverter): void {
    const data = this._data;
    if (!data || data.bars.length === 0 || !data.visibleRange) return;
    const range = data.visibleRange;
    target.useBitmapCoordinateSpace(scope => {
      const ctx = scope.context;
      const hpr = scope.horizontalPixelRatio, vpr = scope.verticalPixelRatio;
      const barWidth = Math.max(1, Math.floor(data.barSpacing * 0.6 * hpr));
      ctx.save();
      ctx.globalAlpha = 0.5;                     // 반투명 — 세그먼트 비겹침이라 혼색 없음
      for (let i = range.from; i < range.to; i++) {
        const bar = data.bars[i];
        const item = bar.originalData;
        if (!item || !item.segments) continue;
        const left = Math.round(bar.x * hpr - barWidth / 2);
        let pos = 0, neg = 0;                     // 양수/음수 누적 경계
        for (const seg of item.segments) {
          const v = seg.value;
          if (!v) continue;
          let b0: number, b1: number;
          if (v > 0) { b0 = pos; b1 = pos + v; pos = b1; }
          else { b0 = neg; b1 = neg + v; neg = b1; }
          const y0 = priceToCoordinate(b0), y1 = priceToCoordinate(b1);
          if (y0 == null || y1 == null) continue;
          const top = Math.round(Math.min(y0, y1) * vpr);
          const h = Math.max(1, Math.round(Math.abs(y1 - y0) * vpr));
          ctx.fillStyle = seg.color;
          ctx.fillRect(left, top, barWidth, h);
        }
      }
      ctx.restore();
    });
  }
}

export class StackedNetSeries implements ICustomSeriesPaneView<Time, StackBarData> {
  private _renderer = new StackedNetRenderer();

  // autoscale — 양수합 / 음수합 / 0(현재값). 라이브러리는 최대·최소·현재만 필요.
  priceValueBuilder(d: StackBarData): CustomSeriesPricePlotValues {
    let pos = 0, neg = 0;
    for (const s of d.segments) { if (s.value > 0) pos += s.value; else neg += s.value; }
    return [neg, pos, 0];
  }
  isWhitespace(d: StackBarData | CustomSeriesWhitespaceData<Time>): d is CustomSeriesWhitespaceData<Time> {
    const seg = (d as StackBarData).segments;
    return !seg || seg.length === 0;
  }
  renderer(): ICustomSeriesPaneRenderer { return this._renderer; }
  update(data: PaneRendererCustomData<Time, StackBarData>): void { this._renderer.update(data); }
  defaultOptions(): CustomSeriesOptions { return customSeriesDefaultOptions; }
}
