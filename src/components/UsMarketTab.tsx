import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchYahooBatch, fetchTossPrices } from "../lib/api";
import type { UsIndex } from "../lib/api";
import type { Price } from "../types";
import { isSymbolSleeping } from "../lib/format";
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

function bgFor(diff: number) {
  if (diff > 0) return "bg-rose-50";
  if (diff < 0) return "bg-blue-50";
  return "bg-gray-50";
}
function colorFor(diff: number) {
  if (diff > 0) return "text-rose-700";
  if (diff < 0) return "text-blue-700";
  return "text-gray-500";
}

interface QuoteCellProps {
  symbol: string;
  name: string;
  desc?: string;
  price?: number;
  diff?: number;
  pct?: number;
  bold?: boolean;
  sleeping?: boolean;
}

function quoteUrl(symbol: string): string {
  // 한국 ETF (6자리 숫자) → 토스
  if (/^\d{6}$/.test(symbol)) return `https://tossinvest.com/stocks/A${symbol}`;
  // 그 외 → Yahoo Finance (path 에 인코딩, trailing slash 없음)
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`;
}

function QuoteCell({ symbol, name, desc, price, diff, pct, bold, sleeping }: QuoteCellProps) {
  if (price === undefined || diff === undefined || pct === undefined) {
    return (
      <a href={quoteUrl(symbol)} target="_blank" rel="noopener noreferrer"
         className="rounded border border-gray-200 bg-gray-50/50 px-2 py-1
                    hover:border-gray-400 transition inline-flex items-baseline gap-1.5">
        <span className="text-xs text-gray-400 font-semibold">{name}</span>
        {desc && <span className="text-[10px] text-gray-400 truncate">{desc}</span>}
        <span className="text-[10px] text-gray-300">…</span>
      </a>
    );
  }
  const bg = bgFor(diff);
  const color = colorFor(diff);
  return (
    <a href={quoteUrl(symbol)} target="_blank" rel="noopener noreferrer"
       className={`rounded border border-gray-200 ${bg} px-2 py-1
                    inline-flex items-baseline gap-1.5
                    hover:border-gray-400 hover:brightness-95 transition
                    ${sleeping ? "opacity-60" : ""}`}>
      <span className={`${bold ? "font-bold" : "font-semibold"} text-xs
                        ${diff !== 0 ? color : "text-gray-700"}`}>
        {sleeping && (
          <span className="text-[10px] text-gray-400 mr-0.5">
            z<sup>z</sup><sup>z</sup>
          </span>
        )}
        {name}
      </span>
      <span className="font-bold text-gray-800 tabular-nums text-xs">
        {fmtPrice(symbol, price)}
      </span>
      <span className={`text-[11px] font-medium tabular-nums ${color}`}>
        ({diff >= 0 ? "+" : ""}{pct.toFixed(2)}%)
      </span>
      {desc && (
        <span className="text-[10px] text-gray-500 truncate max-w-[180px]">
          {desc}
        </span>
      )}
    </a>
  );
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

  // 갱신 시각 글로벌 보고
  useEffect(() => { if (usUpdatedAt > 0) reportRefresh(usUpdatedAt); }, [usUpdatedAt]);
  useEffect(() => { if (krUpdatedAt > 0) reportRefresh(krUpdatedAt); }, [krUpdatedAt]);

  const krMap = new Map((krPrices ?? []).map(p => [p.ticker, p]));

  const tier0 = US_PAIRS.filter(p => p.tier === "T0");
  const sectorPairs = US_PAIRS.filter(p => p.tier !== "T0");

  // 섹터별 그룹화
  const bySector = new Map<string, typeof sectorPairs>();
  for (const p of sectorPairs) {
    const arr = bySector.get(p.sector) ?? [];
    arr.push(p);
    bySector.set(p.sector, arr);
  }

  return (
    <div className="space-y-3">
      {/* ─── Tier 0: 핵심 대시보드 (각 카드 클릭 → Yahoo Finance 새 탭) ─── */}
      <div className="rounded-lg bg-slate-800 text-white px-4 py-3
                       grid grid-cols-2 lg:grid-cols-4 gap-3">
        {tier0.map(p => {
          const q = usMap?.get(p.symbol);
          const diff = q?.diff ?? 0;
          const pct = q?.pct ?? 0;
          const sleeping = isSymbolSleeping(p.symbol);
          const sign = diff > 0 ? "text-rose-400"
                      : diff < 0 ? "text-blue-400" : "text-gray-300";
          return (
            <a key={p.symbol}
               href={quoteUrl(p.symbol)} target="_blank" rel="noopener noreferrer"
               title={`${p.name} — Yahoo Finance 새 탭에서 보기`}
               className={`flex flex-col gap-0.5 rounded -mx-2 px-2 py-1
                            hover:bg-slate-700 transition cursor-pointer
                            ${sleeping ? "opacity-60" : ""}`}>
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-base font-bold">
                  {sleeping && (
                    <span className="text-[10px] text-gray-400 mr-0.5">
                      z<sup>z</sup><sup>z</sup>
                    </span>
                  )}
                  {p.name}
                </span>
                <span className="font-bold tabular-nums text-sm">
                  {q ? fmtPrice(p.symbol, q.price) : "—"}
                </span>
                <span className={`font-bold tabular-nums text-sm ${sign}`}>
                  {q ? `${diff >= 0 ? "+" : ""}${pct.toFixed(2)}%` : ""}
                </span>
              </div>
              <div className="text-[11px] text-gray-300 truncate">
                {p.desc}
              </div>
            </a>
          );
        })}
      </div>

      {/* ─── 섹터 그리드 ─── */}
      <div className="rounded-lg bg-white border border-gray-200 overflow-hidden">
        {SECTOR_ORDER.map((sectorKey, sectorIdx) => {
          const pairs = bySector.get(sectorKey) ?? [];
          const etfTickers = ETFS_BY_SECTOR[sectorKey] ?? [];
          if (pairs.length === 0 && etfTickers.length === 0) return null;

          // 현물(=F 아닌 것) / 선물(=F or .future 사용) 분리
          const cashPairs = pairs.filter(p => !p.symbol.endsWith("=F"));
          const futurePairs: { symbol: string; name: string; desc?: string }[] = [];
          for (const p of pairs) {
            if (p.symbol.endsWith("=F")) {
              futurePairs.push({ symbol: p.symbol, name: p.name, desc: p.desc });
            } else if (p.future) {
              futurePairs.push({
                symbol: p.future,
                name: `${p.name} 선물`,
                desc: `(${p.future})`,
              });
            }
          }

          return (
            <div key={sectorKey}
                 className={`grid grid-cols-[80px_1fr_1fr_1fr] gap-2 p-2
                             border-b border-gray-100 last:border-b-0
                             items-start
                             ${sectorIdx % 2 === 1 ? "bg-gray-50/70" : ""}`}>
              {/* 좌측: 섹터 라벨 */}
              <div className="flex items-center justify-center text-sm font-bold text-gray-700">
                <span className="mr-1">{SECTOR_EMOJI[sectorKey] ?? "📊"}</span>
                {sectorKey}
              </div>
              {/* 컬럼 1: 현물 (선행지수 등) */}
              <div className="flex flex-wrap gap-1">
                {cashPairs.map(p => {
                  const q = usMap?.get(p.symbol);
                  const sleeping = isSymbolSleeping(p.symbol);
                  return (
                    <QuoteCell key={p.symbol}
                      symbol={p.symbol} name={p.name} desc={p.desc}
                      price={q?.price} diff={q?.diff} pct={q?.pct}
                      bold={p.tier === "T1"} sleeping={sleeping} />
                  );
                })}
              </div>
              {/* 컬럼 2: 선물 */}
              <div className="flex flex-wrap gap-1">
                {futurePairs.map(f => {
                  const q = usMap?.get(f.symbol);
                  const sleeping = isSymbolSleeping(f.symbol);
                  return (
                    <QuoteCell key={f.symbol}
                      symbol={f.symbol} name={f.name} desc={f.desc}
                      price={q?.price} diff={q?.diff} pct={q?.pct}
                      sleeping={sleeping} />
                  );
                })}
              </div>
              {/* 컬럼 3: KR ETF */}
              <div className="flex flex-wrap gap-1">
                {etfTickers.map(t => {
                  const p: Price | undefined = krMap.get(t);
                  const etfName = ETF_NAMES[t] ?? `ETF ${t}`;
                  const sleeping = isSymbolSleeping(t);
                  if (!p) {
                    return (
                      <QuoteCell key={t} symbol={t} name={etfName}
                                 sleeping={sleeping} />
                    );
                  }
                  const diff = p.price - p.base;
                  const pct = p.base > 0 ? (diff / p.base) * 100 : 0;
                  return (
                    <QuoteCell key={t}
                      symbol={t} name={etfName}
                      price={p.price} diff={diff} pct={pct}
                      bold sleeping={sleeping} />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// 임시 사용: UsIndex import 회피용
export type _UnusedUsIndex = UsIndex;
