// 투자자 순매수 다중 라인 차트 — 당일(시간축) / 일별(날짜축) 공용.
//   투자자 on/off 는 상위(IntradayInvestorSection)의 공통 토글로 제어(controlled).
//   series 는 이미 (당일=누적 스냅샷 / 일별=기간 누적) 계산된 값. summary=헤더 표시값.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, Fragment } from "react";
import {
  createChart,
  ColorType,
  LineSeries,
  BaselineSeries,
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
import { StackedNetSeries, type StackBarData } from "../lib/stackedNetSeries";

export interface FlowSeriesPoint {
  t: UTCTimestamp;
  label: string;                        // 툴팁 표기용 (HH:MM 또는 MM/DD)
  values: Record<IntradayKey, number>;  // 누적(라인용)
  daily?: Record<IntradayKey, number>;  // 그날 순매수(비누적) — 하단 스택 막대용(일별 모드만)
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
  series, summary, enabled, unit, marketLabel, timeVisible, summaryHint, indexSeries, indexLabel, indexBaseline, onReady, onToggle, refFirstT, refLastT,
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
  onReady?: SyncRegistrar;                              // 3개 차트 crosshair 동기화
  onToggle?: (key: IntradayKey) => void;                // 헤더/값표 칩 클릭 → 상위 공통 토글
  refFirstT?: UTCTimestamp;                             // 기준 시간범위(코스피·코스닥) — 후행 선물이 도메인을 맞추도록
  refLastT?: UTCTimestamp;                              //   선물은 우측 공백, 코스피·코스닥이 시간축 기준
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const vlinesRef = useRef<HTMLDivElement>(null);
  const fracKeyRef = useRef("");
  // 09:00/12:00/15:00 의 차트 내 x 위치(0~1) — 아래 값표 컬럼 정렬용.
  const [colFrac, setColFrac] = useState<{ label: string; frac: number }[]>([]);
  // 값표 컬럼 충돌 회피 — 측정 폭 기반으로 겹치면 오른쪽으로 밀어낸 최종 left(px).
  const valueTableRef = useRef<HTMLDivElement>(null);
  const colRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const colPosKeyRef = useRef("");
  const [colLeft, setColLeft] = useState<Record<string, number>>({});

  const byT = useMemo(() => {
    const m = new Map<number, FlowSeriesPoint>();
    for (const p of series) m.set(p.t as number, p);
    return m;
  }, [series]);

  // 09:00 / 12:00 / 15:00 최근접 포인트(20분 이내) + 맨 오른쪽 "현재"(최신) — 차트 아래 값표용.
  const timeCols = useMemo(() => {
    if (!timeVisible || series.length === 0) return [] as { label: string; pt: FlowSeriesPoint }[];
    const lastT = series[series.length - 1].t as number;   // 최신 데이터 시각
    const cols = MARK_TIMES.map(hm => {
      const [h, mm] = hm.split(":").map(Number);
      const tt = Date.UTC(2000, 0, 1, h, mm) / 1000;
      if (tt > lastT) return null;   // 아직 도달 안 한 마커(예: 14:50 인데 15:00)는 숨김
      let best: FlowSeriesPoint | null = null, bestD = Infinity;
      for (const p of series) { const d = Math.abs((p.t as number) - tt); if (d < bestD) { bestD = d; best = p; } }
      return best && bestD <= 20 * 60 ? { label: hm, pt: best } : null;
    }).filter((c): c is { label: string; pt: FlowSeriesPoint } => c != null);
    cols.push({ label: "현재", pt: series[series.length - 1] });   // 최신값 = 맨 오른쪽
    return cols;
  }, [series, timeVisible]);

  // 각 값표 컬럼 시각의 지수(코스피/코스닥) 값 — 20분 이내 최근접. 값표에 지수도 함께 표시.
  const indexAtCol = useMemo(() => {
    const m = new Map<string, number>();
    if (!indexSeries || indexSeries.length === 0) return m;
    for (const c of timeCols) {
      const tt = c.pt.t as number;
      let best: number | null = null, bestD = Infinity;
      for (const p of indexSeries) { const d = Math.abs((p.t as number) - tt); if (d < bestD) { bestD = d; best = p.value; } }
      if (best != null && bestD <= 20 * 60) m.set(c.label, best);
    }
    return m;
  }, [timeCols, indexSeries]);

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
      timeScale: { borderColor: "#e5e7eb", timeVisible, secondsVisible: false, fixLeftEdge: true, fixRightEdge: true },
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

    // 배경 지수(코스피/코스닥) — 전일 종가 기준 위=빨강/아래=파랑(한국식). 투자자 라인 뒤에 깔림.
    if (indexSeries && indexSeries.length > 1) {
      const base = indexBaseline ?? indexSeries[0].value;
      const idx = chart.addSeries(BaselineSeries, {
        priceScaleId: "left",
        priceFormat: { type: "price", precision: 0, minMove: 1 },   // 지수 축 정수 표시(6800.00 → 6,800)
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
    //   후행 선물은 기준 시간범위(코스피·코스닥) 끝까지 0선을 연장해 도메인을 맞춤 →
    //   세 차트가 같은 범위로 fit 되고, 선물 순매수 라인만 일찍 끝나 우측이 공백으로 남음.
    const zero = chart.addSeries(LineSeries, {
      color: "#475569", lineWidth: 1, lineStyle: LineStyle.Dashed,   // slate-600
      priceFormat: { type: "price", precision: 0, minMove: 1 },   // 순매수 축 정수(억원/계약)
      priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
    });
    const zeroData = series.map(p => ({ time: p.t as Time, value: 0 }));
    const firstT = series[0].t as number, lastT = series[series.length - 1].t as number;
    if (refFirstT != null && (refFirstT as number) < firstT) zeroData.unshift({ time: refFirstT as Time, value: 0 });
    if (refLastT != null && (refLastT as number) > lastT) zeroData.push({ time: refLastT as Time, value: 0 });
    zero.setData(zeroData);

    for (const def of INTRADAY_SERIES) {
      if (!enabled[def.key]) continue;
      const s: ISeriesApi<"Line"> = chart.addSeries(LineSeries, {
        color: def.color, lineWidth: 2,
        priceFormat: { type: "price", precision: 0, minMove: 1 },   // 순매수 정수(억원/계약)
        priceLineVisible: false, lastValueVisible: false,
      });
      s.setData(series.map(p => ({ time: p.t as Time, value: p.values[def.key] })));
    }

    // ─── 하단 일별 스택 막대 (daily 값이 있을 때 = 일별 모드) ───────────────
    //   체크된 주체를 각자 색으로 다이버징 스택(양수 0 위 / 음수 0 아래). 커스텀 시리즈로 진짜 세그먼트 렌더.
    //   상단 라인 패널(right)과 축 분리(오버레이 스케일 "hist", 아래 30%).
    //   스택은 '합산'이라 포함관계 항목 이중계산 방지 — '기관계'(= 금융투자+투신+보험+연기금+은행+기타금융)가
    //   켜져 있으면 그 세부는 스택에서 제외(라인차트는 세부까지 그대로 표시).
    const INST_DETAIL = new Set<IntradayKey>([
      "financialInvestment", "insurance", "trust", "bank", "otherFinancial", "pensionFund",
    ]);
    const stackDefs = INTRADAY_SERIES
      .filter(d => enabled[d.key])
      .filter(d => !(enabled["institutions"] && INST_DETAIL.has(d.key)));   // 스택 순서(개인이 맨 안쪽)
    if (stackDefs.length > 0 && series.some(p => p.daily)) {
      const stackData: (StackBarData | { time: Time })[] = series.map(p =>
        p.daily
          ? { time: p.t as Time, segments: stackDefs.map(def => ({ value: p.daily![def.key] ?? 0, color: def.color })) }
          : { time: p.t as Time });
      const stack = chart.addCustomSeries(new StackedNetSeries(), {
        priceScaleId: "hist",
        priceFormat: { type: "price", precision: 0, minMove: 1 },
        priceLineVisible: false, lastValueVisible: false,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stack.setData(stackData as any);
      chart.priceScale("hist").applyOptions({ scaleMargins: { top: 0.7, bottom: 0 } });
      chart.priceScale("right").applyOptions({ scaleMargins: { top: 0.1, bottom: 0.36 } });
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
        const dv = pt.daily?.[def.key];   // 그날 순매수(일별 모드만) — 누적 옆에 (+일별) 병기
        html += `<div class="flex justify-between gap-3"><span style="color:${def.color}">${def.label}</span>`
              + `<span><span class="font-bold" style="color:${netColor(v)}">${fmtNet(v, unit)}</span>`
              + (dv != null ? ` <span class="text-[9px]" style="color:${netColor(dv)}">(${fmtNet(dv, unit)})</span>` : "")
              + `</span></div>`;
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
  }, [series, enabled, unit, timeVisible, byT, indexSeries, indexLabel, indexBaseline, timeCols, onReady, refFirstT, refLastT]);

  // 값표도 헤더와 동일하게 금액 내림차순(+ 위 / − 아래) 정렬.
  const enabledDefs = INTRADAY_SERIES.filter(d => enabled[d.key]).sort((a, b) => summary[b.key] - summary[a.key]);

  // 값표 컬럼 충돌 회피 — 각 컬럼 실제 폭을 측정해 좌→우로 겹치면 오른쪽으로 밀고,
  //   우측 경계를 넘으면 마지막을 당긴 뒤 앞 컬럼들을 역방향으로 정리(선물 '현재'가 박스 밖으로 나가던 것 방지).
  //   deps 없이 매 렌더 실행하되 결과가 바뀔 때만 setState (무한루프 방지).
  useLayoutEffect(() => {
    const cont = valueTableRef.current;
    if (!cont) return;
    const CW = cont.clientWidth || 1;
    const GAP = 8;
    const cols = colFrac
      .filter(c => timeCols.some(tc => tc.label === c.label))
      .slice()
      .sort((a, b) => a.frac - b.frac);
    if (cols.length === 0) { if (colPosKeyRef.current !== "") { colPosKeyRef.current = ""; setColLeft({}); } return; }
    const widths = cols.map(c => colRefs.current[c.label]?.offsetWidth ?? 70);
    const pos: number[] = [];
    for (let i = 0; i < cols.length; i++) {
      let p = cols[i].frac * CW;                                  // 목표 = 마커 x 위치
      if (i > 0) p = Math.max(p, pos[i - 1] + widths[i - 1] + GAP);  // 앞과 겹치면 오른쪽으로
      pos.push(p);
    }
    const last = cols.length - 1;
    if (pos[last] + widths[last] > CW) {                          // 우측 경계 초과 → 당겨서 맞추고 앞쪽 정리
      pos[last] = Math.max(0, CW - widths[last]);
      for (let i = last - 1; i >= 0; i--) pos[i] = Math.max(0, Math.min(pos[i], pos[i + 1] - widths[i] - GAP));
    }
    const map: Record<string, number> = {};
    cols.forEach((c, i) => { map[c.label] = pos[i]; });
    const key = cols.map((c, i) => `${c.label}:${Math.round(pos[i])}`).join(",");
    if (key !== colPosKeyRef.current) { colPosKeyRef.current = key; setColLeft(map); }
  });

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
              {/* 칩 클릭 → 상위 공통 토글(위쪽 체크박스와 동기화). 켜짐=진하게 / 꺼짐=흐리게. */}
              <button type="button"
                      onClick={onToggle ? () => onToggle(def.key) : undefined}
                      title={`${def.label} ${enabled[def.key] ? "끄기" : "켜기"}`}
                      className={`inline-flex items-baseline gap-1 rounded ${onToggle ? "cursor-pointer hover:bg-gray-100" : ""} ${enabled[def.key] ? "" : "opacity-50"}`}>
                <span className="text-white px-1 rounded text-[10px] font-medium"
                      style={{ backgroundColor: def.color }}>{def.label}</span>
                <span className={enabled[def.key] ? "font-bold" : "font-normal"}
                      style={{ color: netColor(summary[def.key]) }}>{fmtNet(summary[def.key], unit)}</span>
              </button>
            </Fragment>
          ));
        })()}
      </div>
      <div className="relative">
        {/* 고정 높이 대신 가로세로 비율 유지 — 카드 수가 줄어 폭이 커지면 세로도 비례해 커짐(3개→2개→1개).
            min/max 로 너무 납작하거나 과대해지는 것 방지. */}
        <div ref={containerRef} className="w-full aspect-[16/10] min-h-[190px] max-h-[460px]" />
        <div ref={vlinesRef} className="absolute inset-0 pointer-events-none overflow-hidden z-10" />
        <div ref={tooltipRef}
             className="absolute pointer-events-none bg-white/30 backdrop-blur-[2px] border border-gray-200/60 rounded shadow-sm
                        px-2 py-1 text-xs text-gray-800 tabular-nums z-50 leading-snug"
             style={{ display: "none" }} />
      </div>

      {/* 차트 아래 값표 — 09:00 / 12:00 / 15:00 / 현재 를 그래프 x 위치에 맞추되, 서로 겹치면 오른쪽으로 밀어냄(useLayoutEffect) */}
      {timeVisible && colFrac.length > 0 && enabledDefs.length > 0 && (
        <div ref={valueTableRef} className="relative mt-1.5 text-[10px] tabular-nums"
             style={{ height: 16 + (enabledDefs.length + (indexAtCol.size ? 1 : 0)) * 15 }}>
          {colFrac.map(c => {
            const col = timeCols.find(tc => tc.label === c.label);
            if (!col) return null;
            const left = colLeft[c.label];   // 충돌 회피 후 최종 위치(px). 아직 미측정이면 frac% 로 임시 배치(레이아웃이펙트가 페인트 전 확정).
            const idxVal = indexAtCol.get(c.label);
            return (
              <div key={c.label}
                   ref={el => { colRefs.current[c.label] = el; }}
                   className="absolute top-0 flex flex-col gap-0.5 items-start"
                   style={left != null ? { left: `${left}px` } : { left: `${c.frac * 100}%` }}>
                <span className="text-gray-500 font-semibold leading-none">{c.label}</span>
                {/* 배경 지수(코스피/코스닥) 값 — 툴팁과 같은 녹색 */}
                {idxVal != null && (
                  <span className="inline-flex items-center gap-1 whitespace-nowrap leading-none">
                    <span className="text-white px-1 rounded text-[9px]" style={{ backgroundColor: "#16a34a" }}>
                      {indexLabel ?? "지수"}
                    </span>
                    <span className="font-bold text-gray-700">
                      {idxVal.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </span>
                  </span>
                )}
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
