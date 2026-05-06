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
  // Tier 0: 핵심 대시보드 (그리드 4열, 3행)
  // 1행: 한국 지수 + 환율
  { symbol: "^KS11",  name: "KOSPI",      desc: "코스피 종합 지수", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "^KS200", name: "KOSPI 200",  desc: "코스피 200 지수 — 시총 상위", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "^KQ11",  name: "KOSDAQ",     desc: "코스닥 종합 지수", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "^KQ100", name: "KOSDAQ 100", desc: "코스닥 100 지수 — 시총 상위", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "KRW=X",  name: "USD/KRW",   desc: "원달러 환율 — 수출주·외국인 수급", tier: "T0", sector: "dashboard", direction: "inverse" },
  // 2행: 미국 지수 + 야간 선물 (현물·선물 짝)
  { symbol: "^IXIC",  name: "나스닥",     desc: "미국 기술주 전체", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "NQ=F",   name: "나스닥 선물", desc: "미장 외 흐름 — 다음 한국장 영향 (24h)", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "^GSPC",  name: "S&P 500",   desc: "미국 대형주 — 글로벌 리스크 온/오프", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "ES=F",   name: "S&P 500 선물", desc: "미장 외 흐름 — 다음 한국장 영향 (24h)", tier: "T0", sector: "dashboard", direction: "direct" },
  // 3행: 반도체
  { symbol: "^SOX",   name: "필반",      desc: "필라델피아반도체 — 미국 반도체 30개사 지수", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "SOX=F",  name: "필반 선물",  desc: "PHLX 반도체 선물 — 야간 흐름", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "NVDA",   name: "NVIDIA",    desc: "AI 칩 대장 — HBM 수요", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "TSM",    name: "TSMC",      desc: "파운드리 1위 — 업황 대표", tier: "T0", sector: "dashboard", direction: "direct" },
  // 4행: 환율 + 매크로 + 외국인 투심 + 공포
  { symbol: "JPY=X",  name: "엔/달러",   desc: "USD/JPY — 한일 수출 경쟁력 (엔 약세 = 한국 불리)", tier: "T0", sector: "dashboard", direction: "neutral" },
  { symbol: "DX-Y.NYB", name: "달러 인덱스", desc: "DXY — 6개 통화 대비 달러 강도", tier: "T0", sector: "dashboard", direction: "inverse" },
  { symbol: "^TNX",   name: "미국 10Y",  desc: "미 10년 국채금리 — 외국인 수급·성장주 할인율", tier: "T0", sector: "dashboard", direction: "inverse" },
  { symbol: "EWY",    name: "EWY",       desc: "MSCI Korea — 외국인 투심", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "^VIX",   name: "VIX",       desc: "공포지수 — 20↑ 경계, 30↑ 공포", tier: "T0", sector: "dashboard", direction: "inverse" },
  // 원자재 + 비트코인 (위험자산 sentiment)
  { symbol: "GC=F",   name: "금",        desc: "Gold — 안전자산 / risk-off 지표", tier: "T0", sector: "dashboard", direction: "neutral" },
  { symbol: "SI=F",   name: "은",        desc: "Silver — 산업금속 + 안전자산 양성격", tier: "T0", sector: "dashboard", direction: "neutral" },
  { symbol: "HG=F",   name: "구리",      desc: "Dr. Copper — 글로벌 경기 선행지표", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "CL=F",   name: "WTI 원유",  desc: "국제 유가 — 정유·에너지·인플레", tier: "T0", sector: "dashboard", direction: "neutral" },
  { symbol: "NG=F",   name: "천연가스",   desc: "헨리허브 — LNG·발전·난방·화학", tier: "T0", sector: "dashboard", direction: "neutral" },
  { symbol: "BTC-USD",name: "비트코인",  desc: "위험자산 — 한국 IT/플랫폼 상관", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "^N225",  name: "닛케이 225", desc: "일본 대형주 — 아시아 sentiment", tier: "T0", sector: "dashboard", direction: "direct" },
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
