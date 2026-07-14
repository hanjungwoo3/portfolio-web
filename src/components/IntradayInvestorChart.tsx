// 당일 시간별 투자자 순매수 차트 (1개 시장) — HTS "시간별동향" 형식.
//   투자자 on/off 는 상위(IntradayInvestorSection)의 공통 토글로 제어(controlled).
//   데이터: fetchKrIntradayInvestorFlow (네이버 investorDealTrendTime).

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
import type { IntradayFlowPoint } from "../lib/api";
import { INTRADAY_SERIES } from "../lib/intradayInvestor";

// "HH:MM" → 고정일자 UTC 타임스탬프 (뷰어 TZ 무관하게 축에 HH:MM 표기되도록 UTC 취급)
function toTime(hhmm: string): UTCTimestamp {
  const [h, m] = hhmm.split(":").map(Number);
  return (Date.UTC(2000, 0, 1, h, m) / 1000) as UTCTimestamp;
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
  points, unit, enabled, marketLabel,
}: {
  points: IntradayFlowPoint[];
  unit: string;
  enabled: Record<string, boolean>;
  marketLabel: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const byTime = useMemo(() => {
    const m = new Map<number, IntradayFlowPoint>();
    for (const p of points) m.set(toTime(p.time) as number, p);
    return m;
  }, [points]);

  const latest = points[points.length - 1];

  useEffect(() => {
    if (!containerRef.current || points.length < 2) return;

    const chart: IChartApi = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#374151", fontSize: 10,
        fontFamily: "system-ui, -apple-system, sans-serif",
        attributionLogo: false,
      },
      grid: { vertLines: { color: "#f3f4f6" }, horzLines: { color: "#f3f4f6" } },
      rightPriceScale: { borderColor: "#e5e7eb", scaleMargins: { top: 0.1, bottom: 0.1 } },
      timeScale: { borderColor: "#e5e7eb", timeVisible: true, secondsVisible: false },
      crosshair: {
        mode: 1,
        vertLine: { color: "#9ca3af", width: 1, style: LineStyle.Dotted, labelBackgroundColor: "#475569" },
        horzLine: { color: "#9ca3af", width: 1, style: LineStyle.Dotted, labelVisible: false },
      },
      autoSize: true,
    });

    // 0 기준선 (순매수 부호 판독용)
    const zero = chart.addSeries(LineSeries, {
      color: "#d1d5db", lineWidth: 1, lineStyle: LineStyle.Dashed,
      priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
    });
    zero.setData(points.map(p => ({ time: toTime(p.time) as Time, value: 0 })));

    // 선택된 투자자 라인
    for (const def of INTRADAY_SERIES) {
      if (!enabled[def.key]) continue;
      const s: ISeriesApi<"Line"> = chart.addSeries(LineSeries, {
        color: def.color, lineWidth: 2, priceFormat: { type: "volume" },
        priceLineVisible: false, lastValueVisible: false,
      });
      s.setData(points.map(p => ({ time: toTime(p.time) as Time, value: p[def.key] })));
    }

    chart.timeScale().fitContent();

    const hide = () => { if (tooltipRef.current) tooltipRef.current.style.display = "none"; };
    const onMove = (param: MouseEventParams) => {
      const tip = tooltipRef.current, cont = containerRef.current;
      if (!tip || !cont || param.time == null || param.point == null) { hide(); return; }
      const pt = byTime.get(param.time as number);
      if (!pt) { hide(); return; }
      let html = `<div class="text-[10px] text-gray-400 mb-0.5">${pt.time}</div>`;
      for (const def of INTRADAY_SERIES) {
        if (!enabled[def.key]) continue;
        const v = pt[def.key];
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
  }, [points, enabled, unit, byTime]);

  return (
    <div className="border border-gray-200 rounded p-1.5 bg-white min-w-0">
      {/* 헤더 — 시장명(녹색) + 개인/외국인/기관 최신 누적값 (이미지 #2 스타일) */}
      <div className="flex flex-wrap items-baseline gap-x-2 text-xs mb-1 px-0.5 tabular-nums leading-tight">
        <span className="font-bold text-green-600">{marketLabel}</span>
        {latest && (
          <>
            <span><span className="text-purple-600">개인</span> <span className="font-bold" style={{ color: netColor(latest.individuals) }}>{fmtNet(latest.individuals, unit)}</span></span>
            <span><span className="text-orange-500">외국인</span> <span className="font-bold" style={{ color: netColor(latest.foreigners) }}>{fmtNet(latest.foreigners, unit)}</span></span>
            <span><span className="text-blue-500">기관</span> <span className="font-bold" style={{ color: netColor(latest.institutions) }}>{fmtNet(latest.institutions, unit)}</span></span>
          </>
        )}
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
