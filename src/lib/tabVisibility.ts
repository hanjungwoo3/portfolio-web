// 시스템 탭 (주요지수 / 반도체 / 내주식 / 컨센서스 / 섹터) 표시 여부.
// 모바일/PC 각각 별도 저장 — 디바이스 폼팩터마다 보고 싶은 탭이 다르기 때문.
// 기본값: 모두 ON. 사용자가 OFF 한 탭만 false 저장.
// 저장/불러오기(JSON)에는 포함하지 않음(디바이스별로 환경이 달라서).

export interface TabVisibility {
  stockMarket: boolean;
  usMarket: boolean;
  semiCheck: boolean;
  sectorRank: boolean;
  myStocks: boolean;
  myTrades: boolean;
  consensus: boolean;
  etfReverse: boolean;
  etfRanking: boolean;
}

const BASE_KEYS = {
  stockMarket: "portfolio_tab_stock_market",
  usMarket:   "portfolio_tab_us_market",
  semiCheck:  "portfolio_tab_semi_check",
  sectorRank: "portfolio_tab_sector_rank",
  myStocks:   "portfolio_tab_my_stocks",
  myTrades:   "portfolio_tab_my_trades",
  consensus:  "portfolio_tab_consensus",
  etfReverse: "portfolio_tab_etf_reverse",
  etfRanking: "portfolio_tab_etf_ranking",
} as const;

// 디바이스 폼팩터 — App.tsx 의 useIsMobile 과 동일 기준(width < 768)
function deviceSuffix(): "_mobile" | "_pc" {
  try {
    return typeof window !== "undefined" && window.innerWidth < 768
      ? "_mobile" : "_pc";
  } catch { return "_pc"; }
}
function deviceKey(base: string): string { return base + deviceSuffix(); }

// 새 키(디바이스별) → 옛 키(접미사 없음) 순으로 읽기 — 마이그레이션 자동 fallback.
function read(base: string): boolean {
  try {
    const v = localStorage.getItem(deviceKey(base));
    if (v !== null) return v === "1";
    const legacy = localStorage.getItem(base);
    if (legacy !== null) return legacy === "1";
    return true;
  } catch { return true; }
}
function write(base: string, v: boolean): void {
  try { localStorage.setItem(deviceKey(base), v ? "1" : "0"); }
  catch { /* noop */ }
}

export function getTabVisibility(): TabVisibility {
  return {
    stockMarket: read(BASE_KEYS.stockMarket),
    usMarket:   read(BASE_KEYS.usMarket),
    semiCheck:  read(BASE_KEYS.semiCheck),
    sectorRank: read(BASE_KEYS.sectorRank),
    myStocks:   read(BASE_KEYS.myStocks),
    myTrades:   read(BASE_KEYS.myTrades),
    consensus:  read(BASE_KEYS.consensus),
    etfReverse: read(BASE_KEYS.etfReverse),
    etfRanking: read(BASE_KEYS.etfRanking),
  };
}

export function setTabVisibility(patch: Partial<TabVisibility>): void {
  if (patch.stockMarket !== undefined) write(BASE_KEYS.stockMarket, patch.stockMarket);
  if (patch.usMarket   !== undefined) write(BASE_KEYS.usMarket,   patch.usMarket);
  if (patch.semiCheck  !== undefined) write(BASE_KEYS.semiCheck,  patch.semiCheck);
  if (patch.sectorRank !== undefined) write(BASE_KEYS.sectorRank, patch.sectorRank);
  if (patch.myStocks   !== undefined) write(BASE_KEYS.myStocks,   patch.myStocks);
  if (patch.myTrades   !== undefined) write(BASE_KEYS.myTrades,   patch.myTrades);
  if (patch.consensus  !== undefined) write(BASE_KEYS.consensus,  patch.consensus);
  if (patch.etfReverse !== undefined) write(BASE_KEYS.etfReverse, patch.etfReverse);
  if (patch.etfRanking !== undefined) write(BASE_KEYS.etfRanking, patch.etfRanking);
}

// 종목 목록 시장 분리 보기 — 코스피/코스닥/ETF 섹션으로 나눠 표시. 기본 OFF(전체보기).
const MARKET_SPLIT_KEY = "portfolio_market_split";
export function getMarketSplit(): boolean {
  try { return localStorage.getItem(MARKET_SPLIT_KEY) === "1"; }
  catch { return false; }
}
export function setMarketSplit(v: boolean): void {
  try { localStorage.setItem(MARKET_SPLIT_KEY, v ? "1" : "0"); }
  catch { /* noop */ }
}
