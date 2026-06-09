// 지수 대시보드 그룹 정의 — 데스크톱(UsMarketTab)·모바일(MobileSimpleView) 공용 단일 소스.
//   "한국시장 영향 관계" 기준 그룹. 데스크톱은 8열, 모바일은 2열 그리드로 같은 순서를 렌더.
//   코스피200/코스닥150 야선은 야간 세션일 때만 '야간 선물' 그룹으로 이동, 주간 세션엔 한국 시장 유지.

export interface DashboardSection {
  label: string;
  rows: string[][];   // 데스크톱 줄 구분용. 모바일은 flat 으로 펼쳐 2열 렌더.
  // 모바일 2열에서 각 줄을 좌(미국)·우(한국) 짝으로 배치 — 줄이 [US...절반, KR...절반] 구성일 때.
  //   예: [SMH,PAVE,091160,117700] → 모바일 [SMH,091160, PAVE,117700] → 줄마다 미국|한국.
  mobilePair?: boolean;
}

export function buildDashboardSections(nightSession: boolean): DashboardSection[] {
  const krNightFut = nightSession ? ["^KS200N", "^KQ150N"] : [];
  return [
    {
      label: "🇰🇷 한국 시장",                       // 본체 지수 + (주간 세션 한정)야선 + 한국 공포
      rows: [nightSession
        ? ["^KS11", "^KQ11", "069500.KS", "VKOSPI"]
        : ["^KS11", "^KQ11", "069500.KS", "^KS200N", "^KQ150N", "VKOSPI"]],
    },
    {
      label: "📊 환율/달러/투심",                     // 환율·달러 강도 + 외국인 투심(EWY)·공포(VIX)
      rows: [["KRW=X", "DX-Y.NYB", "EWY", "^VIX"]],
    },
    {
      label: "🔧 반도체",                             // 필반 지수·선물 + 미국 반도체 대표주 (삼성·하이닉스 가늠자)
      rows: [
        ["^SOX", "SOX=F", "MU", "NVDA"],     // 필반 지수·선물 + 메모리/AI 대표
        ["AMAT", "LRCX", "ASML"],            // 반도체 장비
      ],
    },
    {
      label: "🌙 야간 선물",                          // 미장 마감 후 다음 한국장 선행 신호 (+야간 세션엔 코스피/코스닥 야선)
      rows: [[...krNightFut, "NQ=F", "ES=F", "RTY=F"]],
    },
    {
      label: "💵 현물·매크로",                        // 가격 자체가 신호인 외부 변수
      rows: [
        ["^IXIC", "^GSPC", "^DJI", "^FVX", "^TNX", "^TYX"],     // 미국 지수 현물 + 미국 국채금리 커브(5/10/30Y)
        ["GC=F", "SI=F", "HG=F", "CL=F", "NG=F", "BTC-USD"],    // 원자재(현물격) + 코인
      ],
    },
    {
      label: "📦 미국 대표 ETF",
      rows: [["SPY", "QQQ", "DIA", "IWM", "VTI"]],
    },
    {
      label: "🧩 섹터 ETF (미국 ↔ 한국 페어)",        // 한 줄 = 미국 2 + 짝 한국 2 (모바일은 좌 미국·우 한국)
      mobilePair: true,
      rows: [
        ["SMH", "PAVE", "091160.KS", "117700.KS"],     // 반도체 · 건설
        ["LIT", "XBI", "305720.KS", "244580.KS"],      // 2차전지 · 바이오
        ["KBE", "ITA", "091170.KS", "449450.KS"],      // 은행 · 방산
        ["XLV", "KOID", "266420.KS", "0190C0.KS"],     // 헬스케어 · 피지컬AI
      ],
    },
  ];
}
