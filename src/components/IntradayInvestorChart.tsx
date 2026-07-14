// 투자자 순매수 다중 라인 차트 — 당일(시간축) / 일별(날짜축) 공용.
//   투자자 on/off 는 상위(IntradayInvestorSection)의 공통 토글로 제어(controlled).
//   series 는 이미 (당일=누적 스냅샷 / 일별=기간 누적) 계산된 값. summary=헤더 표시값.

import { useEffect, useMemo, useRef } from "react";
import {
  createChart,
  ColorType,
  LineSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
  type MouseEventParams,
} from "lightweight-charts";
import type { IntradayKey } from "../lib/intradayInvestor";
import { INTRADAY_SERIES } from "../lib/intradayInvestor";

export interface FlowSeriesPoint {
  t: UTCTimestamp;
  label: string;                        // 툴팁 표기용 (HH:MM 또는 MM/DD)
  values: Record<IntradayKey, number>;
}

// 금액 표시 — 억원은 조/억원(예: -4조 1,411억원), 선물은 계약.
function fmtNet(v: number, unit: string): string {
  const sign = v > 0 ? "+" : v < 0 ? "-" : "";
  const abs = Math.abs(v);
  if (unit === "계약") return `${sign}${abs.toLocaleString()}계약`;
  const jo = Math.floor(abs / 10000);      // 1조 = 10,000억
  const eok = abs % 10000;
  if (jo > 0) return `${sign}${jo}조 ${eok.toLocaleString()}억원`;
  return `${sign}${abs.toLocaleString()}억원`;
}
const netColor = (v: number) => (v > 0 ? "#dc2626" : v < 0 ? "#2563eb" : "#9ca3af");

export function IntradayInvestorChart({
  series, summary, enabled, unit, marketLabel, timeVisible, summaryHint,
}: {
  series: FlowSeriesPoint[];
  summary: Record<IntradayKey, number>;
  enabled: Record<string, boolean>;
  unit: string;
  marketLabel: string;
  timeVisible: boolean;
  summaryHint?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const byT = useMemo(() => {
    const m = new Map<number, FlowSeriesPoint>();
    for (const p of series) m.set(p.t as number, p);
    return m;
  }, [series]);

  useEffect(() => {
    if (!containerRef.current || series.length < 2) return;

    const chart: IChartApi = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#374151", fontSize: 10,
        fontFamily: "system-ui, -apple-system, sans-serif",
        attributionLogo: false,
      },
      grid: { vertLines: { color: "#f3f4f6" }, horzLines: { color: "#f3f4f6" } },
      rightPriceScale: { borderColor: "#e5e7eb", scaleMargins: { top: 0.1, bottom: 0.1 } },
      timeScale: { borderColor: "#e5e7eb", timeVisible, secondsVisible: false },
      crosshair: {
        mode: 1,
        vertLine: { color: "#9ca3af", width: 1, style: LineStyle.Dotted, labelBackgroundColor: "#475569" },
        horzLine: { color: "#9ca3af", width: 1, style: LineStyle.Dotted, labelVisible: false },
      },
      autoSize: true,
    });

    // 0 기준선
    const zero = chart.addSeries(LineSeries, {
      color: "#d1d5db", lineWidth: 1, lineStyle: LineStyle.Dashed,
      priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
    });
    zero.setData(series.map(p => ({ time: p.t as Time, value: 0 })));

    for (const def of INTRADAY_SERIES) {
      if (!enabled[def.key]) continue;
      const s: ISeriesApi<"Line"> = chart.addSeries(LineSeries, {
        color: def.color, lineWidth: 2, priceFormat: { type: "volume" },
        priceLineVisible: false, lastValueVisible: false,
      });
      s.setData(series.map(p => ({ time: p.t as Time, value: p.values[def.key] })));
    }

    chart.timeScale().fitContent();

    const hide = () => { if (tooltipRef.current) tooltipRef.current.style.display = "none"; };
    const onMove = (param: MouseEventParams) => {
      const tip = tooltipRef.current, cont = containerRef.current;
      if (!tip || !cont || param.time == null || param.point == null) { hide(); return; }
      const pt = byT.get(param.time as number);
      if (!pt) { hide(); return; }
      let html = `<div class="text-[10px] text-gray-400 mb-0.5">${pt.label}</div>`;
      for (const def of INTRADAY_SERIES) {
        if (!enabled[def.key]) continue;
        const v = pt.values[def.key];
        html += `<div class="flex justify-between gap-3"><span style="color:${def.color}">${def.label}</span>`
              + `<span class="font-bold" style="color:${netColor(v)}">${fmtNet(v, unit)}</span></div>`;
      }
      tip.innerHTML = html;
      tip.style.display = "block";
      const W = cont.clientWidth;
      const tw = tip.offsetWidth || 110;
      let left = param.point.x + 12;
      if (left + tw > W - 4) left = param.point.x - tw - 12;
      if (left < 4) left = 4;
      tip.style.left = `${left}px`;
      tip.style.top = `4px`;
    };
    chart.subscribeCrosshairMove(onMove);

    return () => {
      try { chart.unsubscribeCrosshairMove(onMove); } catch { /* noop */ }
      chart.remove();
    };
  }, [series, enabled, unit, timeVisible, byT]);

  return (
    <div className="border border-gray-200 rounded p-1.5 bg-white min-w-0">
      {/* 헤더 — 시장명(녹색) + 전체 투자자 요약값(당일=최신 / 일별=기간합계). 여러 줄 wrap. */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px] mb-1 px-0.5 tabular-nums leading-tight">
        <span className="font-bold text-green-600 text-xs">{marketLabel}</span>
        {summaryHint && <span className="text-[10px] text-gray-400">{summaryHint}</span>}
        {INTRADAY_SERIES.map(def => (
          <span key={def.key} className={`inline-flex items-baseline gap-1 ${enabled[def.key] ? "" : "opacity-50"}`}>
            <span className="text-white px-1 rounded text-[10px] font-medium"
                  style={{ backgroundColor: def.color }}>{def.label}</span>
            <span className={enabled[def.key] ? "font-bold" : "font-normal"}
                  style={{ color: netColor(summary[def.key]) }}>{fmtNet(summary[def.key], unit)}</span>
          </span>
        ))}
      </div>
      <div className="relative">
        <div ref={containerRef} className="w-full h-[220px] lg:h-[240px]" />
        <div ref={tooltipRef}
             className="absolute pointer-events-none bg-white/95 border border-gray-200 rounded shadow-md
                        px-2 py-1 text-xs text-gray-700 tabular-nums z-50 leading-snug"
             style={{ display: "none" }} />
      </div>
    </div>
  );
}

export default IntradayInvestorChart;
