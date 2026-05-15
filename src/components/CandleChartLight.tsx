// lightweight-charts (TradingView) 기반 가격 차트
// — 라인/캔들 + 거래량 히스토그램 + 외인비율 (좌측 축) + 목표가/평단가 priceLine
// — 재렌더 시 줌 상태 보존 (visibleLogicalRange ref 저장/복원)
// — onReady 콜백으로 chart + anchor series 노출 → 다중 차트 crosshair sync 가능

import { useEffect, useRef, useState } from "react";
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
import type { PricePoint, DividendEvent, SplitEvent, DartDisclosure } from "../lib/api";
import type { Investor } from "../types";

const UP_COLOR    = "#dc2626";  // 양봉 빨강
const DN_COLOR    = "#2563eb";  // 음봉 파랑

function fmtVol(v: number): string {
  if (v >= 100_000_000) return `${(v / 100_000_000).toFixed(1)}억`;
  if (v >= 10_000_000) return `${(v / 10_000_000).toFixed(1)}천만`;
  if (v >= 10_000) return `${Math.round(v / 10_000)}만`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return `${v}`;
}
const LINE_COLOR  = "#dc2626";  // 라인 모드 — 빨강 (한국식 상승 색)
const RATIO_COLOR = "#7c3aed";  // 외국인지분 (violet)
const TARGET_COLOR = "#f59e0b"; // 목표가 (amber)
const AVG_COLOR   = "#10b981";  // 내 평단가 (emerald)
const ENTRY_COLOR = "#8b5cf6";  // 기대가 (violet — 매수 희망가)
const LABEL_BG    = "#475569";  // crosshair label 배경 — slate-600 (산뜻 + 가독성)

interface Props {
  prices: PricePoint[];
  investors: Investor[];
  targetPrice?: number;
  myAvgPrice?: number;
  entryPrice?: number;
  dividends?: DividendEvent[];
  splits?: SplitEvent[];
  disclosures?: DartDisclosure[];
  ticker?: string;
  mode: "line" | "candle";
  onReady?: (
    chart: IChartApi,
    anchor: ISeriesApi<SeriesType>,
    onSyncedHover?: (time: Time | null) => void,
  ) => (() => void) | void;
}

const DIV_COLOR = "#0d9488";   // 배당락 marker — teal-600
const SPLIT_COLOR = "#a855f7"; // 액면분할 marker — purple-500
const DART_COLOR = "#ea580c";  // DART 공시 marker — orange-600

// 공시 제목에서 차트 라벨용 짧은 키워드 추출 (우선순위 순)
//   매칭 안 되면 null → 호출자가 "N건" 카운트로 폴백
// 분할/병합 키워드는 Yahoo splits 마커가 이미 표시하므로 여기선 제외 (중복 회피).
// 배당도 마찬가지 — 배당락 마커가 별도 — 단 "배당 결정" 공시는 결정일 ≠ 배당락일이라 유지.
function pickImportantKeyword(titles: string[]): string | null {
  for (const t of titles) {
    if (t.includes("잠정실적") || t.includes("영업(잠정)")) return "잠정실적";
    if (t.includes("합병")) return "합병";
    if (t.includes("유상증자")) return "유상증자";
    if (t.includes("무상증자")) return "무상증자";
    if (t.includes("감자")) return "감자";
    if (t.includes("최대주주")) return "최대주주변경";
    if (t.includes("자기주식 취득")) return "자사주매수";
    if (t.includes("자기주식 처분")) return "자사주처분";
    if (t.includes("자기주식 소각") || t.includes("주식 소각") || t.includes("주식소각")) return "주식소각";
    if (t.includes("배당")) return "배당";
    if (t.includes("공급계약") || t.includes("단일판매")) return "대형계약";
    if (t.includes("주요사항")) return "주요사항";
    if (t.includes("기업가치")) return "기업가치";
  }
  return null;
}

export function CandleChartLight({
  prices, investors, targetPrice, myAvgPrice, entryPrice, dividends, splits, disclosures, ticker, mode, onReady,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<HTMLDivElement>(null);
  // 공시 팝업 — 마커 클릭 시 활성, 닫기 전까지 유지
  const [discPopup, setDiscPopup] = useState<{ date: string; x: number; y: number } | null>(null);
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
        if (entryPrice && entryPrice > 0) candidates.push(entryPrice);
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
    if (entryPrice && entryPrice > 0) {
      priceSeries.createPriceLine({
        price: entryPrice,
        color: ENTRY_COLOR,
        lineStyle: LineStyle.Dashed,
        lineWidth: 1,
        axisLabelVisible: true,
        title: `기대 ${Math.round(entryPrice).toLocaleString()}`,
      });
    }

    // ─── 이벤트 마커 데이터 (배당락 / 액면분할 / DART 공시) ──
    const priceDateSet = new Set(prices.map(p => p.date));
    const divMap = new Map<string, number>();
    if (dividends) for (const d of dividends) {
      if (priceDateSet.has(d.date)) divMap.set(d.date, d.amount);
    }
    const splitMap = new Map<string, string>();
    if (splits) for (const s of splits) {
      if (priceDateSet.has(s.date)) splitMap.set(s.date, s.ratio);
    }
    // DART 공시 — 일자별 그룹, 중요 공시는 키워드 라벨로 요약
    // Yahoo split 일자 ±3일 내 분할/병합/변경상장 공시는 제외 (Yahoo 마커와 중복)
    const splitDates = new Set(splitMap.keys());
    const isNearSplit = (date: string): boolean => {
      const t = new Date(date).getTime();
      for (const sd of splitDates) {
        if (Math.abs(t - new Date(sd).getTime()) <= 3 * 86400_000) return true;
      }
      return false;
    };
    const isSplitTopic = (title: string): boolean =>
      /(주식분할|액면분할|주식병합|액면병합|변경상장.*분할|변경상장.*소각)/.test(title);

    const dartMap = new Map<string, { count: number; titles: string[] }>();
    if (disclosures) for (const d of disclosures) {
      if (!priceDateSet.has(d.date)) continue;
      if (isSplitTopic(d.title) && isNearSplit(d.date)) continue;
      const cur = dartMap.get(d.date);
      if (cur) { cur.count++; cur.titles.push(d.title); }
      else dartMap.set(d.date, { count: 1, titles: [d.title] });
    }

    // 분할 일자에 정확히 같은 날 Naver 분할 관련 공시가 있을 때만 URL 매칭
    // — 추정 매칭은 오용 위험이라 제외, 매칭 없으면 클릭 비활성
    const splitDiscUrlMap = new Map<string, string>();
    if (disclosures && splitMap.size > 0) {
      for (const [splitDate] of splitMap) {
        const match = disclosures.find(d => d.date === splitDate && isSplitTopic(d.title));
        if (match) splitDiscUrlMap.set(splitDate, match.url);
      }
    }

    // ─── 마커 렌더 (HTML overlay: 가는 세로선 + 화살촉 + 라벨) ──
    const renderEventMarkers = () => {
      const layer = markersRef.current;
      if (!layer) return;
      layer.innerHTML = "";

      const renderBelow = (date: string, color: string, text: string, slot = 0) => {
        const p = priceMap.get(date);
        if (!p) return;
        const x = chart.timeScale().timeToCoordinate(date as Time);
        if (x == null) return;
        const baseY = priceSeries.priceToCoordinate(p.low ?? p.close);
        if (baseY == null) return;
        const wrap = document.createElement("div");
        wrap.style.cssText =
          `position:absolute;left:${x}px;top:${baseY + 4 + slot * 32}px;` +
          `transform:translateX(-50%);pointer-events:none;z-index:4;` +
          `display:flex;flex-direction:column;align-items:center;`;
        const head = document.createElement("div");
        head.style.cssText =
          `width:0;height:0;border-left:3px solid transparent;` +
          `border-right:3px solid transparent;border-bottom:5px solid ${color};`;
        wrap.appendChild(head);
        const line = document.createElement("div");
        line.style.cssText = `width:1px;height:18px;background:${color};`;
        wrap.appendChild(line);
        const label = document.createElement("div");
        label.style.cssText =
          `background:#ffffff;border:1px solid ${color};color:${color};` +
          `border-radius:3px;padding:0 4px;font-size:9px;font-weight:600;` +
          `white-space:nowrap;line-height:1.4;margin-top:1px;`;
        label.textContent = text;
        wrap.appendChild(label);
        layer.appendChild(wrap);
      };

      const renderAbove = (
        date: string, color: string, text: string,
        slot = 0,
        onClick?: (px: number, py: number) => void,
      ) => {
        const p = priceMap.get(date);
        if (!p) return;
        const x = chart.timeScale().timeToCoordinate(date as Time);
        if (x == null) return;
        const baseY = priceSeries.priceToCoordinate(p.high ?? p.close);
        if (baseY == null) return;
        const totalH = 18 + 5 + 18;  // line + arrow + label
        const topY = baseY - 4 - totalH - slot * 32;
        const wrap = document.createElement("div");
        const interactive = !!onClick;
        wrap.style.cssText =
          `position:absolute;left:${x}px;top:${topY}px;` +
          `transform:translateX(-50%);z-index:4;` +
          `pointer-events:${interactive ? "auto" : "none"};` +
          `cursor:${interactive ? "pointer" : "default"};` +
          `display:flex;flex-direction:column;align-items:center;`;
        if (onClick) {
          wrap.addEventListener("click", e => {
            e.stopPropagation();
            onClick(x, topY);
          });
        }
        const label = document.createElement("div");
        label.style.cssText =
          `background:#ffffff;border:1px solid ${color};color:${color};` +
          `border-radius:3px;padding:0 4px;font-size:9px;font-weight:600;` +
          `white-space:nowrap;line-height:1.4;margin-bottom:1px;`;
        label.textContent = text;
        wrap.appendChild(label);
        const line = document.createElement("div");
        line.style.cssText = `width:1px;height:18px;background:${color};`;
        wrap.appendChild(line);
        const head = document.createElement("div");
        head.style.cssText =
          `width:0;height:0;border-left:3px solid transparent;` +
          `border-right:3px solid transparent;border-top:5px solid ${color};`;
        wrap.appendChild(head);
        layer.appendChild(wrap);
      };

      // 배당락 (아래)
      for (const [date, amount] of divMap) {
        renderBelow(date, DIV_COLOR, `배당락 ${Math.round(amount).toLocaleString()}원`);
      }
      // 액면분할 (위) — 정확히 같은 날 Naver 분할 공시 있을 때만 클릭 가능
      for (const [date, ratio] of splitMap) {
        const url = splitDiscUrlMap.get(date);
        renderAbove(
          date, SPLIT_COLOR, `분할 ${ratio}`, 0,
          url ? () => window.open(url, "_blank", "noopener,noreferrer") : undefined,
        );
      }
      // 공시 (위) — 클릭 가능, 클릭 시 useState 로 팝업 활성화 (닫기 전까지 유지)
      for (const [date, info] of dartMap) {
        const slot = splitMap.has(date) ? 1 : 0;
        const keyword = pickImportantKeyword(info.titles);
        const text = keyword
          ? keyword + (info.count > 1 ? ` +${info.count - 1}` : "")
          : `${info.count}건`;
        renderAbove(date, DART_COLOR, text, slot, (px, py) => {
          setDiscPopup({ date, x: px, y: py });
        });
      }
    };
    const initMarkerTimer = window.setTimeout(renderEventMarkers, 0);

    // ─── 줌 상태 복원/저장 ──────────────────────────────────
    if (visibleRangeRef.current) {
      chart.timeScale().setVisibleLogicalRange(visibleRangeRef.current);
    } else {
      chart.timeScale().fitContent();
    }
    const rangeHandler = (range: LogicalRange | null) => {
      if (range) visibleRangeRef.current = range;
      renderEventMarkers();   // 줌/스크롤 시 위치 갱신
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(rangeHandler);

    const resizeObs = new ResizeObserver(() => renderEventMarkers());
    if (containerRef.current) resizeObs.observe(containerRef.current);

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

      // 양봉/음봉 — 거래량 색에도 동일하게 사용
      const isUp = p.open != null ? p.close >= p.open : true;
      const dirColor = isUp ? UP_COLOR : DN_COLOR;

      // 종가대비 — 금액·% 동일 색 (양수 빨강 / 음수 파랑)
      const renderRow = (label: string, v: number, base: number) => {
        const d = ((v - base) / base) * 100;
        const sign = d >= 0 ? "+" : "";
        const c = d >= 0 ? UP_COLOR : DN_COLOR;
        return `<div><span class="text-gray-500">${label} </span>` +
          `<span style="color:${c}">${v.toLocaleString()}원 (${sign}${d.toFixed(2)}%)</span></div>`;
      };

      let content = `<div class="text-[10px] text-gray-400 mb-0.5">${String(time)}</div>`;
      if (mode === "candle" && p.open != null && p.high != null && p.low != null) {
        content += renderRow("시작", p.open, p.close);
        content += renderRow("고가", p.high, p.close);
        content += renderRow("저가", p.low, p.close);
        content += `<div><span class="text-gray-500">종가 </span><span style="color:${dirColor}" class="font-bold">${p.close.toLocaleString()}원</span></div>`;
      } else {
        content += `<div><span class="text-gray-500">주가 </span><span style="color:${UP_COLOR}" class="font-bold">${p.close.toLocaleString()}원</span></div>`;
      }
      if (p.volume > 0) {
        content += `<div><span class="text-gray-500">거래량 </span><span style="color:${dirColor}">${fmtVol(p.volume)}</span></div>`;
      }
      const r = ratioMap.get(String(time));
      if (r !== undefined) {
        content += `<div><span class="text-gray-500">외인지분 </span><span style="color:${RATIO_COLOR}">${r.toFixed(2)}%</span></div>`;
      }
      const div = divMap.get(String(time));
      if (div !== undefined) {
        content += `<div><span class="text-gray-500">배당락 </span><span style="color:${DIV_COLOR}" class="font-bold">${Math.round(div).toLocaleString()}원</span></div>`;
      }
      const sp = splitMap.get(String(time));
      if (sp !== undefined) {
        content += `<div><span class="text-gray-500">분할 </span><span style="color:${SPLIT_COLOR}" class="font-bold">${sp}</span></div>`;
      }
      // 공시는 hover 툴팁에 넣지 않음 (마커 클릭 시 별도 팝업으로 표시)
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
      window.clearTimeout(initMarkerTimer);
      resizeObs.disconnect();
      if (typeof cleanupSync === "function") cleanupSync();
      try { chart.unsubscribeCrosshairMove(tooltipHandler); } catch { /* noop */ }
      try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(rangeHandler); }
      catch { /* chart already removed */ }
      chart.remove();
    };
  }, [prices, investors, mode, targetPrice, myAvgPrice, entryPrice, dividends, splits, disclosures, ticker, onReady]);

  // 팝업 dismiss — 외부 클릭 / Esc
  useEffect(() => {
    if (!discPopup) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDiscPopup(null); };
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-disc-popup]")) setDiscPopup(null);
    };
    window.addEventListener("keydown", onKey);
    // setTimeout 으로 등록 — 마커 클릭 자체가 즉시 닫히는 것 방지
    const t = window.setTimeout(() => window.addEventListener("click", onClick), 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("click", onClick);
      window.clearTimeout(t);
    };
  }, [discPopup]);

  const popupItems = discPopup
    ? (disclosures ?? []).filter(d => d.date === discPopup.date)
    : [];

  return (
    <div className="relative">
      <div ref={containerRef} className="w-full h-[220px] lg:h-[360px]" />
      <div ref={markersRef}
           className="absolute inset-0 pointer-events-none overflow-hidden" />
      <div ref={tooltipRef}
           className="absolute pointer-events-none bg-white border border-gray-200 rounded shadow-md
                      px-2 py-1 text-xs text-gray-700 tabular-nums z-50 leading-snug"
           style={{ display: "none" }} />
      {discPopup && popupItems.length > 0 && (
        <div data-disc-popup
             className="absolute z-30 bg-white border border-orange-300 rounded-lg shadow-xl
                        text-xs leading-snug"
             style={{
               left: discPopup.x,
               top: Math.max(4, discPopup.y - 8),
               transform: "translate(-50%, -100%)",
               minWidth: 220,
               maxWidth: 360,
             }}>
          <div className="flex items-center justify-between px-2 py-1 border-b border-gray-100 bg-orange-50 rounded-t-lg">
            <span className="text-[11px] text-gray-600 font-medium">
              {discPopup.date} 공시 {popupItems.length}건
            </span>
            <button onClick={() => setDiscPopup(null)}
                    className="text-gray-400 hover:text-gray-700 text-sm leading-none ml-2">
              ✕
            </button>
          </div>
          <div className="px-2 py-1.5 space-y-1 max-h-60 overflow-y-auto">
            {popupItems.map((d, i) => (
              <a key={i} href={d.url} target="_blank" rel="noopener noreferrer"
                 className="block text-orange-700 hover:underline">
                📋 {d.title}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default CandleChartLight;
