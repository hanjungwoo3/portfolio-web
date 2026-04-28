import { useQuery } from "@tanstack/react-query";
import { fetchYahooBatch, fetchTossPrices } from "../lib/api";
import type { UsIndex } from "../lib/api";
import type { Price } from "../types";
import { nowKstDateStr } from "../lib/format";
import {
  US_PAIRS, ETFS_BY_SECTOR, SECTOR_EMOJI, SECTOR_ORDER,
  allYahooSymbols, allKrEtfTickers,
} from "../lib/usMarketData";

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

function QuoteCell({ name, desc, price, diff, pct, bold, sleeping }: QuoteCellProps) {
  if (price === undefined || diff === undefined || pct === undefined) {
    return (
      <div className="rounded-md border border-gray-200 bg-gray-50/50 p-2 min-h-[58px]">
        <div className="text-xs text-gray-400">{name}</div>
        <div className="text-xs text-gray-300 mt-1">로딩...</div>
      </div>
    );
  }
  const bg = bgFor(diff);
  const color = colorFor(diff);
  return (
    <div className={`rounded-md border border-gray-200 ${bg} px-2.5 py-1.5
                      flex flex-col gap-0.5
                      ${sleeping ? "opacity-60" : ""}`}>
      <div className="flex items-baseline flex-wrap gap-x-2">
        <span className={`${bold ? "font-bold" : "font-semibold"} text-sm
                          ${diff !== 0 ? color : "text-gray-700"}`}>
          {sleeping && (
            <span className="text-[10px] text-gray-400 mr-0.5">
              z<sup>z</sup><sup>z</sup>
            </span>
          )}
          {name}
        </span>
        {desc && (
          <span className="text-[10px] text-gray-500 truncate">{desc}</span>
        )}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="font-bold text-gray-800 tabular-nums">
          {fmtPrice("", price)}
        </span>
        <span className={`text-xs font-medium tabular-nums ${color}`}>
          ({diff >= 0 ? "+" : ""}{pct.toFixed(2)}%)
        </span>
      </div>
    </div>
  );
}

export function UsMarketTab() {
  const yahooSymbols = allYahooSymbols();
  const krEtfs = allKrEtfTickers();
  const todayKst = nowKstDateStr();

  const { data: usMap } = useQuery({
    queryKey: ["yahoo-batch", yahooSymbols.length],
    queryFn: () => fetchYahooBatch(yahooSymbols),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const { data: krPrices } = useQuery({
    queryKey: ["us-tab-kr-etfs", krEtfs],
    queryFn: () => fetchTossPrices(krEtfs),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

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
      {/* ─── Tier 0: 핵심 대시보드 ─── */}
      <div className="rounded-lg bg-slate-800 text-white px-4 py-3
                       grid grid-cols-2 lg:grid-cols-4 gap-3">
        {tier0.map(p => {
          const q = usMap?.get(p.symbol);
          const diff = q?.diff ?? 0;
          const pct = q?.pct ?? 0;
          const sleeping = q ? q.tradeDate !== todayKst : false;
          const sign = diff > 0 ? "text-rose-400"
                      : diff < 0 ? "text-blue-400" : "text-gray-300";
          return (
            <div key={p.symbol}
                 className={`flex flex-col gap-0.5 ${sleeping ? "opacity-60" : ""}`}>
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
            </div>
          );
        })}
      </div>

      {/* ─── 섹터 그리드 ─── */}
      <div className="rounded-lg bg-white border border-gray-200 overflow-hidden">
        {SECTOR_ORDER.map(sectorKey => {
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
                 className="grid grid-cols-[80px_1fr_1fr_1fr] gap-2 p-2
                            border-b border-gray-100 last:border-b-0">
              {/* 좌측: 섹터 라벨 */}
              <div className="flex items-center justify-center text-sm font-bold text-gray-700">
                <span className="mr-1">{SECTOR_EMOJI[sectorKey] ?? "📊"}</span>
                {sectorKey}
              </div>
              {/* 컬럼 1: 현물 */}
              <div className="flex flex-col gap-1">
                {cashPairs.map(p => {
                  const q = usMap?.get(p.symbol);
                  const sleeping = q ? q.tradeDate !== todayKst : false;
                  return (
                    <QuoteCell key={p.symbol}
                      symbol={p.symbol} name={p.name} desc={p.desc}
                      price={q?.price} diff={q?.diff} pct={q?.pct}
                      bold={p.tier === "T1"} sleeping={sleeping} />
                  );
                })}
              </div>
              {/* 컬럼 2: 선물 */}
              <div className="flex flex-col gap-1">
                {futurePairs.map(f => {
                  const q = usMap?.get(f.symbol);
                  const sleeping = q ? q.tradeDate !== todayKst : false;
                  return (
                    <QuoteCell key={f.symbol}
                      symbol={f.symbol} name={f.name} desc={f.desc}
                      price={q?.price} diff={q?.diff} pct={q?.pct}
                      sleeping={sleeping} />
                  );
                })}
              </div>
              {/* 컬럼 3: KR ETF */}
              <div className="flex flex-col gap-1">
                {etfTickers.map(t => {
                  const p: Price | undefined = krMap.get(t);
                  if (!p) {
                    return (
                      <QuoteCell key={t} symbol={t} name={`ETF ${t}`} />
                    );
                  }
                  const diff = p.price - p.base;
                  const pct = p.base > 0 ? (diff / p.base) * 100 : 0;
                  const sleeping = p.trade_date !== todayKst;
                  return (
                    <QuoteCell key={t}
                      symbol={t} name={`ETF ${t}`}
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
