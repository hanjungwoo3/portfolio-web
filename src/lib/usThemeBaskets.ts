// 미국 테마 바스켓 — **한국 섹터 카드와 같은 이름**으로 묶는다.
//
// 왜 분류를 안 쓰고 종목을 직접 고르나:
//   TradingView 산업 분류로는 '주도 테마' 가 안 보인다. 양자컴퓨팅 4종(IONQ·RGTI·QBTS·QUBT)은
//   전부 "Computer Processing Hardware" 에 묻히고, HBM 도 CPO 도 다 "Semiconductors" 다(실측).
//   한국 카드도 같은 이유로 크롤러가 종목을 뽑아 만든 것이지 분류를 빌린 게 아니다.
//   그래서 여기도 종목을 고른다 — 대신 **주요 종목만**, 테마당 4~10개다. 전 종목 망라가 목적이
//   아니라 "오늘 어느 테마에 돈이 몰렸나" 를 보는 게 목적이다.
//
// 라벨은 한국 theme-cards.json 의 카드명을 그대로 쓴다. 이름이 같아야 두 화면을 나란히 읽는다.
//   한국에만 있는 테마(밸류업·지주사·전후재건 등)와 미국에 주도주가 없는 테마(조선·디스플레이)는
//   아예 만들지 않는다 — 빈 카드는 비교를 돕지 않는다.
//
// ⚠️ 티커가 틀리거나 상장폐지되면 그 종목만 조용히 빠진다(스캐너가 이름으로 거른다).
//   카드가 사라지지는 않으므로, 표본이 줄면 카드의 종목 수(n)로 드러난다.

export interface UsThemeBasket {
  /** 한국 카드와 동일한 라벨 */
  label: string;
  tickers: string[];
}

export const US_THEME_BASKETS: UsThemeBasket[] = [
  // ── AI·반도체 ────────────────────────────────────────────────
  { label: "반도체",        tickers: ["NVDA", "AVGO", "AMD", "TSM", "QCOM", "TXN", "ARM", "MRVL", "ADI", "INTC"] },
  { label: "HBM·메모리",    tickers: ["MU", "SNDK", "STX", "WDC"] },
  { label: "반도체 소부장",  tickers: ["AMAT", "LRCX", "KLAC", "ASML", "TER", "ENTG", "ONTO"] },
  { label: "광통신·CPO",    tickers: ["COHR", "LITE", "AAOI", "CRDO", "ANET", "FN"] },
  { label: "AI 소프트웨어",  tickers: ["PLTR", "AI", "SNOW", "NOW", "CRM"] },
  { label: "데이터센터 냉각", tickers: ["VRT", "MOD", "TT", "JCI", "CARR"] },
  { label: "양자컴퓨팅",     tickers: ["IONQ", "RGTI", "QBTS", "QUBT"] },
  { label: "로봇·피지컬AI",  tickers: ["ISRG", "ROK", "SYM", "PATH", "TER"] },
  { label: "클라우드·SI",    tickers: ["MSFT", "AMZN", "GOOGL", "ORCL", "IBM", "ACN", "NOW"] },
  { label: "메타버스·XR",    tickers: ["META", "RBLX", "U", "SNAP"] },

  // ── 에너지·전력 ──────────────────────────────────────────────
  { label: "원전·SMR",      tickers: ["CEG", "VST", "SMR", "OKLO", "LEU", "CCJ", "BWXT"] },
  { label: "전력설비·그리드", tickers: ["GEV", "ETN", "PWR", "HUBB", "AME", "EMR"] },
  { label: "태양광",        tickers: ["FSLR", "ENPH", "SEDG", "RUN", "NXT"] },
  { label: "수소",          tickers: ["PLUG", "BE", "BLDP"] },
  { label: "ESS·전력저장",   tickers: ["FLNC", "STEM", "EOSE"] },
  { label: "석유화학·정유",  tickers: ["XOM", "CVX", "COP", "PSX", "VLO", "MPC", "DOW", "LYB"] },

  // ── 모빌리티·산업 ────────────────────────────────────────────
  { label: "2차전지",       tickers: ["ALB", "QS", "ENVX", "AMPX", "SLDP"] },
  { label: "전기차·자율주행", tickers: ["TSLA", "RIVN", "LCID", "GM", "F", "MBLY"] },
  { label: "자동차부품",     tickers: ["APTV", "BWA", "LEA", "MGA"] },
  { label: "방산",          tickers: ["LMT", "RTX", "NOC", "GD", "LHX", "HII"] },
  { label: "우주항공·UAM",   tickers: ["RKLB", "ASTS", "LUNR", "JOBY", "ACHR"] },
  { label: "건설·기계",     tickers: ["CAT", "DE", "URI", "MLM", "VMC", "DHI", "LEN"] },
  // X(US Steel)는 스캐너에 없다 — 피인수로 상장폐지(실측 2026-09-17).
  { label: "철강·비철",     tickers: ["NUE", "STLD", "CLF", "FCX", "AA", "SCCO"] },
  { label: "철도·인프라",    tickers: ["UNP", "CSX", "NSC", "ACM", "J"] },
  { label: "환경·기후",     tickers: ["WM", "RSG", "WCN", "ECL"] },

  // ── 헬스케어 ────────────────────────────────────────────────
  { label: "제약·바이오",   tickers: ["LLY", "JNJ", "MRK", "PFE", "ABBV", "AMGN", "GILD", "VRTX", "REGN"] },
  { label: "비만치료제",     tickers: ["LLY", "NVO", "VKTX"] },
  { label: "의료기기·미용",  tickers: ["ISRG", "SYK", "BSX", "MDT", "ABT", "EW"] },
  { label: "헬스케어·고령화", tickers: ["UNH", "ELV", "CI", "HCA", "CVS", "HUM"] },

  // ── 소비·금융 ───────────────────────────────────────────────
  { label: "엔터·콘텐츠",    tickers: ["NFLX", "DIS", "WBD", "SPOT", "LYV"] },
  // EA 는 스캐너에 없다 — 피인수로 상장폐지(실측).
  { label: "게임",          tickers: ["TTWO", "RBLX", "U", "PLTK"] },
  { label: "여행·항공",     tickers: ["DAL", "UAL", "AAL", "LUV", "BKNG", "ABNB", "MAR", "RCL", "CCL"] },
  { label: "유통·소비",     tickers: ["WMT", "COST", "TGT", "HD", "LOW", "TJX", "DG"] },
  { label: "음식료",        tickers: ["KO", "PEP", "MDLZ", "GIS", "KHC", "HSY", "MNST"] },
  { label: "화장품",        tickers: ["EL", "ELF", "COTY", "ULTA"] },
  { label: "스마트폰·부품",  tickers: ["AAPL", "QCOM", "SWKS", "QRVO", "CRUS"] },
  { label: "통신·5G",       tickers: ["T", "VZ", "TMUS", "CSCO", "ANET", "CIEN"] },
  { label: "증권",          tickers: ["GS", "MS", "SCHW", "IBKR", "BLK", "BX", "KKR"] },
  { label: "은행·보험",     tickers: ["JPM", "BAC", "WFC", "C", "PGR", "ALL", "CB", "MET"] },
  // Fiserv 는 FISV 다 — FI 로 넣으면 조용히 빠진다(실측).
  { label: "핀테크·결제",    tickers: ["V", "MA", "PYPL", "FISV", "AXP", "SOFI", "AFRM", "HOOD"] },
  { label: "가상자산",      tickers: ["COIN", "MSTR", "MARA", "RIOT", "CLSK", "CIFR"] },
  { label: "리츠·부동산",    tickers: ["PLD", "AMT", "EQIX", "DLR", "SPG", "O", "CCI"] },
];

/** 스캐너에 한 번에 물어볼 전체 티커(중복 제거). LLY 처럼 두 테마에 걸친 종목이 있다. */
export const US_THEME_TICKERS: string[] =
  [...new Set(US_THEME_BASKETS.flatMap(b => b.tickers))];
