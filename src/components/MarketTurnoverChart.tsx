// 시장 일별 거래대금 미니 차트 — 코스피/코스닥 공용.
//   히스토그램: 일별 거래대금(토스 지수 캔들 amount = KRX 실거래대금). 지수 상승일=빨강 / 하락일=파랑.
//   라인(진회색): 20일 평균 거래대금 — "요즘 돈이 붙는 중인지" 추세.
//   라인(연회색, 왼쪽 축): 지수 종가 — 거래대금 급증이 상승·하락 어느 쪽에 붙었는지 대조용.
//   crosshair sync anchor = 20일 평균 라인 (전 구간 값이 있어 hover 가 끊기지 않음)

import { useEffect, useRef } from "react";
import {
  createChart, ColorType, LineSeries, HistogramSeries, LineStyle,
  type IChartApi, type Time, type LogicalRange, type MouseEventParams,
} from "lightweight-charts";
import type { MarketTurnoverPoint } from "../lib/api";
import type { SyncRegistrar } from "../lib/useCrosshairSync";
import { fmtAmount, MA_DAYS } from "../lib/marketTurnover";

const UP_BAR   = "#fca5a5";   // 지수 상승일 (red-300)
const DOWN_BAR = "#93c5fd";   // 지수 하락일 (blue-300)
const MA_COLOR = "#4b5563";   // 20일 평균 (gray-600)
const IDX_COLOR = "#a78bfa";  // 지수 종가 (violet-400) — 막대와 색이 겹치지 않게

interface Props {
  points: MarketTurnoverPoint[];   // 오름차순(과거→최신). 이미 기간만큼 잘린 것
  ma: number[];                    // points 와 같은 길이의 20일 평균
  upFlags: boolean[];              // points 와 같은 길이 — 전일 대비 지수 상승 여부
  label: string;                   // "코스피" / "코스닥"
  resetKey: number;                // 기간(일수) — 바뀌면 저장된 줌을 버리고 전체를 다시 맞춤
  onReady?: SyncRegistrar;
}

export function MarketTurnoverChart({ points, ma, upFlags, label, resetKey, onReady }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const visibleRangeRef = useRef<LogicalRange | null>(null);
  const rangeKeyRef = useRef<number | null>(null);

  useEffect(() => {
    if (!containerRef.current || points.length < 2) return;

    const chart: IChartApi = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#374151", fontSize: 10,
        fontFamily: "system-ui, -apple-system, sans-serif", attributionLogo: false,
      },
      grid: { vertLines: { color: "#f3f4f6" }, horzLines: { color: "#f3f4f6" } },
      // 거래대금(막대+평균)은 아래 6할, 지수 라인은 위 4할 — 겹쳐도 서로 안 가림.
      rightPriceScale: { borderColor: "#e5e7eb", scaleMargins: { top: 0.42, bottom: 0.02 } },
      leftPriceScale: { visible: true, borderColor: "#e5e7eb", scaleMargins: { top: 0.04, bottom: 0.62 } },
      timeScale: { borderColor: "#e5e7eb", timeVisible: false, secondsVisible: false, fixLeftEdge: true, fixRightEdge: true },
      // 드래그는 이동(팬)만 — 시간축 드래그 줌·끝단 스트레치 방지. 줌은 휠/핀치.
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: { time: false, price: true } },
      crosshair: {
        mode: 1,
        vertLine: { color: "#9ca3af", width: 1, style: LineStyle.Dotted, labelBackgroundColor: "#475569" },
        horzLine: { color: "#9ca3af", width: 1, style: LineStyle.Dotted, labelVisible: false },
      },
      autoSize: true,
    });

    // 조 단위 축 라벨 — 원 그대로 넣고 표시만 변환(막대·평균 공용).
    const amountFormat = { type: "custom" as const, formatter: (v: number) => fmtAmount(v), minMove: 1e8 };

    // 지수 종가 (왼쪽 축) — 막대 뒤에 먼저 깔림
    const idxLine = chart.addSeries(LineSeries, {
      priceScaleId: "left", color: IDX_COLOR, lineWidth: 1,
      priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
    });
    idxLine.setData(points.map(p => ({ time: p.date as Time, value: p.close })));

    // 일별 거래대금 막대 — 지수 상승일 빨강 / 하락일 파랑
    const bars = chart.addSeries(HistogramSeries, {
      priceScaleId: "right", priceFormat: amountFormat,
      base: 0, priceLineVisible: false, lastValueVisible: false,
    });
    bars.setData(points.map((p, i) => ({
      time: p.date as Time, value: p.amount, color: upFlags[i] ? UP_BAR : DOWN_BAR,
    })));

    // 20일 평균 거래대금
    const maLine = chart.addSeries(LineSeries, {
      priceScaleId: "right", color: MA_COLOR, lineWidth: 1, priceFormat: amountFormat,
      priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
    });
    maLine.setData(points.map((p, i) => ({ time: p.date as Time, value: ma[i] })));

    // 저장된 줌은 '같은 기간 안에서의' 재생성(30분 refetch 등)에만 복원한다.
    // 기간 토글로 봉 수가 바뀌면 버려야 한다 — 3개월(66봉) 기준 logical range 를
    // 2년(450봉)에 그대로 적용하면 앞쪽 66봉만 보이고 나머지가 화면 밖으로 나간다.
    if (rangeKeyRef.current !== resetKey) {
      visibleRangeRef.current = null;
      rangeKeyRef.current = resetKey;
    }
    if (visibleRangeRef.current) chart.timeScale().setVisibleLogicalRange(visibleRangeRef.current);
    else chart.timeScale().fitContent();
    const rangeHandler = (r: LogicalRange | null) => { if (r) visibleRangeRef.current = r; };
    chart.timeScale().subscribeVisibleLogicalRangeChange(rangeHandler);

    const byDate = new Map(points.map((p, i) => [p.date, { p, ma: ma[i], prev: points[i - 1] }]));
    const hideTooltip = () => { if (tooltipRef.current) tooltipRef.current.style.display = "none"; };

    const updateTooltipForTime = (time: Time): boolean => {
      const tooltip = tooltipRef.current, container = containerRef.current;
      if (!tooltip || !container) return false;
      const hit = byDate.get(String(time));
      const x = chart.timeScale().timeToCoordinate(time);
      if (x == null || !hit) { hideTooltip(); return false; }
      const { p, ma: avg, prev } = hit;
      const y = maLine.priceToCoordinate(avg) ?? 12;
      const vsAvg = avg > 0 ? (p.amount / avg - 1) * 100 : 0;
      const vsColor = vsAvg >= 0 ? "#dc2626" : "#2563eb";
      const chg = prev ? (p.close / prev.close - 1) * 100 : 0;
      const chgColor = chg > 0 ? "#dc2626" : chg < 0 ? "#2563eb" : "#6b7280";
      let html = `<div class="text-[10px] text-gray-400 mb-0.5">${String(time)}</div>`;
      html += `<div><span class="text-gray-500">거래대금 </span><span class="font-bold" style="color:${vsColor}">${fmtAmount(p.amount)}</span></div>`;
      html += `<div><span class="text-gray-500">${MA_DAYS}일평균 </span><span>${fmtAmount(avg)}</span>`
            + `<span style="color:${vsColor}"> (${vsAvg >= 0 ? "+" : ""}${vsAvg.toFixed(0)}%)</span></div>`;
      html += `<div><span class="text-gray-500">${label} </span><span>${p.close.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>`;
      if (prev) html += `<span style="color:${chgColor}"> (${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%)</span>`;
      html += `</div>`;
      tooltip.innerHTML = html;
      tooltip.style.display = "block";
      const W = container.clientWidth, H = container.clientHeight;
      const tw = tooltip.offsetWidth || 140, th = tooltip.offsetHeight || 70;
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
      const hit = byDate.get(String(time));
      if (hit) chart.setCrosshairPosition(hit.ma, time, maLine);
      updateTooltipForTime(time);
    };

    const cleanupSync = onReady?.(chart, maLine, onSyncedHover);

    return () => {
      if (typeof cleanupSync === "function") cleanupSync();
      try { chart.unsubscribeCrosshairMove(tooltipHandler); } catch { /* noop */ }
      try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(rangeHandler); } catch { /* noop */ }
      chart.remove();
    };
  }, [points, ma, upFlags, label, resetKey, onReady]);

  return (
    <div className="relative">
      <div ref={containerRef} className="w-full h-[190px]" />
      <div ref={tooltipRef}
           className="absolute pointer-events-none bg-white border border-gray-200 rounded shadow-md
                      px-2 py-1 text-xs text-gray-700 tabular-nums z-50 leading-snug"
           style={{ display: "none" }} />
    </div>
  );
}

export default MarketTurnoverChart;
