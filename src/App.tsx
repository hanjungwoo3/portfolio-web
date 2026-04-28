import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { fetchTossPrices } from "./lib/api";
import { StockCard } from "./components/StockCard";
import type { Stock } from "./types";

// PoC 더미 보유 종목 — MVP 단계에서 IndexedDB 로 교체
const DEMO_STOCKS: Stock[] = [
  { ticker: "005930", name: "삼성전자", shares: 10, avg_price: 200000 },
  { ticker: "000660", name: "SK하이닉스", shares: 5, avg_price: 150000 },
  { ticker: "035420", name: "NAVER", shares: 3, avg_price: 180000 },
  { ticker: "207940", name: "삼성바이오로직스", shares: 0, avg_price: 0 },  // 관심
];

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchInterval: 30_000,  // 30초 폴링 (PoC 단계)
      refetchOnWindowFocus: true,
    },
  },
});

function PoCDashboard() {
  const tickers = DEMO_STOCKS.map(s => s.ticker);
  const { data: prices, isLoading, error } = useQuery({
    queryKey: ["toss-prices", tickers],
    queryFn: () => fetchTossPrices(tickers),
  });

  const priceMap = new Map((prices ?? []).map(p => [p.ticker, p]));

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <header className="max-w-5xl mx-auto mb-6">
        <h1 className="text-3xl font-bold text-gray-900">
          📈 포트폴리오 v3 (PoC)
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Toss API 라이브 가격 · Cloudflare Worker 프록시 경유 ·
          {prices ? ` ${prices.length}건 fetch` : " 로딩 중"}
        </p>
        {error instanceof Error && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
            <strong>fetch 실패:</strong> {error.message}<br />
            <span className="text-xs opacity-75">
              Cloudflare Worker 가 로컬에서 실행 중인지 확인 (cd workers/proxy && npx wrangler dev)
            </span>
          </div>
        )}
      </header>

      <main className="max-w-5xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {DEMO_STOCKS.map(stock => (
          <StockCard
            key={stock.ticker}
            stock={stock}
            price={priceMap.get(stock.ticker)}
            loading={isLoading}
          />
        ))}
      </main>

      <footer className="max-w-5xl mx-auto mt-10 text-center text-xs text-gray-400">
        v3 PoC · 30초 자동 갱신 · 새벽(00-08 KST) 어제 데이터 보존 ·
        {" "}브라우저 IndexedDB 저장 (MVP 단계 예정)
      </footer>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <PoCDashboard />
    </QueryClientProvider>
  );
}

export default App;
