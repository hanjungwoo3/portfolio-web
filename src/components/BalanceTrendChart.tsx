// 잔고 추세 미니 차트 (대차잔고 / 신용잔고 / CFD 공용) — 종가 없음
//   면적 (우측 축): 잔고 수량 추세 [메인]  (+ 선택: 2번째 면적 = CFD 매도잔고)
//   히스토그램 (좌측 축, 하단): 일별 증감 수량 (증가=빌드업 / 감소=상환)
//   crosshair sync anchor = 잔고 면적

import { useEffect, useRef, type ReactNode } from "react";
import {
  createChart, ColorType, AreaSeries, HistogramSeries, LineStyle,
  type IChartApi, type ISeriesApi, type SeriesType, type Time,
  type LogicalRange, type MouseEventParams,
} from "lightweight-charts";

export interface BalanceTrendPoint {
  date: string;
  volume: number;        // 잔고 수량 (면적)
  amount?: number;       // 잔고금액 (원)
  rate?: number;         // 잔고 비율 (%)
  fluctuation?: number;  // 일별 증감 수량
  volume2?: number;      // 2번째 면적 (CFD 매도잔고 등)
}

function hexToRgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
function fmtEok(won: number): string {
  const eok = won / 1e8;
  if (eok >= 10000) return `${(eok / 10000).toFixed(2)}조`;
  if (eok >= 1) return `${Math.round(eok).toLocaleString()}억`;
  return `${Math.round(won / 1e4).toLocaleString()}만`;
}
function fmtVol(v: number): string {
  const abs = Math.abs(v), sign = v < 0 ? "-" : "";
  if (abs >= 100_000_000) return `${sign}${(abs / 100_000_000).toFixed(1)}억`;
  if (abs >= 10_000) return `${sign}${Math.round(abs / 10_000).toLocaleString()}만`;
  return `${sign}${abs.toLocaleString()}`;
}

interface Props {
  title: string;       // "대차잔고" / "신용잔고" / "CFD 잔고"
  color: string;       // 잔고 면적/수치 색 (hex)
  title2?: string;     // 2번째 면적 라벨 (예: "매도")
  color2?: string;     // 2번째 면적 색 (hex)
  desc?: ReactNode;    // 그래프 하단 설명 (색상 마크업 가능)
  upIsBad?: boolean;   // 잔고 증가가 '부정'인지 (대차/신용=true: 증가 파랑·감소 빨강 / CFD매수=false)
  points: BalanceTrendPoint[];
  dates: string[];
  onReady?: (
    chart: IChartApi,
    anchor: ISeriesApi<SeriesType>,
    onSyncedHover?: (time: Time | null) => void,
  ) => (() => void) | void;
}

export function BalanceTrendChart({ title, color, title2, color2, desc, upIsBad, points, dates, onReady }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const visibleRangeRef = useRef<LogicalRange | null>(null);

  const valid = points.filter(p => p.volume > 0);
  const last = valid[valid.length - 1];
  const past = valid.length > 20 ? valid[valid.length - 21] : valid[0];
  const trendPct = last && past && past.volume > 0
    ? ((last.volume - past.volume) / past.volume) * 100 : null;
  const headline = last
    ? (last.amount && last.amount > 0 ? `${fmtEok(last.amount)}원` : `${last.volume.toLocaleString()}주`)
    : "";

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
      rightPriceScale: { borderColor: "#e5e7eb", scaleMargins: { top: 0.08, bottom: 0.30 } },
      leftPriceScale: { visible: false, scaleMargins: { top: 0.55, bottom: 0 } },
      timeScale: { borderColor: "#e5e7eb", timeVisible: false, secondsVisible: false },
      crosshair: {
        mode: 1,
        vertLine: { color: "#9ca3af", width: 1, style: LineStyle.Dotted, labelBackgroundColor: "#475569" },
        horzLine: { color: "#9ca3af", width: 1, style: LineStyle.Dotted, labelVisible: false },
      },
      autoSize: true,
    });

    const ptMap = new Map<string, BalanceTrendPoint>();
    for (const p of points) ptMap.set(p.date, p);

    // 잔고 수량 면적 (메인, 우측)
    const area = chart.addSeries(AreaSeries, {
      priceScaleId: "right", lineColor: color, lineWidth: 1,
      topColor: hexToRgba(color, 0.28), bottomColor: hexToRgba(color, 0.02),
      priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
    });
    // 모든 dates 에 대해 값 또는 whitespace({time}) — 시간축을 다른 차트와 동일하게 맞춤(정렬)
    area.setData(dates.map(d => {
      const p = ptMap.get(d);
      return p && p.volume > 0 ? { time: d as Time, value: p.volume } : { time: d as Time };
    }));

    // 2번째 면적 (CFD 매도잔고 등) — 같은 우측 축
    if (title2 && color2) {
      const area2 = chart.addSeries(AreaSeries, {
        priceScaleId: "right", lineColor: color2, lineWidth: 1,
        topColor: hexToRgba(color2, 0.22), bottomColor: hexToRgba(color2, 0.02),
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      });
      area2.setData(dates.map(d => {
        const p = ptMap.get(d);
        return p && p.volume2 != null && p.volume2 > 0 ? { time: d as Time, value: p.volume2 } : { time: d as Time };
      }));
    }

    // 일별 증감 히스토그램 (좌측, 하단) — 증가=빌드업 / 감소=상환
    const hasFluc = points.some(p => p.fluctuation !== undefined && p.fluctuation !== 0);
    if (hasFluc) {
      const flucBars = chart.addSeries(HistogramSeries, {
        priceScaleId: "left", base: 0,
        priceLineVisible: false, lastValueVisible: false,
      });
      chart.priceScale("left").applyOptions({ scaleMargins: { top: 0.55, bottom: 0 } });
      flucBars.setData(dates.map(d => {
        const p = ptMap.get(d);
        if (!p || p.fluctuation === undefined || p.fluctuation === 0) return { time: d as Time };
        return { time: d as Time, value: p.fluctuation,
          color: p.fluctuation > 0 ? "rgba(220, 38, 38, 0.6)" : "rgba(37, 99, 235, 0.6)" };
      }));
    }

    if (visibleRangeRef.current) chart.timeScale().setVisibleLogicalRange(visibleRangeRef.current);
    else chart.timeScale().fitContent();
    const rangeHandler = (r: LogicalRange | null) => { if (r) visibleRangeRef.current = r; };
    chart.timeScale().subscribeVisibleLogicalRangeChange(rangeHandler);

    const hideTooltip = () => { if (tooltipRef.current) tooltipRef.current.style.display = "none"; };

    const updateTooltipForTime = (time: Time): boolean => {
      const tooltip = tooltipRef.current, container = containerRef.current;
      if (!tooltip || !container) return false;
      const x = chart.timeScale().timeToCoordinate(time);
      const p = ptMap.get(String(time));
      if (x == null || !p || !(p.volume > 0)) { hideTooltip(); return false; }
      const y = area.priceToCoordinate(p.volume) ?? 12;
      let html = `<div class="text-[10px] text-gray-400 mb-0.5">${String(time)}</div>`;
      html += `<div><span class="text-gray-500">${title} </span><span style="color:${color}" class="font-bold">${p.volume.toLocaleString()}주</span>`;
      if (p.rate && p.rate > 0) html += ` <span class="text-gray-400 text-[10px]">(${p.rate.toFixed(2)}%)</span>`;
      html += `</div>`;
      if (p.amount && p.amount > 0) html += `<div><span class="text-gray-500">잔고금액 </span><span>${fmtEok(p.amount)}원</span></div>`;
      if (title2 && p.volume2 != null && p.volume2 > 0) {
        html += `<div><span class="text-gray-500">${title2} </span><span style="color:${color2}" class="font-bold">${p.volume2.toLocaleString()}주</span></div>`;
      }
      if (p.fluctuation !== undefined && p.fluctuation !== 0) {
        const fc = p.fluctuation > 0 ? "#dc2626" : "#2563eb";
        html += `<div><span class="text-gray-500">증감 </span><span style="color:${fc}">${p.fluctuation > 0 ? "+" : ""}${fmtVol(p.fluctuation)}주</span></div>`;
      }
      tooltip.innerHTML = html;
      tooltip.style.display = "block";
      const W = container.clientWidth, H = container.clientHeight;
      const tw = tooltip.offsetWidth || 130, th = tooltip.offsetHeight || 80;
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
      const p = ptMap.get(String(time));
      if (p && p.volume > 0) chart.setCrosshairPosition(p.volume, time, area);
      updateTooltipForTime(time);
    };

    const cleanupSync = onReady?.(chart, area, onSyncedHover);

    return () => {
      if (typeof cleanupSync === "function") cleanupSync();
      try { chart.unsubscribeCrosshairMove(tooltipHandler); } catch { /* noop */ }
      try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(rangeHandler); } catch { /* noop */ }
      chart.remove();
    };
  }, [title, color, title2, color2, points, dates, onReady]);

  return (
    <div className="border border-gray-200 rounded p-2 bg-white">
      <div className="flex items-baseline gap-2 text-xs mb-1 flex-wrap">
        {title2 && color2 && (
          <span className="inline-block w-3 h-0.5 self-center" style={{ background: color }}></span>
        )}
        <span className="font-bold" style={{ color }}>{title}</span>
        {last && <span className="tabular-nums font-bold" style={{ color }}>{headline}</span>}
        {last?.rate != null && last.rate > 0 && (
          <span className="text-[10px] text-gray-400">{last.rate.toFixed(2)}%</span>
        )}
        {trendPct !== null && (() => {
          // 긍정=빨강 / 부정=파랑. 대차·신용은 증가가 부정(upIsBad), CFD매수는 증가가 긍정.
          const positive = upIsBad ? trendPct < 0 : trendPct > 0;
          return (
            <span className={`tabular-nums text-[11px] ${positive ? "text-rose-600" : "text-blue-600"}`}>
              {trendPct > 0 ? "▲" : "▼"} {Math.abs(trendPct).toFixed(1)}% <span className="text-gray-400">(20일)</span>
            </span>
          );
        })()}
        {title2 && color2 && (
          <span className="flex items-center gap-1 ml-auto">
            <span className="inline-block w-3 h-0.5" style={{ background: color2 }}></span>
            <span style={{ color: color2 }} className="font-medium">{title2}</span>
          </span>
        )}
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

export default BalanceTrendChart;
