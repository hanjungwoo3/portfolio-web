// 데스크톱 v2 holdings.json 스키마 호환
export interface Stock {
  ticker: string;
  name: string;
  shares: number;
  avg_price: number;
  invested?: number;
  buy_date?: string;
  market?: string;
  account?: string;
}

export interface Price {
  ticker: string;
  price: number;
  base: number;        // "어제대비" 표시용 — 비거래일엔 price 와 동일 (= 0)
  prevClose: number;   // 직전 거래일 종가 — 색상 결정용 (비거래일 보정 영향 없음)
  open: number;
  volume: number;
  trade_date: string;
  trade_dt?: string;
  high?: number;       // 오늘 고가
  low?: number;        // 오늘 저가
}

// 토스 수급 — 데스크톱 v2 fetch_investor_flow 와 동일 키
export interface Investor {
  date?: string;
  개인: number;
  외국인: number;        // 순매수량
  기관: number;
  연기금: number;
  금융투자: number;
  투신: number;
  사모: number;
  보험: number;
  은행: number;
  기타금융: number;
  기타법인: number;
  외국인비율: number;    // 보유율 %
}

export interface Consensus {
  target?: number;       // 목표주가
  opinion?: string;      // 투자의견 텍스트
  score?: number;        // 1.0~5.0 (5=강력매수)
}
