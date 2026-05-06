import { useEffect } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { fetchYahooBatch, fetchTossPrices, fetchYahooChart, fetchKrPriceHistory } from "../lib/api";
import type { UsIndex } from "../lib/api";
import type { Price } from "../types";
import { isSymbolSleeping } from "../lib/format";
import { getDimSleepingEnabled } from "../lib/proxyConfig";
import {
  US_PAIRS, ETFS_BY_SECTOR, ETF_NAMES, SECTOR_EMOJI, SECTOR_ORDER,
  allYahooSymbols, allKrEtfTickers,
} from "../lib/usMarketData";
import { useAdaptiveRefreshMs } from "../lib/proxyStatus";
import { reportRefresh } from "../lib/lastRefresh";
import { Sparkline } from "./Sparkline";

const BASE_REFRESH_MS = 10_000;

function fmtPrice(symbol: string, price: number): string {
  if (symbol.includes("KRW")) return price.toFixed(2);
  if (symbol === "^VIX" || symbol === "^TNX") return price.toFixed(2);
  if (price >= 1000) return Math.round(price).toLocaleString();
  return price.toFixed(2);
}

function quoteUrl(symbol: string): string {
  if (/^[\dA-Za-z]{6}$/.test(symbol)) return `https://tossinvest.com/stocks/A${symbol}`;
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`;
}

interface QuoteRow {
  kind: "spot" | "future" | "etf";
  symbol: string;
  name: string;
  desc?: string;
  price?: number;
  pct?: number;
  diff?: number;
  // 색 결정용 — 장마감 기준 (prevClose 대비). 비거래일 보정 영향 없음.
  // 미지정 시 diff 로 폴백.
  colorDiff?: number;
  sleeping: boolean;
  chart?: number[];   // 3개월 일봉 종가 시계열 (배경 sparkline 용)
}

export function UsMarketTab() {
  const yahooSymbols = allYahooSymbols();
  const krEtfs = allKrEtfTickers();
  const REFRESH_MS = useAdaptiveRefreshMs(BASE_REFRESH_MS);

  const { data: usMap, dataUpdatedAt: usUpdatedAt } = useQuery({
    queryKey: ["yahoo-batch", yahooSymbols.length],
    queryFn: () => fetchYahooBatch(yahooSymbols),
    refetchInterval: REFRESH_MS,
  });

  const { data: krPrices, dataUpdatedAt: krUpdatedAt } = useQuery({
    queryKey: ["us-tab-kr-etfs", krEtfs],
    queryFn: () => fetchTossPrices(krEtfs),
    refetchInterval: REFRESH_MS,
  });

  useEffect(() => { if (usUpdatedAt > 0) reportRefresh(usUpdatedAt); }, [usUpdatedAt]);
  useEffect(() => { if (krUpdatedAt > 0) reportRefresh(krUpdatedAt); }, [krUpdatedAt]);

  const krMap = new Map((krPrices ?? []).map(p => [p.ticker, p]));
  const tier0 = US_PAIRS.filter(p => p.tier === "T0");
  // T0 그룹 — 비슷한 지수끼리 묶어서 줄별로 표시
  const T0_GROUPS: string[][] = [
    ["^KS11", "^KS200", "^KQ11", "^KQ100"],                       // 한국 지수 (맨 위)
    ["KRW=X", "DX-Y.NYB", "JPY=X", "^TNX", "EWY", "^VIX"],     // 환율 + 매크로 + 외국인 투심 + 공포
    ["GC=F", "SI=F", "HG=F", "CL=F", "NG=F", "BTC-USD"],        // 원자재 + 비트코인
    ["^IXIC", "NQ=F", "^N225", "^GSPC", "ES=F"],                // 미국 지수 + 야간 선물 + 닛케이
    ["^SOX", "SOX=F", "NVDA", "TSM"],                            // 반도체
    ["091160.KS", "091180.KS", "305720.KS", "244580.KS",
     "091170.KS", "117700.KS", "266420.KS", "445290.KS"],         // 한국 KODEX 섹터 ETF (마지막)
  ];

  // T0 + 모든 섹터 현물·선물 Yahoo 심볼 통합 — 동일 캐시
  const allYahooForCharts: string[] = [];
  for (const p of US_PAIRS) {
    allYahooForCharts.push(p.symbol);
    if (p.future) allYahooForCharts.push(p.future);
  }
  const yahooChartQs = useQueries({
    queries: allYahooForCharts.map(sym => ({
      queryKey: ["yahoo-chart", sym, "3mo"],
      queryFn: () => fetchYahooChart(sym, "3mo"),
      staleTime: 60 * 60 * 1000,
      refetchOnWindowFocus: false,
    })),
  });
  const yahooChartMap = new Map(
    allYahooForCharts.map((sym, i) => [sym, yahooChartQs[i]?.data ?? []])
  );

  // KR ETF — fetchKrPriceHistory (Yahoo .KS/.KQ)
  const krEtfChartQs = useQueries({
    queries: krEtfs.map(t => ({
      queryKey: ["kr-price-history", t, "3mo"],
      queryFn: () => fetchKrPriceHistory(t, "3mo"),
      staleTime: 60 * 60 * 1000,
      refetchOnWindowFocus: false,
    })),
  });
  const krEtfChartMap = new Map(
    krEtfs.map((t, i) => [t, (krEtfChartQs[i]?.data ?? []).map(p => p.close)])
  );

  // T0 카드 sparkline — 일부 심볼 (SOX=F, ^KQ100) 은 Yahoo 가 historical 안 줌 → 가장 가까운 현물 차트로 폴백
  const SPARKLINE_FALLBACK: Record<string, string> = {
    "SOX=F": "^SOX",   // 필반 선물 → 필반 현물
    "^KQ100": "^KQ11", // 코스닥 100 → 코스닥 종합
  };
  const t0ChartMap = new Map(
    tier0.map(p => {
      const own = yahooChartMap.get(p.symbol) ?? [];
      if (own.length > 1) return [p.symbol, own];
      const fb = SPARKLINE_FALLBACK[p.symbol];
      if (fb) return [p.symbol, yahooChartMap.get(fb) ?? own];
      return [p.symbol, own];
    })
  );

  // 섹터별 행 묶음 — 현물 + 선물 + ETF
  function buildRowsForSector(sector: string): QuoteRow[] {
    const rows: QuoteRow[] = [];
    const sectorPairs = US_PAIRS.filter(p => p.tier !== "T0" && p.sector === sector);

    // 1) 현물 (=F 로 끝나는 심볼은 future 스타일링)
    for (const p of sectorPairs) {
      const q = usMap?.get(p.symbol);
      const isFuture = p.symbol.endsWith("=F");
      rows.push({
        kind: isFuture ? "future" : "spot", symbol: p.symbol, name: p.name, desc: p.desc,
        price: q?.price, pct: q?.pct, diff: q?.diff,
        sleeping: isSymbolSleeping(p.symbol),
        chart: yahooChartMap.get(p.symbol),
      });
    }
    // 2) 선물
    for (const p of sectorPairs) {
      if (!p.future) continue;
      const fq = usMap?.get(p.future);
      rows.push({
        kind: "future", symbol: p.future, name: `${p.name} 선물`,
        desc: `${p.name} 선물 — 정규장 외 흐름 체크`,
        price: fq?.price, pct: fq?.pct, diff: fq?.diff,
        sleeping: isSymbolSleeping(p.future),
        chart: yahooChartMap.get(p.future),
      });
    }
    // 3) KR ETF
    const etfs = ETFS_BY_SECTOR[sector] ?? [];
    for (const t of etfs) {
      const p: Price | undefined = krMap.get(t);
      const dayDiff = p ? p.price - p.base : 0;
      const dayPct = p && p.base > 0 ? (dayDiff / p.base) * 100 : 0;
      // 색용 — 장마감 기준 (prevClose 대비)
      const colorDiffEtf = p ? p.price - (p.prevClose || p.price) : 0;
      rows.push({
        kind: "etf", symbol: t, name: ETF_NAMES[t] ?? `ETF ${t}`,
        price: p?.price, pct: p ? dayPct : undefined, diff: p ? dayDiff : undefined,
        colorDiff: colorDiffEtf,
        sleeping: isSymbolSleeping(t),
        chart: krEtfChartMap.get(t),
      });
    }
    return rows;
  }

  // 좌우 분배 — 사용자 시각 균형 맞춤 (좌우 종목 수 비슷)
  const LEFT_SECTORS: string[] = [];
  const RIGHT_SECTORS: string[] = [];
  const t1Sectors = LEFT_SECTORS.filter(s => SECTOR_ORDER.includes(s));
  const t2Sectors = RIGHT_SECTORS.filter(s => SECTOR_ORDER.includes(s));

  const dimEnabled = getDimSleepingEnabled();

  return (
    <div className="space-y-3">
      {/* ─── Tier 0 — 비슷한 지수끼리 그룹별 줄 분리 ─── */}
      <div className="space-y-2">
        {T0_GROUPS.map((group, gi) => (
          <div key={gi} className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            {group.map(symbol => {
              const p = tier0.find(x => x.symbol === symbol);
              if (!p) return null;
              const q = usMap?.get(p.symbol);
              const sleeping = isSymbolSleeping(p.symbol);
              const cdiff = q ? q.price - (q.prevClose || q.price) : 0;
              const isFuture = p.symbol.endsWith("=F");
              const bg = sleeping && dimEnabled
                ? "bg-gray-100 border-gray-300"
                : cdiff > 0 ? "bg-rose-50 border-rose-200"
                : cdiff < 0 ? "bg-blue-50/70 border-blue-200"
                : "bg-white border-gray-200";
              const sign =
                cdiff > 0 ? "text-rose-600"
                : cdiff < 0 ? "text-blue-600"
                : "text-gray-900";
              const nameColor = isFuture ? "text-amber-700" : "text-gray-900";
              return (
                <a key={p.symbol}
                   href={quoteUrl(p.symbol)}
                   target="_blank" rel="noopener noreferrer"
                   title={`${p.name} — Yahoo Finance 보기`}
                   className={`relative overflow-hidden flex flex-col gap-0.5
                                rounded-lg border px-3 py-1.5
                                hover:brightness-95 transition cursor-pointer
                                ${bg} ${sleeping && dimEnabled ? "opacity-60" : ""}`}>
                  <Sparkline data={t0ChartMap.get(p.symbol) ?? []}
                             width={400} height={80}
                             color={sleeping && dimEnabled ? "#94a3b8" : undefined}
                             className="absolute inset-0 w-full h-full opacity-50
                                        pointer-events-none" />
                  <div className="relative z-10 flex items-baseline gap-1.5">
                    {sleeping && (
                      <span className="text-[11px] text-gray-400">zZ</span>
                    )}
                    <span className={`text-base font-bold ${nameColor}`}>{p.name}</span>
                  </div>
                  <div className="relative z-10 text-[11px] text-gray-500 truncate">
                    {p.desc}
                  </div>
                  <div className="relative z-10 flex items-baseline mt-1">
                    <span className={`flex-1 text-left text-sm tabular-nums ${sign}`}>
                      {q ? fmtPrice(p.symbol, q.price) : "—"}
                    </span>
                    <span className={`flex-1 text-right text-xl font-bold tabular-nums ${sign}`}>
                      {q && Math.abs(q.pct) >= 0.005
                        ? `${q.pct >= 0 ? "+" : ""}${q.pct.toFixed(2)}%`
                        : ""}
                    </span>
                  </div>
                </a>
              );
            })}
          </div>
        ))}
      </div>

      {/* ─── 섹터 표 — lg 이상 좌우 2 column (T1 좌측 / T2 우측) ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <SectorTable sectors={t1Sectors} buildRows={buildRowsForSector} />
        <SectorTable sectors={t2Sectors} buildRows={buildRowsForSector} />
      </div>
    </div>
  );
}

interface SectorTableProps {
  sectors: string[];
  buildRows: (sector: string) => QuoteRow[];
}

function SectorTable({ sectors, buildRows }: SectorTableProps) {
  return (
    <div className="space-y-2">
      {sectors.map(sector => {
        const rows = buildRows(sector);
        if (rows.length === 0) return null;
        const spots = rows.filter(r => r.kind === "spot");
        const futures = rows.filter(r => r.kind === "future");
        const etfs = rows.filter(r => r.kind === "etf");
        return (
          <div key={sector}
               className="grid grid-cols-[80px_1fr_1fr]
                           bg-white rounded-lg border border-gray-200 overflow-hidden">
            {/* 섹터 라벨 (좌측) — emoji 큼 + 라벨 세로 */}
            <div className="bg-slate-200 px-1 py-3 flex flex-col items-center
                              justify-center gap-0.5 text-center
                              border-r border-gray-300">
              <span className="text-2xl">{SECTOR_EMOJI[sector] ?? "📊"}</span>
              <span className="text-xs font-bold text-gray-800">{sector}</span>
            </div>
            {/* 현물 / 선물+ETF (선물 위, ETF 아래) 컬럼 */}
            <QuoteList rows={spots} />
            <QuoteList rows={[...futures, ...etfs]} />
          </div>
        );
      })}
    </div>
  );
}

interface QuoteListProps {
  rows: QuoteRow[];
}

function QuoteList({ rows }: QuoteListProps) {
  if (rows.length === 0) {
    return <div className="px-2 py-2 text-[10px] text-gray-300">—</div>;
  }
  const dimEnabled = getDimSleepingEnabled();
  return (
    <div className="flex flex-col py-0.5">
      {rows.map(r => {
        // 가격·배경 색 — 장마감 기준 (colorDiff 우선, 없으면 diff)
        const cdiff = r.colorDiff !== undefined ? r.colorDiff : r.diff;
        const sign =
          cdiff !== undefined && cdiff > 0 ? "text-rose-600"
          : cdiff !== undefined && cdiff < 0 ? "text-blue-600"
          : "text-gray-900";
        const rowBg =
          cdiff !== undefined && cdiff > 0 ? "bg-rose-50"
          : cdiff !== undefined && cdiff < 0 ? "bg-blue-50/70"
          : "";
        return (
          <div key={r.symbol}
               className={`relative overflow-hidden flex items-baseline gap-2 px-1.5 py-1
                            ${rowBg}
                            ${r.sleeping && dimEnabled ? "opacity-60" : ""}`}>
            {/* 차트 색은 자체 추세 판정 (3개월 첫값 vs 끝값) */}
            {r.chart && r.chart.length > 1 && (
              <Sparkline data={r.chart} width={150} height={28}
                         className="absolute inset-y-0 right-0 w-1/2 h-full
                                    opacity-25 pointer-events-none" />
            )}
            {/* zZ 자리 항상 확보 — 종목명 위치 정렬 통일 */}
            <span className="relative z-10 text-[10px] text-gray-400 shrink-0 w-4 text-left">
              {r.sleeping ? "zZ" : ""}
            </span>
            <a href={quoteUrl(r.symbol)}
               target="_blank" rel="noopener noreferrer"
               title={r.desc}
               className={`relative z-10 text-sm font-bold hover:underline truncate w-[160px]
                            ${r.kind === "future" ? "text-amber-700"
                              : r.kind === "etf" ? "text-gray-700"
                              : "text-gray-900"}`}>
              {r.name}
            </a>
            <span className={`relative z-10 text-xs tabular-nums text-right w-[64px] shrink-0 ${sign}`}>
              {r.price !== undefined ? fmtPrice(r.symbol, r.price) : "—"}
            </span>
            <span className={`relative z-10 text-base font-bold tabular-nums text-right w-[64px] shrink-0 ${sign}`}>
              {r.pct !== undefined && Math.abs(r.pct) >= 0.005
                ? `${r.pct >= 0 ? "+" : ""}${r.pct.toFixed(2)}%`
                : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// 임시 사용: UsIndex import 회피용
export type _UnusedUsIndex = UsIndex;
