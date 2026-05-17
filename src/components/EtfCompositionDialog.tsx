import { useEffect } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { fetchEtfCompositions, fetchTossPrices, fetchKrPriceHistory, fetchKrRegularPrices } from "../lib/api";
import { loadHoldings } from "../lib/db";
import { Sparkline } from "./Sparkline";
import { formatSigned, signColor } from "../lib/format";

// ETF 구성 종목 모달 — 토스 v2 compositions endpoint
interface Props {
  isOpen: boolean;
  onClose: () => void;
  ticker: string;          // 6자리 (예: "069500")
  etfName: string;         // 표시명 (예: "KODEX 200")
  onRequestSearch?: (query: string) => void;  // "+추가" 클릭 시 SearchDialog 오픈
}

export function EtfCompositionDialog({ isOpen, onClose, ticker, etfName, onRequestSearch }: Props) {
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

  // Yahoo .KS quote — 정규장 종가/등락률 (StockCard 의 krReg 와 동일 데이터)
  const { data: krRegMap } = useQuery({
    queryKey: ["etf-kr-reg-prices", stockTickers],
    queryFn: () => fetchKrRegularPrices(stockTickers),
    enabled: isOpen && stockTickers.length > 0,
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
  });

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

  // 보유 holdings — ticker → 속한 그룹 목록
  const { data: holdings } = useQuery({
    queryKey: ["holdings-for-etf-modal"],
    queryFn: loadHoldings,
    enabled: isOpen,
    staleTime: 30_000,
  });
  const holdingGroups = new Map<string, string[]>();
  for (const h of holdings ?? []) {
    const arr = holdingGroups.get(h.ticker) ?? [];
    const acc = (h.account ?? "").trim() || "보유";
    if (!arr.includes(acc)) arr.push(acc);
    holdingGroups.set(h.ticker, arr);
  }

  if (!isOpen) return null;

  // "그 외" / "기타" — 카드 표시 제외하고 합계 라인에만 비중 표기
  const isOtherCategory = (name: string) => name === "그 외" || name === "기타";
  const visibleItems = (items ?? []).filter(it => !isOtherCategory(it.name));
  const otherRatio = (items ?? []).filter(it => isOtherCategory(it.name))
                                  .reduce((s, it) => s + it.ratio, 0);
  // 합계 — 표시 종목들만 (그 외 제외)
  const visibleRatio = visibleItems.reduce((s, it) => s + it.ratio, 0);
  const totalRatio = visibleRatio + otherRatio;
  const cashRatio = Math.max(0, 100 - totalRatio);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-stretch sm:items-center
                    justify-center p-0 sm:p-4 overflow-y-auto"
         onClick={onClose}>
      <div className="bg-white w-full max-w-3xl h-full sm:h-auto sm:max-h-[95vh]
                      rounded-none sm:rounded-lg shadow-xl flex flex-col my-auto"
           onClick={e => e.stopPropagation()}>
        <header className="px-4 py-3 border-b bg-gray-50 flex items-center gap-2 flex-wrap">
          <h2 className="text-base font-bold">
            📋 {etfName} — {visibleItems.length > 0 ? `구성종목 top ${visibleItems.length}` : "구성 종목"}
          </h2>
          {/* 한번에 추가하기 — 모든 종목 코드를 SearchDialog 로 prefill */}
          {onRequestSearch && stockTickers.length > 0 && (
            <button onClick={() => onRequestSearch(stockTickers.join(" "))}
                    title="모든 구성 종목을 검색창에 한번에 추가"
                    className="inline-flex items-center gap-1 px-2 py-1
                               border border-emerald-300 rounded
                               text-[11px] font-bold text-emerald-700 bg-emerald-50
                               hover:bg-emerald-100">
              ✅ 한번에 추가
            </button>
          )}
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
              {/* StockCard 패턴 — 가로 작게(3열), 세로 크게(min-h-[120px]), gap-y 충분히 */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-2 gap-y-5 pt-3 pb-2">
                {visibleItems.map((it, i) => {
                  const tNum = it.stockCode.replace(/^A/, "");
                  const isStandard = /^\d{6}$/.test(tNum);
                  const price = priceMap.get(tNum);
                  const chart = chartMap.get(tNum) ?? [];
                  const krReg = krRegMap?.get(tNum);

                  // StockCard 와 동일한 계산 (line 545-565)
                  // dayDiff/dayPct — 어제대비 표시용 (price.base, 비거래일 자동 0%)
                  const dayDiff = price ? price.price - price.base : 0;
                  const dayPct = price && price.base > 0 ? (dayDiff / price.base) * 100 : 0;
                  // colorDiff/colorPct — 색상 결정용 (price.prevClose, 비거래일에도 색 유지)
                  const colorDiff = price ? price.price - (price.prevClose || price.price) : 0;
                  const priceColorCls = colorDiff > 0 ? "text-rose-600"
                    : colorDiff < 0 ? "text-blue-600"
                    : "text-gray-900";

                  // 마감 책갈피 — StockCard 와 동일 (krReg 사용 + 조건)
                  const showRegTag = krReg && krReg.regularPrice !== price?.price
                                     && (price?.price ?? 0) > 0
                                     && Math.abs(krReg.regularPrice - (price?.price ?? 0)) / (price?.price ?? 1) < 0.15;
                  const regTagBg = !krReg ? "bg-white/20 border-gray-300/20"
                    : krReg.regularPct > 0 ? "bg-rose-100/20 border-rose-300/20"
                    : krReg.regularPct < 0 ? "bg-blue-100/20 border-blue-300/20"
                    : "bg-white/20 border-gray-300/20";

                  const groups = holdingGroups.get(tNum) ?? [];
                  const isHeld = groups.length > 0;
                  // 종목명 탭 색 — colorDiff 부호 (StockCard priceColorCls 와 동일)
                  const tabBg = colorDiff > 0 ? "bg-rose-50 border-rose-300"
                    : colorDiff < 0 ? "bg-blue-50/70 border-blue-300"
                    : "bg-white border-gray-300";
                  return (
                    <div key={`${it.stockCode || "x"}-${i}`}
                         className={`group ${isStandard ? "" : "opacity-60"}`}>
                      {/* 책갈피 라인 — 종목명 탭 (좌) + 보유/+ (우). 외부 감싸는 박스 위로 빠져나옴 */}
                      <div className="flex items-end justify-between gap-1 mx-1">
                        <div className="flex items-end gap-0.5 flex-wrap min-w-0">
                          <button onClick={isStandard
                                    ? () => window.open(`https://www.tossinvest.com/stocks/${it.stockCode}`, "_blank")
                                    : undefined}
                                  disabled={!isStandard}
                                  className={`inline-flex items-center px-2 py-0.5 rounded-t-md
                                              border-t border-l border-r font-bold text-sm leading-none
                                              ${tabBg} ${priceColorCls}
                                              ${isStandard ? "cursor-pointer hover:brightness-95 transition" : ""}`}
                                  title={isStandard ? undefined : `${it.name} — 선물·기타 (추가 불가)`}>
                            <span className="text-[10px] text-gray-500 mr-1">{i + 1}</span>
                            {it.name}
                          </button>
                        </div>
                        <div className="flex items-end gap-0.5">
                          {isHeld && groups.map(g => (
                            <span key={g} title={`보유 그룹: ${g}`}
                                  className="px-1.5 py-0.5 rounded-t-md shadow-sm text-[10px] font-bold leading-none
                                             bg-emerald-100 text-emerald-800 border-t border-l border-r border-emerald-300">
                              {g}
                            </span>
                          ))}
                          {onRequestSearch && isStandard && (
                            <button onClick={e => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      onRequestSearch(tNum);
                                    }}
                                    title={`${it.name} (${tNum}) 추가하기`}
                                    className="px-1.5 py-0.5 rounded-t-md text-[10px] font-bold leading-none
                                               bg-blue-50 text-blue-700 border-t border-l border-r border-blue-300
                                               hover:bg-blue-100">
                              +
                            </button>
                          )}
                        </div>
                      </div>
                      {/* 외부 감싸는 박스 — 카드 본체 + 책갈피들을 다 감쌈 */}
                      <div className="border border-gray-300 rounded-lg bg-gray-100/60 px-1.5 pt-3 pb-1.5 relative">
                      {/* 가격 박스 컨테이너 — StockCard 1083 그대로 */}
                      <div className="relative w-full h-full">
                        {/* 마감 책갈피 — StockCard 1084-1106 그대로 (krReg 조건 동일) */}
                        {showRegTag && krReg && (
                          <div className={`absolute -top-2 left-1 z-10 px-1.5 py-0
                                           border rounded text-[10px] leading-tight whitespace-nowrap ${regTagBg}`}>
                            <span className="text-gray-500">마감 </span>
                            <span className="text-gray-800 tabular-nums">
                              {Math.round(krReg.regularPrice).toLocaleString()}
                            </span>
                            <span className={`tabular-nums ml-1 font-bold ${signColor(krReg.regularPct)}`}>
                              ({krReg.regularPct >= 0 ? "+" : ""}{krReg.regularPct.toFixed(2)}%)
                            </span>
                          </div>
                        )}
                        {/* 비중 책갈피 — 배경/보더만 30% 투명, 글자는 진하게 */}
                        <div className="absolute -top-2 right-1 z-10 bg-violet-50/30 border border-violet-300/30
                                        rounded px-1.5 py-0 leading-tight
                                        flex items-baseline gap-0.5">
                          <span className="text-[10px] text-violet-700">비중</span>
                          <span className="font-bold text-violet-800 text-sm tabular-nums">
                            {it.ratio.toFixed(1)}%
                          </span>
                        </div>
                        {/* 가격 박스 본체 — 가로 작게/세로 높게 (StockCard 와 유사 높이) */}
                        <div className="relative overflow-hidden border border-gray-200 rounded-md
                                        bg-gray-50/60 px-2 py-1 space-y-0.5 w-full min-h-[120px]
                                        flex flex-col justify-center">
                          {chart.length > 1 && (
                            <Sparkline data={chart} width={300} height={120}
                                       className="absolute inset-0 w-full h-full opacity-20
                                                  pointer-events-none" />
                          )}
                          {/* 현재가 + 등락률 — StockCard 1157-1196 그대로 (화살표는 ETF 카드엔 불필요 → invisible 들여쓰기만) */}
                          <div className="relative z-10">
                            <div className="flex items-baseline gap-2">
                              <span className="text-xl font-bold leading-tight invisible">▲</span>
                              <span className={`text-xl font-bold leading-tight tabular-nums ${priceColorCls}`}>
                                {price ? `${price.price.toLocaleString()}원` : "—"}
                              </span>
                            </div>
                            <div className={`flex items-baseline gap-1 pl-6 font-bold ${signColor(dayDiff)}`}>
                              <span className="text-lg leading-tight bg-yellow-100 rounded px-1 tabular-nums">
                                {dayPct >= 0 ? "+" : ""}{dayPct.toFixed(2)}%
                              </span>
                              <span className="text-xs font-normal text-gray-700 tabular-nums">
                                ({formatSigned(dayDiff)}원)
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                      </div>{/* /외부 감싸는 박스 */}
                    </div>
                  );
                })}
                {/* 합계 정보 — 마지막 그리드 셀 우하단에 가로 한 줄, 흐리게 */}
                <div className="col-start-2 sm:col-start-3 flex items-end justify-end
                                px-2 pb-2 text-xs text-gray-400 tabular-nums whitespace-nowrap">
                  종목 <span className="font-bold text-gray-500 mx-0.5">{visibleItems.length}개</span> ·
                  합계 <span className="font-bold text-gray-500 mx-0.5">{visibleRatio.toFixed(1)}%</span>
                  {otherRatio > 0.01 && (
                    <> · 그 외 <span className="font-bold text-gray-500 ml-0.5">{otherRatio.toFixed(1)}%</span></>
                  )}
                  {cashRatio > 0.5 && (
                    <> · 현금·기타 <span className="font-bold text-gray-500 ml-0.5">{cashRatio.toFixed(1)}%</span></>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
