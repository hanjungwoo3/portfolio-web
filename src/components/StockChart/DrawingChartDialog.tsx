// 그리기 차트 팝업 — 기존 CandleChartLight 은 건드리지 않고 별도로 띄운다.
//
// 왜 분리했나 — 기존 차트는 보유·거래 마커, 외인비율, 다중 차트 crosshair sync 까지
//   얽혀 있다. 거기에 그리기 상태(도구·드래그·패닝 차단)를 섞으면 기존 동작이 깨질 위험이
//   크고, 그리기는 "지금 집중해서 분석할 때" 쓰는 기능이라 팝업이 더 맞다.
//
// 구조(사양서 §8): 데이터는 MarketDataProvider, 좌표·판정은 lib/stockChart/geometry,
//   렌더는 primitives(DrawingLayer), 이력은 DrawingHistory, 저장은 storage.
//   이 파일은 그것들을 차트 인스턴스에 붙이는 컨트롤러 역할만 한다.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  createChart, ColorType, CandlestickSeries, HistogramSeries, LineSeries, LineStyle,
  type IChartApi, type ISeriesApi, type IPriceLine, type MouseEventParams, type Time,
} from "lightweight-charts";
import {
  type Drawing, type DrawingKind, type Interval, type Anchor, type Candle, type BarTime,
  FIB_LEVELS, defaultStyle, barTimeToSortable, INTERVAL_LABEL,
} from "../../lib/stockChart/types";
import { TossMarketDataProvider, MockMarketDataProvider, SUPPORTED_INTERVALS } from "../../lib/stockChart/provider";
import { DrawingLayer } from "../../lib/stockChart/primitives";
import { DrawingHistory } from "../../lib/stockChart/history";
import { loadDrawings, saveDrawings } from "../../lib/stockChart/storage";
import { distToSegment, isDegenerate, snapToBar, smaAligned } from "../../lib/stockChart/geometry";
import { toLwTime, tickLabel, fullLabel, fmtKrw } from "../../lib/stockChart/lwAdapter";
import { maColor } from "../../lib/indicators";
import { ChartToolbar } from "./ChartToolbar";
import { DrawingList } from "./DrawingList";

const UP = "#D64550", DOWN = "#2F60C6", FLAT = "#9ca3af";
const HIT_PX = 8;                 // 선 집기 여유 — 터치를 감안해 선보다 넓게 잡는다
const DEFAULT_MA = [5, 20, 60, 120];

const newId = () => `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

interface Props { ticker: string; name: string; isOpen: boolean; onClose: () => void }

export function DrawingChartDialog({ ticker, name, isOpen, onClose }: Props) {
  const [interval, setInterval] = useState<Interval>("1d");
  const [maPeriods, setMaPeriods] = useState<number[]>(DEFAULT_MA);
  const [tool, setTool] = useState<DrawingKind | null>(null);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingA, setPendingA] = useState<Anchor | null>(null);
  const [hint, setHint] = useState<string>("");
  const [storageNote, setStorageNote] = useState<string>("");
  const [tip, setTip] = useState<{ t: string; o: number; h: number; l: number; c: number; v: number; chg: number | null; ma: { n: number; v: number }[] } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const maRef = useRef<Map<number, ISeriesApi<"Line">>>(new Map());
  const layerRef = useRef<DrawingLayer | null>(null);
  const priceLineRef = useRef<Map<string, IPriceLine>>(new Map());
  const historyRef = useRef(new DrawingHistory([]));
  const candlesRef = useRef<Candle[]>([]);
  // moved — 실제로 움직였을 때만 이력에 남긴다. 선을 고르기만 해도 undo 한 칸이 생기면
  //   사용자가 "실행취소가 먹통" 이라고 느낀다.
  const dragRef = useRef<{ id: string; part: "a" | "b" | "whole"; startPrice: number; startLogical: number; moved: boolean } | null>(null);
  const [, forceHistory] = useState(0);
  // ★ 차트 인스턴스 세대. 팝업을 닫으면 chart.remove() 로 시리즈가 통째로 사라지는데,
  //   candles 는 react-query 캐시라 다시 열어도 **참조가 그대로**다. 그러면 setData 를 하는
  //   이펙트가 다시 돌지 않아 새 차트가 빈 채로 남는다. 세대를 의존성에 끼워 넣어
  //   "차트가 새로 만들어졌다" 를 데이터·이평·레이어 이펙트에 알린다.
  const [chartEpoch, setChartEpoch] = useState(0);

  // ── 데이터 ───────────────────────────────────────────────
  const provider = useMemo(() => new TossMarketDataProvider(() => name), [name]);
  const mock = useMemo(() => new MockMarketDataProvider(), []);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    // queryKey 에 종목·주기가 다 들어가 있어 빠르게 바꿔도 늦게 온 응답이 새 차트를 덮지 않는다
    // (react-query 가 키별로 결과를 가른다 — 사양서 A13).
    queryKey: ["draw-chart", ticker, interval],
    queryFn: async ({ signal }) => {
      try {
        const r = await provider.getCandles({ symbol: ticker, interval, limit: 450, signal });
        if (r.candles.length > 0) return r;
        throw new Error("빈 응답");
      } catch (e) {
        // 시세를 못 받으면 예제 데이터로 떨어진다. mode 가 'mock' 이라 배지가 뜬다.
        if (signal?.aborted) throw e;
        return mock.getCandles({ symbol: ticker, interval, limit: 300 });
      }
    },
    enabled: isOpen && /^[\dA-Za-z]{6}$/.test(ticker),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const candles = useMemo(() => data?.candles ?? [], [data]);
  candlesRef.current = candles;

  // ── 저장·복원 ────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const r = loadDrawings(ticker, interval);
    historyRef.current.reset(r.drawings);
    setDrawings(r.drawings);
    setSelectedId(null);
    setStorageNote(
      r.memoryOnly ? "저장소를 쓸 수 없어 이번 세션에서만 유지됩니다."
      : r.skipped === -1 ? "저장된 그리기를 읽지 못했습니다(형식 오류). 원본은 지우지 않았습니다."
      : r.skipped > 0 ? `손상된 항목 ${r.skipped}건을 건너뛰었습니다.` : "",
    );
    forceHistory(v => v + 1);
  }, [isOpen, ticker, interval]);

  const commit = useCallback((next: Drawing[]) => {
    historyRef.current.commit(next);
    setDrawings(next);
    const ok = saveDrawings(ticker, interval, next);
    if (!ok) setStorageNote("저장 용량을 넘겨 이번 세션에서만 유지됩니다.");
    forceHistory(v => v + 1);
  }, [ticker, interval]);

  const applyHistory = useCallback((next: Drawing[]) => {
    setDrawings(next);
    saveDrawings(ticker, interval, next);
    setSelectedId(id => (next.some(d => d.id === id) ? id : null));
    forceHistory(v => v + 1);
  }, [ticker, interval]);

  const undo = useCallback(() => applyHistory(historyRef.current.undo()), [applyHistory]);
  const redo = useCallback(() => applyHistory(historyRef.current.redo()), [applyHistory]);

  // ── 좌표 변환 ────────────────────────────────────────────
  // 앵커(시간·가격) → 화면 픽셀. 변환 불가면 null 을 돌려 그 부분만 안 그린다.
  const project = useCallback((a: Anchor) => {
    const chart = chartRef.current, series = candleRef.current;
    if (!chart || !series) return null;
    const y = series.priceToCoordinate(a.price);
    if (y == null) return null;
    // 수평선류는 시간이 의미 없다 — x 는 안 쓰므로 0 을 준다.
    if (a.time.kind === "date" && a.time.value === "") return { x: 0, y };
    const ts = chart.timeScale();
    let x = ts.timeToCoordinate(toLwTime(a.time));
    if (x == null) {
      // 데이터에 없는 시각(주기 전환 직후 등) — 가장 가까운 봉의 논리 좌표로 대신한다.
      const idx = nearestIndex(candlesRef.current, a.time);
      if (idx < 0) return null;
      x = ts.logicalToCoordinate(idx as never);
      if (x == null) return null;
    }
    return { x, y };
  }, []);

  // ── 차트 생성 ────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen || !containerRef.current) return;
    const el = containerRef.current;
    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#374151", fontSize: 11,
        fontFamily: "system-ui, -apple-system, sans-serif",
        // TradingView 저작자 표시 — 라이브러리 요구사항이라 켜 둔다.
        attributionLogo: true,
      },
      grid: { vertLines: { color: "#f3f4f6" }, horzLines: { color: "#f3f4f6" } },
      rightPriceScale: { borderColor: "#e5e7eb", scaleMargins: { top: 0.08, bottom: 0.26 } },
      timeScale: {
        borderColor: "#e5e7eb",
        timeVisible: true, secondsVisible: false,
        tickMarkFormatter: (t: Time) => tickLabel(t),
      },
      crosshair: { mode: 0 },
      localization: { priceFormatter: (v: number) => Math.round(v).toLocaleString() },
      autoSize: true,      // ResizeObserver 를 라이브러리가 관리한다
    });
    chartRef.current = chart;

    const candle = chart.addSeries(CandlestickSeries, {
      upColor: UP, downColor: DOWN, borderVisible: false,
      wickUpColor: UP, wickDownColor: DOWN,
      priceLineVisible: true, lastValueVisible: true,
    });
    candleRef.current = candle;

    const vol = chart.addSeries(HistogramSeries, {
      priceScaleId: "vol", priceFormat: { type: "volume" }, priceLineVisible: false,
      lastValueVisible: false,
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    volRef.current = vol;

    const layer = new DrawingLayer({
      drawings: [], selectedId: null, preview: null, project, priceFormat: fmtKrw,
    });
    candle.attachPrimitive(layer);
    layerRef.current = layer;

    const onMove = (param: MouseEventParams) => {
      const cs = candlesRef.current;
      if (!param.point || !param.time || cs.length === 0) { setTip(null); return; }
      const idx = cs.findIndex(c => String(toLwTime(c.time)) === String(param.time));
      if (idx < 0) { setTip(null); return; }
      const c = cs[idx], prev = idx > 0 ? cs[idx - 1] : null;
      setTip({
        t: fullLabel(c.time), o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume,
        chg: prev ? ((c.close - prev.close) / prev.close) * 100 : null,
        ma: [...maRef.current.keys()].sort((a, b) => a - b).flatMap(n => {
          const v = smaAligned(cs.map(x => x.close), n)[idx];
          return v == null ? [] : [{ n, v }];
        }),
      });
    };
    chart.subscribeCrosshairMove(onMove);
    setChartEpoch(e => e + 1);

    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = null; candleRef.current = null; volRef.current = null;
      layerRef.current = null; maRef.current.clear(); priceLineRef.current.clear();
    };
  }, [isOpen, project]);

  // ── 데이터 주입 ──────────────────────────────────────────
  useEffect(() => {
    const candle = candleRef.current, vol = volRef.current, chart = chartRef.current;
    if (!candle || !vol || !chart) return;
    candle.setData(candles.map(c => ({
      time: toLwTime(c.time), open: c.open, high: c.high, low: c.low, close: c.close,
      color: c.close === c.open ? FLAT : undefined,
    })));
    vol.setData(candles.map(c => ({
      time: toLwTime(c.time), value: c.volume,
      color: c.close > c.open ? `${UP}55` : c.close < c.open ? `${DOWN}55` : "#9ca3af55",
    })));
    if (candles.length > 0) chart.timeScale().fitContent();
  }, [candles, chartEpoch]);

  // ── 이동평균 ─────────────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const closes = candles.map(c => c.close);
    // 빠진 기간은 시리즈를 지운다 — 반복 토글로 시리즈가 쌓이지 않게(A15).
    for (const [n, s] of maRef.current) {
      if (!maPeriods.includes(n)) { chart.removeSeries(s); maRef.current.delete(n); }
    }
    maPeriods.forEach((n, i) => {
      let s = maRef.current.get(n);
      if (!s) {
        s = chart.addSeries(LineSeries, {
          color: maColor(i), lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        maRef.current.set(n, s);
      }
      const arr = smaAligned(closes, n);
      // N 개 미만 구간은 그리지 않는다(사양서 §4).
      s.setData(candles.flatMap((c, idx) => {
        const v = arr[idx];
        return v == null ? [] : [{ time: toLwTime(c.time), value: v }];
      }));
    });
  }, [candles, maPeriods, chartEpoch]);

  // ── 수평선·가격선은 라이브러리 priceLine 으로 ─────────────
  useEffect(() => {
    const candle = candleRef.current;
    if (!candle) return;
    const map = priceLineRef.current;
    const want = new Map(drawings
      .filter((d): d is Extract<Drawing, { type: "horizontal" | "price" }> =>
        d.type === "horizontal" || d.type === "price")
      .map(d => [d.id, d]));
    for (const [id, line] of map) {
      if (!want.has(id)) { candle.removePriceLine(line); map.delete(id); }
    }
    for (const [id, d] of want) {
      const opts = {
        price: d.price,
        color: d.style.color,
        lineWidth: (d.id === selectedId ? 3 : 2) as 1 | 2 | 3 | 4,
        lineStyle: d.type === "price" ? LineStyle.Dashed : LineStyle.Solid,
        axisLabelVisible: d.type === "price",   // 가격선만 우측 축 배지
        title: d.type === "price" ? fmtKrw(d.price) : "",
      };
      const cur = map.get(id);
      if (cur) cur.applyOptions(opts);
      else map.set(id, candle.createPriceLine(opts));
    }
  }, [drawings, selectedId, chartEpoch]);

  // ── 레이어 갱신 ──────────────────────────────────────────
  useEffect(() => {
    layerRef.current?.update({ drawings, selectedId, project });
  }, [drawings, selectedId, project, chartEpoch]);

  // 도구를 고르면 차트 이동/확대를 막는다 — 그리기 클릭이 패닝과 겹치지 않게(사양서 §5.1).
  useEffect(() => {
    chartRef.current?.applyOptions({
      handleScroll: tool == null, handleScale: tool == null,
    });
  }, [tool, chartEpoch]);

  // 닫으면 도구·툴팁·미완성 선을 비운다 — 다시 열었을 때 이어지지 않게.
  useEffect(() => {
    if (isOpen) return;
    setTool(null);
    setPendingA(null);
    setTip(null);
    setSelectedId(null);
  }, [isOpen]);

  // 안내 문구
  useEffect(() => {
    if (!tool) { setHint(""); return; }
    if (tool === "horizontal" || tool === "price") setHint("원하는 높이를 클릭하세요");
    else setHint(pendingA ? "끝점을 선택하세요 (Esc 취소)" : "시작점을 선택하세요");
  }, [tool, pendingA]);

  const cancelPending = useCallback(() => {
    setPendingA(null);
    layerRef.current?.update({ preview: null });
  }, []);

  // 도구를 바꾸면 미완성 선은 버린다(저장도 이력도 남기지 않는다).
  useEffect(() => { cancelPending(); }, [tool, cancelPending]);

  // ── 포인터 입력 ──────────────────────────────────────────
  const anchorAt = useCallback((x: number, y: number): Anchor | null => {
    const chart = chartRef.current, series = candleRef.current;
    if (!chart || !series) return null;
    const price = series.coordinateToPrice(y);
    if (price == null) return null;
    const logical = chart.timeScale().coordinateToLogical(x);
    if (logical == null) return null;
    const cs = candlesRef.current;
    if (cs.length === 0) return null;
    // 데이터 밖(미래 여백)은 선을 만들지 않는다 — P0 범위 밖(사양서 §5.1).
    if (logical < -0.5 || logical > cs.length - 0.5) return null;
    const time = snapToBar(cs.map(c => c.time), barTimeToSortable(cs[Math.max(0, Math.min(cs.length - 1, Math.round(logical)))].time));
    if (!time) return null;
    return { time, price };     // 가격은 클릭한 그대로 — P0 는 가격 스냅 없음
  }, []);

  const hitTest = useCallback((x: number, y: number): { id: string; part: "a" | "b" | "whole" } | null => {
    for (let i = drawings.length - 1; i >= 0; i--) {
      const d = drawings[i];
      if (d.type === "horizontal" || d.type === "price") {
        const p = project({ time: { kind: "date", value: "" }, price: d.price });
        if (p && Math.abs(p.y - y) <= HIT_PX) return { id: d.id, part: "whole" };
        continue;
      }
      const pa = project(d.a), pb = project(d.b);
      if (!pa || !pb) continue;
      if (Math.hypot(pa.x - x, pa.y - y) <= HIT_PX + 2) return { id: d.id, part: "a" };
      if (Math.hypot(pb.x - x, pb.y - y) <= HIT_PX + 2) return { id: d.id, part: "b" };
      if (d.type === "trend") {
        if (distToSegment({ x, y }, pa, pb) <= HIT_PX) return { id: d.id, part: "whole" };
      } else {
        const x1 = Math.min(pa.x, pb.x), x2 = Math.max(pa.x, pb.x);
        if (x < x1 - HIT_PX || x > x2 + HIT_PX) continue;
        for (const r of (d.levels.length > 0 ? d.levels : FIB_LEVELS)) {
          const p = project({ time: d.a.time, price: d.a.price + (d.b.price - d.a.price) * r });
          if (p && Math.abs(p.y - y) <= HIT_PX) return { id: d.id, part: "whole" };
        }
      }
    }
    return null;
  }, [drawings, project]);

  const localXY = (e: React.PointerEvent) => {
    const r = containerRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const { x, y } = localXY(e);
    if (tool) {
      const a = anchorAt(x, y);
      if (!a) return;                       // 축·여백 클릭은 무시
      e.preventDefault();
      if (tool === "horizontal" || tool === "price") {
        const d: Drawing = {
          id: newId(), schemaVersion: 1, symbol: ticker, interval,
          style: defaultStyle(tool), type: tool, price: a.price,
        };
        commit([...drawings, d]);
        setSelectedId(d.id);
        setTool(null);                      // 완성 후 선택 모드로 복귀
        return;
      }
      if (!pendingA) { setPendingA(a); layerRef.current?.update({ preview: { type: tool, a, b: null, color: defaultStyle(tool).color } }); return; }
      if (isDegenerate(tool, pendingA, a)) {
        setHint(tool === "fibonacci" ? "가격이 같습니다 — 다른 높이를 선택하세요" : "길이가 0입니다 — 다른 점을 선택하세요");
        return;
      }
      const d: Drawing = tool === "trend"
        ? { id: newId(), schemaVersion: 1, symbol: ticker, interval, style: defaultStyle("trend"), type: "trend", a: pendingA, b: a }
        : { id: newId(), schemaVersion: 1, symbol: ticker, interval, style: defaultStyle("fibonacci"), type: "fibonacci", a: pendingA, b: a, levels: FIB_LEVELS };
      commit([...drawings, d]);
      setSelectedId(d.id);
      cancelPending();
      setTool(null);
      return;
    }

    // 선택 모드 — 선을 집었으면 드래그, 아니면 차트 패닝에 맡긴다.
    const hit = hitTest(x, y);
    setSelectedId(hit?.id ?? null);
    if (!hit) return;
    const chart = chartRef.current, series = candleRef.current;
    const price = series?.coordinateToPrice(y);
    const logical = chart?.timeScale().coordinateToLogical(x);
    if (price == null || logical == null) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { id: hit.id, part: hit.part, startPrice: price, startLogical: logical as unknown as number, moved: false };
    chart?.applyOptions({ handleScroll: false, handleScale: false });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const { x, y } = localXY(e);
    if (tool && pendingA && (tool === "trend" || tool === "fibonacci")) {
      const b = anchorAt(x, y);
      layerRef.current?.update({ preview: { type: tool, a: pendingA, b, color: defaultStyle(tool).color } });
      return;
    }
    const drag = dragRef.current;
    if (!drag) return;
    const chart = chartRef.current, series = candleRef.current;
    const price = series?.coordinateToPrice(y);
    const logical = chart?.timeScale().coordinateToLogical(x);
    if (price == null || logical == null) return;
    const dPrice = price - drag.startPrice;
    const dBars = (logical as unknown as number) - drag.startLogical;
    if (dPrice === 0 && Math.round(dBars) === 0) return;
    drag.moved = true;
    setDrawings(prev => prev.map(d => (d.id === drag.id ? moveDrawing(d, drag.part, dPrice, dBars, candlesRef.current) : d)));
    // 기준점을 갱신해 델타가 누적되지 않게 한다.
    drag.startPrice = price;
    drag.startLogical = logical as unknown as number;
  };

  const endDrag = () => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    chartRef.current?.applyOptions({ handleScroll: tool == null, handleScale: tool == null });
    // 드래그 한 번 = 이력 한 건(사양서 §5.6). 안 움직였으면 이력을 남기지 않는다.
    if (drag.moved) commit(drawings);
  };

  // ── 키보드 ───────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (e.key === "Escape") {
        if (pendingA || tool) { cancelPending(); setTool(null); return; }
        onClose();
        return;
      }
      if (typing) return;    // 입력창에서는 텍스트 편집 단축키가 우선
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        commit(drawings.filter(d => d.id !== selectedId));
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, pendingA, tool, selectedId, drawings, commit, undo, redo, cancelPending, onClose]);

  if (!isOpen) return null;

  const hist = historyRef.current;
  const mode = data?.mode;
  const last = candles.length > 0 ? candles[candles.length - 1] : null;
  const prev = candles.length > 1 ? candles[candles.length - 2] : null;
  const chgPct = last && prev ? ((last.close - prev.close) / prev.close) * 100 : null;

  return (
    <div className="fixed inset-0 z-[70] bg-black/40 flex items-start sm:items-center justify-center p-2 sm:p-4"
         onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-[1100px] max-h-[95vh] overflow-y-auto"
           onClick={e => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="flex items-center gap-2 flex-wrap px-3 py-2 border-b border-gray-200">
          <h2 className="text-sm font-bold text-gray-900">{name}</h2>
          <span className="text-[11px] text-gray-400 tabular-nums">{ticker}</span>
          {last && (
            <span className="text-[13px] tabular-nums font-bold text-gray-800">
              {fmtKrw(last.close)}
              {chgPct != null && (
                <span className={`ml-1 text-[12px] ${chgPct >= 0 ? "text-rose-600" : "text-blue-600"}`}>
                  {chgPct >= 0 ? "+" : ""}{chgPct.toFixed(2)}%
                </span>
              )}
            </span>
          )}
          {mode === "mock" && (
            <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold">
              예제 데이터
            </span>
          )}
          {mode === "delayed" && data && (
            <span className="text-[10px] text-gray-400">
              {INTERVAL_LABEL[interval]} · 기준 {new Date(data.asOf).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          {isFetching && <span className="text-[10px] text-gray-400">불러오는 중…</span>}
          <button onClick={onClose} aria-label="닫기"
                  className="ml-auto min-w-[36px] min-h-[36px] text-gray-400 hover:text-gray-700 text-lg">✕</button>
        </div>

        <div className="p-3 space-y-2">
          <ChartToolbar
            interval={interval} supported={SUPPORTED_INTERVALS} onInterval={setInterval}
            maPeriods={maPeriods}
            onToggleMa={n => setMaPeriods(p => p.includes(n) ? p.filter(x => x !== n) : [...p, n].sort((a, b) => a - b))}
            tool={tool} onTool={setTool}
            onUndo={undo} onRedo={redo}
            onClearAll={() => { commit([]); setSelectedId(null); }}
            canUndo={hist.canUndo} canRedo={hist.canRedo} hasDrawings={drawings.length > 0}
          />

          {(hint || storageNote) && (
            <div className="flex items-center gap-2 text-[11px] min-h-[20px]">
              {hint && (
                <>
                  <span className="text-blue-700 font-bold">{hint}</span>
                  <button type="button" onClick={() => { cancelPending(); setTool(null); }}
                          className="px-1.5 py-0.5 rounded border border-gray-300 text-gray-500">취소</button>
                </>
              )}
              {storageNote && <span className="ml-auto text-amber-700">{storageNote}</span>}
            </div>
          )}

          {/* 차트 */}
          <div className="relative">
            <div ref={containerRef}
                 className="w-full h-[340px] sm:h-[420px] touch-none select-none"
                 style={{ cursor: tool ? "crosshair" : "default" }}
                 onPointerDown={onPointerDown}
                 onPointerMove={onPointerMove}
                 onPointerUp={endDrag}
                 onPointerCancel={endDrag}
            />
            {isLoading && (
              <div className="absolute inset-0 grid place-items-center text-xs text-gray-400 bg-white/70">
                불러오는 중…
              </div>
            )}
            {isError && (
              <div className="absolute inset-0 grid place-items-center bg-white/90 text-center">
                <div className="text-xs text-rose-700">
                  시세를 불러오지 못했습니다.
                  <div className="text-[11px] text-gray-500 mt-1">{(error as Error)?.message}</div>
                  <button onClick={() => void refetch()}
                          className="mt-2 px-2 py-1 rounded bg-gray-800 text-white text-[11px]">다시 시도</button>
                </div>
              </div>
            )}
            {!isLoading && !isError && candles.length === 0 && (
              <div className="absolute inset-0 grid place-items-center text-xs text-gray-400">
                이 주기의 데이터가 없습니다.
              </div>
            )}
            {/* 툴팁 — 그리는 중에는 점을 가리지 않게 접어 둔다 */}
            {tip && !tool && (
              <div className="absolute top-1 left-1 rounded bg-white/95 border border-gray-200 px-2 py-1
                              text-[10px] tabular-nums text-gray-600 shadow-sm pointer-events-none">
                <div className="font-bold text-gray-800">{tip.t}</div>
                <div>시 {tip.o.toLocaleString()} · 고 {tip.h.toLocaleString()} · 저 {tip.l.toLocaleString()} · 종 {tip.c.toLocaleString()}</div>
                <div>
                  거래량 {tip.v.toLocaleString()} · 등락{" "}
                  {tip.chg == null ? "—" : <span className={tip.chg >= 0 ? "text-rose-600" : "text-blue-600"}>{tip.chg >= 0 ? "+" : ""}{tip.chg.toFixed(2)}%</span>}
                </div>
                {tip.ma.length > 0 && <div>{tip.ma.map(m => `MA${m.n} ${Math.round(m.v).toLocaleString()}`).join(" · ")}</div>}
              </div>
            )}
          </div>

          {/* 선 목록 */}
          <div className="border border-gray-200 rounded">
            <div className="px-2 py-1 border-b border-gray-100 text-[10px] text-gray-400">
              그린 선 {drawings.length}개 — 클릭해 선택, 드래그로 이동, ✕ 로 삭제
            </div>
            <DrawingList
              drawings={drawings} selectedId={selectedId} onSelect={setSelectedId}
              onPrice={(id, price) => commit(drawings.map(d =>
                (d.id === id && (d.type === "horizontal" || d.type === "price")) ? { ...d, price } : d))}
              onDelete={id => { commit(drawings.filter(d => d.id !== id)); setSelectedId(s => s === id ? null : s); }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 순수 헬퍼 ──────────────────────────────────────────────
function nearestIndex(cs: Candle[], t: BarTime): number {
  if (cs.length === 0) return -1;
  const target = barTimeToSortable(t);
  let best = 0, bestD = Infinity;
  for (let i = 0; i < cs.length; i++) {
    const d = Math.abs(barTimeToSortable(cs[i].time) - target);
    if (d < bestD) { best = i; bestD = d; }
  }
  return best;
}

/** 드래그 이동 — 시간은 논리적 봉 간격으로, 가격은 두 점에 같은 양을 적용한다(사양서 §5.2). */
function moveDrawing(d: Drawing, part: "a" | "b" | "whole", dPrice: number, dBars: number, cs: Candle[]): Drawing {
  if (d.type === "horizontal" || d.type === "price") {
    return { ...d, price: Math.max(0.01, d.price + dPrice) };
  }
  const times = cs.map(c => c.time);
  const shift = (a: Anchor): Anchor => {
    const idx = nearestIndex(cs, a.time);
    const next = Math.max(0, Math.min(times.length - 1, idx + Math.round(dBars)));
    return { time: times[next] ?? a.time, price: a.price + dPrice };
  };
  if (part === "a") return { ...d, a: shift(d.a) };
  if (part === "b") return { ...d, b: shift(d.b) };
  return { ...d, a: shift(d.a), b: shift(d.b) };
}

export default DrawingChartDialog;
