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

// 종목별 메모 — ticker 기준 (계좌 무관, 같은 종목 여러 그룹에 있어도 메모는 1개 공유)
export type MemoColor = "red" | "yellow" | "green" | "blue" | "purple" | "gray";

// 목표가/손절가의 % 환산 기준 가격 — 다이얼로그 표시용 (저장값은 항상 절대가격)
export type MemoPriceBasis = "current" | "avg";

export interface Memo {
  ticker: string;            // PK
  text?: string;             // 자유 텍스트 (최대 2000자)
  targetPrice?: number;      // 목표가 (양수, 절대가격) — 보유 종목 매도 목표
  stopPrice?: number;        // 손절가 (양수, 절대가격) — 보유 종목 손절 기준
  entryPrice?: number;       // 기대가 (양수, 절대가격) — 미보유/관심 종목의 매수 희망가
  priceBasis?: MemoPriceBasis;  // % 입력 시 사용한 기준 — 없으면 "current" 로 동작
  tag?: string;              // 짧은 라벨 (최대 12자)
  color?: MemoColor;         // 색상 라벨
  updatedAt: string;         // ISO 8601
}
