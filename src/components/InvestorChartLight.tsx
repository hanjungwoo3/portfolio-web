// 일별 막대 (좌측 축) + 누적 라인 (우측 축) — 외국인/기관/연기금
// crosshair sync 위해 onReady 콜백으로 chart + anchor series 제공.

import { useEffect, useRef } from "react";
import {
  createChart,
  ColorType,
  LineSeries,
  HistogramSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type SeriesType,
  type Time,
  type LogicalRange,
  type MouseEventParams,
} from "lightweight-charts";

interface Props {
  label: string;
  daily: number[];
  cumulative: number[];
  dates: string[];
  barColor: string;
  cumColor: string;
  onReady?: (
    chart: IChartApi,
    anchor: ISeriesApi<SeriesType>,
    onSyncedHover?: (time: Time | null) => void,
  ) => (() => void) | void;
}

function fmtVol(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 100_000_000) return `${sign}${(abs / 100_000_000).toFixed(1)}억`;
  if (abs >= 10_000_000) return `${sign}${(abs / 10_000_000).toFixed(1)}천만`;
  if (abs >= 10_000) return `${sign}${Math.round(abs / 10_000)}만`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`;
  return `${v}`;
}

export function InvestorChartLight({
  label, daily, cumulative, dates, barColor, cumColor, onReady,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const visibleRangeRef = useRef<LogicalRange | null>(null);
  const last = cumulative[cumulative.length - 1] ?? 0;

  useEffect(() => {
    if (!containerRef.current) return;
    if (daily.length < 2) return;

    const chart: IChartApi = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#374151",
        fontSize: 10,
        fontFamily: "system-ui, -apple-system, sans-serif",
      },
      grid: {
        vertLines: { color: "#f3f4f6" },
        horzLines: { color: "#f3f4f6" },
      },
      rightPriceScale: {
        borderColor: "#e5e7eb",
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      leftPriceScale: {
        // 좌측 일별 axis 숨김 — hover 툴팁이 우측 누적 axis 에만 표시되도록.
        // 일별 막대는 그래도 그려지지만 정확한 값은 우측 누적 라벨로 표시.
        visible: false,
        borderColor: "#e5e7eb",
        scaleMargins: { top: 0.08, bottom: 0.08 },
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
          labelBackgroundColor: "#475569",  // slate-600
        },
        horzLine: {
          color: "#9ca3af", width: 1, style: LineStyle.Dotted,
          labelVisible: false,    // 우측 axis hover 라벨 숨김 — HTML 툴팁으로 대체
        },
      },
      autoSize: true,
    });

    // 일별 막대 (좌측 축, 0 기준 양/음)
    const histSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: "left",
      priceFormat: { type: "volume" },
      base: 0,
      color: barColor,
      priceLineVisible: false,    // 현재값 가로 점선 숨김
      lastValueVisible: false,    // 우측/좌측 axis 현재값 라벨 숨김
    });
    // 일별 막대 — 양수(매수): 빨강, 음수(매도): 파랑 (한국식)
    const histData = daily.map((v, i) => ({
      time: dates[i] as Time,
      value: v,
      color: v >= 0 ? "#fecaca" : "#bfdbfe",  // red-200 / blue-200
    }));
    histSeries.setData(histData);

    // 누적 라인 (우측 축)
    const cumSeries = chart.addSeries(LineSeries, {
      priceScaleId: "right",
      color: cumColor,
      lineWidth: 1,
      priceFormat: { type: "volume" },
      priceLineVisible: false,    // 현재값 가로 점선 숨김
      lastValueVisible: false,    // 우측/좌측 axis 현재값 라벨 숨김
    });
    const cumData = cumulative.map((v, i) => ({
      time: dates[i] as Time,
      value: v,
    }));
    cumSeries.setData(cumData);

    // 줌 상태 복원 / 저장
    if (visibleRangeRef.current) {
      chart.timeScale().setVisibleLogicalRange(visibleRangeRef.current);
    } else {
      chart.timeScale().fitContent();
    }
    const rangeHandler = (range: LogicalRange | null) => {
      if (range) visibleRangeRef.current = range;
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(rangeHandler);

    // ─── 데이터 lookup map (hover/sync 공용) ──────────────────
    const dailyMap = new Map<string, number>();
    const cumMap = new Map<string, number>();
    dates.forEach((d, i) => { dailyMap.set(d, daily[i]); cumMap.set(d, cumulative[i]); });

    const hideTooltip = () => {
      if (tooltipRef.current) tooltipRef.current.style.display = "none";
    };

    // 툴팁 위치는 (timeScale.x, cumSeries.y) 교차점 — sync 시에도 동일
    const updateTooltipForTime = (time: Time): boolean => {
      const tooltip = tooltipRef.current;
      const container = containerRef.current;
      if (!tooltip || !container) return false;

      const x = chart.timeScale().timeToCoordinate(time);
      const cumV = cumMap.get(String(time));
      const dailyV = dailyMap.get(String(time));
      if (x == null || cumV === undefined) { hideTooltip(); return false; }
      const y = cumSeries.priceToCoordinate(cumV);
      if (y == null) { hideTooltip(); return false; }

      let content = `<div class="text-[10px] text-gray-400 mb-0.5">${String(time)}</div>`;
      if (dailyV !== undefined) {
        const sign = dailyV >= 0 ? "+" : "";
        const dailyColor = dailyV >= 0 ? "#dc2626" : "#2563eb";  // 매수 빨강 / 매도 파랑
        content += `<div><span class="text-gray-500">일별 </span><span style="color:${dailyColor}">${sign}${fmtVol(dailyV)}주</span></div>`;
      }
      content += `<div><span class="text-gray-500">누적 </span><span style="color:${cumColor}" class="font-bold">${fmtVol(cumV)}주</span></div>`;
      tooltip.innerHTML = content;
      tooltip.style.display = "block";

      const W = container.clientWidth;
      const H = container.clientHeight;
      const tw = tooltip.offsetWidth || 100;
      const th = tooltip.offsetHeight || 60;
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

    // 다른 차트에서 sync 호출 시 — 자체 데이터로 crosshair + 툴팁 갱신
    const onSyncedHover = (time: Time | null) => {
      if (time == null) {
        chart.clearCrosshairPosition();
        hideTooltip();
        return;
      }
      const cumV = cumMap.get(String(time));
      if (cumV !== undefined) chart.setCrosshairPosition(cumV, time, cumSeries);
      updateTooltipForTime(time);
    };

    // sync anchor 는 누적 라인 — 다른 차트에서 hover 시 누적 위치에 마커 표시
    const cleanupSync = onReady?.(chart, cumSeries, onSyncedHover);

    return () => {
      if (typeof cleanupSync === "function") cleanupSync();
      try { chart.unsubscribeCrosshairMove(tooltipHandler); } catch { /* noop */ }
      try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(rangeHandler); }
      catch { /* chart already removed */ }
      chart.remove();
    };
  }, [daily, cumulative, dates, barColor, cumColor, onReady]);

  return (
    <div className="border border-gray-200 rounded p-2 bg-white">
      <div className="flex items-baseline gap-2 text-xs mb-1 flex-wrap">
        <span className="font-bold" style={{ color: cumColor }}>{label}</span>
        <span className="tabular-nums font-bold" style={{ color: cumColor }}>
          {fmtVol(last)}주
        </span>
        <span className="text-gray-400 text-[10px] ml-auto">일별 + 누적</span>
      </div>
      <div className="relative">
        <div ref={containerRef} className="w-full h-[180px]" />
        <div ref={tooltipRef}
             className="absolute pointer-events-none bg-white/95 border border-gray-200 rounded shadow-md
                        px-2 py-1 text-xs text-gray-700 tabular-nums z-10 leading-snug"
             style={{ display: "none" }} />
      </div>
    </div>
  );
}

export default InvestorChartLight;
