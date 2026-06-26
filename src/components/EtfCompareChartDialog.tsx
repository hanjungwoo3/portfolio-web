// ETF/종목 비교 차트 — seed(검색결과 전체 or 단일)로 시작, 검색으로 더 추가 가능. 한 그래프에 등락률 겹침.
//   시간 토글: [분봉 / 일봉 / 주봉 / 월봉]. 분봉=5거래일 1분봉(요일·시간대), 일봉=6개월, 주봉=2년 리샘플, 월봉=10년 리샘플. 시작점=0% 정규화.
//   분봉 타임스탬프는 +9h(KST) 보정 → lightweight-charts UTC 축에 한국 벽시계로 표시
//   (KR·US 모두 자기 장 시간대에 맞게 찍힘).
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQueries } from "@tanstack/react-query";
import {
  createChart,
  ColorType,
  LineSeries,
  BaselineSeries,
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

// 해당 연·월의 둘째 목요일(UTC) — 한국 선물옵션 만기일 = ETF 정기변경 기준일.
//   KOSPI200·KOSDAQ150·FnGuide 반기지수 모두 6·12월 만기일 전후로 리밸런싱(추정 마커용).
function secondThursday(year: number, monthIdx0: number): number {
  const first = new Date(Date.UTC(year, monthIdx0, 1));
  const toThu = (4 - first.getUTCDay() + 7) % 7;   // 0=일..4=목
  return Date.UTC(year, monthIdx0, 1 + toThu + 7);
}

// 종목 타입별 fetch 디스패치 (KR 6자리 → 토스/야후 KS·KQ, 그 외 → 야후 심볼)
const fetchDaily = (ticker: string, range: string): Promise<PricePoint[]> =>
  isKr(ticker) ? fetchKrPriceHistory(ticker, range) : fetchYahooPriceHistory(ticker, range);
const fetchMin = (ticker: string, range: string): Promise<IntradayBar[]> =>
  isKr(ticker) ? fetchKrIntraday(ticker, range, "1m") : fetchYahooIntraday(ticker, range, "1m");

type Mode = "min" | "day" | "week" | "month";   // 분봉(요일·시간대) / 일봉(단중기) / 주봉(중기) / 월봉(장기)

// 봉별 선택 가능 기간(Yahoo range 토큰). 분봉은 1m 이라 최대 ~7일.
const PERIODS: Record<Mode, { range: string; label: string }[]> = {
  min:   [{ range: "1d", label: "1일" }, { range: "5d", label: "5일" }],
  day:   [{ range: "1mo", label: "1개월" }, { range: "3mo", label: "3개월" }, { range: "6mo", label: "6개월" }, { range: "1y", label: "1년" }],
  week:  [{ range: "1y", label: "1년" }, { range: "2y", label: "2년" }, { range: "5y", label: "5년" }],
  month: [{ range: "2y", label: "2년" }, { range: "5y", label: "5년" }, { range: "10y", label: "10년" }, { range: "max", label: "전체" }],
};
const DEFAULT_RANGE: Record<Mode, string> = { min: "5d", day: "6mo", week: "2y", month: "10y" };

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

// 일봉: 각 거래일 종가를 첫 거래일=0% 로 정규화
function buildDaily(hist: PricePoint[]): Built {
  if (!hist || hist.length < 2) return EMPTY;
  const base = hist[0].close;
  if (!(base > 0)) return EMPTY;
  const data = hist.map(p => ({ time: p.date as Time, value: (p.close / base - 1) * 100 }));
  return { data, map: new Map(data.map(x => [String(x.time), x.value])), final: data[data.length - 1].value };
}

// 월봉: 일봉을 YYYY-MM 버킷으로 묶어 각 월 마지막 종가 → 시작월=0% 정규화
function buildMonthly(hist: PricePoint[]): Built {
  if (!hist || hist.length < 2) return EMPTY;
  const monthly: { date: string; close: number }[] = [];
  let curKey = "";
  for (const p of hist) {
    const key = p.date.slice(0, 7);   // YYYY-MM
    if (key !== curKey) { monthly.push({ date: p.date, close: p.close }); curKey = key; }
    else monthly[monthly.length - 1] = { date: p.date, close: p.close };   // 같은 달 → 마지막 거래일로 갱신
  }
  if (monthly.length < 2) return EMPTY;
  const base = monthly[0].close;
  if (!(base > 0)) return EMPTY;
  const data = monthly.map(p => ({ time: p.date as Time, value: (p.close / base - 1) * 100 }));
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

// "#dc2626" + 알파 → rgba (격차 리본 채우기용). 비-hex(hsl)은 그대로 반환(2종목 비교는 항상 hex).
const hexA = (hex: string, a: number): string => {
  if (hex[0] !== "#" || hex.length < 7) return hex;
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

export function EtfCompareChartDialog({ isOpen, onClose, seed }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const bandRef = useRef<HTMLCanvasElement>(null);   // 배경 밴드(일/주 음영 + 요일 라벨)
  const [mode, setMode] = useState<Mode>("min");
  const [range, setRange] = useState<string>(DEFAULT_RANGE.min);
  // 모드 전환 시 그 모드의 기본 기간으로 (현재 range 가 새 모드에 없으면 기본값).
  const pickMode = (m: Mode) => {
    setMode(m);
    setRange(r => (PERIODS[m].some(p => p.range === r) ? r : DEFAULT_RANGE[m]));
  };
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
    queries: stocks.map(s => ({
      queryKey: ["cmp", mode, range, s.ticker],
      queryFn: () => (mode === "min" ? fetchMin(s.ticker, range) : fetchDaily(s.ticker, range)),
      staleTime: mode === "min" ? 5 * 60_000 : mode === "day" ? 30 * 60_000 : 60 * 60_000,
      enabled: isOpen,
    })),
  });
  const stamp = qs.map(q => q.dataUpdatedAt).join(",");
  const loading = qs.some(q => q.isLoading);

  // ticker → 정규화 시리즈
  const built = useMemo(() => {
    const m = new Map<string, Built>();
    stocks.forEach((s, i) => {
      const data = qs[i]?.data;
      m.set(s.ticker,
        mode === "month" ? buildMonthly((data as PricePoint[]) ?? [])
        : mode === "week" ? buildWeekly((data as PricePoint[]) ?? [])
        : mode === "day" ? buildDaily((data as PricePoint[]) ?? [])
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

    // ── 격차선 — 정확히 2종목 비교 시 하단 서브패널에 (A−B) %p 라인 + 0 기준선.
    //    0 으로 향하면 수렴, 멀어지면 발산. 0 위/아래 색으로 어느 종목이 앞서는지 표시(BaselineSeries).
    if (visible.length === 2) {
      const [sa, sb] = visible;
      const ba = built.get(sa.ticker)!, bb = built.get(sb.ticker)!;
      const longer = ba.data.length >= bb.data.length ? ba : bb;
      const spreadData: { time: Time; value: number }[] = [];
      for (const d of longer.data) {
        const key = String(d.time);
        const va = ba.map.get(key), vb = bb.map.get(key);
        if (va == null || vb == null) continue;
        spreadData.push({ time: d.time, value: va - vb });   // sa 등락률 − sb 등락률 (%p)
      }
      if (spreadData.length >= 2) {
        const ca = colorOf(sa.ticker), cb = colorOf(sb.ticker);
        const spreadSer = chart.addSeries(BaselineSeries, {
          baseValue: { type: "price", price: 0 },
          topLineColor: ca, topFillColor1: hexA(ca, 0.28), topFillColor2: hexA(ca, 0.04),
          bottomLineColor: cb, bottomFillColor1: hexA(cb, 0.04), bottomFillColor2: hexA(cb, 0.28),
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          crosshairMarkerVisible: true,
          crosshairMarkerRadius: 3,
        }, 1);   // paneIndex 1 = 하단 서브패널
        spreadSer.setData(spreadData);
        spreadSer.createPriceLine({
          price: 0, color: "#9ca3af", lineWidth: 1, lineStyle: LineStyle.Dashed,
          axisLabelVisible: true, title: "동일",
        });
        // 상단(가격) 3 : 하단(격차) 1 비율
        const panes = chart.panes();
        panes[0]?.setStretchFactor(3);
        panes[1]?.setStretchFactor(1);
      }
    }

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
      // 격차 — 정확히 2종목일 때 두 등락률 차(%p)를 명시. 앞선 종목 색으로.
      if (rows.length === 2) {
        const gap = rows[0].v - rows[1].v;   // 정렬상 rows[0] 이 위 → gap ≥ 0
        html += `<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;`
          + `margin-top:2px;padding:1px 5px;border-top:1px solid #e5e7eb;color:#374151;font-weight:600">`
          + `<span>격차</span>`
          + `<span style="color:${rows[0].color};font-weight:700;font-variant-numeric:tabular-nums">${gap.toFixed(2)}%p</span>`
          + `</div>`;
      }
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
    const groupOf = (t: Time): number => {
      if (mode === "week") return Math.floor(Date.parse(`${String(t)}T00:00:00Z`) / 86_400_000 / 7);
      if (mode === "month") {   // 연 단위 교차 음영
        return new Date(`${String(t)}T00:00:00Z`).getUTCFullYear();
      }
      if (mode === "day") {   // 월 단위 교차 음영
        const d = new Date(`${String(t)}T00:00:00Z`);
        return d.getUTCFullYear() * 12 + d.getUTCMonth();
      }
      return Math.floor(Number(t) / 86_400);
    };

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

      // ── 격차 리본 — 2종목 비교 시 두 선 사이를 음영으로 채움(두께=등락률 격차, 색=앞선 종목).
      //    상단 가격 패널(pane 0, 캔버스 최상단) 좌표라 priceToCoordinate 가 곧 캔버스 y.
      if (visible.length === 2 && zeroAnchor) {
        const ma = built.get(visible[0].ticker)!.map, mb = built.get(visible[1].ticker)!.map;
        const ca = colorOf(visible[0].ticker), cb = colorOf(visible[1].ticker);
        const Y = (v: number) => zeroAnchor!.priceToCoordinate(v);
        let rx: number[] = [], rya: number[] = [], ryb: number[] = [], rd: number[] = [];
        const flush = () => {
          for (let k = 0; k + 1 < rx.length; k++) {
            ctx.beginPath();
            ctx.moveTo(rx[k], rya[k]);
            ctx.lineTo(rx[k + 1], rya[k + 1]);
            ctx.lineTo(rx[k + 1], ryb[k + 1]);
            ctx.lineTo(rx[k], ryb[k]);
            ctx.closePath();
            ctx.fillStyle = hexA((rd[k] + rd[k + 1]) >= 0 ? ca : cb, 0.13);   // 평균 격차 부호로 앞선 종목
            ctx.fill();
          }
          rx = []; rya = []; ryb = []; rd = [];
        };
        for (const t of refTimes) {
          const key = String(t);
          const va = ma.get(key), vb = mb.get(key), x = X(t);
          if (va == null || vb == null || x == null) { flush(); continue; }
          const ya = Y(va), yb = Y(vb);
          if (ya == null || yb == null) { flush(); continue; }
          rx.push(x); rya.push(ya); ryb.push(yb); rd.push(va - vb);
        }
        flush();
      }

      // ── ETF 정기변경(추정) 마커 — 6·12월 선물만기일(둘째 목요일) 세로선. 분봉 제외, KR ETF 포함 시만.
      //    룰베이스라 전 구간 backfill. 실제 리밸런싱은 만기일 직전일~D+수일에 집중.
      if (mode !== "min" && stocks.some(s => isKr(s.ticker))) {
        const toMs = (t: Time) => Date.parse(`${String(t)}T00:00:00Z`);
        const sMs = toMs(refTimes[0]), eMs = toMs(refTimes[refTimes.length - 1]);
        const y0 = new Date(sMs).getUTCFullYear(), y1 = new Date(eMs).getUTCFullYear();
        ctx.font = "700 9px system-ui, -apple-system, sans-serif";
        ctx.textBaseline = "top";
        for (let y = y0; y <= y1; y++) {
          for (const mo of [5, 11]) {   // 6월(idx5)·12월(idx11)
            const rbMs = secondThursday(y, mo);
            if (rbMs < sMs || rbMs > eMs) continue;
            // 가장 가까운 bar 에 스냅(임의 날짜는 timeToCoordinate 가 null 일 수 있음)
            let bi = 0, bd = Infinity;
            for (let k = 0; k < refTimes.length; k++) {
              const d = Math.abs(toMs(refTimes[k]) - rbMs);
              if (d < bd) { bd = d; bi = k; }
            }
            const x = X(refTimes[bi]);
            if (x == null || x < 0 || x > plotW) continue;
            ctx.strokeStyle = "rgba(217,119,6,0.5)";   // amber
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 3]);
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
            ctx.setLineDash([]);
            const label = `정기변경 ${mo === 5 ? "6" : "12"}월`;
            const tw = ctx.measureText(label).width;
            const lx = x + 3 + tw > plotW ? x - 3 - tw : x + 3;
            ctx.fillStyle = "rgba(180,83,9,0.95)";
            ctx.fillText(label, lx, 3);
          }
        }
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
            {([["min", "분봉"], ["day", "일봉"], ["week", "주봉"], ["month", "월봉"]] as const).map(([m, label]) => (
              <button key={m} onClick={() => pickMode(m)}
                      title={m === "min" ? "최근 5거래일 1분봉 — 요일·시간대 패턴"
                             : m === "day" ? "6개월 일봉 — 단·중기 추세"
                             : m === "week" ? "2년 주봉 — 중기 추세"
                             : "10년 월봉 — 장기 추세"}
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

        {/* 기간 선택 — 현재 봉 모드에서 고를 수 있는 기간 칩 */}
        <div className="px-4 py-1.5 border-b bg-white flex items-center justify-end gap-1.5 flex-wrap text-[11px]">
          <span className="text-gray-400 font-medium mr-0.5">기간</span>
          {PERIODS[mode].map(p => (
            <button key={p.range} onClick={() => setRange(p.range)}
                    className={`px-2 py-0.5 rounded border transition font-semibold
                                ${range === p.range
                                  ? "bg-indigo-600 text-white border-indigo-600"
                                  : "bg-white text-gray-600 border-gray-300 hover:bg-gray-100"}`}>
              {p.label}
            </button>
          ))}
        </div>

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
          {mode !== "min" && stocks.some(s => isKr(s.ticker)) && (
            <span className="inline-flex items-center gap-1 text-gray-500">
              <span className="inline-block w-4 border-t-2 border-dashed border-amber-600" />
              <b className="text-amber-700">정기변경(추정)</b> 6·12월 선물만기일
            </span>
          )}
          {stocks.length === 2 && (
            <span className="text-gray-500">
              하단 <b className="text-gray-700">격차선</b> = 두 등락률 차(%p) · 0선에 가까울수록 수렴(격차↓), 멀어지면 발산
            </span>
          )}
          <span className="ml-auto text-gray-400">
            {(PERIODS[mode].find(p => p.range === range)?.label ?? "")}{" "}
            {mode === "min" ? "1분봉 · KST · 요일·시간대 패턴 · 첫 봉 대비 %"
             : mode === "day" ? "일봉 · 첫 거래일 대비 %"
             : mode === "week" ? "주봉 · 시작주 대비 %"
             : "월봉 · 시작월 대비 %"}
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default EtfCompareChartDialog;
