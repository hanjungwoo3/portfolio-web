import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchYahooBatch, fetchTossPrices } from "../lib/api";
import type { UsIndex } from "../lib/api";
import type { Price } from "../types";
import { isSymbolSleeping, signColor } from "../lib/format";
import {
  US_PAIRS, ETFS_BY_SECTOR, ETF_NAMES, SECTOR_EMOJI, SECTOR_ORDER,
  allYahooSymbols, allKrEtfTickers,
} from "../lib/usMarketData";
import { useAdaptiveRefreshMs } from "../lib/proxyStatus";
import { reportRefresh } from "../lib/lastRefresh";

const BASE_REFRESH_MS = 10_000;

function fmtPrice(symbol: string, price: number): string {
  if (symbol.includes("KRW")) return price.toFixed(2);
  if (symbol === "^VIX" || symbol === "^TNX") return price.toFixed(2);
  if (price >= 1000) return Math.round(price).toLocaleString();
  return price.toFixed(2);
}

function quoteUrl(symbol: string): string {
  if (/^\d{6}$/.test(symbol)) return `https://tossinvest.com/stocks/A${symbol}`;
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
  sleeping: boolean;
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

  // 섹터별 행 묶음 — 현물 + 선물 + ETF
  function buildRowsForSector(sector: string): QuoteRow[] {
    const rows: QuoteRow[] = [];
    const sectorPairs = US_PAIRS.filter(p => p.tier !== "T0" && p.sector === sector);

    // 1) 현물
    for (const p of sectorPairs) {
      const q = usMap?.get(p.symbol);
      rows.push({
        kind: "spot", symbol: p.symbol, name: p.name, desc: p.desc,
        price: q?.price, pct: q?.pct, diff: q?.diff,
        sleeping: isSymbolSleeping(p.symbol),
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
      });
    }
    // 3) KR ETF
    const etfs = ETFS_BY_SECTOR[sector] ?? [];
    for (const t of etfs) {
      const p: Price | undefined = krMap.get(t);
      const dayDiff = p ? p.price - p.base : 0;
      const dayPct = p && p.base > 0 ? (dayDiff / p.base) * 100 : 0;
      rows.push({
        kind: "etf", symbol: t, name: ETF_NAMES[t] ?? `ETF ${t}`,
        price: p?.price, pct: p ? dayPct : undefined, diff: p ? dayDiff : undefined,
        sleeping: isSymbolSleeping(t),
      });
    }
    return rows;
  }

  // T1 / T2 분할 (좌측 / 우측)
  const t1Sectors = SECTOR_ORDER.filter(s =>
    US_PAIRS.some(p => p.tier === "T1" && p.sector === s)
  );
  const t2Sectors = SECTOR_ORDER.filter(s =>
    US_PAIRS.some(p => p.tier === "T2" && p.sector === s)
  );

  return (
    <div className="space-y-3">
      {/* ─── Tier 0 (4개 카드) — +/- 색칠 ─── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {tier0.map(p => {
          const q = usMap?.get(p.symbol);
          const sleeping = isSymbolSleeping(p.symbol);
          const bg =
            q && q.diff > 0 ? "bg-rose-50 border-rose-200"
            : q && q.diff < 0 ? "bg-blue-50/70 border-blue-200"
            : "bg-white border-gray-200";
          const sign = q ? signColor(q.diff) : "text-gray-400";
          return (
            <a key={p.symbol}
               href={quoteUrl(p.symbol)} target="_blank" rel="noopener noreferrer"
               title={`${p.name} — Yahoo Finance 새 탭에서 보기`}
               className={`flex flex-col gap-0.5 rounded-lg border px-3 py-2
                            hover:brightness-95 transition cursor-pointer
                            ${bg} ${sleeping ? "opacity-60" : ""}`}>
              <div className="flex items-baseline gap-1.5">
                {sleeping && (
                  <span className="text-[11px] text-gray-400">zZ</span>
                )}
                <span className="text-base font-bold text-gray-900">{p.name}</span>
              </div>
              <div className="text-[11px] text-gray-500 truncate">{p.desc}</div>
              <div className="flex items-baseline mt-0.5">
                <span className="flex-1 text-left text-sm tabular-nums text-gray-700">
                  {q ? fmtPrice(p.symbol, q.price) : "—"}
                </span>
                <span className={`flex-1 text-right text-base font-bold tabular-nums ${sign}`}>
                  {q ? `${q.pct >= 0 ? "+" : ""}${q.pct.toFixed(2)}%` : ""}
                </span>
              </div>
            </a>
          );
        })}
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
    <table className="w-full bg-white rounded-lg border border-gray-200
                       overflow-hidden text-sm">
      <thead className="bg-gray-100 text-gray-600 text-xs">
        <tr>
          <th className="px-2 py-2 text-left w-16">섹터</th>
          <th className="px-2 py-2 text-left">종목</th>
          <th className="px-2 py-2 text-right">현재가</th>
          <th className="px-2 py-2 text-right w-24">등락%</th>
        </tr>
      </thead>
      <tbody>
        {sectors.map(sector => {
          const rows = buildRows(sector);
          if (rows.length === 0) return null;
          return rows.map((r, idx) => {
            const isFirst = idx === 0;
            const isLast = idx === rows.length - 1;
            const sign = r.diff !== undefined ? signColor(r.diff) : "text-gray-400";
            const rowBg =
              r.diff !== undefined && r.diff > 0 ? "bg-rose-50"
              : r.diff !== undefined && r.diff < 0 ? "bg-blue-50/70"
              : "";
            const borderCls = isLast
              ? "border-b border-gray-300"
              : "border-b border-gray-100";
            return (
              <tr key={`${sector}-${r.symbol}`}
                  className={`${borderCls} ${rowBg}
                               ${r.sleeping ? "opacity-60" : ""}`}>
                {isFirst ? (
                  <td className="px-2 py-2 font-bold text-gray-800 align-middle
                                  bg-slate-200 border-r border-gray-300"
                      rowSpan={rows.length}>
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-2xl">{SECTOR_EMOJI[sector] ?? "📊"}</span>
                      <span className="text-xs font-bold">{sector}</span>
                    </div>
                  </td>
                ) : null}
                <td className="px-2 py-2">
                  <div className="flex items-baseline gap-1">
                    {r.sleeping && (
                      <span className="text-[10px] text-gray-400">zZ</span>
                    )}
                    {r.kind === "etf" && (
                      <span className="text-gray-400 text-[10px]">·</span>
                    )}
                    <a href={quoteUrl(r.symbol)}
                       target="_blank" rel="noopener noreferrer"
                       className={`text-base font-bold hover:underline
                                    ${r.kind === "future" ? "text-amber-700"
                                      : r.kind === "etf" ? "text-gray-600"
                                      : "text-gray-900"}`}>
                      {r.name}
                    </a>
                  </div>
                  {r.desc && r.kind !== "etf" && (
                    <div className="text-[11px] text-gray-500 truncate
                                      max-w-[260px] mt-0.5">
                      {r.desc}
                    </div>
                  )}
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-gray-900 font-medium">
                  {r.price !== undefined ? fmtPrice(r.symbol, r.price) : "—"}
                </td>
                <td className={`px-2 py-2 text-right tabular-nums text-base font-bold ${sign}`}>
                  {r.pct !== undefined
                    ? `${r.pct >= 0 ? "+" : ""}${r.pct.toFixed(2)}%`
                    : "—"}
                </td>
              </tr>
            );
          });
        })}
      </tbody>
    </table>
  );
}

// 임시 사용: UsIndex import 회피용
export type _UnusedUsIndex = UsIndex;
