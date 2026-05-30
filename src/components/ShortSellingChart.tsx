// 공매도 미니 차트 — 외국인/기관계/연기금 차트 옆에 4번째로 표시
//   라인 (우측 축, 가격 단위): 공매도 평단가 + 종가 → 둘의 거리가 곧 숏 손익
//   히스토그램 (좌측 축, %): 일별 공매도 비중 (%)
//   crosshair sync 지원 (다른 차트와 동일 패턴, anchor = 종가 라인)

import { useEffect, useRef } from "react";
import {
  createChart,
  ColorType,
  LineSeries,
  AreaSeries,
  HistogramSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type SeriesType,
  type Time,
  type LogicalRange,
  type MouseEventParams,
} from "lightweight-charts";
import type { PricePoint, ShortSellingPoint } from "../lib/api";

const PRICE_COLOR     = "#dc2626";    // 종가 라인 — 주가 차트와 동일 (red-600, 한국식 상승색)
const SHORT_AVG_COLOR = "#2563eb";    // 공매도 평단 면적 — 하락 베팅 의미 (blue-600)
// 공매도 비중 막대 — 갭 부호에 따라 색 분기 (빨강=공매도손실 / 파랑=공매도수익)
const RATIO_BAR_UP_COLOR = "rgba(220, 38, 38, 0.5)";   // red-600 50% — 갭 +
const RATIO_BAR_DN_COLOR = "rgba(37, 99, 235, 0.5)";   // blue-600 50% — 갭 -
const RATIO_BAR_NEUTRAL  = "rgba(156, 163, 175, 0.4)"; // gray-400 — 평단 데이터 없음

interface Props {
  shortSelling: ShortSellingPoint[];
  prices: PricePoint[];
  dates: string[];   // X 축 통일용 (다른 차트와 같은 날짜 배열)
  onReady?: (
    chart: IChartApi,
    anchor: ISeriesApi<SeriesType>,
    onSyncedHover?: (time: Time | null) => void,
  ) => (() => void) | void;
}

export function ShortSellingChart({ shortSelling, prices, dates, onReady }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const visibleRangeRef = useRef<LogicalRange | null>(null);

  // 헤더: 최신 평단 + 같은 날짜 종가 대비 차이 (공매도 데이터 1-2일 지연 → 최신 종가와 어긋남 방지)
  const lastShort = [...shortSelling].reverse().find(s => s.avgPrice > 0);
  const matchingClose = lastShort
    ? prices.find(p => p.date === lastShort.date)?.close
    : undefined;
  const lastDiff = lastShort && matchingClose && matchingClose > 0
    ? ((matchingClose - lastShort.avgPrice) / lastShort.avgPrice) * 100
    : null;

  useEffect(() => {
    if (!containerRef.current) return;
    if (dates.length < 2) return;

    const chart: IChartApi = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#374151",
        fontSize: 10,
        fontFamily: "system-ui, -apple-system, sans-serif",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "#f3f4f6" },
        horzLines: { color: "#f3f4f6" },
      },
      rightPriceScale: {
        borderColor: "#e5e7eb",
        scaleMargins: { top: 0.08, bottom: 0.32 },
      },
      leftPriceScale: {
        visible: false,
        borderColor: "#e5e7eb",
        scaleMargins: { top: 0.08, bottom: 0.32 },
      },
      timeScale: {
        borderColor: "#e5e7eb",
        timeVisible: false,
        secondsVisible: false,
      },
      crosshair: {
        mode: 1,
        vertLine: {
          color: "#9ca3af", width: 1, style: LineStyle.Dotted,
          labelBackgroundColor: "#475569",
        },
        horzLine: {
          color: "#9ca3af", width: 1, style: LineStyle.Dotted,
          labelVisible: false,
        },
      },
      autoSize: true,
    });

    // ─── 데이터 lookup ──────────────────────────────────────
    const shortMap = new Map<string, ShortSellingPoint>();
    for (const s of shortSelling) shortMap.set(s.date, s);
    const priceMap = new Map<string, number>();
    for (const p of prices) priceMap.set(p.date, p.close);

    // ─── 공매도 비중 히스토그램 (좌측 축, hidden) — 갭 부호로 색 분기 ──
    const ratioBars = chart.addSeries(HistogramSeries, {
      priceScaleId: "left",
      priceFormat: { type: "custom", formatter: (v: number) => `${v.toFixed(2)}%` },
      base: 0,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    chart.priceScale("left").applyOptions({
      scaleMargins: { top: 0.7, bottom: 0 },   // 하단 30% 영역만 사용
    });
    const ratioData = dates
      .map(d => {
        const s = shortMap.get(d);
        if (!s) return null;
        const close = priceMap.get(d);
        let color = RATIO_BAR_NEUTRAL;
        if (close !== undefined && s.avgPrice > 0) {
          const gap = close - s.avgPrice;
          color = gap > 0 ? RATIO_BAR_UP_COLOR
                : gap < 0 ? RATIO_BAR_DN_COLOR
                : RATIO_BAR_NEUTRAL;
        }
        return { time: d as Time, value: s.ratio, color };
      })
      .filter((x): x is { time: Time; value: number; color: string } => x !== null);
    ratioBars.setData(ratioData);

    // ─── 공매도 평단 (배경 면적, 핑크 그라디언트) ─────────────
    // line 자체는 숨기고 fill 만 — 공매도 세력이 위치한 "구역" 시각화
    const avgArea = chart.addSeries(AreaSeries, {
      priceScaleId: "right",
      lineColor: "rgba(0,0,0,0)",   // 라인 숨김 (transparent)
      lineWidth: 1,
      topColor: "rgba(37, 99, 235, 0.22)",     // blue-600 22%
      bottomColor: "rgba(37, 99, 235, 0.02)",
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    const avgData = dates
      .map(d => {
        const s = shortMap.get(d);
        return s && s.avgPrice > 0 ? { time: d as Time, value: s.avgPrice } : null;
      })
      .filter((x): x is { time: Time; value: number } => x !== null);
    avgArea.setData(avgData);

    // ─── 종가 라인 (빨강 — 주가 차트와 동일) — 공매도 면적 위로 부각 ──
    const closeSeries = chart.addSeries(LineSeries, {
      priceScaleId: "right",
      color: PRICE_COLOR,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    const closeData = dates
      .map(d => {
        const c = priceMap.get(d);
        return c !== undefined ? { time: d as Time, value: c } : null;
      })
      .filter((x): x is { time: Time; value: number } => x !== null);
    closeSeries.setData(closeData);

    // ─── 줌 상태 복원/저장 ──────────────────────────────────
    if (visibleRangeRef.current) {
      chart.timeScale().setVisibleLogicalRange(visibleRangeRef.current);
    } else {
      chart.timeScale().fitContent();
    }
    const rangeHandler = (range: LogicalRange | null) => {
      if (range) visibleRangeRef.current = range;
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(rangeHandler);

    const hideTooltip = () => {
      if (tooltipRef.current) tooltipRef.current.style.display = "none";
    };

    // 툴팁 위치 — (timeScale.x, closeSeries.y) 교차점, sync 시에도 동일
    const updateTooltipForTime = (time: Time): boolean => {
      const tooltip = tooltipRef.current;
      const container = containerRef.current;
      if (!tooltip || !container) return false;

      const x = chart.timeScale().timeToCoordinate(time);
      const close = priceMap.get(String(time));
      if (x == null || close === undefined) { hideTooltip(); return false; }
      const y = closeSeries.priceToCoordinate(close);
      if (y == null) { hideTooltip(); return false; }

      const s = shortMap.get(String(time));
      let content = `<div class="text-[10px] text-gray-400 mb-0.5">${String(time)}</div>`;
      content += `<div><span class="text-gray-500">종가 </span><span style="color:${PRICE_COLOR}">${close.toLocaleString()}원</span></div>`;
      if (s && s.avgPrice > 0) {
        const diff = ((close - s.avgPrice) / s.avgPrice) * 100;
        const diffColor = diff >= 0 ? "#dc2626" : "#2563eb";   // 양수=숏손실(빨강), 음수=숏수익(파랑)
        content += `<div><span class="text-gray-500">공매도 평단 </span><span style="color:${SHORT_AVG_COLOR}" class="font-bold">${s.avgPrice.toLocaleString()}원</span></div>`;
        content += `<div><span class="text-gray-500">갭 </span><span style="color:${diffColor}">${diff >= 0 ? "+" : ""}${diff.toFixed(2)}%</span></div>`;
        content += `<div><span class="text-gray-500">비중 </span><span>${s.ratio.toFixed(2)}%</span></div>`;
      }
      tooltip.innerHTML = content;
      tooltip.style.display = "block";

      const W = container.clientWidth;
      const H = container.clientHeight;
      const tw = tooltip.offsetWidth || 110;
      const th = tooltip.offsetHeight || 70;
      let left = x + 12;
      let top = y + 12;
      if (left + tw > W - 4) left = x - tw - 12;
      if (top + th > H - 4) top = y - th - 12;
      if (left < 4) left = 4;
      if (top < 4) top = 4;
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
      return true;
    };

    const tooltipHandler = (param: MouseEventParams) => {
      if (!param.time) { hideTooltip(); return; }
      updateTooltipForTime(param.time);
    };
    chart.subscribeCrosshairMove(tooltipHandler);

    const onSyncedHover = (time: Time | null) => {
      if (time == null) {
        chart.clearCrosshairPosition();
        hideTooltip();
        return;
      }
      const close = priceMap.get(String(time));
      if (close !== undefined) chart.setCrosshairPosition(close, time, closeSeries);
      updateTooltipForTime(time);
    };

    // sync anchor — 종가 라인 (다른 차트 hover 시 종가 위치에 마커)
    const cleanupSync = onReady?.(chart, closeSeries, onSyncedHover);

    return () => {
      if (typeof cleanupSync === "function") cleanupSync();
      try { chart.unsubscribeCrosshairMove(tooltipHandler); } catch { /* noop */ }
      try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(rangeHandler); }
      catch { /* chart already removed */ }
      chart.remove();
    };
  }, [shortSelling, prices, dates, onReady]);

  return (
    <div className="border border-gray-200 rounded p-2 bg-white">
      <div className="flex items-baseline gap-2 text-xs mb-1 flex-wrap">
        <span className="font-bold" style={{ color: SHORT_AVG_COLOR }}>공매도 평단</span>
        {lastShort && (
          <span className="tabular-nums font-bold" style={{ color: SHORT_AVG_COLOR }}>
            {lastShort.avgPrice.toLocaleString()}원
          </span>
        )}
        {lastDiff !== null && (
          <span className={`tabular-nums ${lastDiff >= 0 ? "text-rose-600" : "text-blue-600"}`}>
            ({lastDiff >= 0 ? "+" : ""}{lastDiff.toFixed(2)}%)
          </span>
        )}
        {/* 종가 범례 — 주가 차트와 동일한 빨강 라인 */}
        <span className="flex items-center gap-1 ml-1">
          <span className="inline-block w-3 h-0.5" style={{ background: PRICE_COLOR }}></span>
          <span style={{ color: PRICE_COLOR }} className="font-medium">종가</span>
        </span>
      </div>
      <div className="relative">
        <div ref={containerRef} className="w-full h-[180px]" />
        <div ref={tooltipRef}
             className="absolute pointer-events-none bg-white border border-gray-200 rounded shadow-md
                        px-2 py-1 text-xs text-gray-700 tabular-nums z-50 leading-snug"
             style={{ display: "none" }} />
      </div>
    </div>
  );
}

export default ShortSellingChart;
