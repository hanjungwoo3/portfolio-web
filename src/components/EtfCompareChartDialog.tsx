// ETF 비교 차트 팝업 — 검색 결과 ETF 들을 한 그래프에 겹쳐 일별 등락률(누적 %)을 비교.
//   각 ETF 의 6개월 종가 히스토리를 시작점=0% 로 정규화(rebase) → 라인 한 줄씩.
//   기간 토글(1·3·6개월), 범례 클릭으로 개별 ON/OFF, 크로스헤어 시 범례에 해당일 % 표시.

import { useEffect, useMemo, useRef, useState } from "react";
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
import { fetchKrPriceHistory, type PricePoint } from "../lib/api";

const MAX_LINES = 12;   // 가독성 — 상위 N 개만 (그 이상은 선이 뭉개짐)

// 12색 팔레트 (코드 인덱스 고정 — ON/OFF 해도 색 안 바뀜)
const PALETTE = [
  "#dc2626", "#2563eb", "#16a34a", "#d97706", "#9333ea", "#0d9488",
  "#db2777", "#0891b2", "#65a30d", "#e11d48", "#7c3aed", "#ca8a04",
];

interface EtfRef { code: string; name: string; }

interface Props {
  isOpen: boolean;
  onClose: () => void;
  etfs: EtfRef[];   // 비교할 ETF (정렬·필터 적용된 검색 결과)
}

type Period = "1mo" | "3mo" | "6mo";
const PERIOD_MONTHS: Record<Period, number> = { "1mo": 1, "3mo": 3, "6mo": 6 };

// lastISO 에서 months 개월 전 날짜(YYYY-MM-DD)
function cutoffDate(lastISO: string, months: number): string {
  const d = new Date(`${lastISO}T00:00:00`);
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

interface Built {
  data: { time: Time; value: number }[];
  map: Map<string, number>;   // date → 누적%
  final: number | null;       // 마지막 누적%
}

// 기간 윈도 잘라 시작점=0% 로 정규화
function buildSeries(hist: PricePoint[], months: number): Built {
  const empty: Built = { data: [], map: new Map(), final: null };
  if (!hist || hist.length < 2) return empty;
  const lastISO = hist[hist.length - 1].date;
  const cut = cutoffDate(lastISO, months);
  let win = hist.filter(p => p.date >= cut);
  if (win.length < 2) win = hist;
  const base = win[0].close;
  if (!(base > 0)) return empty;
  const data = win.map(p => ({ time: p.date as Time, value: (p.close / base - 1) * 100 }));
  const map = new Map(data.map(d => [String(d.time), d.value]));
  return { data, map, final: data[data.length - 1].value };
}

export function EtfCompareChartDialog({ isOpen, onClose, etfs }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);   // 마우스 추적 순위 박스 (DOM 직접 갱신)
  const [period, setPeriod] = useState<Period>("3mo");
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const capped = useMemo(() => etfs.slice(0, MAX_LINES), [etfs]);
  const colorOf = useMemo(() => {
    const m: Record<string, string> = {};
    capped.forEach((e, i) => { m[e.code] = PALETTE[i % PALETTE.length]; });
    return m;
  }, [capped]);

  // Esc 닫기
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  // 각 ETF 6개월 히스토리 (기간 토글은 클라에서 슬라이스 — 재조회 없음)
  const qs = useQueries({
    queries: capped.map(e => ({
      queryKey: ["price-history", e.code, "6mo"],
      queryFn: () => fetchKrPriceHistory(e.code, "6mo"),
      staleTime: 60 * 60_000,
      enabled: isOpen,
    })),
  });
  const stamp = qs.map(q => q.dataUpdatedAt).join(",");
  const loading = qs.some(q => q.isLoading);

  // code → 정규화 시리즈 (기간/데이터 변경 시 재계산)
  const built = useMemo(() => {
    const m = new Map<string, Built>();
    capped.forEach((e, i) => m.set(e.code, buildSeries(qs[i]?.data ?? [], PERIOD_MONTHS[period])));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capped, period, stamp]);

  const hiddenKey = [...hidden].sort().join(",");

  // 차트 그리기
  useEffect(() => {
    if (!isOpen || !containerRef.current) return;
    const visible = capped.filter(e => !hidden.has(e.code) && (built.get(e.code)?.data.length ?? 0) >= 2);
    if (visible.length === 0) return;

    const chart: IChartApi = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#374151",
        fontSize: 11,
        fontFamily: "system-ui, -apple-system, sans-serif",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "#f3f4f6" },
        horzLines: { color: "#f3f4f6" },
      },
      rightPriceScale: {
        borderColor: "#e5e7eb",
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: { borderColor: "#e5e7eb", timeVisible: false, secondsVisible: false },
      crosshair: {
        mode: 1,
        vertLine: { color: "#9ca3af", width: 1, style: LineStyle.Dotted, labelBackgroundColor: "#475569" },
        horzLine: { color: "#9ca3af", width: 1, style: LineStyle.Dotted, labelBackgroundColor: "#475569" },
      },
      localization: {
        priceFormatter: (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`,
      },
      autoSize: true,
    });

    const seriesList: { code: string; series: ISeriesApi<SeriesType> }[] = [];
    let zeroAnchor: ISeriesApi<SeriesType> | null = null;
    for (const e of visible) {
      const b = built.get(e.code)!;
      const s = chart.addSeries(LineSeries, {
        color: colorOf[e.code],
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,   // 우측 축엔 % 값만 (종목명은 하단 범례 + 마우스 순위 박스)
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 3,
      });
      s.setData(b.data);
      seriesList.push({ code: e.code, series: s });
      if (!zeroAnchor) zeroAnchor = s;
    }
    // 0% 기준선 (시작점)
    zeroAnchor?.createPriceLine({
      price: 0, color: "#9ca3af", lineWidth: 1, lineStyle: LineStyle.Dashed,
      axisLabelVisible: true, title: "0%",
    });

    chart.timeScale().fitContent();

    const nameByCode: Record<string, string> = {};
    for (const e of capped) nameByCode[e.code] = e.name;
    const PAD_L = 8, PAD_T = 8;   // wrapper 의 px-2 pt-2(8px) 보정

    const onMove = (param: MouseEventParams) => {
      const tip = tooltipRef.current;
      const cont = containerRef.current;
      if (!tip || !cont) return;
      if (param.time == null || !param.point) { tip.style.display = "none"; return; }
      const date = String(param.time);
      // 해당일 등락률 내림차순(순위) 정렬
      const rows = seriesList
        .map(({ code }) => ({ code, v: built.get(code)?.map.get(date), color: colorOf[code], name: nameByCode[code] ?? code }))
        .filter((r): r is { code: string; v: number; color: string; name: string } => typeof r.v === "number")
        .sort((a, b) => b.v - a.v);
      if (rows.length === 0) { tip.style.display = "none"; return; }
      let html = `<div style="color:#9ca3af;font-size:10px;margin-bottom:3px">${date}</div>`;
      rows.forEach((r, i) => {
        const pc = r.v >= 0 ? "#e11d48" : "#2563eb";
        // 행 배경 = 라인 색 (범례와 동일) · 순번/이름 흰색 · % 는 흰 알약
        html += `<div style="display:flex;align-items:center;gap:5px;line-height:1.7;`
          + `background:${r.color};border-radius:4px;padding:1px 5px;margin-bottom:2px">`
          + `<span style="color:rgba(255,255,255,0.8);width:13px;text-align:right;flex:none;font-weight:700">${i + 1}</span>`
          + `<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#fff;font-weight:600;text-shadow:0 1px 1px rgba(0,0,0,0.3)">${r.name}</span>`
          + `<span style="background:#fff;border-radius:3px;padding:0 3px;color:${pc};font-weight:700;font-variant-numeric:tabular-nums;flex:none">${r.v >= 0 ? "+" : ""}${r.v.toFixed(2)}%</span>`
          + `</div>`;
      });
      tip.innerHTML = html;
      tip.style.display = "block";
      // 마우스 따라가기 — 가장자리 넘으면 반대편으로 flip
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

    return () => {
      try { chart.unsubscribeCrosshairMove(onMove); } catch { /* noop */ }
      chart.remove();
    };
  }, [isOpen, built, hiddenKey, capped, colorOf, hidden]);

  if (!isOpen) return null;

  const toggle = (code: string) =>
    setHidden(prev => {
      const n = new Set(prev);
      if (n.has(code)) n.delete(code); else n.add(code);
      return n;
    });

  const periodLabel: Record<Period, string> = { "1mo": "1개월", "3mo": "3개월", "6mo": "6개월" };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-stretch sm:items-center
                    justify-center p-0 sm:p-4 overflow-y-auto"
         onClick={onClose}>
      <div className="bg-white w-full h-full sm:h-auto sm:max-h-[95vh] max-w-6xl
                      rounded-none sm:rounded-lg shadow-xl flex flex-col my-auto"
           onClick={e => e.stopPropagation()}>
        {/* 헤더 */}
        <header className="px-4 py-2 border-b bg-gray-50 flex items-center gap-2 flex-wrap">
          <span className="text-base font-bold">📊 ETF 등락률 비교</span>
          <span className="text-[11px] text-gray-500">
            시작점=0% 정규화 · {capped.length}개{etfs.length > MAX_LINES && ` (상위 ${MAX_LINES}개만)`}
          </span>
          {/* 기간 토글 */}
          <span className="ml-auto inline-flex items-center gap-0.5">
            {(["1mo", "3mo", "6mo"] as const).map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                      className={`px-2 py-0.5 rounded text-[11px] font-bold border transition
                                  ${period === p
                                    ? "bg-gray-700 text-white border-gray-700"
                                    : "bg-white text-gray-600 border-gray-300 hover:bg-gray-100"}`}>
                {periodLabel[p]}
              </button>
            ))}
          </span>
          <button onClick={onClose}
                  className="px-2 py-0.5 text-gray-400 hover:text-rose-500 text-lg leading-none">✕</button>
        </header>

        {/* 차트 */}
        <div className="relative px-2 pt-2">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-gray-400">
              불러오는 중…
            </div>
          )}
          <div ref={containerRef} className="w-full h-[52vh] min-h-[300px]" />
          {/* 마우스 추적 순위 박스 — 색상칩·이름·% (등락률 내림차순) */}
          <div ref={tooltipRef}
               className="absolute pointer-events-none z-20 bg-white/95 border border-gray-200 rounded-md
                          shadow-lg px-2 py-1.5 text-[11px] leading-snug"
               style={{ display: "none", minWidth: "160px", maxWidth: "280px" }} />
        </div>

        {/* 범례 — 클릭으로 ON/OFF, 최종 등락률(%). 마우스 올리면 차트 위 순위 박스에 해당일 % */}
        <div className="px-3 py-2 border-t bg-gray-50 flex flex-wrap gap-1.5 overflow-y-auto max-h-[28vh]">
          {capped.map(e => {
            const b = built.get(e.code);
            const off = hidden.has(e.code);
            const shown = b?.final ?? null;
            const noData = (b?.data.length ?? 0) < 2;
            return (
              <button key={e.code} onClick={() => toggle(e.code)}
                      title={off ? "클릭: 표시" : "클릭: 숨김"}
                      style={{ background: off ? "#e5e7eb" : colorOf[e.code] }}
                      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border border-black/10
                                  text-[11px] transition ${off ? "opacity-50" : "hover:brightness-110"}`}>
                <span className={`font-bold ${off ? "text-gray-500 line-through" : "text-white"}`}
                      style={off ? undefined : { textShadow: "0 1px 1px rgba(0,0,0,0.3)" }}>
                  {e.name}
                </span>
                {noData ? (
                  <span className={off ? "text-gray-400" : "text-white/70"}>—</span>
                ) : shown != null && (
                  <span className={`tabular-nums font-bold rounded px-1 bg-white
                                    ${shown >= 0 ? "text-rose-600" : "text-blue-600"}`}>
                    {shown >= 0 ? "+" : ""}{shown.toFixed(2)}%
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default EtfCompareChartDialog;
