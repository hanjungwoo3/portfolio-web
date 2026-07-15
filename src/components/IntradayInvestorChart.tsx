// 투자자 순매수 다중 라인 차트 — 당일(시간축) / 일별(날짜축) 공용.
//   투자자 on/off 는 상위(IntradayInvestorSection)의 공통 토글로 제어(controlled).
//   series 는 이미 (당일=누적 스냅샷 / 일별=기간 누적) 계산된 값. summary=헤더 표시값.

import { useEffect, useMemo, useRef, useState, Fragment } from "react";
import {
  createChart,
  ColorType,
  LineSeries,
  BaselineSeries,
  HistogramSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
  type MouseEventParams,
} from "lightweight-charts";
import type { IntradayKey } from "../lib/intradayInvestor";
import { INTRADAY_SERIES } from "../lib/intradayInvestor";
import type { SyncRegistrar } from "../lib/useCrosshairSync";

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
  series, summary, enabled, unit, marketLabel, timeVisible, summaryHint, indexSeries, indexLabel, indexBaseline, volumeSeries, onReady,
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
  indexBaseline?: number;                               // 전일 종가(기준가) — 위=빨강/아래=파랑
  volumeSeries?: { t: UTCTimestamp; value: number }[];  // 지수 거래량 — 차트 하단 막대
  onReady?: SyncRegistrar;                              // 3개 차트 crosshair 동기화
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const vlinesRef = useRef<HTMLDivElement>(null);
  const fracKeyRef = useRef("");
  // 09:00/12:00/15:00 의 차트 내 x 위치(0~1) — 아래 값표 컬럼 정렬용.
  const [colFrac, setColFrac] = useState<{ label: string; frac: number }[]>([]);

  const byT = useMemo(() => {
    const m = new Map<number, FlowSeriesPoint>();
    for (const p of series) m.set(p.t as number, p);
    return m;
  }, [series]);

  // 09:00 / 12:00 / 15:00 최근접 포인트(20분 이내) + 맨 오른쪽 "현재"(최신) — 차트 아래 값표용.
  const timeCols = useMemo(() => {
    if (!timeVisible || series.length === 0) return [] as { label: string; pt: FlowSeriesPoint }[];
    const cols = MARK_TIMES.map(hm => {
      const [h, mm] = hm.split(":").map(Number);
      const tt = Date.UTC(2000, 0, 1, h, mm) / 1000;
      let best: FlowSeriesPoint | null = null, bestD = Infinity;
      for (const p of series) { const d = Math.abs((p.t as number) - tt); if (d < bestD) { bestD = d; best = p; } }
      return best && bestD <= 20 * 60 ? { label: hm, pt: best } : null;
    }).filter((c): c is { label: string; pt: FlowSeriesPoint } => c != null);
    cols.push({ label: "현재", pt: series[series.length - 1] });   // 최신값 = 맨 오른쪽
    return cols;
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

    // 지수 거래량 — 하단 오버레이 히스토그램(자체 스케일, 아래 ~25%).
    if (volumeSeries && volumeSeries.length > 1) {
      const vol = chart.addSeries(HistogramSeries, {
        priceScaleId: "vol",
        color: "rgba(5,150,105,0.6)",   // emerald-600, 진하게
        priceLineVisible: false, lastValueVisible: false,
      });
      vol.priceScale().applyOptions({ scaleMargins: { top: 0.75, bottom: 0 } });
      vol.setData(volumeSeries.map(p => ({ time: p.t as Time, value: p.value })));
    }

    // 배경 지수(코스피/코스닥) — 전일 종가 기준 위=빨강/아래=파랑(한국식). 투자자 라인 뒤에 깔림.
    if (indexSeries && indexSeries.length > 1) {
      const base = indexBaseline ?? indexSeries[0].value;
      const idx = chart.addSeries(BaselineSeries, {
        priceScaleId: "left",
        baseValue: { type: "price", price: base },
        topLineColor: "rgba(220,38,38,0.7)",
        topFillColor1: "rgba(220,38,38,0.28)", topFillColor2: "rgba(220,38,38,0.05)",
        bottomLineColor: "rgba(37,99,235,0.7)",
        bottomFillColor1: "rgba(37,99,235,0.05)", bottomFillColor2: "rgba(37,99,235,0.28)",
        lineWidth: 1,
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

    // 툴팁 렌더+위치 (onMove·동기화 hover 공용)
    const showAt = (time: Time, xPixel: number) => {
      const tip = tooltipRef.current, cont = containerRef.current;
      if (!tip || !cont) return;
      const pt = byT.get(time as number);
      if (!pt) { hide(); return; }
      let html = `<div class="text-[10px] text-gray-400 mb-0.5">${pt.label}</div>`;
      const iv = idxByT.get(time as number);
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
      let left = xPixel + 12;
      if (left + tw > W - 4) left = xPixel - tw - 12;
      if (left < 4) left = 4;
      tip.style.left = `${left}px`;
      tip.style.top = `4px`;
    };

    const onMove = (param: MouseEventParams) => {
      if (param.time == null || param.point == null) { hide(); return; }
      showAt(param.time, param.point.x);
    };
    chart.subscribeCrosshairMove(onMove);

    // 다른 차트 hover 시 동기화 — 같은 시각의 최근접 포인트로 crosshair+툴팁 표시.
    const onSyncedHover = (time: Time | null) => {
      if (time == null) { try { chart.clearCrosshairPosition(); } catch { /* noop */ } hide(); return; }
      const tt = time as number;
      let best: FlowSeriesPoint | null = null, bestD = Infinity;
      for (const p of series) { const d = Math.abs((p.t as number) - tt); if (d < bestD) { bestD = d; best = p; } }
      if (!best) { hide(); return; }
      try { chart.setCrosshairPosition(0, best.t as Time, zero); } catch { /* noop */ }
      let lw = 0; try { lw = chart.priceScale("left").width(); } catch { /* noop */ }
      const x = chart.timeScale().timeToCoordinate(best.t as Time);
      if (x != null) showAt(best.t, x + lw);
    };
    const syncCleanup = onReady?.(chart, zero, onSyncedHover);

    // 12:00 / 15:00 세로선 + 아래 값표 컬럼 위치 — timeScale 좌표 기반 (줌·리사이즈 시 재배치).
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
        // 값표 컬럼 x 비율(0~1) 갱신 — 컨테이너 폭 기준.
        const cw = containerRef.current?.clientWidth || 1;
        const fr = timeCols
          .map(c => {
            const x = chart.timeScale().timeToCoordinate(c.pt.t as Time);
            return { label: c.label, frac: x == null ? -1 : (x + lw) / cw };
          })
          .filter(f => f.frac >= 0);
        const key = fr.map(f => `${f.label}:${f.frac.toFixed(3)}`).join(",");
        if (key !== fracKeyRef.current) { fracKeyRef.current = key; setColFrac(fr); }
      };
      reposition();
      // 왼쪽 지수축 등장 등 레이아웃이 다음 프레임 이후 확정 → 지연 재계산 필요.
      [0, 60, 160, 320].forEach(ms => timers.push(window.setTimeout(() => reposition && reposition(), ms)));
      chart.timeScale().subscribeVisibleLogicalRangeChange(reposition);
      if (containerRef.current) { ro = new ResizeObserver(() => reposition && reposition()); ro.observe(containerRef.current); }
    }

    return () => {
      try { chart.unsubscribeCrosshairMove(onMove); } catch { /* noop */ }
      if (syncCleanup) syncCleanup();
      if (reposition) { try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(reposition); } catch { /* noop */ } }
      if (ro) ro.disconnect();
      timers.forEach(clearTimeout);
      if (vlEl) vlEl.innerHTML = "";
      chart.remove();
    };
  }, [series, enabled, unit, timeVisible, byT, indexSeries, indexLabel, indexBaseline, volumeSeries, timeCols, onReady]);

  // 값표도 헤더와 동일하게 금액 내림차순(+ 위 / − 아래) 정렬.
  const enabledDefs = INTRADAY_SERIES.filter(d => enabled[d.key]).sort((a, b) => summary[b.key] - summary[a.key]);

  return (
    <div className="border border-gray-200 rounded p-1.5 bg-white min-w-0">
      {/* 헤더 — 시장명(녹색) + 전체 투자자 요약값(당일=최신 / 일별=기간합계). 여러 줄 wrap. */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px] mb-1 px-0.5 tabular-nums leading-tight">
        <span className="font-bold text-green-600 text-xs">{marketLabel}</span>
        {summaryHint && <span className="text-[10px] text-gray-400">{summaryHint}</span>}
        {indexLabel && indexSeries && indexSeries.length > 1 && (
          <span className="text-[10px] text-green-700/70">▨ {indexLabel}</span>
        )}
        {(() => {
          // 금액 내림차순 → 순매수(+) 위, 순매도(−) 아래. 그 경계에서 줄바꿈으로 분리.
          const sorted = [...INTRADAY_SERIES].sort((a, b) => summary[b.key] - summary[a.key]);
          const firstNeg = sorted.findIndex(d => summary[d.key] < 0);
          return sorted.map((def, i) => (
            <Fragment key={def.key}>
              {i === firstNeg && firstNeg > 0 && <div className="basis-full h-0" />}
              <span className={`inline-flex items-baseline gap-1 ${enabled[def.key] ? "" : "opacity-50"}`}>
                <span className="text-white px-1 rounded text-[10px] font-medium"
                      style={{ backgroundColor: def.color }}>{def.label}</span>
                <span className={enabled[def.key] ? "font-bold" : "font-normal"}
                      style={{ color: netColor(summary[def.key]) }}>{fmtNet(summary[def.key], unit)}</span>
              </span>
            </Fragment>
          ));
        })()}
      </div>
      <div className="relative">
        <div ref={containerRef} className="w-full h-[220px] lg:h-[240px]" />
        <div ref={vlinesRef} className="absolute inset-0 pointer-events-none overflow-hidden z-10" />
        <div ref={tooltipRef}
             className="absolute pointer-events-none bg-white/30 backdrop-blur-[2px] border border-gray-200/60 rounded shadow-sm
                        px-2 py-1 text-xs text-gray-800 tabular-nums z-50 leading-snug"
             style={{ display: "none" }} />
      </div>

      {/* 차트 아래 값표 — 09:00 / 12:00 / 15:00 을 그래프의 실제 시간 위치에 맞춰 배치 */}
      {timeVisible && colFrac.length > 0 && enabledDefs.length > 0 && (
        <div className="relative mt-1.5 text-[10px] tabular-nums"
             style={{ height: 16 + enabledDefs.length * 15 }}>
          {colFrac.map(c => {
            const col = timeCols.find(tc => tc.label === c.label);
            if (!col) return null;
            const rightSide = c.frac > 0.5;   // 오른쪽 절반은 우측 앵커(화면 밖으로 안 나가게)
            const pos = rightSide ? { right: `${(1 - c.frac) * 100}%` } : { left: `${c.frac * 100}%` };
            return (
              <div key={c.label}
                   className={`absolute top-0 flex flex-col gap-0.5 ${rightSide ? "items-end" : "items-start"}`}
                   style={{ ...pos, maxWidth: "34%" }}>
                <span className="text-gray-500 font-semibold leading-none">{c.label}</span>
                {enabledDefs.map(def => (
                  <span key={def.key} className="inline-flex items-center gap-1 whitespace-nowrap leading-none">
                    <span className="text-white px-1 rounded text-[9px]"
                          style={{ backgroundColor: def.color }}>{def.label}</span>
                    <span className="font-bold" style={{ color: netColor(col.pt.values[def.key]) }}>
                      {fmtNet(col.pt.values[def.key], unit)}
                    </span>
                  </span>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default IntradayInvestorChart;
