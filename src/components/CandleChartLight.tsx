// lightweight-charts (TradingView) 기반 가격 차트
// — 라인/캔들 + 거래량 히스토그램 + 외인비율 (좌측 축) + 목표가/평단가 priceLine
// — 재렌더 시 줌 상태 보존 (visibleLogicalRange ref 저장/복원)
// — onReady 콜백으로 chart + anchor series 노출 → 다중 차트 crosshair sync 가능

import { useEffect, useRef } from "react";
import {
  createChart,
  ColorType,
  LineSeries,
  CandlestickSeries,
  HistogramSeries,
  LineStyle,
  type IChartApi,
  type SeriesType,
  type ISeriesApi,
  type Time,
  type LogicalRange,
  type MouseEventParams,
} from "lightweight-charts";
import type { PricePoint } from "../lib/api";
import type { Investor } from "../types";

const UP_COLOR    = "#dc2626";  // 양봉 빨강
const DN_COLOR    = "#2563eb";  // 음봉 파랑
const LINE_COLOR  = "#dc2626";  // 라인 모드 — 빨강 (한국식 상승 색)
const RATIO_COLOR = "#7c3aed";  // 외국인지분 (violet)
const TARGET_COLOR = "#f59e0b"; // 목표가 (amber)
const AVG_COLOR   = "#10b981";  // 내 평단가 (emerald)
const LABEL_BG    = "#475569";  // crosshair label 배경 — slate-600 (산뜻 + 가독성)

interface Props {
  prices: PricePoint[];
  investors: Investor[];
  targetPrice?: number;
  myAvgPrice?: number;
  mode: "line" | "candle";
  onReady?: (
    chart: IChartApi,
    anchor: ISeriesApi<SeriesType>,
    onSyncedHover?: (time: Time | null) => void,
  ) => (() => void) | void;
}

export function CandleChartLight({
  prices, investors, targetPrice, myAvgPrice, mode, onReady,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  // 재생성 시 줌 상태 복원용 — 마지막 visible logical range
  const visibleRangeRef = useRef<LogicalRange | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    if (prices.length < 2) return;

    const chart: IChartApi = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#374151",
        fontSize: 11,
        fontFamily: "system-ui, -apple-system, sans-serif",
      },
      grid: {
        vertLines: { color: "#f3f4f6" },
        horzLines: { color: "#f3f4f6" },
      },
      rightPriceScale: {
        borderColor: "#e5e7eb",
        scaleMargins: { top: 0.05, bottom: 0.28 },
      },
      leftPriceScale: {
        borderColor: "#e5e7eb",
        // 좌측 외인지분율 axis 는 숨김 — hover 시 misleading 한 좌표값 라벨 회피.
        // (lightweight-charts 가 per-side crosshair label visibility 를 지원 안 함)
        // 외인지분율 line 자체는 여전히 그려지고, latest 값은 헤더에 표시.
        visible: false,
        scaleMargins: { top: 0.05, bottom: 0.28 },
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
          labelBackgroundColor: LABEL_BG,
        },
        horzLine: {
          color: "#9ca3af", width: 1, style: LineStyle.Dotted,
          labelVisible: false,    // 우측 axis hover 라벨 숨김 — HTML 툴팁으로 대체
        },
      },
      handleScroll: true,
      handleScale: true,
      autoSize: true,
    });

    // ─── 가격 series ──────────────────────────────────────
    let priceSeries: ISeriesApi<SeriesType>;
    if (mode === "candle") {
      const candleData = prices
        .filter(p => p.open != null && p.high != null && p.low != null)
        .map(p => ({
          time: p.date as Time,
          open: p.open!,
          high: p.high!,
          low: p.low!,
          close: p.close,
        }));
      const s = chart.addSeries(CandlestickSeries, {
        upColor: UP_COLOR,
        downColor: DN_COLOR,
        borderUpColor: UP_COLOR,
        borderDownColor: DN_COLOR,
        wickUpColor: UP_COLOR,
        wickDownColor: DN_COLOR,
        priceLineVisible: false,         // 자동 priceLine 숨김
        lastValueVisible: false,         // 자동 우측 라벨 숨김 — "현재가" priceLine 으로 대체
      });
      s.setData(candleData);
      priceSeries = s;
    } else {
      const lineData = prices.map(p => ({ time: p.date as Time, value: p.close }));
      const s = chart.addSeries(LineSeries, {
        color: LINE_COLOR,
        lineWidth: 1,
        priceLineVisible: false,         // 자동 priceLine 숨김
        lastValueVisible: false,         // 자동 우측 라벨 숨김 — "현재가" priceLine 으로 대체
      });
      s.setData(lineData);
      priceSeries = s;
    }

    // ─── 거래량 histogram (overlay) ───────────────────────
    const volSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: "vol",
      priceFormat: { type: "volume" },
    });
    chart.priceScale("vol").applyOptions({
      scaleMargins: { top: 0.75, bottom: 0 },
    });
    const volData = prices.map(p => {
      const isUp = p.open != null ? p.close >= p.open : true;
      return {
        time: p.date as Time,
        value: p.volume,
        color: isUp ? "rgba(220, 38, 38, 0.45)" : "rgba(37, 99, 235, 0.45)",
      };
    });
    volSeries.setData(volData);

    // ─── 외국인 지분율 (좌측 축, 실선 — target/avg 점선과 구분) ─────
    const ratioByDate = new Map<string, number>();
    for (const inv of investors) {
      if (inv.date && inv.외국인비율 > 0) {
        ratioByDate.set(inv.date, inv.외국인비율);
      }
    }
    const ratioData = prices
      .map(p => {
        const v = ratioByDate.get(p.date);
        return v !== undefined ? { time: p.date as Time, value: v } : null;
      })
      .filter((d): d is { time: Time; value: number } => d !== null);
    let ratioSeries: ISeriesApi<"Line"> | null = null;
    if (ratioData.length >= 2) {
      ratioSeries = chart.addSeries(LineSeries, {
        color: RATIO_COLOR,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,    // 점선
        priceScaleId: "left",
        priceFormat: { type: "custom", formatter: (v: number) => `${v.toFixed(2)}%` },
        lastValueVisible: false,         // 우측 라벨 숨김
        priceLineVisible: false,         // 현재가 가로 점선 숨김
        crosshairMarkerVisible: false,   // hover 시 동그라미 마커 숨김
      });
      ratioSeries.setData(ratioData);
    }

    // ─── 가격 스케일에 목표가/평단가 포함 (autoscale 확장) ─────
    // priceLine 만으로는 가격 범위 밖이면 안 보임 → autoscaleInfoProvider 로 강제 포함
    priceSeries.applyOptions({
      autoscaleInfoProvider: (original: () => { priceRange: { minValue: number; maxValue: number }; margins?: unknown } | null) => {
        const auto = original();
        if (!auto) return null;
        const candidates = [auto.priceRange.minValue, auto.priceRange.maxValue];
        if (targetPrice && targetPrice > 0) candidates.push(targetPrice);
        if (myAvgPrice && myAvgPrice > 0) candidates.push(myAvgPrice);
        return {
          priceRange: {
            minValue: Math.min(...candidates),
            maxValue: Math.max(...candidates),
          },
          margins: auto.margins,
        };
      },
    });

    // ─── 목표가 / 평단가 priceLine ──────────────────
    if (targetPrice && targetPrice > 0) {
      priceSeries.createPriceLine({
        price: targetPrice,
        color: TARGET_COLOR,
        lineStyle: LineStyle.Dashed,
        lineWidth: 1,
        axisLabelVisible: true,
        title: `목표 ${targetPrice.toLocaleString()}`,
      });
    }
    if (myAvgPrice && myAvgPrice > 0) {
      priceSeries.createPriceLine({
        price: myAvgPrice,
        color: AVG_COLOR,
        lineStyle: LineStyle.Dashed,
        lineWidth: 1,
        axisLabelVisible: true,
        title: `내평단 ${Math.round(myAvgPrice).toLocaleString()}`,
      });
    }

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

    // ─── 데이터 lookup map (hover/sync 공용) ──────────────────
    const priceMap = new Map<string, PricePoint>();
    prices.forEach(p => priceMap.set(p.date, p));
    const ratioMap = new Map<string, number>();
    for (const inv of investors) {
      if (inv.date && inv.외국인비율 > 0) ratioMap.set(inv.date, inv.외국인비율);
    }

    const hideTooltip = () => {
      if (tooltipRef.current) tooltipRef.current.style.display = "none";
    };

    // x = timeScale.timeToCoordinate, y = priceSeries.priceToCoordinate(close)
    // 마우스 직접 hover & sync 모두 같은 로직 — crosshair 교차점에 배치
    const updateTooltipForTime = (time: Time): boolean => {
      const tooltip = tooltipRef.current;
      const container = containerRef.current;
      if (!tooltip || !container) return false;

      const x = chart.timeScale().timeToCoordinate(time);
      const p = priceMap.get(String(time));
      if (x == null || !p) { hideTooltip(); return false; }
      const y = priceSeries.priceToCoordinate(p.close);
      if (y == null) { hideTooltip(); return false; }

      let content = `<div class="text-[10px] text-gray-400 mb-0.5">${String(time)}</div>`;
      if (mode === "candle" && p.open != null && p.high != null && p.low != null) {
        // 양봉/음봉 따라 색 (한국식)
        const isUp = p.close >= p.open;
        const candleColor = isUp ? UP_COLOR : DN_COLOR;
        content += `<div><span class="text-gray-500">시작 </span><span style="color:${candleColor}">${p.open.toLocaleString()}원</span></div>`;
        content += `<div><span class="text-gray-500">고가 </span><span style="color:${candleColor}">${p.high.toLocaleString()}원</span></div>`;
        content += `<div><span class="text-gray-500">저가 </span><span style="color:${candleColor}">${p.low.toLocaleString()}원</span></div>`;
        content += `<div><span class="text-gray-500">종가 </span><span style="color:${candleColor}" class="font-bold">${p.close.toLocaleString()}원</span></div>`;
      } else {
        content += `<div><span class="text-gray-500">주가 </span><span style="color:${UP_COLOR}" class="font-bold">${p.close.toLocaleString()}원</span></div>`;
      }
      const r = ratioMap.get(String(time));
      if (r !== undefined) {
        content += `<div><span class="text-gray-500">외인지분 </span><span style="color:${RATIO_COLOR}">${r.toFixed(2)}%</span></div>`;
      }
      tooltip.innerHTML = content;
      tooltip.style.display = "block";

      // (x, y) 교차점 근처 — 화면 경계 회피
      const W = container.clientWidth;
      const H = container.clientHeight;
      const tw = tooltip.offsetWidth || 130;
      const th = tooltip.offsetHeight || 80;
      let left = x + 14;
      let top = y + 14;
      if (left + tw > W - 8) left = x - tw - 14;
      if (top + th > H - 8) top = y - th - 14;
      if (left < 8) left = 8;
      if (top < 8) top = 8;
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
      return true;
    };

    // 직접 hover
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
      const p = priceMap.get(String(time));
      if (p) chart.setCrosshairPosition(p.close, time, priceSeries);
      updateTooltipForTime(time);
    };

    // ─── 외부 sync 등록 ────────────────────────────────────
    const cleanupSync = onReady?.(chart, priceSeries, onSyncedHover);

    return () => {
      if (typeof cleanupSync === "function") cleanupSync();
      try { chart.unsubscribeCrosshairMove(tooltipHandler); } catch { /* noop */ }
      try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(rangeHandler); }
      catch { /* chart already removed */ }
      chart.remove();
    };
  }, [prices, investors, mode, targetPrice, myAvgPrice, onReady]);

  return (
    <div className="relative">
      <div ref={containerRef} className="w-full h-[220px] lg:h-[360px]" />
      <div ref={tooltipRef}
           className="absolute pointer-events-none bg-white/95 border border-gray-200 rounded shadow-md
                      px-2 py-1 text-xs text-gray-700 tabular-nums z-10 leading-snug"
           style={{ display: "none" }} />
    </div>
  );
}

export default CandleChartLight;
