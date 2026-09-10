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
      {/* 지수 공지와 거래대금을 나란히 1:2 로 — 공지는 제목 목록이라 폭이 덜 필요하고,
          거래대금은 차트 두 개라 넓어야 읽힌다.
          좁은 화면에서는 세로로 쌓인다(공지 먼저 — 지수 규칙 변경이 수급을 통째로
          흔들기 때문에 먼저 눈에 띄어야 한다. 예: 반도체지수 20% 상한 조정으로
          SK하이닉스 1.2조 매도).
          기본 stretch 라 두 카드의 높이가 맞춰진다 — 공지 쪽은 목록을 늘려 채운다. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-1"><KrxNoticeCard /></div>
        <div className="lg:col-span-2"><MarketTurnoverCard /></div>
      </div>
      <FundFlowCard />
      <IntradayInvestorSection />
      <NewsFeed />
    </div>
  );
}
