import { FundFlowCard } from "./FundFlowCard";
import { IntradayInvestorSection } from "./IntradayInvestorSection";
import { NewsFeed } from "./NewsFeed";

// 증시 탭 — 증시 자금동향(지수 차트 + 예탁금/신용/펀드) + 시간별 투자자 순매수 + 증시 뉴스. PC(App)·모바일 공용.
export function StockMarketTab() {
  return (
    <div className="space-y-3">
      <FundFlowCard />
      <IntradayInvestorSection />
      <NewsFeed />
    </div>
  );
}
