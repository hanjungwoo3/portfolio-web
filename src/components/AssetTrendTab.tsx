// 자산추이 탭 — 일별 총자산(평가금액)과 매입원금, 원금 대비 수익.
//
// 기준은 '내주식'(보유현황)이다. 거래 로그는 과거를 되짚는 재료일 뿐 정답지가 아니다.
//   · 로그가 있는 종목  → 매수/매도 시점까지 그대로 재현
//   · 로그가 없는 보유  → 기초 잔고로 전 구간에 깔아 준다 (assetHistory.computeBaseline)
// 그래서 마지막 점의 평가금액·매입원금은 내주식 화면과 맞는다.
//
// 앱에 과거 스냅샷이 없어 과거는 거래 로그로 역산한다(assetHistory.ts).
// 오늘부터는 App 이 매일 실측 스냅샷을 남기므로, 시간이 지날수록 실측 구간이 늘어난다.
// 미국 종목은 야후 일봉(USD) × 그날 원달러 환율로 원화 환산해 함께 합산한다.

import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { fetchTossKrCandles, fetchYahooPriceHistory, TOSS_CANDLE_MAX, type PricePoint } from "../lib/api";
import {
  buildAssetHistory, computeBaseline, mergeSnapshots, sliceByRange,
  assetLineColor, ASSET_INDEX_COLORS, RANGE_OPTS, type RangeKey,
} from "../lib/assetHistory";
import { loadAssetSnapshots, type Trade } from "../lib/db";
import { signColor } from "../lib/format";
import { filterByTab, MY_STOCKS_TAB_KEY } from "./Tabs";
import type { Stock } from "../types";

const AssetTrendChart = lazy(() =>
  import("./AssetTrendChart").then(m => ({ default: m.AssetTrendChart })));


// 뒤에 깔 시장 지수 — 각각 켜고 끈다. 지수마다 전용 축이라 동시에 깔아도 서로 안 눌린다.
const INDEX_OPTS = [
  { key: "kospi",  label: "코스피", symbol: "^KS11" },
  { key: "kosdaq", label: "코스닥", symbol: "^KQ11" },
] as const;
type IndexKey = typeof INDEX_OPTS[number]["key"];

const CANDLE_STALE_MS = 60 * 60 * 1000;
const US_RANGE = "2y";                       // 토스 일봉(450거래일)과 얼추 같은 구간
const isKrTicker = (t: string) => /^[\dA-Za-z]{6}$/.test(t);     // 신형 ETF 는 영숫자 6자리
const isUsTicker = (t: string) => /^[A-Za-z][A-Za-z.]{0,4}$/.test(t);

function won(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e8) return `${(v / 1e8).toFixed(2)}억`;
  if (a >= 1e4) return `${Math.round(v / 1e4).toLocaleString()}만`;
  return Math.round(v).toLocaleString();
}

// 미국 일봉(USD) → 원화 종가. 환율은 그날 값, 없으면 직전 고시치를 이어 쓴다.
function toKrwCloses(rows: PricePoint[], fx: PricePoint[]): Map<string, number> {
  const out = new Map<string, number>();
  const rates = fx.filter(f => f.close > 0).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (rows.length === 0 || rates.length === 0) return out;
  let i = 0;
  let rate = rates[0].close;
  for (const r of [...rows].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    while (i < rates.length && rates[i].date <= r.date) rate = rates[i++].close;
    if (r.close > 0 && rate > 0) out.set(r.date, r.close * rate);
  }
  return out;
}

// 표는 대략치가 아니라 대사(對査)용 — 억/만 축약 대신 원 단위 그대로 보여준다
const full = (v: number): string => Math.round(v).toLocaleString();
const signed = (v: number): string => `${v >= 0 ? "+" : "-"}${full(Math.abs(v))}`;
const fmtDate = (d: string): string => d.slice(2).replace(/-/g, ".");   // 2026-08-14 → 26.08.14

// 표 열 수 — PC 는 남는 가로를 신문처럼 나눠 쓴다.
//   한 열을 위에서 아래까지 채우고, 다음 열 맨 위로 이어진다(열 우선 채움).
const COL_BREAKS = [
  { q: "(min-width: 1600px)", n: 4 },
  { q: "(min-width: 1200px)", n: 3 },
  { q: "(min-width: 768px)",  n: 2 },
] as const;

function pickCols(): number {
  if (typeof window === "undefined") return 1;
  return COL_BREAKS.find(b => window.matchMedia(b.q).matches)?.n ?? 1;
}

function useTableCols(): number {
  const [n, setN] = useState(pickCols);
  useEffect(() => {
    const mqls = COL_BREAKS.map(b => window.matchMedia(b.q));
    const on = () => setN(pickCols());
    mqls.forEach(m => m.addEventListener("change", on));
    return () => mqls.forEach(m => m.removeEventListener("change", on));
  }, []);
  return n;
}

interface Props { trades: Trade[]; holdings: Stock[] }

export function AssetTrendTab({ trades, holdings }: Props) {
  const [range, setRange] = useState<RangeKey>("6m");
  const [tableOpen, setTableOpen] = useState(true);   // 차트와 표를 같이 본다 — 표는 접을 수 있게만
  const [onIndexes, setOnIndexes] = useState<IndexKey[]>(["kospi"]);
  const cols = useTableCols();

  // 정답지 — '내주식'과 같은 합산 규칙(그룹 미러 중복 제거, 독립보유 모드 반영)
  const held = useMemo(
    () => filterByTab(holdings, MY_STOCKS_TAB_KEY).filter(h => h.shares > 0 && h.avg_price > 0),
    [holdings],
  );

  const krTickers = useMemo(() => Array.from(new Set([
    ...held.map(h => h.ticker), ...trades.map(t => t.ticker),
  ].filter(isKrTicker))), [held, trades]);
  const usTickers = useMemo(() => Array.from(new Set([
    ...held.map(h => h.ticker), ...trades.map(t => t.ticker),
  ].filter(isUsTicker))), [held, trades]);

  // 값을 매길 수 없는 종목(코드 규칙 밖)은 곡선에서 빼고, 뺐다는 사실을 화면에 밝힌다
  const skipped = useMemo(
    () => held.filter(h => !isKrTicker(h.ticker) && !isUsTicker(h.ticker)).length,
    [held],
  );
  const usable = useMemo(() => {
    const ok = (t: string) => isKrTicker(t) || isUsTicker(t);
    return { trades: trades.filter(t => ok(t.ticker)), held: held.filter(h => ok(h.ticker)) };
  }, [trades, held]);

  // 종목별 일봉 — 가치표·기업가치 차트와 같은 쿼리키라 캐시를 공유한다(추가 호출 최소화)
  const krQs = useQueries({
    queries: krTickers.map(t => ({
      queryKey: ["toss-candles", t, "day"],
      queryFn: () => fetchTossKrCandles(t, "day", TOSS_CANDLE_MAX),
      staleTime: CANDLE_STALE_MS,
      gcTime: CANDLE_STALE_MS,
      refetchOnWindowFocus: false,
      retry: 1,
    })),
  });
  const usQs = useQueries({
    queries: usTickers.map(t => ({
      queryKey: ["asset-trend-us", t, US_RANGE],
      queryFn: () => fetchYahooPriceHistory(t, US_RANGE),
      staleTime: CANDLE_STALE_MS,
      gcTime: CANDLE_STALE_MS,
      refetchOnWindowFocus: false,
      retry: 1,
    })),
  });
  // 원달러 일봉 — 미국 보유의 과거 원화 환산용
  const fxQ = useQuery({
    queryKey: ["asset-trend-us", "KRW=X", US_RANGE],
    queryFn: () => fetchYahooPriceHistory("KRW=X", US_RANGE),
    enabled: usTickers.length > 0,
    staleTime: CANDLE_STALE_MS,
    gcTime: CANDLE_STALE_MS,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  // 시장 지수 일봉 — 켜진 것만 호출한다(끄면 호출 안 함)
  const indexQs = useQueries({
    queries: INDEX_OPTS.map(o => ({
      queryKey: ["asset-trend-index", o.symbol, US_RANGE],
      queryFn: () => fetchYahooPriceHistory(o.symbol, US_RANGE),
      enabled: onIndexes.includes(o.key),
      staleTime: CANDLE_STALE_MS,
      gcTime: CANDLE_STALE_MS,
      refetchOnWindowFocus: false,
      retry: 1,
    })),
  });
  const indexLoaded = indexQs.filter(q => q.isSuccess).length;

  const total = krTickers.length + usTickers.length;
  const loaded = krQs.filter(q => q.isSuccess).length + usQs.filter(q => q.isSuccess).length;
  const fxRows = fxQ.data;

  const closes = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    krTickers.forEach((t, i) => {
      const rows = krQs[i]?.data;
      if (!rows?.length) return;
      m.set(t, new Map(rows.map(r => [r.date, r.close])));
    });
    if (fxRows?.length) {
      usTickers.forEach((t, i) => {
        const rows = usQs[i]?.data;
        if (!rows?.length) return;
        const krw = toKrwCloses(rows, fxRows);
        if (krw.size) m.set(t, krw);
      });
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [krTickers, usTickers, loaded, fxRows]);

  // 거래 로그로 설명되지 않는 보유 — 처음부터 들고 있던 것으로 보고 전 구간에 깐다
  const baseline = useMemo(
    () => computeBaseline(usable.trades, usable.held),
    [usable],
  );
  const baseCount = useMemo(
    () => Array.from(baseline.values()).filter(b => b.qty > 0).length,
    [baseline],
  );

  // 실측 스냅샷 — 오늘부터 매일 쌓인다. 있는 날은 역산 대신 실측을 쓴다.
  const { data: snaps } = useQuery({
    queryKey: ["asset-snapshots"],
    queryFn: loadAssetSnapshots,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const all = useMemo(
    () => mergeSnapshots(buildAssetHistory(usable.trades, closes, baseline), snaps ?? []),
    [usable, closes, baseline, snaps],
  );
  const points = useMemo(() => sliceByRange(all, range), [all, range]);

  const indexOverlays = useMemo(
    () => INDEX_OPTS.flatMap((o, i) => {
      if (!onIndexes.includes(o.key)) return [];
      const rows = indexQs[i]?.data;
      if (!rows?.length) return [];
      return [{
        key: o.key, label: o.label, color: ASSET_INDEX_COLORS[o.key],
        closes: rows.map(r => ({ date: r.date, close: r.close })),
      }];
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onIndexes, indexLoaded],
  );

  // 표 행 — 최신이 위. 일간 손익 = 그날 번 돈(평가손익 변화 + 그날 실현손익) = totalPnl 증감.
  //   단순 '자산 증감'을 쓰면 그날 추가매수한 돈까지 수익으로 잡혀서 안 된다.
  const rows = useMemo(() => {
    const idx = new Map(all.map((p, i) => [p.date, i]));
    const out = points.map(p => {
      const i = idx.get(p.date) ?? -1;
      const prev = i > 0 ? all[i - 1] : undefined;   // 구간 밖이라도 바로 앞 거래일을 쓴다
      const diff = prev ? p.totalPnl - prev.totalPnl : 0;
      return {
        p, prev, diff,
        pct: prev && prev.value > 0 ? (diff / prev.value) * 100 : 0,
      };
    });
    return out.reverse();
  }, [points, all]);

  // 열 우선 채움 — 앞 조각이 왼쪽 열, 각 열은 위에서 아래로
  const chunks = useMemo(() => {
    const size = Math.max(1, Math.ceil(rows.length / Math.max(1, cols)));
    const out: (typeof rows)[] = [];
    for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
    return out;
  }, [rows, cols]);

  if (held.length === 0 && usable.trades.length === 0) {
    return (
      <div className="text-center py-16 text-gray-500 text-sm">
        <div className="text-4xl mb-3">📈</div>
        보유 종목도 거래 기록도 없어 자산 추이를 그릴 수 없습니다.
      </div>
    );
  }
  if (loaded < total && all.length === 0) {
    return <div className="py-16 text-center text-gray-400 text-sm">
      과거 시세 불러오는 중 {loaded}/{total}
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
          {loaded < total ? `시세 ${loaded}/${total}` : `${total}종목`}
          {" · 내주식 기준"}
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
        <div className="flex items-center gap-3 text-[11px] mb-1 px-1 flex-wrap">
          <span className="flex items-center gap-1">
            {/* 곡선 색은 이익/손실에 따라 바뀐다 — 범례도 같은 색을 쓴다(assetLineColor) */}
            <span className="inline-block w-3 h-0.5"
                  style={{ backgroundColor: assetLineColor(last.unrealized) }}></span>
            <span className="text-gray-600">평가금액</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 border-t border-dashed border-gray-400"></span>
            <span className="text-gray-600">매입원금</span>
          </span>
          {/* 지수 겹쳐보기 — 켜진 것이 곧 범례(색 점 + 이름). 각각 독립 토글 */}
          <span className="flex items-center gap-1">
            <span className="text-gray-400">지수</span>
            {INDEX_OPTS.map(o => {
              const on = onIndexes.includes(o.key);
              return (
                <button key={o.key}
                        onClick={() => setOnIndexes(prev =>
                          prev.includes(o.key) ? prev.filter(k => k !== o.key) : [...prev, o.key])}
                        title={`${o.label} 겹쳐보기 ${on ? "끄기" : "켜기"}`}
                        className={`inline-flex items-center gap-1 px-1 rounded border transition ${
                          on ? "border-gray-300 bg-white text-gray-700 font-bold"
                             : "border-transparent text-gray-400 hover:bg-gray-100"}`}>
                  <span className="inline-block w-2.5 h-0.5"
                        style={{ backgroundColor: on ? ASSET_INDEX_COLORS[o.key] : "#d1d5db" }}></span>
                  {o.label}
                </button>
              );
            })}
          </span>
          <span className="ml-auto text-gray-500">
            구간 손익 <span className={`font-bold tabular-nums ${signColor(periodPnl)}`}>
              {periodPnl >= 0 ? "+" : ""}{won(periodPnl)}
            </span>
          </span>
        </div>
        <Suspense fallback={<div className="h-[320px]" />}>
          <AssetTrendChart points={points} indexes={indexOverlays} />
        </Suspense>
      </div>

      {/* 일별 표 — 차트 아래. MTS 의 '일별 수익률' 표와 같은 자리. */}
      <div className="border border-gray-200 rounded bg-white overflow-hidden">
        <button onClick={() => setTableOpen(o => !o)}
                className="w-full flex items-center gap-2 text-[11px] px-2 py-1.5 hover:bg-gray-50 transition">
          <span className="font-bold text-gray-700">📋 일별 수익</span>
          <span className="text-gray-400">{rows.length}일</span>
          <span className="ml-auto text-gray-500">
            구간 손익 <span className={`font-bold tabular-nums ${signColor(periodPnl)}`}>
              {periodPnl >= 0 ? "+" : ""}{full(periodPnl)}
            </span>
          </span>
          <span className="text-gray-400">{tableOpen ? "▾" : "▸"}</span>
        </button>
        {tableOpen && (<>
          <div className="max-h-[620px] overflow-y-auto overflow-x-auto border-t border-gray-100 bg-gray-50">
            <div className="flex items-start gap-2 p-2">
              {chunks.map((chunk, ci) => (
                <div key={ci} className="flex-1 min-w-[190px] border border-gray-200 rounded bg-white shadow-sm">
                  <table className="w-full text-[11px] tabular-nums">
                    <thead className="sticky top-0 z-10 bg-gray-50 text-gray-500 shadow-[inset_0_-1px_0_0_rgb(229,231,235)]">
                      <tr>
                        <th className="text-left  px-2 py-1.5 font-medium whitespace-nowrap">기준일</th>
                        <th className="text-right px-2 py-1.5 font-medium whitespace-nowrap">일간 손익</th>
                        <th className="text-right px-2 py-1.5 font-medium whitespace-nowrap">누적 손익</th>
                        <th className="text-right px-2 py-1.5 font-medium whitespace-nowrap">평가금액</th>
                      </tr>
                    </thead>
                    <tbody>
                      {chunk.map(({ p, prev, diff, pct }) => (
                        <tr key={p.date} className="border-t border-gray-100 hover:bg-gray-50">
                          <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap align-top">
                            {fmtDate(p.date)}
                            <div className="text-[10px] text-gray-400">{p.held}종목</div>
                          </td>
                          <td className={`px-2 py-1.5 text-right whitespace-nowrap align-top font-bold ${
                                prev ? signColor(diff) : "text-gray-400"}`}>
                            {prev ? signed(diff) : "—"}
                            <div className="text-[10px] font-normal">
                              {prev ? `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%` : ""}
                            </div>
                          </td>
                          <td className={`px-2 py-1.5 text-right whitespace-nowrap align-top ${signColor(p.unrealized)}`}>
                            {signed(p.unrealized)}
                            <div className="text-[10px]">
                              {p.returnPct >= 0 ? "+" : ""}{p.returnPct.toFixed(2)}%
                            </div>
                          </td>
                          <td className="px-2 py-1.5 text-right whitespace-nowrap align-top font-bold text-gray-900">
                            {full(p.value)}
                            <div className="text-[10px] font-normal text-gray-400">{full(p.principal)}</div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </div>
          <div className="text-[10px] text-gray-400 px-2 py-1.5 border-t border-gray-100 leading-relaxed">
            일간 손익 = 그날 평가손익 변화 + 그날 실현손익 — 추가 매수·입금은 수익으로 치지 않습니다.
            일간 % 는 전일 평가금액 대비. 평가금액 아래 회색 숫자는 매입원금.
          </div>
        </>)}
      </div>

      <div className="text-[10px] text-gray-400 px-1 leading-relaxed">
        마지막 값은 <b>내주식</b>의 총원금·평가액과 같습니다. 과거는 거래 기록과 그날 종가로 되짚습니다.
        원가는 평균단가법(국내 증권사 방식), 매입원금은 <b>지금 보유한 수량의 취득원가</b>입니다.
        예수금은 포함하지 않습니다.
        {baseCount > 0 && <> 거래 기록이 없는 보유 {baseCount}종목은 취득 시점을 알 수 없어
          <b> 전 구간 계속 보유</b>한 것으로 계산했습니다 — 실제로 산 날 이전 구간은 실제보다 커 보일 수 있습니다.</>}
        {usTickers.length > 0 && <> 미국 종목 {usTickers.length}개는 야후 종가 × 그날 원달러 환율로 환산했습니다.</>}
        {skipped > 0 && <> 시세를 매길 수 없는 {skipped}종목은 제외했습니다.</>}
        {" "}국내 일봉은 최대 {TOSS_CANDLE_MAX}거래일(약 21개월)까지만 조회됩니다.
      </div>
    </div>
  );
}
