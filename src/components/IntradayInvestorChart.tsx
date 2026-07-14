// 투자자 순매수 다중 라인 차트 — 당일(시간축) / 일별(날짜축) 공용.
//   투자자 on/off 는 상위(IntradayInvestorSection)의 공통 토글로 제어(controlled).
//   series 는 이미 (당일=누적 스냅샷 / 일별=기간 누적) 계산된 값. summary=헤더 표시값.

import { useEffect, useMemo, useRef } from "react";
import {
  createChart,
  ColorType,
  LineSeries,
  AreaSeries,
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

// 차트 아래 값표 표시 시각 (09:00 / 12:00 / 15:00) — 각 시각 최근접 포인트 사용.
const MARK_TIMES = ["09:00", "12:00", "15:00"];

export function IntradayInvestorChart({
  series, summary, enabled, unit, marketLabel, timeVisible, summaryHint, indexSeries, indexLabel,
}: {
  series: FlowSeriesPoint[];
  summary: Record<IntradayKey, number>;
  enabled: Record<string, boolean>;
  unit: string;
  marketLabel: string;
  timeVisible: boolean;
  summaryHint?: string;
  indexSeries?: { t: UTCTimestamp; value: number }[];   // 배경 지수(코스피/코스닥) — 같은 시간축
  indexLabel?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const vlinesRef = useRef<HTMLDivElement>(null);

  const byT = useMemo(() => {
    const m = new Map<number, FlowSeriesPoint>();
    for (const p of series) m.set(p.t as number, p);
    return m;
  }, [series]);

  // 09:00 / 12:00 / 15:00 최근접 포인트 (당일에서만, 20분 이내) — 차트 아래 값표용.
  const timeCols = useMemo(() => {
    if (!timeVisible) return [] as { label: string; pt: FlowSeriesPoint }[];
    return MARK_TIMES.map(hm => {
      const [h, mm] = hm.split(":").map(Number);
      const tt = Date.UTC(2000, 0, 1, h, mm) / 1000;
      let best: FlowSeriesPoint | null = null, bestD = Infinity;
      for (const p of series) { const d = Math.abs((p.t as number) - tt); if (d < bestD) { bestD = d; best = p; } }
      return best && bestD <= 20 * 60 ? { label: hm, pt: best } : null;
    }).filter((c): c is { label: string; pt: FlowSeriesPoint } => c != null);
  }, [series, timeVisible]);

  useEffect(() => {
    if (!containerRef.current || series.length < 2) return;

    const hasIndex = !!indexSeries && indexSeries.length > 1;
    const chart: IChartApi = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#374151", fontSize: 10,
        fontFamily: "system-ui, -apple-system, sans-serif",
        attributionLogo: false,
      },
      grid: { vertLines: { color: "#f3f4f6" }, horzLines: { color: "#f3f4f6" } },
      rightPriceScale: { borderColor: "#e5e7eb", scaleMargins: { top: 0.1, bottom: 0.1 } },
      leftPriceScale: { visible: hasIndex, borderColor: "#e5e7eb", scaleMargins: { top: 0.05, bottom: 0.05 } },   // 배경 지수(코스피/코스닥)만 표시
      timeScale: { borderColor: "#e5e7eb", timeVisible, secondsVisible: false },
      crosshair: {
        mode: 1,
        vertLine: { color: "#9ca3af", width: 1, style: LineStyle.Dotted, labelBackgroundColor: "#475569" },
        horzLine: { color: "#9ca3af", width: 1, style: LineStyle.Dotted, labelVisible: false },
      },
      autoSize: true,
    });

    // 배경 지수(코스피/코스닥) — 왼쪽(숨김) 스케일에 옅은 area. 투자자 라인보다 먼저 그려 뒤에 깔림.
    if (indexSeries && indexSeries.length > 1) {
      const idx = chart.addSeries(AreaSeries, {
        priceScaleId: "left",
        lineColor: "rgba(22,163,74,0.55)", lineWidth: 1,
        topColor: "rgba(22,163,74,0.14)", bottomColor: "rgba(22,163,74,0.01)",
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      });
      idx.setData(indexSeries.map(p => ({ time: p.t as Time, value: p.value })));
    }

    // 0 기준선 — 순매수 부호 판독용. 눈에 띄게 진한 회색.
    const zero = chart.addSeries(LineSeries, {
      color: "#475569", lineWidth: 1, lineStyle: LineStyle.Dashed,   // slate-600
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
    const idxByT = new Map<number, number>();
    if (indexSeries) for (const p of indexSeries) idxByT.set(p.t as number, p.value);

    const onMove = (param: MouseEventParams) => {
      const tip = tooltipRef.current, cont = containerRef.current;
      if (!tip || !cont || param.time == null || param.point == null) { hide(); return; }
      const pt = byT.get(param.time as number);
      if (!pt) { hide(); return; }
      let html = `<div class="text-[10px] text-gray-400 mb-0.5">${pt.label}</div>`;
      const iv = idxByT.get(param.time as number);
      if (iv != null) {
        html += `<div class="flex justify-between gap-3"><span style="color:#16a34a">${indexLabel ?? "지수"}</span>`
              + `<span class="font-bold text-gray-700">${iv.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>`;
      }
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

    // 12:00 / 15:00 세로선 — timeScale 좌표 기반 HTML 오버레이 (줌·리사이즈 시 재배치).
    const vlEl = vlinesRef.current;
    let ro: ResizeObserver | null = null;
    let reposition: (() => void) | null = null;
    const timers: number[] = [];
    if (vlEl && timeVisible) {
      vlEl.innerHTML = "";
      const targets = timeCols.filter(c => c.label === "12:00" || c.label === "15:00");
      const items = targets.map(c => {
        const line = document.createElement("div");
        line.style.cssText = "position:absolute;top:0;bottom:20px;width:0;border-left:1px dashed #94a3b8;";
        const tag = document.createElement("div");
        tag.textContent = c.label;
        tag.style.cssText = "position:absolute;top:0;transform:translateX(-50%);font-size:9px;color:#64748b;background:rgba(255,255,255,0.8);padding:0 2px;";
        vlEl.appendChild(line); vlEl.appendChild(tag);
        return { line, tag, t: c.pt.t };
      });
      reposition = () => {
        // timeToCoordinate 는 플롯(가격축 제외) 기준 → 왼쪽 지수축 폭만큼 더해 컨테이너 좌표로 보정.
        let lw = 0;
        try { lw = chart.priceScale("left").width(); } catch { /* 없으면 0 */ }
        for (const it of items) {
          const x = chart.timeScale().timeToCoordinate(it.t as Time);
          const show = x != null;
          it.line.style.display = show ? "block" : "none";
          it.tag.style.display = show ? "block" : "none";
          if (show) { it.line.style.left = `${x + lw}px`; it.tag.style.left = `${x + lw}px`; }
        }
      };
      reposition();
      // 왼쪽 지수축 등장 등 레이아웃이 다음 프레임 이후 확정 → 지연 재계산 필요.
      [0, 60, 160, 320].forEach(ms => timers.push(window.setTimeout(() => reposition && reposition(), ms)));
      chart.timeScale().subscribeVisibleLogicalRangeChange(reposition);
      if (containerRef.current) { ro = new ResizeObserver(() => reposition && reposition()); ro.observe(containerRef.current); }
    }

    return () => {
      try { chart.unsubscribeCrosshairMove(onMove); } catch { /* noop */ }
      if (reposition) { try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(reposition); } catch { /* noop */ } }
      if (ro) ro.disconnect();
      timers.forEach(clearTimeout);
      if (vlEl) vlEl.innerHTML = "";
      chart.remove();
    };
  }, [series, enabled, unit, timeVisible, byT, indexSeries, indexLabel, timeCols]);

  return (
    <div className="border border-gray-200 rounded p-1.5 bg-white min-w-0">
      {/* 헤더 — 시장명(녹색) + 전체 투자자 요약값(당일=최신 / 일별=기간합계). 여러 줄 wrap. */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px] mb-1 px-0.5 tabular-nums leading-tight">
        <span className="font-bold text-green-600 text-xs">{marketLabel}</span>
        {summaryHint && <span className="text-[10px] text-gray-400">{summaryHint}</span>}
        {indexLabel && indexSeries && indexSeries.length > 1 && (
          <span className="text-[10px] text-green-700/70">▨ {indexLabel}</span>
        )}
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
        <div ref={vlinesRef} className="absolute inset-0 pointer-events-none overflow-hidden z-10" />
        <div ref={tooltipRef}
             className="absolute pointer-events-none bg-white/30 backdrop-blur-[2px] border border-gray-200/60 rounded shadow-sm
                        px-2 py-1 text-xs text-gray-800 tabular-nums z-50 leading-snug"
             style={{ display: "none" }} />
      </div>

      {/* 차트 아래 값표 — 09:00 / 12:00 / 15:00 × 선택 투자자 (당일만) */}
      {timeVisible && timeCols.length > 0 && (
        <div className="mt-1.5 overflow-x-auto">
          <table className="w-full text-[10px] tabular-nums border-collapse">
            <thead>
              <tr className="text-gray-500 border-b border-gray-100">
                <th className="text-left font-normal px-1 py-0.5"></th>
                {timeCols.map(c => (
                  <th key={c.label} className="text-right font-semibold px-1 py-0.5">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {INTRADAY_SERIES.filter(d => enabled[d.key]).map(def => (
                <tr key={def.key} className="border-b border-gray-50 last:border-0">
                  <td className="px-1 py-0.5">
                    <span className="text-white px-1 rounded text-[10px] font-medium"
                          style={{ backgroundColor: def.color }}>{def.label}</span>
                  </td>
                  {timeCols.map(c => (
                    <td key={c.label} className="text-right px-1 py-0.5 font-bold"
                        style={{ color: netColor(c.pt.values[def.key]) }}>
                      {fmtNet(c.pt.values[def.key], unit)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default IntradayInvestorChart;
