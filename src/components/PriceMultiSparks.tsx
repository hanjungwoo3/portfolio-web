// 종목 가격 멀티 미니캔들 — 년봉 · 월봉 · 주봉.
// 데이터 fetch 는 가능한 한 길게 (max range) → SMA 는 전체 이력으로 계산 → 표시는 최근 N개 슬라이스.
// 토스/한국 차트의 MA-60 / MA-240 스타일.

import { lazy, Suspense } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { fetchKrSparkSeries, fetchTossKrCandles, TOSS_CANDLE_MAX, type SparkPoint } from "../lib/api";
import { maColor } from "../lib/indicators";
import {
  MA_TREND_PERIODS, computeMaTrend, maTrendTooltip, MA_TREND_LABEL, MA_TREND_CLASS,
} from "../lib/maTrend";
import type { Overlay } from "./MiniCandleLight";

// lightweight-charts 는 ~170KB — 기업가치 모달에서만 로드
const MiniCandleLight = lazy(() =>
  import("./MiniCandleLight").then(m => ({ default: m.MiniCandleLight })));

// fetch 사양 — 월봉 max 1개로 년봉/월봉 모두 커버
const FETCH_SPECS = [
  { key: "monthlyMax", range: "max", interval: "1mo" },
] as const;

// 주봉은 야후 대신 토스 c-chart — 야후 국내 주봉은 range 조합에 따라 봉이 들쭉날쭉하다.
//   450주 ≈ 8.6년 → 표시 구간(120주) 왼쪽 끝 봉도 MA120 이 채워진다.
const WEEK_STALE_MS = 6 * 60 * 60_000;

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

// 이동평균 — 단순이동평균(슬라이딩 합, O(n)). 전체 이력으로 계산해야
// 표시 구간 왼쪽 끝 봉도 앞 구간을 포함한 정확한 값이 나온다(주석 방침과 동일).
function smaOnClose(pts: SparkPoint[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    sum += pts[i].close;
    if (i >= period) sum -= pts[i - period].close;
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

// 월·주봉 이평선 — 가치표 '추세' 열, 주가 차트 배열 배지와 같은 20/60/120.
//   전체 이력으로 계산 → 표시 구간만 슬라이스. 이력이 짧아 전부 null 이면 선이 안 그려진다.
//   색은 주가 차트 이평선과 동일(maColor) — 같은 기간이면 같은 색으로 읽히게.
function maOverlays(full: SparkPoint[], startIdx: number): Overlay[] {
  const out: Overlay[] = [];
  MA_TREND_PERIODS.forEach((period, i) => {
    if (full.length < period) return;
    const values = smaOnClose(full, period).slice(startIdx);
    if (!values.some(v => v != null)) return;
    out.push({ values, color: maColor(i), width: 1 });
  });
  return out;
}

interface Slot {
  key: string;
  label: string;
  full: SparkPoint[];        // 전체 데이터 (재집계 결과)
  displayN: number;          // 최근 N개만 표시
  minDisplay: number;        // 최소 표시 캔들 수
  perYear: number;           // 1년에 해당하는 캔들 수 (헤더 "X년" 환산용)
  unit: string;              // 배열 툴팁의 봉 단위 ("년"/"개월"/"주")
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

  // 주봉 — 토스 c-chart. PricePoint(open/high/low 옵셔널) → SparkPoint 로 좁힌다.
  const { data: weekly, isLoading: weeklyLoading } = useQuery({
    queryKey: ["toss-candles", ticker, "week"],
    queryFn: () => fetchTossKrCandles(ticker, "week", TOSS_CANDLE_MAX),
    enabled: /^[\dA-Za-z]{6}$/.test(ticker),
    staleTime: WEEK_STALE_MS,
    gcTime: WEEK_STALE_MS,
    refetchOnWindowFocus: false,
    select: (rows): SparkPoint[] => rows.flatMap(p =>
      p.open != null && p.high != null && p.low != null
        ? [{ date: p.date, open: p.open, high: p.high, low: p.low, close: p.close }]
        : []),
  });

  // 장기 → 중기 → 단기. Yahoo 가 잘게 줘도 클라 재집계로 정확한 봉 보장.
  const slots: Slot[] = [
    // 표시 한도: 년 30개(30년) · 월 120개(10년) · 주 120개(약 2.3년)
    { key: "yr", label: "년봉", full: aggregateBy(monthlyMax, yearBucket),  displayN: 30,  minDisplay: 3,  perYear: 1,  unit: "년" },
    { key: "mo", label: "월봉", full: aggregateBy(monthlyMax, monthBucket), displayN: 120, minDisplay: 12, perYear: 12, unit: "개월" },
    { key: "wk", label: "주봉", full: weekly ?? [],                          displayN: 120, minDisplay: 12, perYear: 52, unit: "주" },
  ];
  const loading = queries.some(q => q.isLoading) || weeklyLoading;
  const anyVisible = slots.some(s => s.full.length >= s.minDisplay);
  if (!anyVisible && !loading) return null;

  return (
    <div className="mb-2 border border-gray-200 rounded-md bg-gray-50/60 px-2 py-1.5">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[10px] font-bold text-gray-600">기간별 추이</span>
        <span className="text-[10px] text-gray-400">년 · 월 · 주봉</span>
        <span className="text-[10px] text-gray-400 ml-auto">
          월·주봉 이평선
          {MA_TREND_PERIODS.map((p, i) => (
            <span key={p} className="ml-1 font-medium" style={{ color: maColor(i) }}>{p}</span>
          ))}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
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
          // 월·주봉에만 이평선 20/60/120 — 년봉은 30개뿐이라 의미 없다.
          const overlays = s.key === "yr" ? undefined : maOverlays(s.full, startIdx);
          // 배열 판정은 전체 이력으로 — 표시 구간이 짧아도 최신 봉 기준 판정은 정확하다.
          // 이력이 MA120 에 못 미치면 null → 배지 대신 '이력부족'.
          const trend = s.key === "yr" ? null : computeMaTrend(s.full);

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
                  {overlays && overlays.length > 0 && (
                    <span className="ml-1 text-gray-400 font-normal">
                      · MA{MA_TREND_PERIODS.slice(0, overlays.length).join("·")}
                    </span>
                  )}
                </span>
                {/* 배열 상태 — 이 주기에서 지금 정배열인지 역배열인지 */}
                {s.key !== "yr" && (
                  trend
                    ? <span className={`px-1 leading-tight ${MA_TREND_CLASS[trend.state]}`}
                            style={{ fontSize: 9 }}
                            title={maTrendTooltip(trend, `${s.label} 이평 배열`, s.unit)}>
                        {MA_TREND_LABEL[trend.state]}
                      </span>
                    : <span className="text-gray-300" style={{ fontSize: 9 }}
                            title={maTrendTooltip(null, `${s.label} 이평 배열`, s.unit)}>
                        배열 이력부족
                      </span>
                )}
                <span className="text-[10px] tabular-nums text-gray-500"
                      title={`최저 ${lo.toLocaleString()} → 최고 ${hi.toLocaleString()}`}>
                  저↔고 <span className="font-bold text-rose-600">+{rangePct.toFixed(1)}%</span>
                </span>
              </div>
              <Suspense fallback={<div style={{ height: 220 }} />}>
                <MiniCandleLight data={displayData} overlays={overlays} height={220} className="w-full" />
              </Suspense>
            </div>
          );
        })}
      </div>
    </div>
  );
}
