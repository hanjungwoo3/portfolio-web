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

// krClosed=true (한국 정규장 마감 → 카드 흐림) 이면 한국 관련 그룹(한국 시장·한국 섹터 ETF·반도체 TOP2+)을
//   맨 아래로 내림 — 마감 후엔 움직이는 미국/야간 지표를 위로.
export function buildDashboardSections(nightSession: boolean, krClosed = false): DashboardSection[] {
  const krNightFut = nightSession ? ["^KS200N", "^KQ150N"] : [];
  const sections: DashboardSection[] = [
    {
      id: "kr", short: "한국",
      label: "🇰🇷 한국 시장",                       // 본체 지수 + (주간 세션 한정)야선 + 한국 공포
      rows: [nightSession
        ? ["^KS11", "^KQ11", "069500.KS", "VKOSPI"]
        : ["^KS11", "^KQ11", "^KS200N", "^KQ150N", "069500.KS", "VKOSPI"]],
    },
    {
      id: "sector", short: "섹터ETF",
      label: "🧩 한국 섹터 ETF",                       // 한국 대표 섹터 ETF 21종 — 오늘 등락률(%) 내림차순 정렬(UsMarketTab/MobileSimpleView), 섹터 순위 차트와 동일 종목
      rows: [
        ["091160.KS", "0190C0.KS", "445290.KS", "305720.KS", "300950.KS", "266360.KS"],                          // 성장·AI·콘텐츠: 반도체·피지컬AI·로봇·2차전지·게임·K콘텐츠
        ["091180.KS", "466920.KS", "117700.KS", "449450.KS", "117680.KS", "117460.KS", "434730.KS"],             // 경기민감·산업: 자동차·조선·건설·방산·철강·에너지화학·원자력
        ["091170.KS", "102970.KS", "140700.KS", "329200.KS", "244580.KS", "266420.KS", "266410.KS", "228790.KS"], // 금융·방어소비: 은행·증권·보험·리츠·바이오·헬스케어·필수소비재·화장품
      ],
    },
    {
      id: "semitop2", short: "TOP2",
      label: "🏆 반도체 TOP2+ ETF",                    // 삼성·하이닉스 집중 반도체 TOP2/HBM 테마 ETF 비교
      rows: [
        ["395160.KS", "395270.KS", "0167A0.KS", "0210A0.KS", "442580.KS"],   // KODEX AI반도체TOP2플러스·HANARO Fn K-반도체·SOL AI반도체TOP2플러스·ACE K반도체TOP2+·PLUS 글로벌HBM반도체
      ],
    },
    {
      id: "fx", short: "환율",
      label: "📊 환율/달러/투심",                     // 환율·달러 강도 + 외국인 투심(EWY)·공포(VIX)
      rows: [["KRW=X", "DX-Y.NYB", "EWY", "^VIX"]],
    },
    {
      id: "semi", short: "반도체",
      label: "🔧 반도체",                             // 필반 지수 + 미국 반도체 대표주 (삼성·하이닉스 가늠자)
      rows: [
        ["^SOX", "MU", "NVDA", "SNDK", "AMD", "AVGO", "INTC", "QCOM"],   // 지수 + 메모리·AI + 로직·CPU 한 줄
      ],
    },
    {
      id: "semieq", short: "장비",
      label: "🛠 반도체 장비",                         // 칩 제조 장비 — 삼성·하이닉스 CAPEX·증설 가늠자
      rows: [["AMAT", "LRCX", "ASML"]],     // 어플라이드머티리얼즈·램리서치·ASML
    },
    {
      id: "night", short: "야간",
      label: "🌙 야간 선물",                          // 미장 마감 후 다음 한국장 선행 신호 (+야간 세션엔 코스피/코스닥 야선, 필반선물 SOX=F)
      rows: [[...krNightFut, "NQ=F", "ES=F", "RTY=F", "SOX=F"]],
    },
    {
      id: "spot", short: "현물",
      label: "💵 현물 (원자재)",                       // 금·은·구리·원유·천연가스 — 가격 자체가 신호
      rows: [["GC=F", "SI=F", "HG=F", "CL=F", "NG=F"]],
    },
    {
      id: "macro", short: "매크로",
      label: "📈 미국 지수·금리",                      // 나스닥·S&P + 미 국채 2Y·10Y + 다우
      rows: [["^IXIC", "^GSPC", "^US2Y", "^TNX", "^DJI"]],
    },
    {
      id: "bigtech", short: "빅테크",
      label: "🍎 미국 빅테크",                  // 플랫폼 + 머스크 + 오라클 (한 줄)
      rows: [
        ["AAPL", "MSFT", "GOOGL", "AMZN", "META", "TSLA", "SPCX", "ORCL"],   // 플랫폼 + 머스크(테슬라·스페이스X) + 오라클 한 줄
      ],
    },
    {
      id: "usetf", short: "ETF",
      label: "📦 미국 대표 ETF",
      rows: [
        ["SPY", "QQQ", "DIA", "IWM", "VTI"],
      ],
    },
  ];
  if (krClosed) {
    const krIds = new Set(["kr", "sector", "semitop2"]);   // 한국 관련 그룹 → 맨 아래(상대 순서 유지)
    return [...sections.filter(s => !krIds.has(s.id)), ...sections.filter(s => krIds.has(s.id))];
  }
  return sections;
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
