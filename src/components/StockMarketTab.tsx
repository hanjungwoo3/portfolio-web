import { FundFlowCard } from "./FundFlowCard";
import { KrxNoticeCard } from "./KrxNoticeCard";
import { MarketTurnoverCard } from "./MarketTurnoverCard";
import { IntradayInvestorSection } from "./IntradayInvestorSection";
import { NewsFeed } from "./NewsFeed";

// 증시 탭 — KRX 지수 공지 + 거래대금(코스피·코스닥) + 증시 자금동향(예탁금/신용/펀드)
//   + 시간별 투자자 순매수 + 증시 뉴스.
//   PC(App)·모바일 공용 — 이 한 파일이 양쪽 증시 탭의 본문이다.
export function StockMarketTab() {
  return (
    <div className="space-y-3">
      {/* 거래대금(2) : 지수 공지(1). 거래대금은 차트 두 개라 넓어야 읽히고,
          공지는 제목 목록이라 폭이 덜 필요하다.
          기본 stretch 라 두 카드의 높이가 맞춰진다 — 공지 쪽은 목록을 늘려 채운다. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* 넓은 화면: 거래대금(2) 왼쪽 · 공지(1) 오른쪽.
            좁은 화면: order 로 공지를 위로 올린다 — 지수 규칙 변경이 수급을 흔들기 때문에
            세로로 쌓일 때는 먼저 보여야 한다. */}
        <div className="order-1 lg:order-2 lg:col-span-1"><KrxNoticeCard /></div>
        <div className="order-2 lg:order-1 lg:col-span-2"><MarketTurnoverCard /></div>
      </div>
      <FundFlowCard />
      <IntradayInvestorSection />
      <NewsFeed />
    </div>
  );
}
