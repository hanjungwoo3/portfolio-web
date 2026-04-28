import { QueryClient, QueryClientProvider, useQueries, useQuery } from "@tanstack/react-query";
import { fetchTossPrices, fetchInvestor } from "./lib/api";
import { StockCard } from "./components/StockCard";
import type { Stock, Consensus } from "./types";

// PoC 더미 — MVP 단계에서 IndexedDB 로 교체
const DEMO_STOCKS: Stock[] = [
  { ticker: "005930", name: "삼성전자", shares: 10, avg_price: 200000 },
  { ticker: "000660", name: "SK하이닉스", shares: 5, avg_price: 150000 },
  { ticker: "035420", name: "NAVER", shares: 3, avg_price: 180000 },
  { ticker: "207940", name: "삼성바이오로직스", shares: 0, avg_price: 0 },
];

// 섹터 / 피크 / 컨센서스는 PoC mock — MVP 에서 Naver/Toss fetch 추가
const DEMO_SECTOR: Record<string, string> = {
  "005930": "반도체와반도체장비",
  "000660": "반도체와반도체장비",
  "035420": "양방향미디어와서비스",
  "207940": "생명과학도구및서비스",
};
const DEMO_PEAK: Record<string, number> = {
  "005930": 251500,
  "000660": 220000,
  "035420": 195000,
};
const DEMO_CONSENSUS: Record<string, Consensus> = {
  "005930": { target: 293200, score: 4.00, opinion: "매수" },
  "000660": { target: 250000, score: 4.42, opinion: "매수" },
  "035420": { target: 240000, score: 4.10, opinion: "매수" },
  "207940": { target: 1100000, score: 4.30, opinion: "매수" },
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchInterval: 30_000,
      refetchOnWindowFocus: true,
    },
  },
});

function PoCDashboard() {
  const tickers = DEMO_STOCKS.map(s => s.ticker);
  const { data: prices } = useQuery({
    queryKey: ["toss-prices", tickers],
    queryFn: () => fetchTossPrices(tickers),
  });

  // 종목별 수급 — 병렬 fetch
  const investorQueries = useQueries({
    queries: tickers.map(t => ({
      queryKey: ["toss-investor", t],
      queryFn: () => fetchInvestor(t),
      staleTime: 60_000,
      refetchInterval: 5 * 60_000,
    })),
  });

  const priceMap = new Map((prices ?? []).map(p => [p.ticker, p]));
  const investorMap = new Map(
    investorQueries.map((q, i) => [tickers[i], q.data ?? null])
  );

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <header className="max-w-6xl mx-auto mb-6">
        <h1 className="text-2xl font-bold text-gray-900">📈 포트폴리오 v3 PoC</h1>
        <p className="text-sm text-gray-500 mt-1">
          Toss 가격 + 수급 라이브 · 섹터/피크/컨센서스는 데모 mock (MVP 에서 실제 fetch)
        </p>
      </header>

      <main className="max-w-6xl mx-auto grid grid-cols-1 xl:grid-cols-2 gap-3">
        {DEMO_STOCKS.map(stock => (
          <StockCard
            key={stock.ticker}
            stock={stock}
            price={priceMap.get(stock.ticker)}
            investor={investorMap.get(stock.ticker)}
            sector={DEMO_SECTOR[stock.ticker]}
            peak={DEMO_PEAK[stock.ticker]}
            consensus={DEMO_CONSENSUS[stock.ticker]}
          />
        ))}
      </main>

      <footer className="max-w-6xl mx-auto mt-8 text-center text-xs text-gray-400">
        v3 PoC · 가격 30초 / 수급 5분 자동 갱신 · 새벽(00-08 KST) 어제 데이터 보존
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
