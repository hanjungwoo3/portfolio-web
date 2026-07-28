// 기업가치 모달용 오버뷰 차트 2종 (네이버 기업분석 스타일):
//   ① 외국인 지분율(%) + 시가총액 — 이중축 라인
//   ② 상대수익률 — 종목 vs KOSPI, 시작일 100 기준 정규화
// 데이터는 기존 모달 쿼리와 동일 queryKey 로 캐시 공유(중복 호출 0). 가벼운 인라인 SVG 라인차트.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchKrPriceHistoryWithEvents, fetchInvestorHistorySafe, fetchYahooPriceHistory,
} from "../lib/api";

interface LineSeries {
  label: string;
  color: string;
  values: (number | null)[];        // dates 와 같은 길이, 없으면 null
  axis?: "left" | "right";          // 기본 right
  fmt: (n: number) => string;       // 값·축 라벨 포맷
}

function MiniMultiLine({ dates, series, height = 170 }:
                       { dates: string[]; series: LineSeries[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, H = height, padT = 10, padB = 18, padL = 46, padR = 52;
  const n = dates.length;
  const iw = W - padL - padR, ih = H - padT - padB;

  const rangeFor = (axis: "left" | "right") => {
    const vals = series.filter(s => (s.axis ?? "right") === axis)
      .flatMap(s => s.values).filter((v): v is number => v != null && Number.isFinite(v));
    if (!vals.length) return null;
    let mn = Math.min(...vals), mx = Math.max(...vals);
    if (mn === mx) { mn -= 1; mx += 1; }
    const pad = (mx - mn) * 0.08;
    return { mn: mn - pad, mx: mx + pad };
  };
  const rL = rangeFor("left"), rR = rangeFor("right");
  const xAt = (i: number) => padL + (n <= 1 ? iw / 2 : (iw * i) / (n - 1));
  const yAt = (v: number, axis: "left" | "right") => {
    const r = axis === "left" ? rL : rR;
    if (!r) return padT + ih / 2;
    return padT + ih - ((v - r.mn) / (r.mx - r.mn)) * ih;
  };
  const pathOf = (s: LineSeries) => {
    const axis = s.axis ?? "right";
    let d = "", pen = false;
    s.values.forEach((v, i) => {
      if (v == null || !Number.isFinite(v)) { pen = false; return; }
      d += `${pen ? "L" : "M"}${xAt(i).toFixed(1)},${yAt(v, axis).toFixed(1)} `;
      pen = true;
    });
    return d.trim();
  };
  // 축 라벨 (min/mid/max) — 해당 축 첫 시리즈 포맷 사용
  const axisLabels = (axis: "left" | "right") => {
    const r = axis === "left" ? rL : rR;
    const s = series.find(x => (x.axis ?? "right") === axis);
    if (!r || !s) return [];
    return [r.mx, (r.mx + r.mn) / 2, r.mn].map((v, k) => ({
      y: padT + (ih * k) / 2, text: s.fmt(v), color: s.color,
    }));
  };

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - padL) / iw) * (n - 1));
    setHover(i >= 0 && i < n ? i : null);
  };

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
           className="w-full block" style={{ height: H }}
           onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {/* 가로 그리드 */}
        {[0, 0.5, 1].map((t, k) => (
          <line key={k} x1={padL} x2={W - padR} y1={padT + ih * t} y2={padT + ih * t}
                stroke="#f1f5f9" strokeWidth={1} />
        ))}
        {/* 좌/우 축 라벨 */}
        {axisLabels("left").map((l, k) => (
          <text key={`l${k}`} x={padL - 4} y={l.y + 3} textAnchor="end"
                fontSize={9} fill={l.color}>{l.text}</text>
        ))}
        {axisLabels("right").map((l, k) => (
          <text key={`r${k}`} x={W - padR + 4} y={l.y + 3} textAnchor="start"
                fontSize={9} fill={l.color}>{l.text}</text>
        ))}
        {/* 라인 */}
        {series.map((s, k) => (
          <path key={k} d={pathOf(s)} fill="none" stroke={s.color} strokeWidth={1.4}
                vectorEffect="non-scaling-stroke" />
        ))}
        {/* 호버 세로선 */}
        {hover != null && (
          <line x1={xAt(hover)} x2={xAt(hover)} y1={padT} y2={padT + ih}
                stroke="#94a3b8" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      {/* 범례 */}
      <div className="flex items-center gap-3 mt-1 px-1 flex-wrap">
        {series.map((s, k) => (
          <span key={k} className="flex items-center gap-1 text-[11px] text-gray-600">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      {/* 호버 툴팁 */}
      {hover != null && dates[hover] && (
        <div className="absolute top-0 left-0 pointer-events-none bg-gray-900/92 text-white rounded px-2 py-1 text-[11px] leading-tight">
          <div className="text-gray-300 mb-0.5">{dates[hover]}</div>
          {series.map((s, k) => (
            <div key={k} className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-sm" style={{ background: s.color }} />
              <span className="text-gray-300">{s.label}</span>
              <span className="ml-auto font-semibold tabular-nums">
                {s.values[hover] != null ? s.fmt(s.values[hover]!) : "—"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function fmtPct1(v: number) { return `${v.toFixed(1)}%`; }
function fmtCap(won: number): string {
  const a = Math.abs(won);
  if (a >= 1e12) return `${(won / 1e12).toFixed(1)}조`;
  if (a >= 1e8) return `${Math.round(won / 1e8).toLocaleString()}억`;
  return `${Math.round(won).toLocaleString()}`;
}
// "460,000억원" → 원(₩). 항상 억원 단위(fundamentals.ts).
function parseMarketCapWon(text?: string): number | null {
  if (!text) return null;
  const n = Number(text.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n * 1e8 : null;
}

interface Props { ticker: string; marketCapText?: string; price?: number; }

export function StockOverviewCharts({ ticker, marketCapText, price }: Props) {
  const enabled = /^[\dA-Za-z]{6}$/.test(ticker);
  const priceQ = useQuery({
    queryKey: ["price-history-modal-with-events", ticker],
    queryFn: () => fetchKrPriceHistoryWithEvents(ticker, "1y"),
    enabled, staleTime: 60_000, refetchOnWindowFocus: false,
  });
  const invQ = useQuery({
    queryKey: ["investor-history-modal", ticker],
    queryFn: () => fetchInvestorHistorySafe(ticker, [200, 120, 60]),
    enabled, staleTime: 60_000, refetchOnWindowFocus: false,
  });
  const kospiQ = useQuery({
    queryKey: ["kospi-index-1y"],   // ticker 없음 → 앱 전역 1회 공유
    queryFn: () => fetchYahooPriceHistory("^KS11", "1y"),
    staleTime: 5 * 60_000, refetchOnWindowFocus: false,
  });

  const prices = priceQ.data?.prices ?? [];
  const investors = invQ.data ?? [];
  const kospi = kospiQ.data ?? [];
  const closeByDate = new Map(prices.map(p => [p.date, p.close]));
  const shares = (() => {
    const cap = parseMarketCapWon(marketCapText);
    return cap && price && price > 0 ? cap / price : null;
  })();

  // ① 외국인 지분율 + 시총 — 투자자 데이터 날짜(오래→최신) 기준
  const invAsc = [...investors].filter(iv => iv.date).sort((a, b) => (a.date! < b.date! ? -1 : 1));
  const foreignDates = invAsc.map(iv => iv.date!);
  const foreignVals = invAsc.map(iv => (Number.isFinite(iv.외국인비율) && iv.외국인비율 > 0 ? iv.외국인비율 : null));
  const capVals = invAsc.map(iv => {
    const c = closeByDate.get(iv.date!);
    return c != null && shares ? c * shares : null;
  });
  const hasForeign = foreignVals.some(v => v != null);
  const hasCap = capVals.some(v => v != null);

  // ② 상대수익률 — 종목 vs KOSPI, 공통 날짜 정규화(첫날=100)
  const kospiByDate = new Map(kospi.map(p => [p.date, p.close]));
  const commonDates = prices.map(p => p.date).filter(d => kospiByDate.has(d));
  const relDates = commonDates;
  const stockBase = prices.find(p => p.date === commonDates[0])?.close;
  const kospiBase = kospiByDate.get(commonDates[0]);
  const stockRel = relDates.map(d => {
    const c = closeByDate.get(d); return c != null && stockBase ? (c / stockBase) * 100 : null;
  });
  const kospiRel = relDates.map(d => {
    const c = kospiByDate.get(d); return c != null && kospiBase ? (c / kospiBase) * 100 : null;
  });

  const loading = priceQ.isLoading || invQ.isLoading;

  return (
    <section className="mt-4">
      <h3 className="text-sm font-bold text-gray-800 mb-2">📈 외국인·상대수익률 추이</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* ① 외국인 지분율 + 시총 */}
        <div className="border border-gray-200 rounded-lg p-2">
          <div className="text-xs font-semibold text-gray-600 mb-1">외국인 지분율 · 시가총액</div>
          {loading ? (
            <div className="text-center text-xs text-gray-400 py-12">불러오는 중…</div>
          ) : !hasForeign && !hasCap ? (
            <div className="text-center text-xs text-gray-400 py-12">데이터 없음</div>
          ) : (
            <MiniMultiLine dates={foreignDates} series={[
              { label: "외국인 지분율", color: "#16a34a", values: foreignVals, axis: "left", fmt: fmtPct1 },
              { label: "시가총액", color: "#e11d48", values: capVals, axis: "right", fmt: fmtCap },
            ]} />
          )}
        </div>
        {/* ② 상대수익률 */}
        <div className="border border-gray-200 rounded-lg p-2">
          <div className="text-xs font-semibold text-gray-600 mb-1">상대수익률 (시작일 100 기준)</div>
          {loading || kospiQ.isLoading ? (
            <div className="text-center text-xs text-gray-400 py-12">불러오는 중…</div>
          ) : relDates.length < 2 ? (
            <div className="text-center text-xs text-gray-400 py-12">데이터 없음</div>
          ) : (
            <MiniMultiLine dates={relDates} series={[
              { label: "종목", color: "#2563eb", values: stockRel, axis: "right", fmt: v => v.toFixed(0) },
              { label: "KOSPI", color: "#94a3b8", values: kospiRel, axis: "right", fmt: v => v.toFixed(0) },
            ]} />
          )}
        </div>
      </div>
    </section>
  );
}

export default StockOverviewCharts;
