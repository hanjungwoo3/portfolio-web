import { FundFlowCard } from "./FundFlowCard";
import { NewsFeed } from "./NewsFeed";

// 증시 탭 — 증시 자금동향(지수 차트 + 예탁금/신용/펀드) + 증시 뉴스. PC(App)·모바일 공용.
export function StockMarketTab() {
  return (
    <div className="space-y-3">
      <FundFlowCard />
      <NewsFeed />
    </div>
  );
}
