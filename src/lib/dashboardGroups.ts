import type { TabVisibility } from "./tabVisibility";

// 지수 대시보드 그룹 정의 — 데스크톱(UsMarketTab)·모바일(MobileSimpleView) 공용 단일 소스.
//
// ★ 페이지 3개 — 나라가 아니라 **지금 움직이는 시장** 으로 나눈다.
//   🌞 주간(한국장): 한국 + 미국 야간선물(한국 낮 = 미국 밤)
//   🌙 야간(미국장): 미국 + 한국 야간선물·24h
//   🔧 반도체: 반도체·소부장·AI 인프라
//   각 페이지는 **그 시간에 필요한 걸 다** 담는다 — 그래서 같은 그룹이 여러 페이지에 나온다
//   (현물·AI 단계별·섹터 등). 한 페이지만 봐도 되게 하는 게 중복을 없애는 것보다 중요하다.

export interface DashboardSection {
  id: string;         // 색인/앵커용 안정 키 (라벨 변경에 영향 안 받음)
  label: string;
  short: string;      // 색인 칩용 짧은 라벨 (이모지 제외 본문)
  rows: string[][];   // 데스크톱 줄 구분용. 모바일은 flat 으로 펼쳐 2열 렌더.
  // 모바일 2열에서 각 줄을 좌(미국)·우(한국) 짝으로 배치 — 줄이 [US...절반, KR...절반] 구성일 때.
  //   예: [SMH,PAVE,091160,117700] → 모바일 [SMH,091160, PAVE,117700] → 줄마다 미국|한국.
  mobilePair?: boolean;
  // 모바일에서도 **줄을 유지**한다(기본은 전부 펼쳐 2열로 흘림). 줄마다 의미가 있는 그룹 — 순환매처럼
  //   '미국 대장주 → 한국 종목' 이 한 줄인 경우. PC 는 원래 줄마다 그린다.
  keepRows?: boolean;
  // 줄마다 첫 카드가 '원인'(간밤 미국 대장주)이고 나머지가 '결과'(오늘 한국 종목). 첫 카드를 굵은
  //   테두리로 구분하고 오른쪽에 → 를 붙여 "이게 → 이것들" 이 한눈에 읽히게 한다.
  lead?: number;      // 줄마다 앞 N 칸이 미국 대장주(원인) — 단계색 배경 + 뒤에 ➜
  // 줄 이름(rows 와 같은 길이) — PC 는 줄 왼쪽, 모바일은 줄 위에 둔다. 줄마다 옅은 상자로 나눈다.
  rowLabels?: string[];
  // 블록 맨 위 설명 한 줄 — 이 블록을 어떻게 읽는지.
  note?: string;
  // 카드 대신 다른 블록으로 그리는 섹션. "sectorFlow" 면 ETF 랭킹의 '섹터별 흐름' 을 넣는다.
  //   랭킹 스냅샷이 없으면(캐시 없음·조회 실패) rows 의 고정 카드로 폴백한다.
  render?: "sectorFlow" | "etfTop" | "rotation";
  // 카드 오른쪽 아래 책갈피 — "이 종목이 이 그룹에서 무슨 역할인지". 심볼 → 짧은 라벨.
  //   **그룹별**로 둔다: 마이크론은 반도체 그룹에선 태그가 없고 AI 단계 줄에서만 '반도체' 다.
  tags?: Record<string, string>;
  // 제목 책갈피 옆 '자세히 →' — 이 그룹을 깊게 보는 페이지로 보낸다. vis 로 탭이 켜져 있을 때만 그린다
  //   (꺼진 탭으로 보내면 App 가드가 첫 탭으로 튕긴다 — tabNav.ts 주석).
  link?: { tab: string; vis: keyof TabVisibility };
}

// 책갈피 색 — 같은 계열은 같은 색. 칩(반도체·장비) / 에너지 / 인프라(광통신·클라우드).
//   줄 안에서 색만 봐도 어디까지가 칩이고 어디부터가 에너지인지 읽힌다.
// 단계마다 색 하나 — RotationTab 의 STAGE_COLOR(순환매 '지금 어디가 강한가' 칸)와 **같은 색**이어야
//   줄 책갈피와 아래 통계 칸이 한눈에 짝지어진다. 한쪽을 바꾸면 다른 쪽도 바꿀 것.
const TAG_TONE: Record<string, string> = {
  반도체:   "text-indigo-700 bg-indigo-50 border-indigo-300/70",
  부품:     "text-indigo-700 bg-indigo-50 border-indigo-300/70",
  소재:     "text-indigo-700 bg-indigo-50 border-indigo-300/70",
  전공정:   "text-violet-700 bg-violet-50 border-violet-300/70",
  후공정:   "text-sky-700 bg-sky-50 border-sky-300/70",
  전력:     "text-amber-700 bg-amber-50 border-amber-300/70",
  전력기기: "text-amber-700 bg-amber-50 border-amber-300/70",
  원자력:   "text-orange-700 bg-orange-50 border-orange-300/70",
  친환경:   "text-emerald-700 bg-emerald-50 border-emerald-300/70",
};
// 순환매 줄 첫 카드(미국 대장주) 배경 — 그 줄 단계 색의 옅은 판. 책갈피와 같은 계열.
const TAG_CARD: Record<string, string> = {
  반도체: "bg-indigo-50 border-indigo-300", 전공정: "bg-violet-50 border-violet-300",
  후공정: "bg-sky-50 border-sky-300", 전력기기: "bg-amber-50 border-amber-300",
  원자력: "bg-orange-50 border-orange-300", 친환경: "bg-emerald-50 border-emerald-300",
};
export function dashboardTagCard(tag: string | undefined): string {
  return (tag && TAG_CARD[tag]) || "bg-amber-50 border-amber-300";
}
/** 순환매 같은 lead 그룹에서 이 심볼이 미국 대장주 칸이면 그 줄 번호, 아니면 -1. */
export function leadRowOf(s: DashboardSection, sym: string): number {
  if (!s.lead) return -1;
  return s.rows.findIndex(r => r.slice(0, s.lead).includes(sym));
}
/** 줄의 마지막 대장주 칸인가 — ➜ 는 여기 뒤(한국 쪽 앞)에 하나만 그린다. */
export function isLastLead(s: DashboardSection, sym: string): boolean {
  return !!s.lead && s.rows.some(r => r[s.lead! - 1] === sym);
}
export function dashboardTagTone(tag: string): string {
  return TAG_TONE[tag] ?? "text-slate-700 bg-slate-50 border-slate-300/70";   // 광통신·AI 클라우드 등
}

// 섹션 정의 — id → 섹션. 페이지(PAGE_IDS)가 이 중 무엇을 어떤 순서로 쓸지 고른다.
function sectionMap(): Record<string, DashboardSection> {
  const sections: DashboardSection[] = [
    {
      id: "kr", short: "주간",
      // '한국 시장' 이었는데 미국 지수 선물까지 들어가 — 나라 대신 시간(한국 낮)으로 이름을 붙였다.
      label: "🌞 주간 시장",                           // 한국 지수 + 한국 공포 — 한 줄
      rows: [["^KS11", "^KQ11", "069500.KS", "229200.KS", "KVALUE", "VKOSPI"]],
    },
    {
      // 주간 선물 한데 모음 — 야간 페이지 '선물' 그룹과 같은 모양.
      //   첫 줄 = 미국 지수 선물(한국 낮 = 미국 밤이라 이 시간에 움직이는 미국은 선물뿐),
      //   둘째 줄 = 한국 주간선물. 야간 시간엔 이 둘이 '야간선물' 이 돼 buildDashboardPage 가 뺀다
      //   (야간 페이지 '선물' 에 있고, 거긴 반대로 낮에 뺀다).
      id: "dayfut", short: "선물",
      label: "⏳ 선물 (미국 지수 · 한국 주간)",
      rows: [["NQ=F", "ES=F", "RTY=F", "SOX=F"], ["^KS200N", "^KQ150N"]],
    },
    {
      // ETF 등락 TOP10(상승·하락) — 한국 시장 바로 아래. 레버리지·선물을 빼야 '오늘 실제로 오른 곳' 이 보인다.
      //   폴백 카드가 없어 rows 는 비어 있다(블록 자체가 그린다).
      id: "etftop", short: "ETF TOP",
      render: "etfTop",
      label: "🏅 ETF 등락 TOP10",
      rows: [],
    },
    {
      id: "sector", short: "섹터",
      // 테마별 종목 바스켓(ThemeFlow)으로 그린다. rows 의 고정 22종 ETF 는 폴백 —
      //   스냅샷이 없을 때(캐시 없음·조회 실패)만 쓰인다. ETF 가 아니라 종목이라 라벨에서 'ETF' 를 뺐다.
      render: "sectorFlow",
      label: "🌏 한·미 섹터",
      rows: [
        ["091160.KS", "0190C0.KS", "487240.KS", "445290.KS", "305720.KS", "300950.KS", "266360.KS"],             // 성장·AI·콘텐츠: 반도체·피지컬AI·AI전력설비·로봇·2차전지·게임·K콘텐츠
        ["091180.KS", "466920.KS", "117700.KS", "449450.KS", "117680.KS", "117460.KS", "433500.KS"],             // 경기민감·산업: 자동차·조선·건설·방산·철강·에너지화학·원자력
        ["091170.KS", "102970.KS", "140700.KS", "329200.KS", "244580.KS", "266420.KS", "266410.KS", "228790.KS"], // 금융·방어소비: 은행·증권·보험·리츠·바이오·헬스케어·필수소비재·화장품
      ],
    },
    {
      id: "macro", short: "미국지수",
      label: "📈 미국 지수",                          // NYSE 종합(기술주 뺀 나머지 시장) + 대표(나스닥·S&P·다우)
      // 윌셔5000(^W5000)은 뺐다 — 야후가 장중 갱신을 안 해 정규장에도 어제 값에서 멈춰
      //   종일 흐렸다(실측 2026-09-29 10:59 ET: 1,410분 전 값). 러셀3000과 상관 0.9999.
      // 러셀3000(^RUA)도 뺐다 — 시총가중이라 S&P 500 과 일간 상관 0.997·1년 +14.8% vs +15.4%
      //   (실측 2026-09-30). NYSE 종합은 남긴다 — S&P 와 0.821·나스닥 0.660, 251일 중 49일 부호가 갈린다.
      rows: [["^NYA", "^IXIC", "^GSPC", "^DJI"]],
    },
    {
      // 환율·금리·투심 — 주간·야간 **같은 한 벌**. 원달러(역외)·달러인덱스·미 국채·VIX·EWY 모두
      //   밤낮 없이 움직여 시간대별로 나눠 둘 이유가 없었다. (id 는 옛 이름 krfx 그대로)
      //   한국 국채(2·10·30Y)는 뺐다 — 하루 움직임이 작아 볼 일이 없었다.
      id: "krfx", short: "환율금리",
      label: "📊 환율·금리·투심",
      rows: [
        ["KRW=X", "JPYKRW=X", "DX-Y.NYB", "^US2Y", "^TNX", "^TYX"],
        ["EWY", "KORU", "^VIX", "^MOVE"],   // MOVE = 채권판 VIX(야후 값·차트)
      ],
    },
    {
      id: "semi", short: "반도체",
      label: "🔧 반도체",                             // 필반 지수 + 미국 반도체 대표주 (삼성·하이닉스 가늠자)
      rows: [
        ["SKHY", "SKHY-PERP", "SMSN-PERP", "KXIAY"],      // SK하이닉스 ADR·SK하이닉스 24h·삼성전자 24h 무기한선물·키오시아(NAND) — 핵심 첫줄
        ["^SOX", "TSM", "MU", "DRAM", "SNDK", "STX"],     // 지수·파운드리(필반·TSMC) + 메모리·스토리지(마이크론·DRAM ETF·샌디스크·씨게이트)
        ["NVDA", "AMD", "AVGO", "INTC", "QCOM"],          // AI·로직: 엔비디아·AMD·브로드컴·인텔·퀄컴
      ],
    },
    {
      // 소부장 — 소재·부품·장비(+후공정). 원래 '반도체 장비'(전공정 3종)였던 그룹을 넓혔다.
      //   ★ 실측(2026-09-30, 미국 직전 거래일 ↔ 한국 다음 날): 한국 소부장은 소재·부품·후공정
      //     할 것 없이 **미국 전공정 장비 3인방**에 가장 강하게 붙는다 —
      //       소재 램리서치 +0.35 · 후공정 램리서치/AMAT +0.37 · 전공정 AMAT/램리서치 +0.43.
      //     분야 매칭 미국 종목은 그보다 약하다(엔테그리스→소재 +0.26 · 온투→후공정 +0.32).
      //     예외는 부품 하나 — 울트라클린이 +0.31 로 제 분야 1위였다.
      //   그래서 전공정 3인방을 앞에 두고, 부품·후공정·소재 대표는 '폭을 보는' 참고로 옆에 붙인다.
      id: "semieq", short: "소부장",
      label: "🛠 소부장 — 소재·부품·장비",
      rows: [["AMAT", "LRCX", "ASML", "UCTT", "ONTO", "ENTG"]],
      tags: { AMAT: "전공정", LRCX: "전공정", ASML: "전공정", UCTT: "부품", ONTO: "후공정", ENTG: "소재" },
    },
    {
      // AI 데이터센터에 돈이 계속 들어오는지 보는 가늠자 — 인프라 세 축의 주도주.
      //   각 테마에서 1년 수익률·거래대금이 모두 1위인 종목을 골랐다(2026-09-30 실측):
      //   전력 BE(+300%, 거래대금 GE버노바의 5배) · 광통신 LITE(+490%) · AI 클라우드 NBIS(+117%).
      //   반도체 장비(칩을 만드는 쪽) 바로 뒤 — 칩이 들어갈 데이터센터를 짓는 쪽이다.
      id: "aiinfra", short: "AI인프라",
      label: "🔌 AI 인프라 주도주",
      rows: [["BE", "LITE", "NBIS"]],       // 전력(블룸에너지) · 광통신(루멘텀) · AI 클라우드(네비우스)
      tags: { BE: "전력", LITE: "광통신", NBIS: "AI 클라우드" },
    },
    {
      // AI 순환매 — 한국 AI 생태계가 도는 순서대로, 각 단계를 **간밤에 끌고 오는** 미국 대장주.
      //   고른 기준 = 미국 종목 '직전 거래일' 수익률 ↔ 한국 단계 바스켓 '다음 날' 수익률 상관 1위.
      //   (2026-09-30 실측, 1년 일봉) 반도체 MU +0.33 · 전공정 AMAT +0.43 · 후공정 ONTO +0.32 ·
      //   전력기기 PWR +0.35 · 원자력 CCJ +0.34 · 친환경 BE +0.32.
      //   ★ 한국 반도체엔 엔비디아(+0.13)보다 마이크론이 2.5배 더 붙는다 — 같은 메모리라서.
      //   ⚠️ **순서는 주장하지 않는다.** 월별 12개로는 '반도체 → 소부장 → 에너지' 처럼 보였지만
      //   주별 97주로 늘리니 사라졌다. 선행 상관이 0.2 를 넘는 건 '친환경 → 반도체 +0.24' 하나뿐이고,
      //   부호로 일관된 건 오히려 '에너지가 오르면 다음 주 반도체가 따라온다' 방향이다(2026-09-30).
      //   줄 안의 배치는 단계를 묶어 읽기 편하게 한 것(칩 → 장비 → 에너지)일 뿐 시간 순서가 아니다.
      //   MU·AMAT·BE 는 위 그룹에도 있다 — 단계별 대장주를 한 줄에서 비교하는 줄이라 겹쳐도 둔다.
      id: "aiflow", short: "순환매",
      label: "🔄 AI 단계별 미국 대장주",
      rows: [["MU", "AMAT", "ONTO", "PWR", "CCJ", "BE"]],   // 반도체·전공정·후공정·전력기기·원자력·친환경
      tags: { MU: "반도체", AMAT: "전공정", ONTO: "후공정", PWR: "전력기기", CCJ: "원자력", BE: "친환경" },
    },
    {
      // AI 순환매 — 간밤 미국 대장주 → 오늘 한국 단계별 종목. **지수의 다른 카드와 같은 카드**.
      //   한 블록 안에 단계마다 한 줄(옅은 상자로 나눔), 줄 왼쪽에 단계 이름(rowLabels).
      //   줄 첫 카드(미국)는 굵은 테두리 + 오른쪽 → (lead). 모바일은 폭이 좁아 단계 이름을 줄 **위**에 둔다.
      //   순서 고정: 반도체 → 전공정 → 후공정 → 전력기기 → 원자력 → 친환경.
      id: "rotflow", short: "순환매",
      label: "🔄 AI 순환매 — 간밤 🇺🇸 → 오늘 🇰🇷",
      note: "간밤 🇺🇸 미국 대장주(굵은 카드)가 움직이면 → 오늘 🇰🇷 같은 분야 한국 종목도 같은 방향으로 가는 경향이 있어요. 예측은 아닙니다.",
      lead: 2,
      rowLabels: ["반도체", "전공정", "후공정", "전력기기", "원자력", "친환경"],
      // 줄 = [미국 대장주 2개, 한국 섹터 ETF…] — lib/rotation STAGES 와 같아야 한다(테스트가 대조).
      rows: [
        ["SNDK", "MU", "396500.KS", "091160.KS", "091230.KS"],
        ["LRCX", "AMAT", "475300.KS", "471990.KS", "471760.KS"],
        ["KLAC", "ONTO", "475310.KS", "455850.KS"],
        ["PWR", "GEV", "487240.KS", "491820.KS", "0117V0.KS"],
        ["CCJ", "OKLO", "433500.KS", "0098F0.KS", "0091P0.KS"],
        ["BE", "FSLR", "377990.KS", "385510.KS", "381570.KS"],
      ],
    },
    {
      // AI 순환매 부가 정보 — 지금 강한 곳 · 다음 후보 · 흐름 · 통계(RotationTab, 접힘).
      //   메인(간밤 → 오늘 카드)은 바로 위 rotflow 그룹이 지수 카드로 그린다.
      id: "rotation", short: "순환매+",
      render: "rotation",
      label: "📊 순환매 — 흐름 · 다음 후보 · 통계",
      rows: [],
    },
    {
      // 밤에 보는 한국 — 코스피200·코스닥150 야간선물 + 하이닉스·삼성 24h + 하이닉스 ADR + 외국인 투심.
      //   미국장 동안 "내일 한국" 을 가늠하는 것들을 한 줄에 모은다.
      // 야간 선물 한데 모음 — 미국 지수 선물(거의 24h, 주간 페이지 '주간 시장' 에도 있다) +
      //   한국 야간선물 + 삼성·하이닉스 24h 무기한선물. (id 는 옛 이름 krnight 그대로)
      // EWY 는 뺐다 — 같은 페이지 맨 위 '환율·금리·투심' 에 이미 있다.
      // SK하이닉스 ADR(SKHY)도 뺐다 — 반도체 탭 '반도체' 그룹 첫 줄에 있다.
      id: "krnight", short: "선물",
      label: "⏳ 선물 (미국 지수 · 한국 야간)",
      rows: [
        ["NQ=F", "ES=F", "RTY=F", "SOX=F"],
        ["^KS200N", "^KQ150N", "SKHY-PERP", "SMSN-PERP"],
      ],
    },
    {
      id: "spot", short: "현물",
      label: "💵 현물 (원자재)",                        // 가격 자체가 신호
      // 줄 = 금속·곡물 / 에너지. 암호화폐(BTC·ETH·XRP·SOL)는 뺐다.
      rows: [
        ["GC=F", "SI=F", "HG=F", "ZW=F"],
        ["CL=F", "BZ=F", "NG=F"],
      ],
    },
    {
      id: "bigtech", short: "빅테크",
      label: "🍎 미국 빅테크",                  // 1줄=플랫폼 4대, 2줄=메타·머스크(테슬라·스페이스X)·오라클
      rows: [
        ["AAPL", "MSFT", "GOOGL", "AMZN"],   // 플랫폼 대장 — 애플·MS·구글·아마존
        ["META", "TSLA", "SPCX", "ORCL"],    // 메타 + 머스크(테슬라·스페이스X) + 오라클
      ],
    },
    {
      id: "usetf", short: "ETF",
      label: "📦 미국 대표 ETF",
      rows: [
        // 6칸 그리드에 딱 맞는 6종. SCHD 는 배당성장 대표 — 국내 '미국배당다우존스' ETF 들이
        //   전부 이 지수를 따라가서(ETF미국 탭 참조) 원본을 같이 봐야 비교가 된다.
        ["SPY", "QQQ", "DIA", "IWM", "VTI", "SCHD"],
      ],
    },
  ];
  return Object.fromEntries(sections.map(s => [s.id, s]));
}

export type DashboardPage = "day" | "night" | "semi";
// 지수 탭 셋 — 메뉴의 '📈 지수' 드롭다운에 들어간다. PC·모바일이 이 라벨 한 벌을 쓴다.
export const DASHBOARD_PAGES: { key: DashboardPage; emoji: string; tab: string; hint: string }[] = [
  { key: "day",   emoji: "🌞", tab: "지수(주간)",   hint: "한국장 + 미국 야간선물" },
  { key: "night", emoji: "🌙", tab: "지수(야간)",   hint: "미국장 + 한국 야간선물·24h" },
  { key: "semi",  emoji: "🔧", tab: "지수(반도체)", hint: "반도체 · 소부장 · AI 인프라 · 순환매" },
];

// 페이지별 구성 — **그 시간에 필요한 걸 다**. 중복 허용(한 페이지만 봐도 되게).
export const PAGE_IDS: Record<DashboardPage, string[]> = {
  // 주간·야간 모두 **맨 아래는 같은 한 세트** — 한·미 섹터 → 환율·금리·투심 → 선물 → 현물(원자재).
  //   밤낮으로 보는 것들이라 어느 페이지에서든 같은 자리에서 찾게 한다.
  day:   ["kr", "etftop", "sector", "krfx", "dayfut", "spot"],
  // 미국 지수 → 빅테크·ETF → 공통 세트(섹터·환율·선물·현물).
  //   반도체·소부장·AI 인프라·AI 단계별은 **반도체 페이지에 따로 있어** 여기선 뺀다(야간이 너무 길어졌다).
  night: ["macro", "bigtech", "usetf", "sector", "krfx", "krnight", "spot"],
  // AI 단계별 미국 대장주(aiflow)는 뺐다 — 바로 아래 순환매 블록 줄마다 첫 카드가 같은 대장주다.
  // 소부장(semieq)은 뺐다 — 순환매 블록이 전공정·소재·부품·후공정 줄로 같은 미국 장비주를 한국 종목과 이어 보여준다.
  semi:  ["semi", "aiinfra", "rotflow", "rotation"],
};

// 한국 선물 가상심볼 — 같은 카드가 시간 따라 주간선물(09:00~15:45)·야간선물(18:00~05:00)이 된다.
const KR_FUT = new Set(["^KS200N", "^KQ150N"]);

/** `krNight` = 지금 한국 야간 세션인가(18:00~09:00 KST). 기본은 현재 시각 — 테스트는 직접 넘긴다. */
export function buildDashboardPage(page: DashboardPage, krNight = isKrNightNow()): DashboardSection[] {
  const m = sectionMap();
  const secs = PAGE_IDS[page].map(id => m[id]).filter((s): s is DashboardSection => !!s);
  // 주간 페이지엔 **주간선물만**(밤엔 뺀다), 야간 페이지엔 **야간선물만**(낮엔 뺀다).
  const dropIn = page === "day" && krNight ? "dayfut" : page === "night" && !krNight ? "krnight" : null;
  if (!dropIn) return secs;
  return secs.map(s => s.id !== dropIn ? s : { ...s, rows: s.rows.map(r => r.filter(sym => !KR_FUT.has(sym))) });
}
// format.ts 의 isKrNightSession 과 같은 규칙 — lib 끼리 순환 import 를 피하려 여기서 계산한다.
function isKrNightNow(): boolean {
  const kst = new Date(Date.now() + 9 * 3600_000);
  const hm = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  return hm >= 18 * 60 || hm < 9 * 60;
}

// PC 지수 탭 키 — Tabs.tsx 의 US_MARKET_TAB_KEY · INDEX_NIGHT_TAB_KEY · INDEX_SEMI_TAB_KEY 와 **같은 문자열**.
//   (lib 이 컴포넌트를 import 하지 않게 문자열로 둔다 — 어긋나지 않게 테스트가 대조한다)
export const INDEX_GROUP_KEYS = new Set<string>(["__us-market__", "__idx-night__", "__idx-semi__"]);
export function indexPageOf(key: string): DashboardPage {
  return key === "__idx-night__" ? "night" : key === "__idx-semi__" ? "semi" : "day";
}

// 처음 열 때 페이지 — 시간으로. 한국 07~18시는 주간, 그 외는 야간. (반도체는 직접 고른다)
export function defaultDashboardPage(): DashboardPage {
  const h = new Date(Date.now() + 9 * 3600_000).getUTCHours();
  return h >= 7 && h < 18 ? "day" : "night";
}

// 색인 칩 네비게이션용 항목 — 이모지(라벨 첫 토큰) + 짧은 라벨 + 앵커 id
export interface DashboardNavItem { id: string; emoji: string; short: string; }
export function dashboardGroupNav(sections: DashboardSection[]): DashboardNavItem[] {
  return sections.map(s => ({
    id: s.id,
    emoji: s.label.split(" ")[0],   // "🌞 주간 시장" → "🌞"
    short: s.short,
  }));
}
