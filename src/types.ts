// 데스크톱 v2 holdings.json 스키마와 호환
export interface Stock {
  ticker: string;
  name: string;
  shares: number;
  avg_price: number;
  invested?: number;
  buy_date?: string;
  market?: string;
  account?: string;  // "" / "퇴직연금" / "관심" / "관심ETF" / 사용자그룹
}

export interface Price {
  ticker: string;
  price: number;       // 현재가 (또는 마지막 체결가)
  base: number;        // 전일 종가 (어제대비 기준)
  open: number;        // 시초가
  volume: number;      // 거래량
  trade_date: string;  // YYYY-MM-DD KST
  trade_dt?: string;   // ISO with offset
}
