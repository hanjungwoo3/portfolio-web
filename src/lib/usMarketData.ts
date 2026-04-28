// 데스크톱 v2 fetch_us_indices_with_futures 의 pairs 리스트 그대로 이식
// + ETFS_BY_SECTOR 매핑 그대로

export type Tier = "T0" | "T1" | "T2";

export interface Pair {
  symbol: string;       // Yahoo 심볼 (^GSPC, NVDA, KRW=X 등)
  name: string;         // 표시명
  desc: string;         // 부가 설명
  future?: string;      // 대응 선물 심볼 (있으면)
  tier: Tier;
  sector: string;       // dashboard / 반도체 / 방산 / 중공업 / 리츠 / 에너지 / 자동차 / 건설 / 금융 / 플랫폼 / 바이오 / 로봇 / 한국지수
  direction: "direct" | "inverse" | "neutral";
}

export const US_PAIRS: Pair[] = [
  // Tier 0: 핵심 대시보드
  { symbol: "EWY",    name: "EWY",       desc: "MSCI Korea — 외국인 투심", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "KRW=X",  name: "USD/KRW",   desc: "원달러 환율 — 수출주·외국인 수급", tier: "T0", sector: "dashboard", direction: "inverse" },
  { symbol: "^VIX",   name: "VIX",       desc: "공포지수 — 20↑ 경계, 30↑ 공포", tier: "T0", sector: "dashboard", direction: "inverse" },
  { symbol: "^GSPC",  name: "S&P 500",   desc: "미국 대형주 — 글로벌 리스크 온/오프", future: "ES=F", tier: "T0", sector: "dashboard", direction: "direct" },

  // Tier 1: 내 섹터
  // 🔧 반도체
  { symbol: "^SOX",   name: "필라델피아반도체", desc: "미국 반도체 30개사 지수", future: "SOX=F", tier: "T1", sector: "반도체", direction: "direct" },
  { symbol: "NVDA",   name: "NVIDIA",    desc: "AI 칩 대장 — HBM 수요", tier: "T1", sector: "반도체", direction: "direct" },
  { symbol: "TSM",    name: "TSMC",      desc: "파운드리 1위 — 업황 대표", tier: "T1", sector: "반도체", direction: "direct" },
  // 🛡️ 방산
  { symbol: "LMT",    name: "Lockheed Martin", desc: "방산 대장 — 글로벌 방산 경기", tier: "T1", sector: "방산", direction: "direct" },
  // 🚢 중공업/조선
  { symbol: "CAT",    name: "Caterpillar", desc: "중장비 — 경기 사이클 선행", tier: "T1", sector: "중공업", direction: "direct" },
  { symbol: "HG=F",   name: "구리",      desc: "Dr. Copper — 글로벌 경기 선행지표", tier: "T1", sector: "중공업", direction: "direct" },
  // 🏢 리츠
  { symbol: "^TNX",   name: "미국 10Y",  desc: "10년물 국채금리 — 리츠·성장주 할인율", future: "ZN=F", tier: "T1", sector: "리츠", direction: "inverse" },
  { symbol: "VNQ",    name: "Vanguard REIT", desc: "미국 리츠 ETF — 부동산 투심", tier: "T1", sector: "리츠", direction: "direct" },
  // ⚡ 에너지
  { symbol: "CL=F",   name: "WTI 원유",  desc: "국제 유가 — 정유·에너지 직결", tier: "T1", sector: "에너지", direction: "neutral" },
  { symbol: "NG=F",   name: "천연가스",  desc: "헨리허브 — LNG·발전·난방", tier: "T1", sector: "에너지", direction: "neutral" },

  // Tier 2: 관심 섹터
  { symbol: "TSLA",   name: "Tesla",     desc: "EV 대장 — 자동차·2차전지 선행", tier: "T2", sector: "자동차", direction: "direct" },
  { symbol: "DHI",    name: "D.R. Horton", desc: "미국 최대 주택건설사", tier: "T2", sector: "건설", direction: "direct" },
  { symbol: "JPM",    name: "JPMorgan",  desc: "미국 금융 대장 — 은행주 투심", tier: "T2", sector: "금융", direction: "direct" },
  { symbol: "^IXIC",  name: "나스닥",    desc: "미국 기술주 전체", future: "NQ=F", tier: "T2", sector: "플랫폼", direction: "direct" },
  { symbol: "META",   name: "Meta",      desc: "플랫폼 대장 — 광고·AI", tier: "T2", sector: "플랫폼", direction: "direct" },
  { symbol: "XBI",    name: "SPDR Biotech", desc: "미국 바이오 ETF", tier: "T2", sector: "바이오", direction: "direct" },
  { symbol: "BOTZ",   name: "BOTZ",      desc: "Global X 로봇·AI ETF — 로봇 섹터 대표", tier: "T2", sector: "로봇", direction: "direct" },
  { symbol: "^N225",  name: "닛케이 225", desc: "일본 대형주 — 아시아 센티멘트", future: "NKD=F", tier: "T2", sector: "한국지수", direction: "direct" },
  { symbol: "^KS200", name: "KOSPI 200", desc: "코스피 200 지수", tier: "T2", sector: "한국지수", direction: "direct" },
  { symbol: "^KQ11",  name: "KOSDAQ",    desc: "코스닥 지수", tier: "T2", sector: "한국지수", direction: "direct" },
];

export const ETFS_BY_SECTOR: Record<string, string[]> = {
  반도체:   ["091160", "091230"],
  방산:     ["449450"],
  중공업:   ["446770"],
  리츠:     ["329200"],
  에너지:   [],
  자동차:   ["091180"],
  건설:     ["117700"],
  금융:     ["091170"],
  플랫폼:   ["365040"],
  바이오:   ["143860"],
  로봇:     ["445290"],
  한국지수: ["122630", "229200"],
};

export const SECTOR_EMOJI: Record<string, string> = {
  반도체: "🔧", 방산: "🛡️", 중공업: "🚢", 리츠: "🏢",
  에너지: "⚡", 자동차: "🚗", 건설: "🏗️", 금융: "💰",
  플랫폼: "📱", 바이오: "🧬", 로봇: "🤖", 한국지수: "🇰🇷",
};

// 섹터 표시 순서 (T1 먼저, 그 다음 T2)
export const SECTOR_ORDER: string[] = [
  "반도체", "방산", "중공업", "리츠", "에너지",          // T1
  "자동차", "건설", "금융", "플랫폼", "바이오", "로봇", "한국지수",  // T2
];

// 모든 Yahoo 심볼 한 번에 fetch 하기 위한 평탄화 (현물 + 선물)
export function allYahooSymbols(): { symbol: string; name: string }[] {
  const result: { symbol: string; name: string }[] = [];
  for (const p of US_PAIRS) {
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
