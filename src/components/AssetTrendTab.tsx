// 자산추이 탭 — 일별 총자산(평가금액)과 매입원금, 원금 대비 수익.
//
// 앱에 과거 스냅샷이 없어 과거는 거래 로그로 역산한다(assetHistory.ts).
// 오늘부터는 App 이 매일 실측 스냅샷을 남기므로, 시간이 지날수록 실측 구간이 늘어난다.
// 1단계는 국내 주식만 — 미국 종목은 과거 환율 환산이 필요해 제외하고, 제외 사실을 화면에 밝힌다.

import { lazy, Suspense, useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { fetchTossKrCandles, TOSS_CANDLE_MAX } from "../lib/api";
import { buildAssetHistory, mergeSnapshots, sliceByRange, RANGE_OPTS, type RangeKey } from "../lib/assetHistory";
import { loadAssetSnapshots, type Trade } from "../lib/db";
import { signColor } from "../lib/format";

const AssetTrendChart = lazy(() =>
  import("./AssetTrendChart").then(m => ({ default: m.AssetTrendChart })));

const CANDLE_STALE_MS = 60 * 60 * 1000;
const isKrTicker = (t: string) => /^\d{6}$/.test(t);

function won(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e8) return `${(v / 1e8).toFixed(2)}억`;
  if (a >= 1e4) return `${Math.round(v / 1e4).toLocaleString()}만`;
  return Math.round(v).toLocaleString();
}

interface Props { trades: Trade[] }

export function AssetTrendTab({ trades }: Props) {
  const [range, setRange] = useState<RangeKey>("6m");

  // 국내 종목만 — 미국 티커(AAPL 등)는 과거 환율이 필요해 1단계에서 제외
  const krTrades = useMemo(() => trades.filter(t => isKrTicker(t.ticker)), [trades]);
  const skipped = useMemo(
    () => new Set(trades.filter(t => !isKrTicker(t.ticker)).map(t => t.ticker)).size,
    [trades],
  );
  const tickers = useMemo(
    () => Array.from(new Set(krTrades.map(t => t.ticker))),
    [krTrades],
  );

  // 종목별 일봉 — 가치표·기업가치 차트와 같은 쿼리키라 캐시를 공유한다(추가 호출 최소화)
  const qs = useQueries({
    queries: tickers.map(t => ({
      queryKey: ["toss-candles", t, "day"],
      queryFn: () => fetchTossKrCandles(t, "day", TOSS_CANDLE_MAX),
      staleTime: CANDLE_STALE_MS,
      gcTime: CANDLE_STALE_MS,
      refetchOnWindowFocus: false,
      retry: 1,
    })),
  });
  const loaded = qs.filter(q => q.isSuccess).length;

  const closes = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    tickers.forEach((t, i) => {
      const rows = qs[i]?.data;
      if (!rows?.length) return;
      m.set(t, new Map(rows.map(r => [r.date, r.close])));
    });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickers, loaded]);

  // 실측 스냅샷 — 오늘부터 매일 쌓인다. 있는 날은 역산 대신 실측을 쓴다.
  const { data: snaps } = useQuery({
    queryKey: ["asset-snapshots"],
    queryFn: loadAssetSnapshots,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const all = useMemo(
    () => mergeSnapshots(buildAssetHistory(krTrades, closes), snaps ?? []),
    [krTrades, closes, snaps],
  );
  const points = useMemo(() => sliceByRange(all, range), [all, range]);

  if (krTrades.length === 0) {
    return (
      <div className="text-center py-16 text-gray-500 text-sm">
        <div className="text-4xl mb-3">📈</div>
        거래 기록이 없어 자산 추이를 그릴 수 없습니다.<br />
        <span className="text-xs text-gray-400">
          설정 → 토스 거래내역 가져오기로 매매 기록을 넣으면 과거 곡선이 만들어집니다.
        </span>
      </div>
    );
  }
  if (loaded < tickers.length && all.length === 0) {
    return <div className="py-16 text-center text-gray-400 text-sm">
      과거 시세 불러오는 중 {loaded}/{tickers.length}
    </div>;
  }
  if (points.length < 2) {
    return <div className="py-16 text-center text-gray-400 text-sm">
      이 기간에 표시할 자료가 없습니다. 기간을 넓혀 보세요.
    </div>;
  }

  const last = points[points.length - 1];
  const first = points[0];
  const periodPnl = last.totalPnl - first.totalPnl;   // 구간 손익(실현 포함)

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-1 flex-wrap">
        <span className="text-sm font-bold text-gray-800">📈 자산 추이</span>
        <span className="text-[11px] text-gray-500">
          {loaded < tickers.length ? `시세 ${loaded}/${tickers.length}` : `${tickers.length}종목`}
          {" · 거래 기록 역산"}
          {(snaps?.length ?? 0) > 0 && ` · 실측 ${snaps!.length}일`}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {RANGE_OPTS.map(o => (
            <button key={o.key} onClick={() => setRange(o.key)}
                    className={`px-1.5 py-0.5 rounded text-[11px] transition ${
                      range === o.key ? "bg-gray-900 text-white font-bold"
                                      : "text-gray-500 hover:bg-gray-100"}`}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* 요약 — 현재 시점 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: "평가금액", value: won(last.value), cls: "text-gray-900" },
          { label: "매입원금", value: won(last.principal), cls: "text-gray-600" },
          { label: "평가손익", value: `${last.unrealized >= 0 ? "+" : ""}${won(last.unrealized)}`, cls: signColor(last.unrealized) },
          { label: "수익률", value: `${last.returnPct >= 0 ? "+" : ""}${last.returnPct.toFixed(2)}%`, cls: signColor(last.returnPct) },
        ].map(c => (
          <div key={c.label} className="border border-gray-200 rounded bg-white px-2 py-1.5">
            <div className="text-[10px] text-gray-400">{c.label}</div>
            <div className={`text-sm font-bold tabular-nums ${c.cls}`}>{c.value}</div>
          </div>
        ))}
      </div>

      <div className="border border-gray-200 rounded bg-white p-2">
        <div className="flex items-center gap-3 text-[11px] mb-1 px-1">
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-0.5 bg-blue-600"></span>
            <span className="text-gray-600">평가금액</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 border-t border-dashed border-gray-400"></span>
            <span className="text-gray-600">매입원금</span>
          </span>
          <span className="ml-auto text-gray-500">
            구간 손익 <span className={`font-bold tabular-nums ${signColor(periodPnl)}`}>
              {periodPnl >= 0 ? "+" : ""}{won(periodPnl)}
            </span>
          </span>
        </div>
        <Suspense fallback={<div className="h-[320px]" />}>
          <AssetTrendChart points={points} />
        </Suspense>
      </div>

      <div className="text-[10px] text-gray-400 px-1 leading-relaxed">
        거래 기록과 과거 종가로 되짚은 값입니다 — 기록에 없는 매매는 반영되지 않습니다.
        원가는 평균단가법(국내 증권사 방식), 매입원금은 <b>지금 보유한 수량의 취득원가</b>입니다.
        예수금은 포함하지 않습니다.
        {skipped > 0 && <> 미국 종목 {skipped}개는 과거 환율 환산이 필요해 제외했습니다.</>}
        {" "}일봉은 최대 {TOSS_CANDLE_MAX}거래일(약 21개월)까지만 조회됩니다.
      </div>
    </div>
  );
}
