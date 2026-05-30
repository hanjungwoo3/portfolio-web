// 종목 가격 멀티 미니캔들 — 년봉 · 월봉 · 주봉.
// 데이터 fetch 는 가능한 한 길게 (max range) → SMA 는 전체 이력으로 계산 → 표시는 최근 N개 슬라이스.
// 토스/한국 차트의 MA-60 / MA-240 스타일.

import { lazy, Suspense } from "react";
import { useQueries } from "@tanstack/react-query";
import { fetchKrSparkSeries, type SparkPoint } from "../lib/api";

// lightweight-charts 는 ~170KB — 기업가치 모달에서만 로드
const MiniCandleLight = lazy(() =>
  import("./MiniCandleLight").then(m => ({ default: m.MiniCandleLight })));

// fetch 사양 — 월봉 max 1개로 년봉/월봉 모두 커버
const FETCH_SPECS = [
  { key: "monthlyMax", range: "max", interval: "1mo" },
] as const;

// 키 함수로 OHLC 재집계 — 입력 그래뉼래러티가 더 잘아도 안전.
// open = 버킷 첫 open, high = max, low = min, close = 버킷 마지막 close.
function aggregateBy(points: SparkPoint[], bucketKey: (date: string) => string): SparkPoint[] {
  if (points.length === 0) return [];
  type Acc = { date: string; open: number; high: number; low: number; close: number };
  const map = new Map<string, Acc>();
  const order: string[] = [];
  for (const p of points) {
    const k = bucketKey(p.date);
    const cur = map.get(k);
    if (!cur) {
      map.set(k, { date: k, open: p.open, high: p.high, low: p.low, close: p.close });
      order.push(k);
    } else {
      cur.close = p.close;
      if (p.high > cur.high) cur.high = p.high;
      if (p.low < cur.low) cur.low = p.low;
    }
  }
  return order.map(k => map.get(k)!);
}
const yearBucket  = (d: string) => `${d.slice(0, 4)}-01-01`;
const monthBucket = (d: string) => `${d.slice(0, 7)}-01`;

interface Slot {
  key: string;
  label: string;
  full: SparkPoint[];        // 전체 데이터 (재집계 결과)
  displayN: number;          // 최근 N개만 표시
  minDisplay: number;        // 최소 표시 캔들 수
  perYear: number;           // 1년에 해당하는 캔들 수 (헤더 "X년" 환산용)
}

interface Props {
  ticker: string;
}

export function PriceMultiSparks({ ticker }: Props) {
  const queries = useQueries({
    queries: FETCH_SPECS.map(spec => ({
      queryKey: ["spark-ohlc-c", ticker, spec.range, spec.interval],
      queryFn: () => fetchKrSparkSeries(ticker, spec.range, spec.interval),
      enabled: /^[\dA-Za-z]{6}$/.test(ticker),
      staleTime: 30 * 60_000,
    })),
  });
  const [qMonthlyMax] = queries;
  const monthlyMax = qMonthlyMax.data ?? [];

  // 장기 → 중기. Yahoo 가 잘게 줘도 클라 재집계로 정확한 봉 보장.
  const slots: Slot[] = [
    // 표시 한도: 년 30개(30년) · 월 120개(10년)
    { key: "yr", label: "년봉", full: aggregateBy(monthlyMax, yearBucket),  displayN: 30,  minDisplay: 3,  perYear: 1 },
    { key: "mo", label: "월봉", full: aggregateBy(monthlyMax, monthBucket), displayN: 120, minDisplay: 12, perYear: 12 },
  ];
  const loading = queries.some(q => q.isLoading);
  const anyVisible = slots.some(s => s.full.length >= s.minDisplay);
  if (!anyVisible && !loading) return null;

  return (
    <div className="mb-2 border border-gray-200 rounded-md bg-gray-50/60 px-2 py-1.5">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[10px] font-bold text-gray-600">기간별 추이</span>
        <span className="text-[10px] text-gray-400">년 · 월봉</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {slots.map(s => {
          if (s.full.length < s.minDisplay) {
            return (
              <div key={s.key}
                   className="bg-white border border-gray-200 rounded p-1.5
                              flex items-center justify-center h-[224px] text-[10px] text-gray-300">
                {s.label} 데이터 부족
              </div>
            );
          }
          // 표시 슬라이스 — 최근 displayN 개
          const startIdx = Math.max(0, s.full.length - s.displayN);
          const displayData = s.full.slice(startIdx);

          // 표시 구간 최저/최고 — 저점 대비 고점 변동폭
          let lo = Infinity, hi = -Infinity;
          for (const p of displayData) {
            if (p.low  < lo) lo = p.low;
            if (p.high > hi) hi = p.high;
          }
          const rangePct = lo > 0 ? (hi / lo - 1) * 100 : 0;

          return (
            <div key={s.key}
                 className="bg-white border border-gray-200 rounded p-1 flex flex-col gap-0.5">
              <div className="flex items-baseline justify-between gap-1 px-1 leading-none">
                <span className="text-[10px] font-bold text-gray-700">
                  {s.label}
                  {" "}
                  <span className="text-gray-400 font-normal">
                    {(displayData.length / s.perYear).toFixed(s.perYear === 1 ? 0 : 1)}년
                  </span>
                </span>
                <span className="text-[10px] tabular-nums text-gray-500"
                      title={`최저 ${lo.toLocaleString()} → 최고 ${hi.toLocaleString()}`}>
                  저↔고 <span className="font-bold text-rose-600">+{rangePct.toFixed(1)}%</span>
                </span>
              </div>
              <Suspense fallback={<div style={{ height: 220 }} />}>
                <MiniCandleLight data={displayData} height={220} className="w-full" />
              </Suspense>
            </div>
          );
        })}
      </div>
    </div>
  );
}
