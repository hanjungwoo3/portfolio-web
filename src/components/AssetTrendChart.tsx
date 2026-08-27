// 일별 자산 추이 차트 — 평가금액(영역) + 매입원금(점선). 둘 사이 간격이 곧 평가손익.
// 축 하나만 쓴다(둘 다 원 단위) — 수익률은 툴팁 숫자로 보여주고 별도 축을 만들지 않는다.

import { useEffect, useRef } from "react";
import {
  createChart, ColorType, LineStyle, LineSeries, AreaSeries,
  type IChartApi, type Time,
} from "lightweight-charts";
import {
  assetLineColor, ASSET_COST_COLOR as COST_COLOR,
  type AssetPoint,
} from "../lib/assetHistory";

function won(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e8) return `${(v / 1e8).toFixed(2)}억`;
  if (a >= 1e4) return `${Math.round(v / 1e4).toLocaleString()}만`;
  return Math.round(v).toLocaleString();
}

// 뒤에 깔 시장 지수. 여러 개를 동시에 깔 수 있고, 지수마다 전용 축을 쓴다.
//   (한 축에 몰면 값이 큰 쪽이 작은 쪽을 눌러 직선처럼 보인다 — 코스피 6,900 vs 코스닥 840)
export interface IndexOverlay {
  key: string;                                // 축 id 로도 쓰인다 (지수별 독립 축)
  label: string;                              // "코스피" 등
  color: string;
  closes: { date: string; close: number }[];  // 일별 종가(정렬 안 돼 있어도 됨)
}

interface Props { points: AssetPoint[]; height?: number; indexes?: IndexOverlay[] }

export function AssetTrendChart({ points, height = 320, indexes }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || points.length < 2) return;

    const chart: IChartApi = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#374151", fontSize: 11,
        fontFamily: "system-ui, -apple-system, sans-serif",
        attributionLogo: false,
      },
      grid: { vertLines: { color: "#f3f4f6" }, horzLines: { color: "#f3f4f6" } },
      rightPriceScale: { borderColor: "#e5e7eb" },
      timeScale: { borderColor: "#e5e7eb", fixLeftEdge: true, fixRightEdge: true },
      crosshair: {
        mode: 1,
        vertLine: { color: "#9ca3af", width: 1, style: LineStyle.Dotted, labelBackgroundColor: "#475569" },
        horzLine: { color: "#9ca3af", width: 1, style: LineStyle.Dotted, labelVisible: false },
      },
      handleScale: { axisPressedMouseMove: { time: false, price: true } },
    });

    // 시장 지수 — 자산 곡선보다 먼저 추가해야 뒤에 깔린다(나중에 추가한 시리즈가 위).
    //   ★ 자산 축에 얹으면 안 된다. 자산 금액대가 지수 변동폭보다 크면 지수선이 축 바닥에
    //     눌려 직선처럼 보인다. 지수끼리도 마찬가지(코스피 6,900 vs 코스닥 840).
    //     → 지수마다 전용 오버레이 축(눈금 숨김)에 그려 각자 범위로 자동 스케일한다.
    //     축이 다르므로 선 높이로 자산과 비교하면 안 된다 — 툴팁에 그날 지수값을 같이 보여준다.
    const idxVal = new Map<string, Map<string, number>>();   // 지수 key → (date → 그날 지수값)
    const from = points[0].date, to = points[points.length - 1].date;
    for (const ov of indexes ?? []) {
      const rows = ov.closes
        .filter(r => r.close > 0 && r.date >= from && r.date <= to)
        .sort((a, b) => (a.date < b.date ? -1 : 1));
      if (rows.length < 2) continue;
      const vals = new Map<string, number>();
      const scaleId = `idx_${ov.key}`;
      const series = chart.addSeries(LineSeries, {
        color: ov.color, lineWidth: 1,
        priceScaleId: scaleId,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      });
      series.setData(rows.map(r => {
        vals.set(r.date, r.close);
        return { time: r.date as Time, value: r.close };
      }));
      chart.priceScale(scaleId).applyOptions({
        visible: false,
        scaleMargins: { top: 0.12, bottom: 0.12 },
      });
      idxVal.set(ov.key, vals);
    }

    // 마지막 시점이 이익이면 빨강 계열, 손실이면 파랑 계열 — 한국식 색 관행
    const last = points[points.length - 1];
    const gain = last.unrealized >= 0;
    const area = chart.addSeries(AreaSeries, {
      lineColor: assetLineColor(last.unrealized),
      topColor: gain ? "rgba(220,38,38,0.22)" : "rgba(37,99,235,0.22)",
      bottomColor: "rgba(255,255,255,0.02)",
      lineWidth: 2,
      priceFormat: { type: "custom", formatter: (v: number) => won(v) },
      priceLineVisible: false,
    });
    area.setData(points.map(p => ({ time: p.date as Time, value: p.value })));

    const cost = chart.addSeries(LineSeries, {
      color: COST_COLOR, lineWidth: 1, lineStyle: LineStyle.Dashed,
      priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      priceFormat: { type: "custom", formatter: (v: number) => won(v) },
    });
    cost.setData(points.map(p => ({ time: p.date as Time, value: p.principal })));

    chart.timeScale().fitContent();

    const byDate = new Map(points.map(p => [p.date, p]));
    const tip = tipRef.current;
    chart.subscribeCrosshairMove(param => {
      if (!tip) return;
      const t = param.time ? String(param.time) : null;
      const p = t ? byDate.get(t) : undefined;
      if (!p || !param.point) { tip.style.display = "none"; return; }
      const c = assetLineColor(p.unrealized);
      const lineC = assetLineColor(last.unrealized);   // 실제 그려진 곡선 색과 맞춤
      tip.innerHTML =
        `<div class="font-bold text-gray-700">${p.date}</div>` +
        `<div><span class="text-gray-500">평가 </span><span style="color:${lineC}" class="font-bold">${won(p.value)}</span></div>` +
        `<div><span class="text-gray-500">원금 </span><span class="text-gray-600">${won(p.principal)}</span></div>` +
        `<div><span class="text-gray-500">평가손익 </span><span style="color:${c}" class="font-bold">${p.unrealized >= 0 ? "+" : ""}${won(p.unrealized)} (${p.returnPct >= 0 ? "+" : ""}${p.returnPct.toFixed(2)}%)</span></div>` +
        (p.realizedCum !== 0
          ? `<div><span class="text-gray-500">누적실현 </span><span class="text-gray-700">${p.realizedCum >= 0 ? "+" : ""}${won(p.realizedCum)}</span></div>` : "") +
        (indexes ?? []).map(ov => {
          const v = idxVal.get(ov.key)?.get(p.date);
          if (v == null) return "";
          const n = v.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          return `<div><span class="text-gray-500">${ov.label} </span><span style="color:${ov.color}" class="font-bold">${n}</span></div>`;
        }).join("") +
        `<div class="text-[10px] text-gray-400">보유 ${p.held}종목${p.priced < p.held ? ` · 종가확인 ${p.priced}` : ""}</div>`;
      tip.style.display = "block";
      const box = el.getBoundingClientRect();
      const x = Math.min(Math.max(param.point.x + 12, 4), box.width - 170);
      tip.style.left = `${x}px`;
      tip.style.top = `${Math.max(4, param.point.y - 10)}px`;
    });

    return () => { chart.remove(); };   // remove() 가 구독까지 정리한다
  }, [points, height, indexes]);

  if (points.length < 2) return null;
  return (
    <div className="relative">
      <div ref={boxRef} style={{ height }} className="w-full" />
      <div ref={tipRef}
           className="absolute hidden z-10 pointer-events-none bg-white/95 border border-gray-200
                      rounded shadow px-2 py-1 text-[11px] leading-tight tabular-nums" />
    </div>
  );
}
