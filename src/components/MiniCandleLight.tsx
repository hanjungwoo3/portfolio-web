// lightweight-charts 기반 미니 캔들 차트 — sparkline 자리에 들어가는 컴팩트 버전.
// 축/라벨/그리드/스크롤 모두 끔. 캔들 + 이동평균선만.
// 한국식 색: 양봉 빨강 / 음봉 파랑.

import { useEffect, useRef } from "react";
import {
  createChart, ColorType, LineStyle,
  CandlestickSeries, LineSeries,
  type IChartApi,
} from "lightweight-charts";

const UP_COLOR  = "#dc2626";
const DN_COLOR  = "#2563eb";
// MA — amber 살짝 투명. 너무 굵으면 캔들 가림.
const MA_COLOR  = "rgba(245, 158, 11, 0.55)";

interface OHLC {
  date: string;       // YYYY-MM-DD (year-only 데이터는 "YYYY-01-01" 로 보정)
  open: number; high: number; low: number; close: number;
}

export interface Overlay {
  values: (number | null)[];   // data 길이와 동일
  color: string;
  width?: number;              // default 1
  dashed?: boolean;
}

interface Props {
  data: OHLC[];
  ma?: (number | null)[];      // amber MA — 호환성 유지. 내부적으로 overlay 로 변환.
  overlays?: Overlay[];        // 추가 라인들 (BB / SuperTrend 등)
  height?: number;
  className?: string;
}

// "2020" / "2020-01" 같은 부분 날짜 → 풀 ISO 로 보정 (lightweight-charts 요구)
function normalizeDate(d: string): string {
  if (/^\d{4}$/.test(d)) return `${d}-01-01`;
  if (/^\d{4}-\d{2}$/.test(d)) return `${d}-01`;
  return d;
}

export function MiniCandleLight({ data, ma, overlays, height = 128, className = "" }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || data.length === 0) return;

    const chart: IChartApi = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#94a3b8",
        attributionLogo: false,           // TV 로고 숨김
      },
      rightPriceScale: {
        visible: true,
        borderVisible: false,
        entireTextOnly: true,
      },
      leftPriceScale:  { visible: false },
      timeScale: {
        visible: true,
        borderVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
        lockVisibleTimeRangeOnResize: true,
      },
      crosshair: { mode: 0 },             // CrosshairMode.Hidden 해당
      handleScroll: false,
      handleScale: false,
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: false },
      },
    });

    const candle = chart.addSeries(CandlestickSeries, {
      upColor: UP_COLOR, borderUpColor: UP_COLOR, wickUpColor: UP_COLOR,
      downColor: DN_COLOR, borderDownColor: DN_COLOR, wickDownColor: DN_COLOR,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    candle.setData(data.map(d => ({
      time: normalizeDate(d.date),
      open: d.open, high: d.high, low: d.low, close: d.close,
    })));

    // 모든 오버레이를 단일 리스트로 통합 (ma 는 amber 라인으로 변환)
    const allOverlays: Overlay[] = [];
    if (ma) allOverlays.push({ values: ma, color: MA_COLOR, width: 1 });
    if (overlays) allOverlays.push(...overlays);

    for (const ov of allOverlays) {
      const line = chart.addSeries(LineSeries, {
        color: ov.color,
        lineWidth: (ov.width ?? 1) as 1 | 2 | 3 | 4,
        lineStyle: ov.dashed ? LineStyle.Dashed : LineStyle.Solid,
        priceLineVisible: false, lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      const pts: { time: string; value: number }[] = [];
      for (let i = 0; i < data.length; i++) {
        const v = ov.values[i];
        if (v == null) continue;
        pts.push({ time: normalizeDate(data[i].date), value: v });
      }
      if (pts.length >= 2) line.setData(pts);
    }

    chart.timeScale().fitContent();

    return () => { chart.remove(); };
  }, [data, ma, overlays]);

  return (
    <div ref={containerRef} className={className} style={{ height, width: "100%" }} />
  );
}
