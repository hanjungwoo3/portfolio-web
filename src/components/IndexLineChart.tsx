// 지수 미니 라인 차트 — KOSPI/KOSDAQ 등 단순 종가 라인 + 거래량 (선택)
//   InvestorChartLight 와 같은 카드/툴팁 스타일로 4열 그리드에 잘 어울리도록.

import { useEffect, useRef } from "react";
import {
  createChart,
  ColorType,
  LineSeries,
  CandlestickSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type SeriesType,
  type LogicalRange,
  type MouseEventParams,
  type Time,
} from "lightweight-charts";
import type { PricePoint } from "../lib/api";
import type { MarketEvent } from "../lib/marketEvents";
import { EVENT_COLORS, eventDisplay, eventShort } from "../lib/marketEvents";

const UP_COLOR   = "#dc2626";   // 양봉 / 라인 (한국식 빨강)
const DN_COLOR   = "#2563eb";   // 음봉 (한국식 파랑)
const VIX_COLOR  = "#9333ea";   // VIX (purple-600 — 공포지수)

interface Props {
  label: string;                      // "KOSPI" 등
  prices: PricePoint[];               // 날짜순 (오래됨 → 최신)
  heightClass?: string;               // Tailwind 높이 (기본 "h-[180px]")
  mode?: "line" | "candle";           // 기본 line
  onToggleMode?: () => void;          // 차트 우상단 캔들 토글 (옵션)
  events?: MarketEvent[];             // 시장 이벤트 마커 (옵션만기/금통위/FOMC 등)
  vixPrices?: PricePoint[];           // VIX 가격 (옵션, 좌측 축 오버레이)
  showVix?: boolean;                  // VIX 표시 여부
  onToggleVix?: () => void;           // VIX ON/OFF 토글 (옵션)
  onReady?: (
    chart: IChartApi,
    anchor: ISeriesApi<SeriesType>,
    onSyncedHover?: (time: Time | null) => void,
  ) => (() => void) | void;
}

function fmtIndex(v: number): string {
  return v >= 1000 ? Math.round(v).toLocaleString() : v.toFixed(2);
}

export function IndexLineChart({
  label, prices, heightClass = "h-[180px]",
  mode = "line", onToggleMode,
  events,
  vixPrices, showVix = false, onToggleVix,
  onReady,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<HTMLDivElement>(null);
  const visibleRangeRef = useRef<LogicalRange | null>(null);

  const last = prices.length > 0 ? prices[prices.length - 1] : null;
  const first = prices.length > 0 ? prices[0] : null;
  const trendUp = last && first ? last.close >= first.close : true;
  const lineColor = trendUp ? UP_COLOR : DN_COLOR;

  useEffect(() => {
    if (!containerRef.current) return;
    if (prices.length < 2) return;

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
        minimumWidth: 64,    // 4 미니 차트와 폭 통일 (X축 정렬용)
      },
      leftPriceScale: {
        visible: showVix && !!vixPrices && vixPrices.length >= 2,
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
          labelBackgroundColor: "#475569",
        },
        horzLine: {
          color: "#9ca3af", width: 1, style: LineStyle.Dotted,
          labelVisible: false,
        },
      },
      autoSize: true,
    });

    // 가격 series — 모드에 따라 라인 / 캔들 분기
    let priceSeries: ISeriesApi<SeriesType>;
    if (mode === "candle") {
      const candleData = prices
        .filter(p => p.open != null && p.high != null && p.low != null)
        .map(p => ({
          time: p.date as Time,
          open: p.open!, high: p.high!, low: p.low!, close: p.close,
        }));
      const s = chart.addSeries(CandlestickSeries, {
        upColor: UP_COLOR, downColor: DN_COLOR,
        borderUpColor: UP_COLOR, borderDownColor: DN_COLOR,
        wickUpColor: UP_COLOR, wickDownColor: DN_COLOR,
        priceLineVisible: false, lastValueVisible: false,
      });
      s.setData(candleData);
      priceSeries = s;
    } else {
      const s = chart.addSeries(LineSeries, {
        color: lineColor,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      s.setData(prices.map(p => ({ time: p.date as Time, value: p.close })));
      priceSeries = s;
    }

    // 거래량 히스토그램 제거 — Yahoo 가 indices 에 대해 의미있는 거래량 미제공

    // VIX 라인 (좌측 축, 보라 점선) — 공포 지수 오버레이
    if (showVix && vixPrices && vixPrices.length >= 2) {
      const priceDates = new Set(prices.map(p => p.date));
      const vixData = vixPrices
        .filter(p => priceDates.has(p.date))
        .map(p => ({ time: p.date as Time, value: p.close }));
      if (vixData.length >= 2) {
        const vixSeries = chart.addSeries(LineSeries, {
          priceScaleId: "left",
          color: VIX_COLOR,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        vixSeries.setData(vixData);
      }
    }

    // 시장 이벤트 마커 (옵션만기 / 쿼드 — HTML overlay, 배당락/공시와 동일 스타일)
    const priceMap = new Map(prices.map(p => [p.date, p]));
    const renderEventMarkers = () => {
      const layer = markersRef.current;
      if (!layer) return;
      layer.innerHTML = "";
      if (!events || events.length === 0) return;
      for (const e of events) {
        const p = priceMap.get(e.date);
        if (!p) continue;
        const x = chart.timeScale().timeToCoordinate(e.date as Time);
        if (x == null) continue;
        // 옵션만기/쿼드/금통위/FOMC — 모두 아래쪽 화살표 (캔들/라인 저점 기준)
        const baseRef = mode === "candle" && p.low != null ? p.low : p.close;
        const baseY = priceSeries.priceToCoordinate(baseRef);
        if (baseY == null) continue;
        const color = EVENT_COLORS[e.type];

        const wrap = document.createElement("div");
        wrap.style.cssText =
          `position:absolute;left:${x}px;top:${baseY + 4}px;` +
          `transform:translateX(-50%);pointer-events:none;z-index:4;` +
          `display:flex;flex-direction:column;align-items:center;`;
        // 화살촉
        const head = document.createElement("div");
        head.style.cssText =
          `width:0;height:0;border-left:3px solid transparent;` +
          `border-right:3px solid transparent;border-bottom:5px solid ${color};`;
        wrap.appendChild(head);
        // 1px 가는 세로선
        const line = document.createElement("div");
        line.style.cssText = `width:1px;height:18px;background:${color};`;
        wrap.appendChild(line);
        // 라벨
        const label = document.createElement("div");
        label.style.cssText =
          `background:#ffffff;border:1px solid ${color};color:${color};` +
          `border-radius:3px;padding:0 4px;font-size:9px;font-weight:600;` +
          `white-space:nowrap;line-height:1.4;margin-top:1px;`;
        label.textContent = eventShort(e);
        wrap.appendChild(label);
        layer.appendChild(wrap);
      }
    };
    const initMarkerTimer = window.setTimeout(renderEventMarkers, 0);

    // 줌 복원
    if (visibleRangeRef.current) {
      chart.timeScale().setVisibleLogicalRange(visibleRangeRef.current);
    } else {
      chart.timeScale().fitContent();
    }
    const rangeHandler = (range: LogicalRange | null) => {
      if (range) visibleRangeRef.current = range;
      renderEventMarkers();   // 줌/스크롤 시 마커 위치 갱신
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(rangeHandler);

    const resizeObs = new ResizeObserver(() => renderEventMarkers());
    if (containerRef.current) resizeObs.observe(containerRef.current);

    const hideTooltip = () => {
      if (tooltipRef.current) tooltipRef.current.style.display = "none";
    };

    const updateTooltipForTime = (time: Time): boolean => {
      const tip = tooltipRef.current;
      const container = containerRef.current;
      if (!tip || !container) return false;
      const x = chart.timeScale().timeToCoordinate(time);
      const p = priceMap.get(String(time));
      if (x == null || !p) { hideTooltip(); return false; }
      const y = priceSeries.priceToCoordinate(p.close);
      if (y == null) { hideTooltip(); return false; }
      let content = `<div class="text-[10px] text-gray-400 mb-0.5">${String(time)}</div>`;
      if (mode === "candle" && p.open != null && p.high != null && p.low != null) {
        const isUp = p.close >= p.open;
        const c = isUp ? UP_COLOR : DN_COLOR;
        content += `<div><span class="text-gray-500">시가 </span><span style="color:${c}">${fmtIndex(p.open)}</span></div>`;
        content += `<div><span class="text-gray-500">고가 </span><span style="color:${c}">${fmtIndex(p.high)}</span></div>`;
        content += `<div><span class="text-gray-500">저가 </span><span style="color:${c}">${fmtIndex(p.low)}</span></div>`;
        content += `<div><span class="text-gray-500">종가 </span><span style="color:${c}" class="font-bold">${fmtIndex(p.close)}</span></div>`;
      } else {
        content += `<div><span class="text-gray-500">종가 </span><span style="color:${lineColor}" class="font-bold">${fmtIndex(p.close)}</span></div>`;
      }
      // 해당 일자의 시장 이벤트
      if (events && events.length > 0) {
        const dayEvents = events.filter(e => e.date === String(time));
        for (const e of dayEvents) {
          content += `<div style="color:${EVENT_COLORS[e.type]}" class="font-bold">📌 ${eventDisplay(e)}</div>`;
        }
      }
      // VIX 값
      if (showVix && vixPrices) {
        const vix = vixPrices.find(v => v.date === String(time));
        if (vix) {
          content += `<div><span class="text-gray-500">VIX </span><span style="color:${VIX_COLOR}">${vix.close.toFixed(2)}</span></div>`;
        }
      }
      tip.innerHTML = content;
      tip.style.display = "block";
      void tip.offsetHeight;   // 강제 reflow — offsetWidth 정확히 측정
      // VIX ON 시 좌측 축이 활성화되면 timeToCoordinate(x) 는 plot 영역 기준이라
      // 컨테이너 좌표와 어긋남 → leftAxisWidth 만큼 보정
      const leftAxisWidth = chart.priceScale("left").width() ?? 0;
      const cx = leftAxisWidth + x;     // 컨테이너 기준 cursor x
      const cy = y;                     // y 는 우측 priceScale 기준 — container 와 동일
      const W = container.clientWidth;
      const H = container.clientHeight;
      const tw = tip.offsetWidth || 130;
      const th = tip.offsetHeight || 90;
      // 마우스 따라가기 + 절대 cursor 좌측으로 flip 안 함 (세로선 항상 보이도록)
      let left = cx + 16;
      if (left + tw > W - 4) left = W - tw - 4;
      if (left < 4) left = 4;
      let top = cy + 16;
      if (top + th > H - 4) top = cy - th - 16;
      if (top < 4) top = 4;
      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
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
      const p = priceMap.get(String(time));
      if (p) chart.setCrosshairPosition(p.close, time, priceSeries);
      updateTooltipForTime(time);
    };

    const cleanupSync = onReady?.(chart, priceSeries, onSyncedHover);

    return () => {
      window.clearTimeout(initMarkerTimer);
      resizeObs.disconnect();
      if (typeof cleanupSync === "function") cleanupSync();
      try { chart.unsubscribeCrosshairMove(tooltipHandler); } catch { /* noop */ }
      try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(rangeHandler); }
      catch { /* removed */ }
      chart.remove();
    };
  }, [prices, lineColor, mode, events, vixPrices, showVix, onReady]);

  return (
    <div className="border border-gray-200 rounded p-2 bg-white">
      <div className="flex items-baseline gap-2 text-xs mb-1 flex-wrap">
        <span className="font-bold" style={{ color: lineColor }}>{label}</span>
        {last && (
          <span className="tabular-nums font-bold" style={{ color: lineColor }}>
            {fmtIndex(last.close)}
          </span>
        )}
        {last && first && (
          <span className={`tabular-nums text-[10px]
                            ${last.close >= first.close ? "text-rose-600" : "text-blue-600"}`}>
            {(((last.close - first.close) / first.close) * 100).toFixed(2)}%
          </span>
        )}
        <span className="text-gray-400 text-[10px] ml-auto">200일</span>
        {/* VIX 토글 — 공포지수 오버레이 */}
        {onToggleVix && (
          <button onClick={onToggleVix}
                  title={showVix ? "VIX 숨기기" : "VIX 보이기"}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                    showVix
                      ? "bg-purple-100 text-purple-700 border-purple-300"
                      : "text-gray-400 border-gray-200 hover:bg-gray-100"
                  }`}>
            VIX {showVix ? "ON" : "OFF"}
          </button>
        )}
        {/* 캔들 모드 토글 — 차트 헤더 우상단 */}
        {onToggleMode && (
          <button onClick={onToggleMode}
                  title={mode === "candle" ? "라인 차트로" : "캔들 차트로"}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                    mode === "candle"
                      ? "bg-amber-100 text-amber-700 border-amber-300"
                      : "text-gray-400 border-gray-200 hover:bg-gray-100"
                  }`}>
            🕯 캔들 {mode === "candle" ? "ON" : "OFF"}
          </button>
        )}
      </div>
      {/* 이벤트 마커 범례 — 옵션만기 / 쿼드러플 + VIX */}
      {(events && events.length > 0) || (showVix && vixPrices && vixPrices.length >= 2) ? (
        <div className="flex items-center gap-2 text-[10px] text-gray-500 mb-1 flex-wrap">
          {events && events.length > 0 && (
            <>
              <span className="flex items-center gap-1"
                    title="매월 둘째 목요일 — 옵션 가격 변동성 ↑">
                <span className="inline-block w-2 h-2 rounded-full"
                      style={{ background: EVENT_COLORS["option-expiry"] }}></span>
                <span>옵만 (옵션만기)</span>
              </span>
              <span className="flex items-center gap-1"
                    title="3·6·9·12월 둘째 목요일 — 선물·옵션 동시 만기, 변동성 큰 날">
                <span className="inline-block w-2 h-2 rounded-full"
                      style={{ background: EVENT_COLORS.quadruple }}></span>
                <span>쿼드 (쿼드러플 위칭)</span>
              </span>
            </>
          )}
          {showVix && vixPrices && vixPrices.length >= 2 && (
            <span className="flex items-center gap-1"
                  title="VIX — S&P500 옵션 내재변동성, 미국·글로벌 공포지수">
              <span className="inline-block w-3 border-t border-dashed"
                    style={{ borderColor: VIX_COLOR }}></span>
              <span style={{ color: VIX_COLOR }}>VIX (공포지수)</span>
            </span>
          )}
        </div>
      ) : null}
      <div className="relative">
        <div ref={containerRef} className={`w-full ${heightClass}`} />
        <div ref={markersRef}
             className="absolute inset-0 pointer-events-none overflow-hidden" />
        <div ref={tooltipRef}
             className="absolute pointer-events-none bg-white/95 border border-gray-200 rounded shadow-md
                        px-2 py-1 text-xs text-gray-700 tabular-nums z-10 leading-snug"
             style={{ display: "none" }} />
      </div>
    </div>
  );
}

export default IndexLineChart;
