import { useEffect, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { fetchYahooBatch, fetchTossPrices, fetchYahooChart, fetchKrPriceHistory, fetchInvestingChart, isInvestingIndex, fetchYasunNightFutures } from "../lib/api";
import type { UsIndex, MarketIndexKey } from "../lib/api";
import type { Price } from "../types";
import { isSymbolSleeping, marketOfSymbol, fmtAgo } from "../lib/format";
import { getDimSleepingEnabled, getPersonalProxyUrl } from "../lib/proxyConfig";
import {
  US_PAIRS, ETFS_BY_SECTOR, ETF_NAMES, SECTOR_EMOJI, SECTOR_ORDER,
  allYahooSymbols, allKrEtfTickers,
} from "../lib/usMarketData";
import { useAdaptiveRefreshMs } from "../lib/proxyStatus";
import { reportRefresh } from "../lib/lastRefresh";
import { handleTossLinkClick, TOSS_SYMBOL_URL } from "../lib/toss";
import { Sparkline } from "./Sparkline";
import { MarketFlowModal } from "./MarketFlowModal";
import { EtfCompositionDialog } from "./EtfCompositionDialog";

// KR ETF Yahoo 심볼 패턴 (예: "091160.KS") — 토스 compositions API 지원 대상
const KR_ETF_SYMBOL_RE = /^([\dA-Za-z]{6})\.K[SQ]$/;

const WORKER_UPDATE_GUIDE_URL = "https://github.com/hanjungwoo3/portfolio-web/blob/main/workers/proxy/UPDATE-POST-SUPPORT.md";
function krEtfTicker(symbol: string): string | null {
  const m = KR_ETF_SYMBOL_RE.exec(symbol);
  return m ? m[1] : null;
}

const BASE_REFRESH_MS = 10_000;

function fmtPrice(symbol: string, price: number): string {
  if (symbol.includes("KRW")) return price.toFixed(2);
  if (symbol === "^VIX" || symbol === "^TNX") return price.toFixed(2);
  if (price >= 1000) return Math.round(price).toLocaleString();
  return price.toFixed(2);
}

function quoteUrl(symbol: string): string {
  // 야간선물 — yasun.gg
  if (symbol === "^KS200N") return "https://yasun.gg/kospi200";
  if (symbol === "^KQ150N") return "https://yasun.gg/kosdaq150";
  // 한국 보유 종목 (6자리) 또는 KODEX/.KS ETF (6자리.KS) — 모두 토스
  const krMatch = /^([\dA-Za-z]{6})(?:\.KS)?$/.exec(symbol);
  if (krMatch) return `https://tossinvest.com/stocks/A${krMatch[1]}`;
  // 지수/환율/미국 ETF 토스 매핑 (lib/toss.ts 공통 맵)
  if (TOSS_SYMBOL_URL[symbol]) return TOSS_SYMBOL_URL[symbol];
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

interface UsMarketTabProps {
  // ETF 구성종목 모달의 "한번에 추가" → 전역 검색창으로 전달
  onRequestSearch?: (q: string) => void;
}

export function UsMarketTab({ onRequestSearch }: UsMarketTabProps = {}) {
  const yahooSymbols = allYahooSymbols();
  const krEtfs = allKrEtfTickers();
  const REFRESH_MS = useAdaptiveRefreshMs(BASE_REFRESH_MS);

  const { data: usMapRaw, dataUpdatedAt: usUpdatedAt } = useQuery({
    queryKey: ["yahoo-batch", yahooSymbols.length],
    queryFn: () => fetchYahooBatch(yahooSymbols),
    refetchInterval: REFRESH_MS,
  });

  // 야간선물(yasun.gg) — 코스피200/코스닥150. Yahoo 와 분리된 별도 fetch.
  const NIGHT_SYMS = ["^KS200N", "^KQ150N"] as const;
  const nightQs = useQueries({
    queries: NIGHT_SYMS.map(sym => ({
      queryKey: ["yasun-night", sym],
      queryFn: () => fetchYasunNightFutures(sym),
      refetchInterval: REFRESH_MS,
      staleTime: 60_000,
    })),
  });
  // Yahoo + 야선 통합 — 카드 렌더는 usMap?.get(symbol) 그대로 사용
  const usMap = new Map(usMapRaw ?? []);
  // 야선 캔들 close 시계열 — 스파크라인용 (^KS200N/^KQ150N)
  const nightClosesMap = new Map<string, number[]>();
  for (let i = 0; i < NIGHT_SYMS.length; i++) {
    const d = nightQs[i]?.data;
    if (d) {
      usMap.set(NIGHT_SYMS[i], d.index);
      nightClosesMap.set(NIGHT_SYMS[i], d.closes);
    }
  }

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
    ["^KS11", "^KQ11", "069500.KS", "VKOSPI", "^VIX", "EWY"],                          // 1행 — 한국 지수 + KODEX 200 + 공포(VKOSPI·VIX) + 외국인 투심
    ["^KS200N", "^KQ150N", "KRW=X", "DX-Y.NYB", "^FVX", "^TNX", "^TYX"],               // 2행 — KOSPI/KOSDAQ 야간선물 + 환율 + 매크로 + 미국 국채(5/10/30Y)
    ["GC=F", "SI=F", "HG=F", "CL=F", "NG=F", "BTC-USD"],        // 원자재 + 비트코인
    ["^IXIC", "NQ=F", "^GSPC", "ES=F", "^DJI", "RTY=F"], // 미국 지수·선물 + 다우 + 러셀선물 (필반은 반도체 탭으로)
    ["SPY", "QQQ", "DIA", "IWM", "VTI"],                          // 미국 대표 ETF
    ["SMH", "PAVE", "LIT", "XBI",
     "KBE", "ITA", "XLV", "BOTZ"],                                // 미국 섹터 ETF (KODEX 위)
    ["091160.KS", "117700.KS", "305720.KS", "244580.KS",
     "091170.KS", "449450.KS", "266420.KS", "445290.KS"],          // 한국 섹터 ETF (KODEX + K-방산)
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
      queryFn: () => isInvestingIndex(sym) ? fetchInvestingChart(sym) : fetchYahooChart(sym, "3mo"),
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

  // T0 카드 sparkline — 일부 심볼 (SOX=F) 은 Yahoo 가 historical 안 줌 → 가장 가까운 현물 차트로 폴백
  const SPARKLINE_FALLBACK: Record<string, string> = {
    "SOX=F": "^SOX",   // 필반 선물 → 필반 현물
  };
  const t0ChartMap = new Map(
    tier0.map(p => {
      // 야선 — yasun 캔들 close 시계열
      const yasunCloses = nightClosesMap.get(p.symbol);
      if (yasunCloses && yasunCloses.length > 1) return [p.symbol, yasunCloses];
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
  const [marketFlowFor, setMarketFlowFor] = useState<MarketIndexKey | null>(null);
  const [etfDialog, setEtfDialog] = useState<{ ticker: string; name: string } | null>(null);
  // 개인 워커 사용 중이면, investing 미허용으로 V-KOSPI 값이 빌 수 있음 → 카드 안에 업데이트 안내
  const hasPersonalProxy = !!getPersonalProxyUrl();

  return (
    <div className="space-y-3">
      {/* ─── Tier 0 — 비슷한 지수끼리 그룹별 줄 분리 ─── */}
      <div className="space-y-2">
        {T0_GROUPS.map((group, gi) => (
          <div key={gi} className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-8 gap-x-2 gap-y-4">
            {group.map(symbol => {
              const p = tier0.find(x => x.symbol === symbol);
              if (!p) return null;
              const q = usMap?.get(p.symbol);
              const sleeping = isSymbolSleeping(p.symbol);
              // 메인 가격/변동률 — 한국 입장(미국장 마감 후 아침에 확인):
              // · REGULAR: regularPct (어제 종가 대비)
              // · 시간외(PRE/POST/POSTPOST/PREPRE/CLOSED): postPrice + 어제 종가(prevClose) 대비
              //   = 정규장 + 시간외 누적 변동률 (예: -7.75%)
              // 시간외 진입~마감 전체 구간에서 postPrice 일관 사용 → POST↔POSTPOST 전환 시 점프 없음
              const offHoursStates = ["PRE", "POST", "POSTPOST", "PREPRE", "CLOSED"];
              const isOffHours = q?.marketState != null && offHoursStates.includes(q.marketState);
              // dim 처리(흐리게) — 정규장 마감 후 모든 상태 (POST 부터). PRE 는 새 거래일 시작 직전이라 제외.
              // 24h 시장(환율 KRW=X, 달러 인덱스, 선물·암호화폐 등)은 Yahoo가 CLOSED 를 자주 반환하지만 흐림 제외.
              const is24h = marketOfSymbol(p.symbol) === "OTHER";
              const isClosed = !is24h && q?.marketState != null
                && ["POST", "POSTPOST", "PREPRE", "CLOSED"].includes(q.marketState);
              const effPrice = isOffHours && q?.postPrice ? q.postPrice : q?.price;
              const effBase = q?.prevClose;
              const pct = (q?.marketState === "REGULAR" && q.regularPct != null)
                ? q.regularPct
                : (effPrice != null && effBase != null && effBase > 0
                   ? ((effPrice - effBase) / effBase) * 100
                   : null);
              const cdiff = effPrice != null && effBase != null ? effPrice - effBase : 0;
              const isFuture = p.symbol.endsWith("=F") || p.symbol === "^KS200N" || p.symbol === "^KQ150N";
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
              const isKospi  = p.symbol === "^KS11";
              const isKosdaq = p.symbol === "^KQ11";
              const hasFlow  = isKospi || isKosdaq;
              const indexKey = isKospi ? "KOSPI" : isKosdaq ? "KOSDAQ" : null;
              // 정규장 종료(sleeping) 후 항상 마감가 책갈피 표시.
              // 시간외 거래값(regularPrice 별도)이 있으면 그 값을, 없으면 현재가를 마감가로 통일 표시.
              const showCloseTag = sleeping && effPrice != null;
              const closeVal = q?.regularPrice ?? effPrice;
              const regPct = q?.regularPct ?? pct;
              const regSign = regPct == null ? "text-gray-700"
                : regPct > 0 ? "text-rose-600" : regPct < 0 ? "text-blue-600" : "text-gray-700";
              // 마감 책갈피는 노란 배경 + 흐림 제외 → dim 은 콘텐츠 자식에만 적용
              const dimCls = dimEnabled && (sleeping || isClosed) ? "opacity-60" : "";
              return (
                <div key={p.symbol} className="relative h-full">
                  {/* ETF 책갈피 — KR ETF (예: 069500.KS) 만. 왼쪽 위. 클릭 시 구성종목 모달 */}
                  {(() => {
                    const etfTk = krEtfTicker(p.symbol);
                    if (!etfTk) return null;
                    return (
                      <button onClick={() => setEtfDialog({ ticker: etfTk, name: p.name })}
                              title="ETF 구성 종목 보기"
                              className="absolute -top-2 left-1 z-20 px-1.5 py-0 rounded
                                         text-[10px] font-bold leading-tight
                                         text-violet-700 bg-violet-100/30 hover:bg-violet-100/60
                                         border border-violet-300/40">
                        ETF
                      </button>
                    );
                  })()}
                  {/* 정규장 마감가 책갈피 — 카드 위로 올림(-top-2). 노란 배경 + 흐림 제외(z-20) */}
                  {showCloseTag && closeVal != null && (
                    <div className="absolute -top-2 right-1 z-20 px-1.5 py-0
                                    border rounded bg-yellow-200/25 border-yellow-400/40
                                    text-[10px] font-medium leading-tight whitespace-nowrap">
                      <span className={`tabular-nums ${regSign}`}>
                        {closeVal < 1000 ? closeVal.toFixed(2) : Math.round(closeVal).toLocaleString()}
                      </span>
                      {regPct != null && (
                        <span className={`tabular-nums ml-1 font-bold text-[11px] ${regSign}`}>
                          ({regPct >= 0 ? "+" : ""}{regPct.toFixed(2)}%)
                        </span>
                      )}
                    </div>
                  )}
                  <div className={`relative overflow-hidden h-full flex flex-col gap-0.5
                                  rounded-lg border px-3 py-1.5 ${bg}`}>
                  <Sparkline data={t0ChartMap.get(p.symbol) ?? []}
                             width={400} height={80}
                             color={sleeping && dimEnabled ? "#94a3b8" : undefined}
                             className={`absolute inset-0 w-full h-full opacity-50
                                        pointer-events-none ${dimCls}`} />
                  <div className={`relative z-10 flex items-baseline gap-1.5 ${dimCls}`}>
                    {sleeping && (
                      <span className="text-[11px] text-gray-400">zZ</span>
                    )}
                    {/* 종목명 자체가 외부 링크 (Toss/Yahoo) */}
                    <a href={quoteUrl(p.symbol)}
                       target="_blank" rel="noopener noreferrer"
                       onClick={e => handleTossLinkClick(e, quoteUrl(p.symbol))}
                       title={`${p.name} 자세히 보기`}
                       className={`text-base font-bold ${nameColor} hover:underline`}>
                      {p.name}
                    </a>
                    {/* 매매동향 모달 버튼 — KOSPI/KOSDAQ 만 */}
                    {hasFlow && indexKey && (
                      <button onClick={() => setMarketFlowFor(indexKey)}
                              title={`${p.name} 투자자별 매매동향`}
                              className="ml-1 px-1 py-0.5 rounded text-[10px] text-gray-500
                                         bg-white/60 hover:bg-white border border-gray-200">
                        📊
                      </button>
                    )}
                  </div>
                  <div className={`relative z-10 text-[11px] text-gray-500 truncate ${dimCls}`}>
                    {p.desc}
                  </div>
                  {(p.symbol === "VKOSPI" || p.symbol === "^KS200N" || p.symbol === "^KQ150N")
                    && effPrice == null && hasPersonalProxy ? (
                    /* 개인 워커 구버전 — investing(VKOSPI) 또는 yasun.gg(야선) 화이트리스트 누락 */
                    <div className="relative z-10 flex items-center mt-auto min-h-[1.75rem]">
                      <a href={WORKER_UPDATE_GUIDE_URL} target="_blank" rel="noopener noreferrer"
                         title={`개인 워커가 구버전이라 ${p.name} 미표시 — 업데이트 가이드`}
                         className="text-[12px] font-bold text-amber-700 underline hover:text-amber-900">
                        ⚠️ 워커 업데이트 ↗
                      </a>
                    </div>
                  ) : (
                  <div className={`relative z-10 flex items-baseline mt-auto ${dimCls}`}>
                    <span className={`flex-1 text-left text-sm tabular-nums ${sign}`}>
                      {effPrice != null ? fmtPrice(p.symbol, effPrice) : "—"}
                    </span>
                    <span className={`flex-1 text-right text-xl font-bold tabular-nums ${sign}`}>
                      {pct != null && Math.abs(pct) >= 0.005
                        ? `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`
                        : ""}
                    </span>
                  </div>
                  )}
                  </div>
                  {sleeping && fmtAgo(q?.regularMarketTime) && (
                    <div className="absolute -bottom-1 left-1 z-20 px-1.5 py-0 rounded
                                    text-[9px] leading-tight whitespace-nowrap
                                    text-gray-500 bg-gray-100 border border-gray-300/60">
                      {fmtAgo(q?.regularMarketTime)}
                    </div>
                  )}
                </div>
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

      {/* 시장 매매동향 모달 — KOSPI/KOSDAQ 카드 📊 클릭 시 */}
      {marketFlowFor && (
        <MarketFlowModal
          isOpen={true}
          indexKey={marketFlowFor}
          onClose={() => setMarketFlowFor(null)}
        />
      )}

      {/* ETF 구성종목 모달 — KR ETF 카드 ETF 책갈피 클릭 시 */}
      {etfDialog && (
        <EtfCompositionDialog isOpen={true}
                              ticker={etfDialog.ticker} etfName={etfDialog.name}
                              onClose={() => setEtfDialog(null)}
                              onRequestSearch={onRequestSearch} />
      )}
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
               onClick={e => handleTossLinkClick(e, quoteUrl(r.symbol))}
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
