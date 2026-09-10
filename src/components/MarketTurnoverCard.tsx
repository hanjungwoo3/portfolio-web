// 증시 거래대금 — 코스피·코스닥 일별 거래대금(토스 지수 캔들 amount = KRX 실거래대금).
//   자금동향(예탁금·신용)이 "대기/차입 자금"이라면 이쪽은 "실제로 오간 돈" — 바로 아래에 둔다.
//   두 차트는 crosshair·줌 동기화. 데이터는 450봉(≈2년) 한 번만 받고 기간 토글은 클라에서 자름.

import { useCallback, useMemo, useState, lazy, Suspense, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchKrMarketTurnover, fetchKrIndexIntradayVolume, TOSS_CANDLE_MAX,
  type MarketTurnoverPoint, type MarketIndexKey,
} from "../lib/api";
import { useCrosshairSync } from "../lib/useCrosshairSync";
import { fmtAmount, movingAvg, sessionProgress, MA_DAYS } from "../lib/marketTurnover";
import { isMarketOpen } from "../lib/format";

const MarketTurnoverChart = lazy(() => import("./MarketTurnoverChart"));

const MARKETS: { key: MarketIndexKey; label: string }[] = [
  { key: "KOSPI",  label: "코스피" },
  { key: "KOSDAQ", label: "코스닥" },
];
const PERIODS: { label: string; days: number }[] = [
  { label: "3개월", days: 66 },
  { label: "6개월", days: 132 },
  { label: "1년",   days: 250 },
  { label: "2년",   days: TOSS_CANDLE_MAX },
];
const DAYS_KEY = "market_turnover_days";

function loadDays(): number {
  const v = Number(localStorage.getItem(DAYS_KEY));
  return PERIODS.some(p => p.days === v) ? v : 66;   // 기본 3개월
}

const TOSS_INDEX_URL: Record<MarketIndexKey, string> = {
  KOSPI:  "https://www.tossinvest.com/indices/KGG01P",
  KOSDAQ: "https://www.tossinvest.com/indices/QGG01P",
};

function MarketBlock({ market, label, days, onReady }: {
  market: MarketIndexKey; label: string; days: number;
  onReady: ReturnType<typeof useCrosshairSync>;
}) {
  const { data, isLoading } = useQuery<MarketTurnoverPoint[]>({
    queryKey: ["marketTurnover", market],
    queryFn: () => fetchKrMarketTurnover(market, TOSS_CANDLE_MAX),
    staleTime: 10 * 60 * 1000,
    refetchInterval: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // 장중 진행률용 10분봉(거래량). 장중에만 부른다 — 마감 뒤엔 보정이 필요 없다.
  const krOpen = isMarketOpen("KR");
  const { data: intraday } = useQuery({
    queryKey: ["marketTurnoverIntraday", market],
    queryFn: () => fetchKrIndexIntradayVolume(market),
    enabled: krOpen,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // 20일 평균은 전체 시계열로 먼저 계산한 뒤 기간만큼 자른다 —
  // 잘라낸 뒤 계산하면 구간 첫 20봉의 평균이 짧은 창으로 잡혀 왜곡된다.
  const built = useMemo(() => {
    const all = data ?? [];
    if (all.length < 2) return null;
    const maAll = movingAvg(all);
    const upAll = all.map((p, i) => (i === 0 ? true : p.close >= all[i - 1].close));
    const start = Math.max(0, all.length - days);
    return { points: all.slice(start), ma: maAll.slice(start), up: upAll.slice(start), last: all[all.length - 1], lastMa: maAll[maAll.length - 1] };
  }, [data, days]);

  const shell = (inner: ReactNode) => (
    <div className="h-[220px] flex flex-col items-center justify-center gap-0.5 text-xs text-gray-400 border border-gray-200 rounded">
      <span className="font-bold text-gray-600">{label}</span>{inner}
    </div>
  );
  if (isLoading) return shell(<span>불러오는 중…</span>);
  if (!built) return shell(<span>거래대금 데이터 없음</span>);

  const { last, lastMa } = built;
  // 장중이면 '이 시각까지' 기준으로 비교한다 — 종일 평균과 그대로 나누면 개장 직후엔
  //   항상 큰 마이너스가 뜬다(하루가 안 끝나서지 거래가 적어서가 아니다).
  //   진행률을 못 구하면(개장 직후·과거 분봉 없음) 아예 비교를 안 보여준다.
  const progress = krOpen ? sessionProgress(intraday ?? []) : null;
  const cmpBase = progress != null ? lastMa * progress : lastMa;
  const canCompare = cmpBase > 0 && (!krOpen || progress != null);
  const vsAvg = canCompare ? (last.amount / cmpBase - 1) * 100 : 0;
  const vsColor = vsAvg >= 0 ? "text-rose-600" : "text-blue-600";
  const vsLabel = progress != null ? "장중 보정" : "평균대비";
  const vsTitle = progress != null
    ? `장중 누적을 같은 시각 기준으로 비교합니다.\n`
      + `최근 ${Math.round(progress * 100)}% 진행 시점 — 20일 평균 ${fmtAmount(lastMa)} × ${(progress * 100).toFixed(0)}% = ${fmtAmount(cmpBase)} 대비\n`
      + `(진행률은 최근 거래일들의 같은 시각까지 거래량 비율)`
    : `20일 평균 ${fmtAmount(lastMa)} 대비`;

  return (
    <div className="border border-gray-200 rounded p-2 bg-white">
      <div className="flex items-baseline gap-2 text-xs mb-1 flex-wrap">
        <a href={TOSS_INDEX_URL[market]} target="_blank" rel="noopener noreferrer"
           className="font-bold text-gray-700 hover:text-blue-600">{label}</a>
        <span className={`tabular-nums font-bold ${vsColor}`}>{fmtAmount(last.amount)}</span>
        {canCompare ? (
          <span className={`text-[10px] tabular-nums ${vsColor}`} title={vsTitle}>
            {vsLabel} {vsAvg >= 0 ? "+" : ""}{vsAvg.toFixed(0)}%
          </span>
        ) : (
          <span className="text-[10px] text-gray-400" title="장중 누적입니다 — 종일 평균과 바로 비교할 수 없습니다.">
            장중 누적
          </span>
        )}
        <span className="text-[10px] text-gray-400 ml-auto tabular-nums">
          {MA_DAYS}일평균 {fmtAmount(lastMa)} · {last.date.slice(5)}
        </span>
      </div>
      <Suspense fallback={<div className="h-[190px]" />}>
        <MarketTurnoverChart points={built.points} ma={built.ma} upFlags={built.up} label={label}
                             resetKey={days} onReady={onReady} />
      </Suspense>
    </div>
  );
}

export function MarketTurnoverCard() {
  const [days, setDays] = useState(loadDays);
  const onReady = useCrosshairSync();
  const pick = useCallback((d: number) => {
    setDays(d);
    localStorage.setItem(DAYS_KEY, String(d));
  }, []);

  return (
    <div className="relative rounded-xl border border-gray-300 bg-white p-2.5 pt-4 mt-3 lg:mt-0 h-full">
      <div className="absolute -top-3 left-3 z-10 px-2 py-0.5 rounded-md border border-gray-300 bg-gray-50
                      text-sm font-bold text-gray-700 whitespace-nowrap">
        📊 증시 거래대금
      </div>
      {/* 기간 토글 — 코스피·코스닥 공통 */}
      <div className="flex justify-end gap-1 mb-1.5">
        {PERIODS.map(p => (
          <button key={p.days} onClick={() => pick(p.days)}
                  className={`px-1.5 py-0.5 rounded text-[11px] border ${
                    days === p.days
                      ? "bg-gray-700 text-white border-gray-700 font-bold"
                      : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"}`}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {MARKETS.map(m => (
          <MarketBlock key={m.key} market={m.key} label={m.label} days={days} onReady={onReady} />
        ))}
      </div>
      <div className="text-[10px] text-gray-500 mt-1.5 leading-snug">
        막대 = 일별 거래대금 (<span className="text-rose-500 font-bold">빨강</span> 지수 상승일 ·
        <span className="text-blue-500 font-bold"> 파랑</span> 하락일),
        <span className="text-gray-700 font-bold"> 진회색 선</span> = {MA_DAYS}일 평균,
        <span className="text-violet-500 font-bold"> 보라 선</span> = 지수(왼쪽 축).
        평균 위로 크게 튀는 날은 자금이 몰린 날 — 상승에 붙었는지 하락에 붙었는지 막대 색으로 봅니다.
      </div>
    </div>
  );
}
