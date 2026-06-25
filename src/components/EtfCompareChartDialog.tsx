// ETF/종목 비교 차트 — seed(검색결과 전체 or 단일)로 시작, 검색으로 더 추가 가능. 한 그래프에 등락률 겹침.
//   시간 토글: [분봉 / 주봉]. 분봉=최근 5거래일 1분봉(요일·시간대 패턴), 주봉=2년 일봉 리샘플. 시작점=0% 정규화.
//   분봉 타임스탬프는 +9h(KST) 보정 → lightweight-charts UTC 축에 한국 벽시계로 표시
//   (KR·US 모두 자기 장 시간대에 맞게 찍힘).
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQueries } from "@tanstack/react-query";
import {
  createChart,
  ColorType,
  LineSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type SeriesType,
  type Time,
  type MouseEventParams,
} from "lightweight-charts";
import {
  fetchKrPriceHistory,
  fetchYahooPriceHistory,
  fetchKrIntraday,
  fetchYahooIntraday,
  type PricePoint,
  type IntradayBar,
} from "../lib/api";

interface StockRef { ticker: string; name: string; }

interface Props {
  isOpen: boolean;
  onClose: () => void;
  seed: StockRef[];   // 초기 종목 (ETF 검색결과 전체 or 단일 ETF). 열릴 때 이걸로 초기화.
}

const KST_OFFSET = 9 * 3600;                  // 분봉 UTC epoch → KST 벽시계 보정(초)
const isKr = (t: string) => /^\d{6}$/.test(t);

// 종목 타입별 fetch 디스패치 (KR 6자리 → 토스/야후 KS·KQ, 그 외 → 야후 심볼)
const fetchDaily = (ticker: string, range: string): Promise<PricePoint[]> =>
  isKr(ticker) ? fetchKrPriceHistory(ticker, range) : fetchYahooPriceHistory(ticker, range);
const fetchMin = (ticker: string, range: string): Promise<IntradayBar[]> =>
  isKr(ticker) ? fetchKrIntraday(ticker, range, "1m") : fetchYahooIntraday(ticker, range, "1m");

type Mode = "min" | "week";   // 분봉(요일·시간대 패턴) / 주봉(중기 추세)

interface Built {
  data: { time: Time; value: number }[];
  map: Map<string, number>;   // timeKey → 누적%
  final: number | null;
}
const EMPTY: Built = { data: [], map: new Map(), final: null };

// 주봉: 일봉을 7일 버킷으로 묶어 각 주 마지막 종가 → 시작주=0% 정규화
function buildWeekly(hist: PricePoint[]): Built {
  if (!hist || hist.length < 2) return EMPTY;
  const weekly: { date: string; close: number }[] = [];
  let curKey = "";
  for (const p of hist) {
    const key = String(Math.floor(Date.parse(`${p.date}T00:00:00Z`) / 86_400_000 / 7));
    if (key !== curKey) { weekly.push({ date: p.date, close: p.close }); curKey = key; }
    else weekly[weekly.length - 1] = { date: p.date, close: p.close };   // 같은 주 → 마지막 거래일로 갱신
  }
  if (weekly.length < 2) return EMPTY;
  const base = weekly[0].close;
  if (!(base > 0)) return EMPTY;
  const data = weekly.map(p => ({ time: p.date as Time, value: (p.close / base - 1) * 100 }));
  return { data, map: new Map(data.map(x => [String(x.time), x.value])), final: data[data.length - 1].value };
}

// 분봉: 첫 봉=0% 정규화, time = epoch + 9h (KST 표시)
function buildMin(bars: IntradayBar[]): Built {
  if (!bars || bars.length < 2) return EMPTY;
  const base = bars[0].close;
  if (!(base > 0)) return EMPTY;
  const data = bars.map(b => ({ time: (b.t + KST_OFFSET) as Time, value: (b.close / base - 1) * 100 }));
  return { data, map: new Map(data.map(x => [String(x.time), x.value])), final: data[data.length - 1].value };
}

// 라인 색 — base(보유종목)=빨강 고정, 추가 종목은 순서대로. 12색 초과 시 황금각 HSL 분산.
const PALETTE = [
  "#dc2626", "#2563eb", "#16a34a", "#d97706", "#9333ea", "#0d9488",
  "#db2777", "#0891b2", "#65a30d", "#e11d48", "#7c3aed", "#ca8a04",
];
const lineColorAt = (i: number): string =>
  i < PALETTE.length ? PALETTE[i] : `hsl(${Math.round((i * 137.508) % 360)}, 62%, 45%)`;

export function EtfCompareChartDialog({ isOpen, onClose, seed }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const bandRef = useRef<HTMLCanvasElement>(null);   // 배경 밴드(일/주 음영 + 요일 라벨)
  const [mode, setMode] = useState<Mode>("min");
  // seed 로 고정 (다이얼로그는 열 때마다 remount → seed 반영). 추가검색 없음.
  const [items] = useState<StockRef[]>(seed);

  const stocks = items;
  const colorMap = useMemo(() => {
    const m: Record<string, string> = {};
    stocks.forEach((s, i) => { m[s.ticker] = lineColorAt(i); });
    return m;
  }, [stocks]);
  const colorOf = (ticker: string) => colorMap[ticker] ?? "#64748b";

  // Esc 닫기
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  // 데이터 — 모드별 fetch (mode 바뀌면 queryKey 달라져 재조회)
  //   분봉: 최근 5거래일 1분봉(요일·시간대 패턴 보기) · 주봉: 2년 일봉 → 주 단위 리샘플
  const qs = useQueries({
    queries: stocks.map(s => mode === "week"
      ? {
          queryKey: ["cmp-week", s.ticker],
          queryFn: () => fetchDaily(s.ticker, "2y"),
          staleTime: 60 * 60_000,
          enabled: isOpen,
        }
      : {
          queryKey: ["cmp-min5d", s.ticker],
          queryFn: () => fetchMin(s.ticker, "5d"),
          staleTime: 5 * 60_000,
          enabled: isOpen,
        }),
  });
  const stamp = qs.map(q => q.dataUpdatedAt).join(",");
  const loading = qs.some(q => q.isLoading);

  // ticker → 정규화 시리즈
  const built = useMemo(() => {
    const m = new Map<string, Built>();
    stocks.forEach((s, i) => {
      const data = qs[i]?.data;
      m.set(s.ticker, mode === "week"
        ? buildWeekly((data as PricePoint[]) ?? [])
        : buildMin((data as IntradayBar[]) ?? []));
    });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stocks, mode, stamp]);

  // 차트 그리기
  useEffect(() => {
    if (!isOpen || !containerRef.current) return;
    const visible = stocks.filter(s => (built.get(s.ticker)?.data.length ?? 0) >= 2);
    if (visible.length === 0) return;

    const chart: IChartApi = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "rgba(255,255,255,0)" },   // 투명 — 뒤 배경밴드 캔버스 노출
        textColor: "#374151",
        fontSize: 11,
        fontFamily: "system-ui, -apple-system, sans-serif",
        attributionLogo: false,
      },
      grid: { vertLines: { color: "#f3f4f6" }, horzLines: { color: "#f3f4f6" } },
      rightPriceScale: { borderColor: "#e5e7eb", scaleMargins: { top: 0.1, bottom: 0.1 } },
      timeScale: {
        borderColor: "#e5e7eb",
        timeVisible: mode === "min",       // 분봉은 시:분 표시
        secondsVisible: false,
      },
      crosshair: {
        mode: 1,
        vertLine: { color: "#9ca3af", width: 1, style: LineStyle.Dotted, labelBackgroundColor: "#475569" },
        horzLine: { color: "#9ca3af", width: 1, style: LineStyle.Dotted, labelBackgroundColor: "#475569" },
      },
      localization: { priceFormatter: (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%` },
      autoSize: true,
    });

    const seriesList: { ticker: string }[] = [];
    let zeroAnchor: ISeriesApi<SeriesType> | null = null;
    for (const s of visible) {
      const b = built.get(s.ticker)!;
      const ser = chart.addSeries(LineSeries, {
        color: colorOf(s.ticker),
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 3,
      });
      ser.setData(b.data);
      seriesList.push({ ticker: s.ticker });
      if (!zeroAnchor) zeroAnchor = ser;
    }
    zeroAnchor?.createPriceLine({
      price: 0, color: "#9ca3af", lineWidth: 1, lineStyle: LineStyle.Dashed,
      axisLabelVisible: true, title: "0%",
    });
    chart.timeScale().fitContent();

    const nameByTicker: Record<string, string> = {};
    for (const s of stocks) nameByTicker[s.ticker] = s.name;
    const PAD_L = 8, PAD_T = 8;

    const fmtTime = (timeKey: string): string => {
      if (mode === "week") return timeKey;   // YYYY-MM-DD (주 마지막 거래일)
      const dt = new Date(Number(timeKey) * 1000);   // +9h 반영된 epoch → UTC 표기가 KST 벽시계
      const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(dt.getUTCDate()).padStart(2, "0");
      const hh = String(dt.getUTCHours()).padStart(2, "0");
      const mi = String(dt.getUTCMinutes()).padStart(2, "0");
      return `${mm}/${dd} ${hh}:${mi}`;
    };

    const onMove = (param: MouseEventParams) => {
      const tip = tooltipRef.current;
      const cont = containerRef.current;
      if (!tip || !cont) return;
      if (param.time == null || !param.point) { tip.style.display = "none"; return; }
      const key = String(param.time);
      const rows = seriesList
        .map(({ ticker }) => ({ ticker, v: built.get(ticker)?.map.get(key), color: colorOf(ticker), name: nameByTicker[ticker] ?? ticker }))
        .filter((r): r is { ticker: string; v: number; color: string; name: string } => typeof r.v === "number")
        .sort((a, b) => b.v - a.v);
      if (rows.length === 0) { tip.style.display = "none"; return; }
      let html = `<div style="color:#9ca3af;font-size:10px;margin-bottom:3px">${fmtTime(key)}</div>`;
      rows.forEach((r, i) => {
        const pc = r.v >= 0 ? "#e11d48" : "#2563eb";
        html += `<div style="display:flex;align-items:center;gap:5px;line-height:1.7;`
          + `background:${r.color};border-radius:4px;padding:1px 5px;margin-bottom:2px">`
          + `<span style="color:rgba(255,255,255,0.8);width:13px;text-align:right;flex:none;font-weight:700">${i + 1}</span>`
          + `<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#fff;font-weight:600;text-shadow:0 1px 1px rgba(0,0,0,0.3)">${r.name}</span>`
          + `<span style="background:#fff;border-radius:3px;padding:0 3px;color:${pc};font-weight:700;font-variant-numeric:tabular-nums;flex:none">${r.v >= 0 ? "+" : ""}${r.v.toFixed(2)}%</span>`
          + `</div>`;
      });
      tip.innerHTML = html;
      tip.style.display = "block";
      const W = cont.clientWidth, H = cont.clientHeight;
      void tip.offsetHeight;
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let left = param.point.x + 16;
      if (left + tw > W) left = param.point.x - tw - 16;
      if (left < 0) left = 0;
      let top = param.point.y + 16;
      if (top + th > H) top = Math.max(0, H - th);
      tip.style.left = `${PAD_L + left}px`;
      tip.style.top = `${PAD_T + top}px`;
    };
    chart.subscribeCrosshairMove(onMove);

    // ── 배경 밴드 — 분봉: 일 단위 음영 + 요일/날짜 라벨 + 매시 세로선·시각 라벨, 주봉: 주 단위 음영
    const ts = chart.timeScale();
    const refData = visible
      .map(s => built.get(s.ticker)!.data)
      .reduce((a, b) => (b.length > a.length ? b : a), [] as { time: Time; value: number }[]);
    const refTimes = refData.map(d => d.time);
    const WD = ["일", "월", "화", "수", "목", "금", "토"];
    const groupOf = (t: Time): number =>
      mode === "week"
        ? Math.floor(Date.parse(`${String(t)}T00:00:00Z`) / 86_400_000 / 7)
        : Math.floor(Number(t) / 86_400);

    const drawBg = () => {
      const canvas = bandRef.current;
      if (!canvas) return;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (refTimes.length < 2) return;
      const plotW = ts.width();
      const X = (t: Time) => ts.timeToCoordinate(t);

      // 그룹(일/주) 교차 음영 + 분봉 요일·날짜 라벨
      let i = 0;
      while (i < refTimes.length) {
        const g = groupOf(refTimes[i]);
        let j = i;
        while (j + 1 < refTimes.length && groupOf(refTimes[j + 1]) === g) j++;
        const xs = X(refTimes[i]);
        const xe = j + 1 < refTimes.length ? X(refTimes[j + 1]) : plotW;
        if (xs != null && xe != null) {
          const left = Math.max(0, xs), right = Math.min(plotW, xe);
          if (right > left) {
            if (((g % 2) + 2) % 2 === 1) {
              ctx.fillStyle = "rgba(99,102,241,0.05)";
              ctx.fillRect(left, 0, right - left, h);
            }
            if (mode === "min" && right - left > 30) {
              const dt = new Date(Number(refTimes[i]) * 1000);
              const dow = dt.getUTCDay();
              ctx.fillStyle = dow === 6 ? "rgba(37,99,235,0.85)"
                : dow === 0 ? "rgba(220,38,38,0.85)" : "rgba(55,65,81,0.75)";
              ctx.font = "700 11px system-ui, -apple-system, sans-serif";
              ctx.textBaseline = "top";
              ctx.fillText(`${WD[dow]} ${dt.getUTCMonth() + 1}/${dt.getUTCDate()}`, left + 4, 3);
            }
          }
        }
        i = j + 1;
      }

      // 분봉: 매시 경계 세로 가이드선 + 시각(시) 라벨 — 하루 중 시간대 한눈에
      if (mode === "min") {
        let prevH = -1, prevD = -1;
        for (let k = 0; k < refTimes.length; k++) {
          const dt = new Date(Number(refTimes[k]) * 1000);
          const hour = dt.getUTCHours();
          const day = Math.floor(Number(refTimes[k]) / 86_400);
          if (hour !== prevH || day !== prevD) {
            const x = X(refTimes[k]);
            if (x != null && x >= 0 && x <= plotW) {
              ctx.strokeStyle = "rgba(148,163,184,0.22)";
              ctx.lineWidth = 1;
              ctx.beginPath(); ctx.moveTo(x, 18); ctx.lineTo(x, h); ctx.stroke();
              ctx.fillStyle = "rgba(100,116,139,0.8)";
              ctx.font = "600 9px system-ui, -apple-system, sans-serif";
              ctx.textBaseline = "top";
              ctx.fillText(`${hour}시`, x + 2, 17);
            }
            prevH = hour; prevD = day;
          }
        }
      }
    };

    const rafDraw = () => requestAnimationFrame(drawBg);
    rafDraw();
    const t1 = setTimeout(drawBg, 120);   // autoSize 레이아웃 안정 후 1회 재그리기
    ts.subscribeVisibleLogicalRangeChange(drawBg);
    window.addEventListener("resize", rafDraw);

    return () => {
      clearTimeout(t1);
      try { chart.unsubscribeCrosshairMove(onMove); } catch { /* noop */ }
      try { ts.unsubscribeVisibleLogicalRangeChange(drawBg); } catch { /* noop */ }
      window.removeEventListener("resize", rafDraw);
      chart.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, built, mode, stocks]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-black/40 flex items-stretch sm:items-center
                    justify-center p-0 sm:p-4 overflow-y-auto"
         onClick={onClose}>
      <div className="bg-white w-full h-full sm:h-auto sm:max-h-[95vh] max-w-5xl
                      rounded-none sm:rounded-lg shadow-xl flex flex-col my-auto"
           onClick={e => e.stopPropagation()}>
        {/* 헤더 */}
        <header className="px-4 py-2 border-b bg-gray-50 flex items-center gap-2 flex-wrap">
          <span className="text-base font-bold">📊 ETF 등락률 비교</span>
          <span className="text-[11px] text-gray-500">시작점=0% 정규화</span>

          {/* 분봉 / 주봉 토글 */}
          <span className="ml-auto inline-flex items-center gap-0.5">
            {([["min", "분봉"], ["week", "주봉"]] as const).map(([m, label]) => (
              <button key={m} onClick={() => setMode(m)}
                      title={m === "min" ? "최근 5거래일 1분봉 — 요일·시간대 패턴" : "2년 주봉 — 중기 추세"}
                      className={`px-2.5 py-0.5 rounded text-[11px] font-bold border transition
                                  ${mode === m
                                    ? "bg-gray-800 text-white border-gray-800"
                                    : "bg-white text-gray-600 border-gray-300 hover:bg-gray-100"}`}>
                {label}
              </button>
            ))}
          </span>

          <button onClick={onClose}
                  className="px-2 py-0.5 text-gray-400 hover:text-rose-500 text-lg leading-none">✕</button>
        </header>

        {/* 종목 줄 — 비교 대상(색칩) */}
        <div className="px-4 py-2 border-b flex items-center gap-2 flex-wrap">
          {stocks.map(s => (
            <span key={s.ticker}
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[12px] font-bold text-white"
                  style={{ background: colorOf(s.ticker) }}>
              {s.name} <span className="opacity-80 font-normal">{s.ticker}</span>
            </span>
          ))}
        </div>

        {/* 차트 */}
        <div className="relative px-2 pt-2">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-gray-400">
              불러오는 중…
            </div>
          )}
          {!loading && items.length === 0 && (
            <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-gray-400">
              비교할 종목을 검색해 추가하세요.
            </div>
          )}
          <div className="relative w-full h-[56vh] min-h-[320px]">
            <canvas ref={bandRef} className="absolute inset-0 w-full h-full pointer-events-none" />
            <div ref={containerRef} className="absolute inset-0" />
          </div>
          <div ref={tooltipRef}
               className="absolute pointer-events-none z-20 bg-white/95 border border-gray-200 rounded-md
                          shadow-lg px-2 py-1.5 text-[11px] leading-snug"
               style={{ display: "none", minWidth: "160px", maxWidth: "280px" }} />
        </div>

        {/* 범례 + 안내 */}
        <div className="px-4 py-2 border-t bg-gray-50 flex items-center gap-3 flex-wrap text-[11px]">
          {stocks.map(s => {
            const f = built.get(s.ticker)?.final ?? null;
            return (
              <span key={s.ticker} className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm inline-block" style={{ background: colorOf(s.ticker) }} />
                <span className="font-semibold text-gray-700">{s.name}</span>
                {f != null && (
                  <span className={`tabular-nums font-bold ${f >= 0 ? "text-rose-600" : "text-blue-600"}`}>
                    {f >= 0 ? "+" : ""}{f.toFixed(2)}%
                  </span>
                )}
              </span>
            );
          })}
          <span className="ml-auto text-gray-400">
            {mode === "min" ? "5일 1분봉 · KST · 요일·시간대 패턴 · 첫 봉 대비 %" : "주봉 2년 · 시작주 대비 %"}
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default EtfCompareChartDialog;
