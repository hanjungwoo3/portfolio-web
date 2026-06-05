// 공매도 미니 차트 (종가 없음 — 상단 주가차트 + crosshair sync 로 대조)
//   히스토그램(연파랑): 일별 공매도 수량(주)  /  라인(진파랑): 20일 이동평균(추세)
//   (누적은 무의미 — 공매도는 상환됨, 실제 잔량은 대차잔고. 그래서 추세=이동평균)
//   crosshair sync anchor = 이동평균 라인

import { useEffect, useRef } from "react";
import {
  createChart, ColorType, LineSeries, HistogramSeries, LineStyle,
  type IChartApi, type ISeriesApi, type SeriesType, type Time,
  type LogicalRange, type MouseEventParams,
} from "lightweight-charts";
import type { ShortSellingPoint } from "../lib/api";

const SHORT_COLOR = "#2563eb";   // 이동평균 라인 + 헤더 (blue-600)
const BAR_COLOR   = "#bfdbfe";   // 일별 막대 (blue-200)

function fmtVol(v: number): string {
  const abs = Math.abs(v), sign = v < 0 ? "-" : "";
  if (abs >= 100_000_000) return `${sign}${(abs / 100_000_000).toFixed(1)}억`;
  if (abs >= 10_000) return `${sign}${Math.round(abs / 10_000).toLocaleString()}만`;
  return `${sign}${Math.round(abs).toLocaleString()}`;
}

interface Props {
  shortSelling: ShortSellingPoint[];
  dates: string[];
  desc?: string;   // 그래프 하단 설명
  onReady?: (
    chart: IChartApi,
    anchor: ISeriesApi<SeriesType>,
    onSyncedHover?: (time: Time | null) => void,
  ) => (() => void) | void;
}

export function ShortSellingChart({ shortSelling, dates, desc, onReady }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const visibleRangeRef = useRef<LogicalRange | null>(null);

  const valid = shortSelling.filter(s => s.shortVolume > 0);
  const last = valid[valid.length - 1];
  const recent = valid.slice(-20);
  const recentAvg = recent.length > 0 ? recent.reduce((a, s) => a + s.shortVolume, 0) / recent.length : null;

  useEffect(() => {
    if (!containerRef.current) return;
    if (dates.length < 2) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#374151", fontSize: 10,
        fontFamily: "system-ui, -apple-system, sans-serif", attributionLogo: false,
      },
      grid: { vertLines: { color: "#f3f4f6" }, horzLines: { color: "#f3f4f6" } },
      rightPriceScale: { borderColor: "#e5e7eb", scaleMargins: { top: 0.12, bottom: 0.06 } },
      leftPriceScale: { visible: false },
      timeScale: { borderColor: "#e5e7eb", timeVisible: false, secondsVisible: false },
      crosshair: {
        mode: 1,
        vertLine: { color: "#9ca3af", width: 1, style: LineStyle.Dotted, labelBackgroundColor: "#475569" },
        horzLine: { color: "#9ca3af", width: 1, style: LineStyle.Dotted, labelVisible: false },
      },
      autoSize: true,
    });

    const shortMap = new Map<string, ShortSellingPoint>();
    for (const s of shortSelling) shortMap.set(s.date, s);

    // 20일 이동평균 (데이터 있는 날 순서 기준 trailing 20)
    const ordered = dates
      .map(d => ({ date: d, s: shortMap.get(d) }))
      .filter(x => x.s && x.s.shortVolume > 0)
      .map(x => ({ date: x.date, vol: x.s!.shortVolume }));
    const maMap = new Map<string, number>();
    for (let i = 0; i < ordered.length; i++) {
      const win = ordered.slice(Math.max(0, i - 19), i + 1);
      maMap.set(ordered[i].date, win.reduce((a, b) => a + b.vol, 0) / win.length);
    }

    // 일별 공매도 수량(주) 히스토그램 (연파랑) — 전 dates whitespace 정렬
    const bars = chart.addSeries(HistogramSeries, {
      priceScaleId: "right", color: BAR_COLOR, priceFormat: { type: "volume" },
      base: 0, priceLineVisible: false, lastValueVisible: false,
    });
    bars.setData(dates.map(d => {
      const s = shortMap.get(d);
      return s && s.shortVolume > 0 ? { time: d as Time, value: s.shortVolume } : { time: d as Time };
    }));

    // 20일 이동평균 라인 (진파랑) — 추세
    const maLine = chart.addSeries(LineSeries, {
      priceScaleId: "right", color: SHORT_COLOR, lineWidth: 1,
      priceFormat: { type: "volume" },
      priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
    });
    maLine.setData(dates.map(d => {
      const m = maMap.get(d);
      return m !== undefined ? { time: d as Time, value: m } : { time: d as Time };
    }));

    if (visibleRangeRef.current) chart.timeScale().setVisibleLogicalRange(visibleRangeRef.current);
    else chart.timeScale().fitContent();
    const rangeHandler = (r: LogicalRange | null) => { if (r) visibleRangeRef.current = r; };
    chart.timeScale().subscribeVisibleLogicalRangeChange(rangeHandler);

    const hideTooltip = () => { if (tooltipRef.current) tooltipRef.current.style.display = "none"; };

    const updateTooltipForTime = (time: Time): boolean => {
      const tooltip = tooltipRef.current, container = containerRef.current;
      if (!tooltip || !container) return false;
      const x = chart.timeScale().timeToCoordinate(time);
      const s = shortMap.get(String(time));
      if (x == null || !s || !(s.shortVolume > 0)) { hideTooltip(); return false; }
      const ma = maMap.get(String(time));
      const y = (ma !== undefined ? maLine.priceToCoordinate(ma) : bars.priceToCoordinate(s.shortVolume)) ?? 12;
      let html = `<div class="text-[10px] text-gray-400 mb-0.5">${String(time)}</div>`;
      html += `<div><span class="text-gray-500">공매도 </span><span style="color:${SHORT_COLOR}" class="font-bold">${s.shortVolume.toLocaleString()}주</span></div>`;
      if (ma !== undefined) html += `<div><span class="text-gray-500">20일평균 </span><span>${fmtVol(ma)}주</span></div>`;
      if (s.amountRatio > 0) html += `<div><span class="text-gray-500">거래대금 대비 </span><span>${s.amountRatio.toFixed(2)}%</span></div>`;
      if (s.ratio > 0) html += `<div><span class="text-gray-500">거래량 대비 </span><span>${s.ratio.toFixed(2)}%</span></div>`;
      tooltip.innerHTML = html;
      tooltip.style.display = "block";
      const W = container.clientWidth, H = container.clientHeight;
      const tw = tooltip.offsetWidth || 130, th = tooltip.offsetHeight || 70;
      let left = x + 12, top = y + 12;
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
      if (time == null) { chart.clearCrosshairPosition(); hideTooltip(); return; }
      const ma = maMap.get(String(time));
      if (ma !== undefined) chart.setCrosshairPosition(ma, time, maLine);
      updateTooltipForTime(time);
    };

    const cleanupSync = onReady?.(chart, maLine, onSyncedHover);

    return () => {
      if (typeof cleanupSync === "function") cleanupSync();
      try { chart.unsubscribeCrosshairMove(tooltipHandler); } catch { /* noop */ }
      try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(rangeHandler); } catch { /* noop */ }
      chart.remove();
    };
  }, [shortSelling, dates, onReady]);

  return (
    <div className="border border-gray-200 rounded p-2 bg-white">
      <div className="flex items-baseline gap-2 text-xs mb-1 flex-wrap">
        <span className="font-bold" style={{ color: SHORT_COLOR }}>공매도</span>
        {last && (
          <span className="tabular-nums font-bold" style={{ color: SHORT_COLOR }}>
            {fmtVol(last.shortVolume)}주
          </span>
        )}
        {recentAvg !== null && (
          <span className="text-[10px] text-gray-400">20일평균 {fmtVol(recentAvg)}주</span>
        )}
        <span className="text-gray-400 text-[10px] ml-auto">일별 + 20일평균</span>
      </div>
      <div className="relative">
        <div ref={containerRef} className="w-full h-[180px]" />
        <div ref={tooltipRef}
             className="absolute pointer-events-none bg-white border border-gray-200 rounded shadow-md
                        px-2 py-1 text-xs text-gray-700 tabular-nums z-50 leading-snug"
             style={{ display: "none" }} />
      </div>
      {desc && <div className="text-[10px] text-gray-600 mt-1 leading-snug">{desc}</div>}
    </div>
  );
}

export default ShortSellingChart;
