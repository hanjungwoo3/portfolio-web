// 데스크톱 v2 fetch_us_indices_with_futures 의 pairs 리스트 그대로 이식
// + ETFS_BY_SECTOR 매핑 그대로

export type Tier = "T0" | "T1" | "T2";

export interface Pair {
  symbol: string;       // Yahoo 심볼 (^GSPC, NVDA, KRW=X 등)
  name: string;         // 표시명
  desc: string;         // 부가 설명
  future?: string;      // 대응 선물 심볼 (있으면)
  tier: Tier;
  sector: string;
  direction: "direct" | "inverse" | "neutral";
  // 토스 미국 종목 코드 — 24시간 ECN Overnight 가격 추적용 (Yahoo postMarketPrice 보다 최신)
  tossUsCode?: string;
}

// Yahoo 심볼 → 토스 미국 종목 코드 매핑 (24시간 가격용)
export const TOSS_US_CODE: Record<string, string> = {
  "MU":   "US19890516001",
  "NVDA": "US19990122001",
  "AMAT": "US19721012001",
  "LRCX": "US19840504001",
  "ASML": "US19950315001",
};

export const US_PAIRS: Pair[] = [
  // Tier 0: 핵심 대시보드 — 데스크탑은 UsMarketTab T0_SECTIONS(한국시장 영향 관계) 기준으로 그룹 표시
  // 행 1 — 한국 지수 (맨 위)
  { symbol: "^KS11",    name: "KOSPI",       desc: "코스피 종합 지수", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "^KS200N",  name: "코스피200 야간선물", desc: "yasun.gg · 18:00~05:00 KST", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "069500.KS", name: "KODEX 200",  desc: "KOSPI 200 추종 ETF — 실물 매매 가능", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "^KQ11",    name: "KOSDAQ",      desc: "코스닥 종합 지수", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "^KQ150N",  name: "코스닥150 야간선물", desc: "yasun.gg · 18:00~05:00 KST", tier: "T0", sector: "dashboard", direction: "direct" },
  // 행 2 — 환율 + 매크로 + 외국인 투심 + 공포
  { symbol: "KRW=X",    name: "달러환율",     desc: "USD/KRW 원달러 환율 — 수출주·외국인 수급", tier: "T0", sector: "dashboard", direction: "inverse" },
  { symbol: "DX-Y.NYB", name: "달러 인덱스",  desc: "DXY — 6개 통화 대비 달러 강도", tier: "T0", sector: "dashboard", direction: "inverse" },
  { symbol: "^US2Y",    name: "미국 2Y",     desc: "미 2년 국채금리 — Fed 정책금리 기대. 10Y 보다 높으면(역전) 침체 신호", tier: "T0", sector: "dashboard", direction: "inverse" },
  { symbol: "^TNX",     name: "미국 10Y",    desc: "미 10년 국채금리 — 외국인 수급·성장주 할인율·시장 벤치마크", tier: "T0", sector: "dashboard", direction: "inverse" },
  { symbol: "EWY",      name: "EWY",         desc: "MSCI Korea — 외국인 투심", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "^VIX",     name: "VIX",         desc: "공포지수 — 20↑ 경계, 30↑ 공포", tier: "T0", sector: "dashboard", direction: "inverse" },
  { symbol: "VKOSPI",   name: "V-KOSPI",     desc: "코스피200 변동성지수 — 한국 공포지수 (20↑ 경계, 30↑ 공포). investing.com", tier: "T0", sector: "dashboard", direction: "inverse" },
  // 행 2 — 원자재 + 위험자산
  { symbol: "GC=F",     name: "금",          desc: "Gold — 안전자산 / risk-off 지표", tier: "T0", sector: "dashboard", direction: "neutral" },
  { symbol: "SI=F",     name: "은",          desc: "Silver — 산업금속 + 안전자산 양성격", tier: "T0", sector: "dashboard", direction: "neutral" },
  { symbol: "HG=F",     name: "구리",        desc: "Dr. Copper — 글로벌 경기 선행지표", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "CL=F",     name: "WTI 원유",    desc: "국제 유가 — 정유·에너지·인플레", tier: "T0", sector: "dashboard", direction: "neutral" },
  { symbol: "NG=F",     name: "천연가스",     desc: "헨리허브 — LNG·발전·난방·화학", tier: "T0", sector: "dashboard", direction: "neutral" },
  { symbol: "BTC-USD",  name: "비트코인",    desc: "위험자산 — 한국 IT/플랫폼 상관", tier: "T0", sector: "dashboard", direction: "direct" },
  // 행 3 — 미국 지수 + 야간 선물 + 닛케이 + 반도체 (필반·필반선물)
  { symbol: "^IXIC",    name: "나스닥",      desc: "미국 기술주 전체", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "NQ=F",     name: "나스닥 선물",  desc: "미장 외 흐름 — 다음 한국장 영향 (24h)", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "^GSPC",    name: "S&P 500",     desc: "미국 대형주 — 글로벌 리스크 온/오프", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "ES=F",     name: "S&P 500 선물", desc: "미장 외 흐름 — 다음 한국장 영향 (24h)", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "^DJI",     name: "다우존스",     desc: "다우 30 산업평균 — 미국 대형 우량주", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "RTY=F",    name: "러셀2000 선물", desc: "E-mini Russell 2000 선물 — 미국 소형주 야간 흐름 (24h)", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "^SOX",     name: "필라델피아반도체", desc: "미국 반도체 30개사 평균 지수", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "SOX=F",    name: "필라델피아반도체 선물", desc: "야간 24시간 거래 — 다음 정규장 가격 미리 가늠", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "MU",       name: "마이크론",     desc: "Micron — 미국 메모리 반도체 (삼성·하이닉스 직접 경쟁사·메모리 사이클 가늠자)", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "NVDA",     name: "엔비디아",     desc: "Nvidia — AI 수요 대표주. MU 와 동행이면 메모리 사이클 동조화 신호", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "AMAT",     name: "어플라이드머티리얼즈", desc: "반도체 식각·증착 장비 회사 — AI 메모리 생산 설비 투자 가늠자", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "LRCX",     name: "램리서치",     desc: "Lam Research — 식각·증착 장비. HBM 핵심 공정", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "ASML",     name: "ASML",        desc: "EUV 노광 독점 — 첨단 반도체 공정 필수", tier: "T0", sector: "dashboard", direction: "direct" },
  // AI 반도체·인프라 대표주 (NVDA 는 위 메모리/AI 줄)
  { symbol: "AMD",      name: "AMD",         desc: "AMD — CPU·GPU. NVDA 의 AI 가속기 경쟁자", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "AVGO",     name: "브로드컴",     desc: "Broadcom — AI 네트워킹·커스텀 실리콘(ASIC). NVDA 다음 AI 핵심", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "ORCL",     name: "오라클",       desc: "Oracle — 클라우드(OCI)·AI 캐펙스 수혜", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "INTC",     name: "인텔",         desc: "Intel — CPU·파운드리. 미국 반도체 심리 게이지", tier: "T0", sector: "dashboard", direction: "direct" },
  // 행 3.5 — 미국 빅테크 개별주 (Mag7 + 스페이스X, NVDA 는 반도체 줄에 있음). 가격·링크 모두 토스.
  { symbol: "AAPL",     name: "애플",         desc: "Apple — 아이폰·서비스. 미국 시총 1위급 소비 가늠자", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "MSFT",     name: "마이크로소프트", desc: "Microsoft — 클라우드(Azure)·AI(코파일럿). 엔터프라이즈 대표", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "GOOGL",    name: "알파벳",       desc: "Alphabet(구글) — 검색·유튜브·클라우드·제미나이", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "AMZN",     name: "아마존",       desc: "Amazon — 이커머스·AWS 클라우드", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "META",     name: "메타",         desc: "Meta — 광고·SNS·AI 인프라 투자", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "TSLA",     name: "테슬라",       desc: "Tesla — 전기차·로보택시·에너지", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "SPCX",     name: "스페이스X",    desc: "SpaceX (SPCX) — 우주 발사·스타링크. NASDAQ 상장 주식", tier: "T0", sector: "dashboard", direction: "direct" },
  // 행 4 — 미국 대표 ETF
  { symbol: "SPY",      name: "SPY",         desc: "SPDR S&P 500 — 미국 대형주 추종", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "QQQ",      name: "QQQ",         desc: "Invesco NASDAQ 100 — 미국 대형 기술주", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "DIA",      name: "DIA",         desc: "SPDR Dow Jones 30 — 미국 대형주 30선", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "IWM",      name: "IWM",         desc: "iShares Russell 2000 — 미국 소형주", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "VTI",      name: "VTI",         desc: "Vanguard Total Stock Market — 미국 전체", tier: "T0", sector: "dashboard", direction: "direct" },
  // 행 6 — 미국 섹터 ETF (KODEX 줄과 짝 매칭 — 같은 순서)
  { symbol: "SMH",   name: "SMH",   desc: "VanEck 반도체 — NVDA·TSM·AMD 등", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "PAVE",  name: "PAVE",  desc: "Global X 미국 인프라 — 건설·소재·기계", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "LIT",   name: "LIT",   desc: "Global X 리튬·배터리", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "XBI",   name: "XBI",   desc: "SPDR 바이오테크 — 중소형 바이오", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "KBE",   name: "KBE",   desc: "SPDR S&P 은행 — 지역은행 포함", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "ITA",   name: "ITA",   desc: "iShares 미국 항공우주·방산 (Lockheed, RTX 등)", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "XLV",   name: "XLV",   desc: "Health Care Select — 미국 대형 헬스케어", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "KOID",  name: "피지컬AI", desc: "KraneShares 휴머노이드·피지컬AI — 액추에이터(Harmonic Drive·THK)·반도체 글로벌 밸류체인. 한국 로봇주(레인보우로보틱스·두산로보틱스·에스피지) 선행 가늠자", tier: "T0", sector: "dashboard", direction: "direct" },
  // 행 7 — 한국 섹터 KODEX ETF (대표 1개씩, .KS suffix → Yahoo 통해 일관 fetch)
  { symbol: "091160.KS", name: "KODEX 반도체",     desc: "한국 반도체 ETF — 삼성·하이닉스 대표", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "117700.KS", name: "KODEX 건설",       desc: "한국 건설주 ETF — 현대건설/삼성물산/GS건설", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "305720.KS", name: "KODEX 2차전지",    desc: "2차전지 산업 ETF — LG·SK", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "244580.KS", name: "KODEX 바이오",     desc: "한국 바이오 ETF", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "091170.KS", name: "KODEX 은행",       desc: "한국 은행주 ETF", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "449450.KS", name: "K-방산",         desc: "한국 방산 ETF — 한화에어로/LIG넥스원/KAI/현대로템", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "266420.KS", name: "KODEX 헬스케어",    desc: "한국 헬스케어 ETF", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "0190C0.KS", name: "RISE 피지컬AI",    desc: "RISE 현대차고정피지컬AI — 현대차 25% + 국내 피지컬AI 밸류체인(LG CNS·현대오토에버·두산로보틱스·레인보우로보틱스·에스피지). 미국 KOID 선행에 대응하는 한국 타깃", tier: "T0", sector: "dashboard", direction: "direct" },
];

export const ETFS_BY_SECTOR: Record<string, string[]> = {};

// KR ETF 이름 — Toss API 가 name 을 반환 안 해 하드코딩
export const ETF_NAMES: Record<string, string> = {};

export const SECTOR_EMOJI: Record<string, string> = {
  반도체: "🔧", 방산: "🛡️", 중공업: "🚢", 리츠: "🏢",
  에너지: "⚡", 자동차: "🚗", 건설: "🏗️", 금융: "💰",
  플랫폼: "📱", 바이오: "🧬", 로봇: "🤖", 한국지수: "🇰🇷",
};

// 섹터 표시 순서 (전체 통합 — 모두 T0 대시보드로)
export const SECTOR_ORDER: string[] = [];

// yasun.gg 에서 가져오는 야선 가상 심볼 — Yahoo 배치에서 제외해야 함
const YASUN_VIRTUAL = new Set<string>(["^KS200N", "^KQ150N"]);

// 모든 Yahoo 심볼 한 번에 fetch 하기 위한 평탄화 (현물 + 선물)
export function allYahooSymbols(): { symbol: string; name: string }[] {
  const result: { symbol: string; name: string }[] = [];
  for (const p of US_PAIRS) {
    if (YASUN_VIRTUAL.has(p.symbol)) continue;   // yasun 별도 fetch
    result.push({ symbol: p.symbol, name: p.name });
    if (p.future) {
      result.push({ symbol: p.future, name: `${p.name} 선물` });
    }
  }
  return result;
}

// 모든 KR ETF 6자리 코드
export function allKrEtfTickers(): string[] {
  const set = new Set<string>();
  for (const arr of Object.values(ETFS_BY_SECTOR)) {
    for (const t of arr) set.add(t);
  }
  return Array.from(set);
}
