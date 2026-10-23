// 넓은 캔들 — lightweight-charts 커스텀 시리즈.
//   표준 CandlestickSeries 는 봉 폭이 가로축 한 칸(barSpacing)이라, 1분 투자자 선과 같은 차트에 10분 봉을 그리면
//   1분 폭으로 가늘게 나왔다(사용자 지적 2026-10-23). 여기선 봉이 **다음 봉 시작 칸까지** 차지하게 그린다.
//   데이터는 묶음마다 하나(time = 묶음 첫 자료 시각) — 다음 봉의 x 가 곧 이 봉의 오른쪽 끝.
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

export interface WideCandleData extends CustomData<Time> {
  time: Time;
  open: number; high: number; low: number; close: number;
}

const UP_FILL = "rgba(220,38,38,0.35)", UP_LINE = "rgba(220,38,38,0.65)";
const DN_FILL = "rgba(37,99,235,0.35)", DN_LINE = "rgba(37,99,235,0.65)";

class WideCandleRenderer implements ICustomSeriesPaneRenderer {
  private _data: PaneRendererCustomData<Time, WideCandleData> | null = null;
  update(data: PaneRendererCustomData<Time, WideCandleData>): void { this._data = data; }

  draw(target: CanvasRenderingTarget2D, priceToCoordinate: PriceToCoordinateConverter): void {
    const data = this._data;
    if (!data || data.bars.length === 0 || !data.visibleRange) return;
    const { bars } = data;
    const from = Math.max(0, data.visibleRange.from - 1), to = Math.min(bars.length, data.visibleRange.to + 1);
    target.useBitmapCoordinateSpace(scope => {
      const ctx = scope.context;
      const hpr = scope.horizontalPixelRatio, vpr = scope.verticalPixelRatio;
      const half = data.barSpacing / 2;
      let prevW = data.barSpacing;
      for (let i = from; i < to; i++) {
        const bar = bars[i], d = bar.originalData;
        if (!d || d.open == null) continue;
        // 칸 = 이 봉 시작 칸 왼쪽 끝 ~ 다음 봉 시작 칸 왼쪽 끝. 마지막 봉은 앞 봉 폭만큼
        const x0 = bar.x - half;
        const w = i + 1 < bars.length ? bars[i + 1].x - bar.x : prevW;
        prevW = w;
        const gap = Math.max(1, w * 0.15);
        const left = (x0 + gap / 2) * hpr, width = Math.max(1, (w - gap) * hpr);
        const cx = (x0 + w / 2) * hpr;
        const yo = priceToCoordinate(d.open), yc = priceToCoordinate(d.close);
        const yh = priceToCoordinate(d.high), yl = priceToCoordinate(d.low);
        if (yo == null || yc == null || yh == null || yl == null) continue;
        const up = d.close >= d.open;
        const top = Math.round(Math.min(yo, yc) * vpr), h = Math.max(1, Math.round(Math.abs(yc - yo) * vpr));
        // 꼬리는 몸통 밖(위·아래)만 — 반투명 몸통 속으로 가운데 선이 비쳐 보였다(사용자 지적)
        ctx.fillStyle = up ? UP_LINE : DN_LINE;
        const wx = Math.round(cx - hpr / 2), ww = Math.max(1, Math.round(hpr));
        const yhB = Math.round(yh * vpr), ylB = Math.round(yl * vpr);
        if (top > yhB) ctx.fillRect(wx, yhB, ww, top - yhB);
        if (ylB > top + h) ctx.fillRect(wx, top + h, ww, ylB - top - h);
        ctx.fillStyle = up ? UP_FILL : DN_FILL;
        ctx.fillRect(Math.round(left), top, Math.round(width), h);
        ctx.strokeStyle = up ? UP_LINE : DN_LINE;
        ctx.lineWidth = Math.max(1, hpr);
        ctx.strokeRect(Math.round(left) + 0.5, top + 0.5, Math.max(0, Math.round(width) - 1), Math.max(0, h - 1));
      }
    });
  }
}

export class WideCandleSeries implements ICustomSeriesPaneView<Time, WideCandleData> {
  private _renderer = new WideCandleRenderer();
  priceValueBuilder(d: WideCandleData): CustomSeriesPricePlotValues { return [d.low, d.high, d.close]; }
  isWhitespace(d: WideCandleData | CustomSeriesWhitespaceData<Time>): d is CustomSeriesWhitespaceData<Time> {
    return (d as WideCandleData).close == null;
  }
  renderer(): ICustomSeriesPaneRenderer { return this._renderer; }
  update(data: PaneRendererCustomData<Time, WideCandleData>): void { this._renderer.update(data); }
  defaultOptions(): CustomSeriesOptions { return customSeriesDefaultOptions; }
}
