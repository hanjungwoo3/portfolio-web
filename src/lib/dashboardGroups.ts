// 지수 대시보드 그룹 정의 — 데스크톱(UsMarketTab)·모바일(MobileSimpleView) 공용 단일 소스.
//   "한국시장 영향 관계" 기준 그룹. 데스크톱은 8열, 모바일은 2열 그리드로 같은 순서를 렌더.
//   코스피200/코스닥150 야선은 야간 세션일 때만 '야간 선물' 그룹으로 이동, 주간 세션엔 한국 시장 유지.

export interface DashboardSection {
  id: string;         // 색인/앵커용 안정 키 (라벨 변경에 영향 안 받음)
  label: string;
  short: string;      // 색인 칩용 짧은 라벨 (이모지 제외 본문)
  rows: string[][];   // 데스크톱 줄 구분용. 모바일은 flat 으로 펼쳐 2열 렌더.
  // 모바일 2열에서 각 줄을 좌(미국)·우(한국) 짝으로 배치 — 줄이 [US...절반, KR...절반] 구성일 때.
  //   예: [SMH,PAVE,091160,117700] → 모바일 [SMH,091160, PAVE,117700] → 줄마다 미국|한국.
  mobilePair?: boolean;
}

export function buildDashboardSections(nightSession: boolean): DashboardSection[] {
  const krNightFut = nightSession ? ["^KS200N", "^KQ150N"] : [];
  return [
    {
      id: "kr", short: "한국",
      label: "🇰🇷 한국 시장",                       // 본체 지수 + (주간 세션 한정)야선 + 한국 공포
      rows: [nightSession
        ? ["^KS11", "^KQ11", "069500.KS", "VKOSPI"]
        : ["^KS11", "^KQ11", "069500.KS", "^KS200N", "^KQ150N", "VKOSPI"]],
    },
    {
      id: "fx", short: "환율",
      label: "📊 환율/달러/투심",                     // 환율·달러 강도 + 외국인 투심(EWY)·공포(VIX)
      rows: [["KRW=X", "DX-Y.NYB", "EWY", "^VIX"]],
    },
    {
      id: "semi", short: "반도체",
      label: "🔧 반도체",                             // 필반 지수·선물 + 미국 반도체 대표주 (삼성·하이닉스 가늠자)
      rows: [
        ["^SOX", "SOX=F", "MU", "NVDA"],     // 필반 지수·선물 + 메모리/AI 대표
        ["AMAT", "LRCX", "ASML"],            // 반도체 장비 (AMD·브로드컴·오라클·인텔은 빅테크로 이동)
      ],
    },
    {
      id: "night", short: "야간",
      label: "🌙 야간 선물",                          // 미장 마감 후 다음 한국장 선행 신호 (+야간 세션엔 코스피/코스닥 야선)
      rows: [[...krNightFut, "NQ=F", "ES=F", "RTY=F"]],
    },
    {
      id: "macro", short: "현물",
      label: "💵 현물·매크로",                        // 가격 자체가 신호인 외부 변수
      mobilePair: true,                               // 모바일: 좌=현물(원자재·코인) / 우=지수·금리
      rows: [
        ["GC=F", "SI=F", "HG=F", "CL=F", "NG=F"],     // 원자재(금·은·구리·원유·천연가스) — 모바일 왼쪽
        ["^IXIC", "^GSPC", "^DJI", "^US2Y", "^TNX"],   // 미국 지수 + 금리 2Y·10Y — 모바일 오른쪽 (5/5 정렬: 2Y 아래 10Y)
      ],
    },
    {
      id: "bigtech", short: "빅테크",
      label: "🍎 미국 빅테크",                  // 모바일: 좌 빅테크 / 우 스페이스X+AI
      mobilePair: true,
      rows: [
        ["AAPL", "MSFT", "GOOGL", "AMZN", "META", "TSLA"],   // 빅테크 개별주
        ["SPCX", "AMD", "AVGO", "ORCL", "INTC"],             // 스페이스X + AMD·브로드컴·오라클·인텔
      ],
    },
    {
      id: "usetf", short: "ETF",
      label: "📦 미국 대표 ETF",
      rows: [
        ["SPY", "QQQ", "DIA", "IWM", "VTI"],
      ],
    },
    {
      id: "sector", short: "섹터ETF",
      label: "🧩 섹터 ETF (미국 선행 ↕ 한국)",        // 데스크톱: 위=미국·아래=한국 / 모바일: 좌 미국·우 한국
      mobilePair: true,
      rows: [
        // 반도체·건설·2차전지·바이오·은행·방산·헬스케어·피지컬AI 순 (열 정렬)
        ["SMH", "PAVE", "LIT", "XBI", "KBE", "ITA", "XLV", "KOID"],                              // 미국
        ["091160.KS", "117700.KS", "305720.KS", "244580.KS", "091170.KS", "449450.KS", "266420.KS", "0190C0.KS"], // 한국
      ],
    },
  ];
}

// 색인 칩 네비게이션용 항목 — 이모지(라벨 첫 토큰) + 짧은 라벨 + 앵커 id
export interface DashboardNavItem { id: string; emoji: string; short: string; }
export function dashboardGroupNav(sections: DashboardSection[]): DashboardNavItem[] {
  return sections.map(s => ({
    id: s.id,
    emoji: s.label.split(" ")[0],   // "🇰🇷 한국 시장" → "🇰🇷"
    short: s.short,
  }));
}
