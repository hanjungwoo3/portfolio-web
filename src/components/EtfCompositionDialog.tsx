import { useEffect } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { fetchEtfCompositions, fetchTossPrices, fetchKrPriceHistory } from "../lib/api";
import { Sparkline } from "./Sparkline";

function signColor(v: number): string {
  if (v > 0) return "text-rose-600";
  if (v < 0) return "text-blue-600";
  return "text-gray-700";
}

// ETF 구성 종목 모달 — 토스 v2 compositions endpoint
interface Props {
  isOpen: boolean;
  onClose: () => void;
  ticker: string;          // 6자리 (예: "069500")
  etfName: string;         // 표시명 (예: "KODEX 200")
}

export function EtfCompositionDialog({ isOpen, onClose, ticker, etfName }: Props) {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  const { data: items, isLoading } = useQuery({
    queryKey: ["etf-compositions", ticker],
    queryFn: () => fetchEtfCompositions(ticker),
    enabled: isOpen,
    staleTime: 10 * 60_000,   // 10분 — 구성은 자주 안 바뀜
  });

  // 구성 종목의 6자리 ticker 추출 (A005930 → 005930)
  const stockTickers = (items ?? [])
    .map(it => it.stockCode.replace(/^A/, ""))
    .filter(t => /^\d{6}$/.test(t));

  // 토스 batch 가격 (현재가/변동률)
  const { data: priceList } = useQuery({
    queryKey: ["etf-stock-prices", stockTickers],
    queryFn: () => fetchTossPrices(stockTickers),
    enabled: isOpen && stockTickers.length > 0,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const priceMap = new Map((priceList ?? []).map(p => [p.ticker, p]));

  // 3개월 sparkline (개별 호출 — chart cache 공유)
  const chartQs = useQueries({
    queries: stockTickers.map(t => ({
      queryKey: ["price-history", t, "3mo"],
      queryFn: () => fetchKrPriceHistory(t, "3mo"),
      enabled: isOpen,
      staleTime: 60 * 60_000,
    })),
  });
  const chartMap = new Map(chartQs.map((q, i) =>
    [stockTickers[i], (q.data ?? []).map(p => p.close)]));

  if (!isOpen) return null;

  const totalRatio = (items ?? []).reduce((s, it) => s + it.ratio, 0);
  const cashRatio = Math.max(0, 100 - totalRatio);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-stretch sm:items-center
                    justify-center p-0 sm:p-4 overflow-y-auto"
         onClick={onClose}>
      <div className="bg-white w-full max-w-3xl h-full sm:h-auto sm:max-h-[85vh]
                      rounded-none sm:rounded-lg shadow-xl flex flex-col my-auto"
           onClick={e => e.stopPropagation()}>
        <header className="px-4 py-3 border-b bg-gray-50 flex items-center gap-2">
          <h2 className="text-base font-bold">📋 {etfName} — 구성 종목</h2>
          <a href={`https://www.tossinvest.com/stocks/A${ticker}`}
             target="_blank" rel="noopener noreferrer"
             title="토스 ETF 페이지에서 보기"
             className="ml-auto inline-flex items-center gap-1 px-2 py-1
                        border border-blue-200 rounded
                        text-[11px] text-blue-700 bg-blue-50/50
                        hover:bg-blue-100/70">
            토스 ↗
          </a>
          <button onClick={onClose}
                  className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </header>
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {isLoading ? (
            <div className="text-center text-xs text-gray-400 py-8">불러오는 중...</div>
          ) : !items || items.length === 0 ? (
            <div className="text-center text-xs text-gray-400 py-8">구성 종목 데이터 없음</div>
          ) : (
            <>
              {/* 지수 탭 카드 스타일 — 작은 정사각형, sparkline 배경, 가격+등락률 */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5 py-1">
                {items.map((it, i) => {
                  const tNum = it.stockCode.replace(/^A/, "");
                  const price = priceMap.get(tNum);
                  const pct = price && price.base > 0
                    ? ((price.price - price.base) / price.base) * 100
                    : null;
                  const chart = chartMap.get(tNum) ?? [];
                  // 카드 배경 색 — 등락률 부호별
                  const cardBg = pct == null
                    ? "bg-white border-gray-200"
                    : pct > 0 ? "bg-rose-50 border-rose-200"
                    : pct < 0 ? "bg-blue-50/70 border-blue-200"
                    : "bg-white border-gray-200";
                  return (
                    <a key={it.stockCode}
                       href={`https://www.tossinvest.com/stocks/${it.stockCode}`}
                       target="_blank" rel="noopener noreferrer"
                       className={`block rounded-lg border px-2.5 py-2 min-h-[88px]
                                   relative overflow-hidden ${cardBg}
                                   flex flex-col justify-between
                                   hover:brightness-95 transition`}>
                      {/* 3개월 sparkline — 배경 워터마크 (카드 가득) */}
                      {chart.length > 1 && (
                        <Sparkline data={chart} width={300} height={100}
                                   className="absolute inset-0 w-full h-full opacity-30
                                              pointer-events-none" />
                      )}
                      {/* 상단: 순위 + 종목명 + 비중 */}
                      <div className="relative flex items-baseline gap-1">
                        <span className="text-[10px] text-gray-500 font-bold shrink-0">
                          {i + 1}
                        </span>
                        <span className="text-sm font-bold text-gray-900 truncate flex-1">
                          {it.name}
                        </span>
                        <span className="text-base font-bold text-gray-900/80 tabular-nums shrink-0
                                         bg-yellow-100/60 rounded px-1.5">
                          {it.ratio.toFixed(1)}%
                        </span>
                      </div>
                      {/* 하단: 가격 + 등락률 */}
                      <div className="relative flex items-baseline mt-1 text-xs tabular-nums">
                        <span className="flex-1 text-left text-gray-700">
                          {price ? price.price.toLocaleString() : "—"}
                        </span>
                        <span className={`text-right text-sm font-bold ${pct == null ? "text-gray-400" : signColor(pct)}`}>
                          {pct != null ? `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%` : ""}
                        </span>
                      </div>
                    </a>
                  );
                })}
              </div>
              <div className="px-2 py-2 text-[10px] text-gray-500 border-t border-gray-100">
                종목 {items.length}개 · 합계 {totalRatio.toFixed(1)}%
                {cashRatio > 0.5 && ` · 현금·기타 ${cashRatio.toFixed(1)}%`}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
