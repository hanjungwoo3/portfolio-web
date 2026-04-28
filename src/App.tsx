import { useEffect, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider, useQueries, useQuery } from "@tanstack/react-query";
import { fetchTossPrices, fetchInvestor, fetchWarning, fetchNaverInfo } from "./lib/api";
import { loadHoldings, loadPeaks, updatePeaksForward } from "./lib/db";
import { StockCard } from "./components/StockCard";
import { Tabs, buildTabs, filterByTab, US_MARKET_TAB_KEY } from "./components/Tabs";
import { TotalRow } from "./components/TotalRow";
import { ImportJsonDialog } from "./components/ImportJsonDialog";
import { UsMarketTab } from "./components/UsMarketTab";
import { RefreshIndicator } from "./components/RefreshIndicator";
import type { Stock } from "./types";

// 모든 polling 5초로 통일 (사용자 요청)
const REFRESH_MS = 5_000;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      refetchOnWindowFocus: true,
    },
  },
});

function Dashboard() {
  const [holdings, setHoldings] = useState<Stock[]>([]);
  const [peaks, setPeaks] = useState<Map<string, number>>(new Map());
  const [activeTab, setActiveTab] = useState<string>("");
  const [importOpen, setImportOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // IndexedDB 로드
  useEffect(() => {
    void (async () => {
      const [h, p] = await Promise.all([loadHoldings(), loadPeaks()]);
      setHoldings(h);
      setPeaks(p);
    })();
  }, [reloadKey]);

  const tabs = useMemo(() => buildTabs(holdings), [holdings]);

  // 데이터 로드 후 첫 탭 자동 선택
  useEffect(() => {
    if (tabs.length > 0 && !tabs.find(t => t.key === activeTab)) {
      setActiveTab(tabs[0].key);
    }
  }, [tabs, activeTab]);

  const visible = useMemo(
    () => filterByTab(holdings, activeTab),
    [holdings, activeTab]
  );

  // 보이는 종목만 KRX 6자리 필터링 (가격 fetch 대상)
  const krxTickers = useMemo(
    () => visible
      .map(s => s.ticker)
      .filter(t => /^\d{6}$/.test(t)),
    [visible]
  );

  // 가격 — 5초 polling
  const { data: prices, dataUpdatedAt: pricesUpdatedAt } = useQuery({
    queryKey: ["prices", krxTickers],
    queryFn: () => fetchTossPrices(krxTickers),
    enabled: krxTickers.length > 0,
    refetchInterval: REFRESH_MS,
  });

  // 가격 갱신 시 피크가 forward-only 업데이트 (저장된 피크 < 현재가면 갱신)
  useEffect(() => {
    if (!prices || prices.length === 0) return;
    const priceMap = new Map(prices.map(p => [p.ticker, p.price]));
    void updatePeaksForward(priceMap).then(updated => {
      if (updated > 0) {
        // peaks 갱신됐으면 메모리 상 peaks 도 동기화
        void loadPeaks().then(setPeaks);
      }
    });
  }, [prices]);

  // 어제대비 % 내림차순 정렬 (가격 로드 후 적용; 가격 없는 종목은 맨 뒤)
  const sortedVisible = useMemo(() => {
    const map = new Map((prices ?? []).map(p => [p.ticker, p]));
    return [...visible].sort((a, b) => {
      const pa = map.get(a.ticker);
      const pb = map.get(b.ticker);
      const pctA = pa && pa.base > 0 ? (pa.price - pa.base) / pa.base : -Infinity;
      const pctB = pb && pb.base > 0 ? (pb.price - pb.base) / pb.base : -Infinity;
      return pctB - pctA;
    });
  }, [visible, prices]);

  // 종목별 수급 — 5초
  const investorQs = useQueries({
    queries: krxTickers.map(t => ({
      queryKey: ["investor", t],
      queryFn: () => fetchInvestor(t),
      refetchInterval: REFRESH_MS,
    })),
  });

  // 경고 뱃지 — 5초
  const warningQs = useQueries({
    queries: krxTickers.map(t => ({
      queryKey: ["warning", t],
      queryFn: () => fetchWarning(t),
      refetchInterval: REFRESH_MS,
    })),
  });

  // Naver info (섹터 + 컨센서스) — 5초
  const naverQs = useQueries({
    queries: krxTickers.map(t => ({
      queryKey: ["naver", t],
      queryFn: () => fetchNaverInfo(t),
      refetchInterval: REFRESH_MS,
    })),
  });

  const priceMap = useMemo(
    () => new Map((prices ?? []).map(p => [p.ticker, p])),
    [prices]
  );
  const investorMap = useMemo(
    () => new Map(investorQs.map((q, i) => [krxTickers[i], q.data ?? null])),
    [investorQs, krxTickers]
  );
  const warningMap = useMemo(
    () => new Map(warningQs.map((q, i) => [krxTickers[i], q.data ?? ""])),
    [warningQs, krxTickers]
  );
  const naverMap = useMemo(
    () => new Map(naverQs.map((q, i) => [krxTickers[i], q.data])),
    [naverQs, krxTickers]
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto flex items-center
                         gap-3 px-6 py-3">
          <h1 className="text-xl font-bold text-gray-900 shrink-0">
            📈 포트폴리오
          </h1>
          <div className="flex items-center gap-3 ml-auto">
            {pricesUpdatedAt > 0 && (
              <RefreshIndicator
                dataUpdatedAt={pricesUpdatedAt}
                refetchIntervalMs={REFRESH_MS} />
            )}
            <button
              onClick={() => setImportOpen(true)}
              className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200
                         text-gray-700 rounded text-sm">
              📥 가져오기
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-3">
        <Tabs tabs={tabs} activeKey={activeTab} onChange={setActiveTab} />

        {activeTab === US_MARKET_TAB_KEY ? (
          <UsMarketTab />
        ) : visible.length === 0 ? (
          holdings.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <div className="text-4xl mb-3">📥</div>
              <p className="mb-4">
                아직 등록된 종목이 없습니다.<br />
                holdings.json / peaks.json 을 가져와 시작하세요.
              </p>
              <button
                onClick={() => setImportOpen(true)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700
                           text-white rounded text-sm font-medium">
                JSON 가져오기
              </button>
            </div>
          ) : (
            <div className="text-center py-10 text-gray-500">
              이 탭에는 종목이 없습니다.
            </div>
          )
        ) : (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              {sortedVisible.map(stock => (
                <StockCard
                  key={`${stock.ticker}_${stock.account || ""}`}
                  stock={stock}
                  price={priceMap.get(stock.ticker)}
                  investor={investorMap.get(stock.ticker)}
                  warning={warningMap.get(stock.ticker)}
                  sector={naverMap.get(stock.ticker)?.sector}
                  consensus={naverMap.get(stock.ticker)?.consensus ?? null}
                  peak={peaks.get(stock.ticker)}
                />
              ))}
            </div>
            <TotalRow holdings={visible} prices={priceMap} />
          </>
        )}
      </main>

      <ImportJsonDialog
        isOpen={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => setReloadKey(k => k + 1)}
      />
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Dashboard />
    </QueryClientProvider>
  );
}

export default App;
