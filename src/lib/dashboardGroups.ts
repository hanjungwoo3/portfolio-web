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
  leadByRow?: number[];  // 줄마다 대장주 수가 다를 때(없으면 lead) — 3개인 줄은 오른쪽 해외 ETF 를 하나 줄여 8장을 맞춘다
  extras?: string[];  // 줄 끝에 붙는 '참고' 카드(국내 상장 해외 테마 ETF) — 한국 블록 뒤 따로 상자
  extraTag?: Record<string, string>;
  pairRows?: boolean; // PC 에서 줄 상자를 두 개씩 좌우로 붙여서(카드 크기는 다른 줄과 같다)
  boxesPerLine?: number;  // pairRows 일 때 한 줄에 놓을 상자 수(기본 2)
  boxLines?: number[];    // 줄마다 상자 수가 다를 때(예: [2, 3]) — boxesPerLine 보다 우선
  wide?: boolean;     // PC 에서 75%·6칸 대신 전체 폭·8칸(카드 크기는 같다) — 한 줄에 7~8장이 들어가야 할 때   // 참고 카드의 나라 이름표(없으면 "🇺🇸 미국")
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
  // 줄 안 대장주(앞 ETF 칸 뒤)를 오늘 등락률순으로 정렬할 수 있다 — 제목 옆 [등락률순|거래대금순] 전환.
  //   **줄 순서는 고정**(자리로 찾는 습관), ETF 칸도 고정(섹터 기준선). 거래대금순 = rows 에 적힌 순서.
  sortable?: boolean;
}

export type LeaderSort = "pct" | "value";
export const LEADER_SORT_KEY = "leaders_sort";   // 기본 등락률순 — 사용자 결정(2026-10-06)
export function loadLeaderSort(): LeaderSort {
  try { return localStorage.getItem(LEADER_SORT_KEY) === "value" ? "value" : "pct"; } catch { return "pct"; }
}
export function saveLeaderSort(v: LeaderSort): void {
  try { localStorage.setItem(LEADER_SORT_KEY, v); } catch { /* 이번 세션만 */ }
}
/** sortable 그룹이면 줄마다 앞 ETF 칸은 두고 나머지를 등락률 내림차순(값 없음은 뒤). 아니면 그대로. */
export function sortedRows(s: DashboardSection, sort: LeaderSort, pctOf: (sym: string) => number | null | undefined): string[][] {
  if (!s.sortable || sort !== "pct") return s.rows;
  return s.rows.map((r, i) => {
    const n = rowLead(s, i);
    const rest = r.slice(n).map((sym, k) => ({ sym, k, v: pctOf(sym) }));
    rest.sort((a, b) => (b.v ?? -Infinity) - (a.v ?? -Infinity) || a.k - b.k);
    return [...r.slice(0, n), ...rest.map(x => x.sym)];
  });
}

// 책갈피 색 — 같은 계열은 같은 색. 칩(반도체·장비) / 에너지 / 인프라(광통신·클라우드).
//   줄 안에서 색만 봐도 어디까지가 칩이고 어디부터가 에너지인지 읽힌다.
// 단계마다 색 하나 — RotationTab 의 STAGE_COLOR(순환매 '지금 어디가 강한가' 칸)와 **같은 색**이어야
//   줄 책갈피와 아래 통계 칸이 한눈에 짝지어진다. 한쪽을 바꾸면 다른 쪽도 바꿀 것.
const DEFAULT_TONE = "text-slate-700 bg-slate-50 border-slate-300/70";
const TAG_TONE: Record<string, string> = {
  반도체:   "text-indigo-700 bg-indigo-50 border-indigo-300/70",
  부품:     "text-indigo-700 bg-indigo-50 border-indigo-300/70",
  소재:     "text-indigo-700 bg-indigo-50 border-indigo-300/70",
  전공정:   "text-violet-700 bg-violet-50 border-violet-300/70",
  후공정:   "text-sky-700 bg-sky-50 border-sky-300/70",
  "CPU·기판": "text-fuchsia-700 bg-fuchsia-50 border-fuchsia-300/70",
  광통신:   "text-lime-700 bg-lime-50 border-lime-300/70",
  전력:     "text-amber-700 bg-amber-50 border-amber-300/70",
  전력기기: "text-amber-700 bg-amber-50 border-amber-300/70",
  원자력:   "text-orange-700 bg-orange-50 border-orange-300/70",
  친환경:   "text-emerald-700 bg-emerald-50 border-emerald-300/70",
  방산:     "text-teal-700 bg-teal-50 border-teal-300/70",
  "2차전지": "text-cyan-700 bg-cyan-50 border-cyan-300/70",
  로봇:     "text-rose-700 bg-rose-50 border-rose-300/70",
};
// 순환매 줄 첫 카드(미국 대장주) 배경 — 그 줄 단계 색의 옅은 판. 책갈피와 같은 계열.
const TAG_CARD: Record<string, string> = {
  반도체: "bg-indigo-50 border-indigo-300", 전공정: "bg-violet-50 border-violet-300",
  후공정: "bg-sky-50 border-sky-300", "CPU·기판": "bg-fuchsia-50 border-fuchsia-300", 광통신: "bg-lime-50 border-lime-300", 전력기기: "bg-amber-50 border-amber-300",
  원자력: "bg-orange-50 border-orange-300", 친환경: "bg-emerald-50 border-emerald-300",
  방산: "bg-teal-50 border-teal-300", "2차전지": "bg-cyan-50 border-cyan-300", 로봇: "bg-rose-50 border-rose-300",
};
export function dashboardTagCard(tag: string | undefined): string {
  return (tag && TAG_CARD[tag]) || "bg-amber-50 border-amber-300";
}
/** 그 줄의 미국 대장주 칸 수. */
export function rowLead(s: DashboardSection, i: number): number {
  return s.leadByRow?.[i] ?? s.lead ?? 0;
}
/** 순환매 같은 lead 그룹에서 이 심볼이 미국 대장주 칸이면 그 줄 번호, 아니면 -1. */
export function leadRowOf(s: DashboardSection, sym: string): number {
  if (!s.lead) return -1;
  return s.rows.findIndex((r, i) => r.slice(0, rowLead(s, i)).includes(sym));
}
/** 줄의 마지막 대장주 칸인가 — ➜ 는 여기 뒤(한국 쪽 앞)에 하나만 그린다. */
export function isLastLead(s: DashboardSection, sym: string): boolean {
  return !!s.lead && s.rows.some((r, i) => r[rowLead(s, i) - 1] === sym);
}
export function dashboardTagTone(tag: string): string {
  return TAG_TONE[tag] ?? DEFAULT_TONE;   // 광통신·AI 클라우드 등
}
// 줄 책갈피 색 — 단계 색은 **순환매 줄**(단계 = 색)에만. 상자로 나눈 그룹(pairRows: 빅테크·ETF·일본 반도체)은
//   분류 이름이 우연히 단계 이름과 같아도(소재·반도체) 색이 튀지 않게 전부 같은 회색으로.
export function dashboardRowLabelTone(section: Pick<DashboardSection, "pairRows">, label: string): string {
  return section.pairRows ? DEFAULT_TONE : dashboardTagTone(label);
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
      // 러셀2000 선물(RTY=F)은 뺐다 — S&P 선물과 0.86 으로 같이 가고, 코스닥 다음 날 상관도 나스닥 선물보다 낮다
      //   (0.23 vs 0.29, 2년 실측 2026-10-05).
      // 한 줄(PC 전체 폭 8칸) — 미국 지수 선물 셋 + 삼성·하이닉스 24h + 한국 주간선물 둘(맨 뒤 — 밤엔 빠지는 카드라 끝에 둬야 자리가 안 흔들린다)
      wide: true,
      rows: [["NQ=F", "ES=F", "SOX=F", "SKHY-PERP", "SMSN-PERP", "KORU", "^KS200N", "^KQ150N"]],
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
    // ── 지수(대장주) — 반도체 페이지에 없는 섹터를 [섹터 ETF] ➜ [대장주] 줄로. 대장주는 최근 3개월 거래대금 순(2026-10-06).
    //   순환매와 같은 줄 모양(lead = 앞 ETF 칸 수). 미국이 끄는 단계가 아니라 '섹터 한눈에' 라 미국 대장주는 없다.
    //   한 줄 8칸을 다 채운다(ETF 1 + 대장주 7, 바이오는 ETF 2 + 6) — 후보가 모자란 섹터(조선·건설·증권·인터넷)만 빈칸.
    //   ETF 거래대금이 10억 미만인 섹터(철강·에너지화학·필수소비재·게임·엔터)도 섹터 기준선으로 둔다.
    {
      id: "ldtech", short: "반도체", label: "💾 반도체·2차전지",
      sortable: true,
      lead: 1, extras: [],
      rowLabels: ["반도체", "반도체 소부장", "2차전지"],
      rows: [
        ["091160.KS", "000660.KS", "005930.KS", "009150.KS", "011070.KS", "353200.KS", "222800.KS", "007660.KS"],
        ["455850.KS", "036930.KS", "042700.KS", "240810.KS", "403870.KS", "095610.KS", "067310.KS", "319660.KS"],
        ["305720.KS", "006400.KS", "373220.KS", "086520.KS", "003670.KS", "066970.KS", "247540.KS", "348370.KS"],
      ],
    },
    {
      id: "ldpower", short: "전력·에너지", label: "⚡ 전력·에너지",
      sortable: true,
      lead: 1, extras: [],
      rowLabels: ["전력기기", "원자력", "친환경"],
      rows: [
        ["487240.KS", "010120.KS", "298040.KS", "267260.KS", "001440.KS", "062040.KS", "006260.KS", "103590.KS"],
        ["433500.KS", "034020.KS", "015760.KS", "032820.KS", "052690.KS", "083650.KS", "006910.KS", "051600.KS"],
        ["377990.KS", "475150.KS", "009830.KS", "010060.KS", "322000.KS", "112610.KS", "389260.KS", "018000.KS"],
      ],
    },
    {
      id: "ldind", short: "산업재", label: "🏭 산업재",
      sortable: true,
      lead: 1, extras: [],
      rowLabels: ["자동차", "조선", "건설", "방산", "로봇", "철강·소재", "에너지화학"],
      rows: [
        ["091180.KS", "005380.KS", "012330.KS", "000270.KS", "307950.KS", "204320.KS", "018880.KS", "011210.KS"],
        ["466920.KS", "329180.KS", "042660.KS", "010140.KS", "009540.KS", "082740.KS", "443060.KS"],
        ["117700.KS", "047040.KS", "028050.KS", "006360.KS", "000720.KS", "375500.KS", "294870.KS"],
        ["449450.KS", "012450.KS", "079550.KS", "064350.KS", "047810.KS", "272210.KS", "099320.KS"],
        ["0148J0.KS", "108490.KS", "058610.KS", "277810.KS", "454910.KS", "090360.KS", "466100.KS", "388720.KS"],
        ["117680.KS", "005490.KS", "010130.KS", "004020.KS", "103140.KS", "001430.KS", "000670.KS", "460860.KS"],
        ["117460.KS", "096770.KS", "010950.KS", "051910.KS", "011790.KS", "011780.KS", "011170.KS", "298020.KS"],
      ],
    },
    {
      id: "ldfin", short: "금융", label: "🏦 금융",
      sortable: true,
      lead: 1, extras: [],
      rowLabels: ["은행", "증권", "보험"],
      rows: [
        ["091170.KS", "105560.KS", "055550.KS", "086790.KS", "316140.KS", "024110.KS", "323410.KS", "138930.KS"],
        ["102970.KS", "006800.KS", "071050.KS", "016360.KS", "039490.KS", "005940.KS", "003540.KS"],
        ["140700.KS", "032830.KS", "000810.KS", "005830.KS", "001450.KS", "088350.KS", "000370.KS", "003690.KS"],
      ],
    },
    {
      id: "ldlife", short: "소비·헬스", label: "💊 소비·헬스",
      sortable: true,
      // 제약·바이오는 ETF 2개(액티브 190억 · KODEX 47억). 미용의료(리쥬란·톡신·슈링크·레이저) 앞 칸 = TIGER 의료기기 — 미용 전용 ETF 가 없어 가장 가까운 것(파마리서치 13%·클래시스 5% 등).
      //   거래는 적지만(일 0.7억) 이 줄 4종목 묶음과 같은 날 상관 0.83(K-뷰티 0.75·화장품 0.72). 4종목은 화장품·바이오
      //   어느 쪽보다 자기들끼리 더 붙어 다녀(0.52~0.68 vs 0.39~0.55) 흩지 않고 한 줄로 둔다.
      lead: 1, leadByRow: [2, 1, 1, 1], extras: [],
      rowLabels: ["제약·바이오", "미용의료", "화장품", "필수소비재"],
      rows: [
        ["462900.KS", "244580.KS", "196170.KS", "068270.KS", "207940.KS", "028300.KS", "141080.KS", "000100.KS"],
        ["307510.KS", "214450.KS", "145020.KS", "214150.KS", "336570.KS", "216080.KS", "200670.KS", "099430.KS"],
        ["228790.KS", "278470.KS", "161890.KS", "257720.KS", "090430.KS", "483650.KS", "192820.KS", "051900.KS"],
        ["266410.KS", "003230.KS", "033780.KS", "271560.KS", "004370.KS", "097950.KS", "005180.KS", "007310.KS"],
      ],
    },
    {
      id: "ldcont", short: "콘텐츠", label: "🎮 콘텐츠·인터넷",
      sortable: true,
      lead: 1, extras: [],
      rowLabels: ["인터넷·SW", "게임", "엔터"],
      rows: [
        ["157490.KS", "035420.KS", "035720.KS", "018260.KS", "022100.KS", "377300.KS", "030520.KS"],
        ["300950.KS", "259960.KS", "036570.KS", "263750.KS", "251270.KS", "112040.KS", "293490.KS", "462870.KS"],
        ["266360.KS", "352820.KS", "035900.KS", "041510.KS", "122870.KS", "035760.KS", "376300.KS", "253450.KS"],
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
        // 첫 줄 = 환율·달러 + 투심(EWY·VIX·MOVE), 둘째 줄 = 미 국채(2·10·30Y) + 10Y 실질금리(TIPS = DFII10).
        //   KORU(한국 3배)는 선물 그룹으로 옮겼다.
        ["KRW=X", "JPYKRW=X", "DX-Y.NYB", "EWY", "^VIX", "^MOVE"],   // MOVE = 채권판 VIX(야후)
        ["^US2Y", "^TNX", "^TYX", "^TIPS10"],                      // 명목 2·10·30Y 옆에 실질 10Y(CNBC) — 둘을 나란히 봐야 물가 탓인지 구분된다
      ],
    },
    {
      id: "semi", short: "반도체",
      label: "🔧 반도체",                             // 필반 지수 + 미국 반도체 대표주 (삼성·하이닉스 가늠자)
      // 분류별 줄 — 줄마다 왼쪽 세로 책갈피. **아래 순환매 블록에 있는 종목은 뺐다**(마이크론·샌디스크·AMD·인텔·
      //   장비 4종·ASML). 순환매에 없는 것만 남겨 한 화면에 같은 카드가 두 번 나오지 않게 한다(테스트가 지킨다).
      // 줄 상자를 좌우로 붙여 한 줄에(카드가 2~4장이라 한 줄씩이면 오른쪽이 텅 빈다)
      pairRows: true,
      //   [지수·선물 2 | 칩·파운드리 6] 한 줄(8장). 한국 24h·메모리 상자는 뺐다(24h 는 선물 그룹, 메모리는 순환매 반도체 줄에 있다).
      //   종류별 상자 [지수 2 | 설계 1 | 파운드리 1 | AI 칩 3] 한 줄(7장). 퀄컴(모바일 AP)·케이던스(설계 SW)는 뺐다 —
      //   한국 다음 날 상관 0.06~0.11 로 최하위. 대신 MPS(AI 서버 전원, 0.22~0.23). 앰코(0.25)는 순환매 후공정 대장주로.
      boxLines: [4],
      //   순서 [지수 | 설계 | 파운드리 | AI 칩 3] — 3장짜리를 끝에 둬 모바일 빈칸이 마지막 한 칸뿐(1장 줄 둘은 한 줄에).
      rowLabels: ["지수", "설계", "파운드리", "AI 칩"],
      rows: [
        ["^SOX", "SOX=F"],                                // 필라델피아 반도체 지수 · 선물
        ["ARM"],                                          // ARM(CPU 설계 — 삼성 다음 날 0.22)
        ["TSM"],                                          // TSMC ADR
        ["NVDA", "AVGO", "MPWR"],                         // 엔비디아 · 브로드컴(AI ASIC) · MPS(AI 서버 전원)
      ],
    },
    {
      id: "jpsemi", short: "일본",
      label: "🇯🇵 일본 반도체",                       // 한국장과 같은 시간에 열리는 일본 — 미국은 밤, 이건 장중 비교용
      // 종류별 상자 한 줄 [지수 1 | 메모리 1 | 소재 1 | 기판 1 | 장비 3] = 7장.
      //   고쿠사이는 뺐다 — 장비 중 한국 상관 최저(하이닉스 0.59·전공정 0.50)에 도쿄일렉트론과 0.75 로 겹친다.
      //   닛케이는 남긴다 — 한국 상관 최고(하이닉스 0.68·코스피 0.77), 도쿄일렉·어드반과 0.78~0.80 = 일본 반도체 체온계.
      //   한국 반도체와 당일 상관(1년 일봉) 0.5~0.69 — 키옥시아↔하이닉스 0.69, 디스코↔한국 장비주 0.54~0.58, 도쿄오카↔하이닉스 0.64.
      pairRows: true,
      boxLines: [5],
      //   순서 [지수 | 메모리] [소재 | 기판] [장비 3] — 3장짜리를 끝에 둬 모바일 빈칸이 마지막 한 칸뿐(1장 줄 둘은 한 줄에).
      rowLabels: ["지수", "메모리", "소재", "기판", "장비"],
      rows: [
        ["^N225"],                                      // 닛케이225
        ["285A.T"],                                     // 키옥시아(NAND)
        ["4186.T"],                                     // 도쿄오카(포토레지스트)
        ["4062.T"],                                     // 이비덴(AI 패키지 기판)
        ["8035.T", "6146.T", "6857.T"],                 // 도쿄일렉트론(전공정) · 디스코(절단·연마) · 어드반테스트(테스터)
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
      // 반도체(하이닉스 ADR)·전공정(ASML)·CPU·기판(마벨)·광통신(코히런트)만 3번째 대장주 — 3번째도 연동이 강한 줄만(데이터 우선)
      leadByRow: [3, 3, 3, 3, 3, 2, 2, 2, 1, 2, 2],
      rowLabels: ["반도체", "전공정", "후공정", "CPU·기판", "광통신", "전력기기", "원자력", "친환경", "2차전지", "방산", "로봇"],
      // 줄 = [미국 대장주 2개, 한국 섹터 ETF(모자라면 주도주)…, (국내 상장 해외 테마 ETF)].
      //   앞 두 칸 + 한국 쪽은 lib/rotation STAGES 와 같아야 한다(테스트가 대조). 맨 뒤 extras 는 참고용 —
      //   해외 ETF 라 통계엔 안 넣는다(미국 것은 하루 시차로 간밤 미국을 따라간다). 전공정·후공정은 일본 소부장 ETF.
      rows: [
        ["SNDK", "MU", "SKHY", "396500.KS", "091160.KS", "005930.KS", "000660.KS", "381180.KS"],
        ["LRCX", "AMAT", "ASML", "475300.KS", "471990.KS", "476260.KS", "0239Y0.KS", "464920.KS"],
        ["KLAC", "ONTO", "AMKR", "475310.KS", "455850.KS", "042700.KS", "095340.KS", "465660.KS"],   // 3번째 앰코 → 일본 ETF 하나(ACE, 거래대금 절반) 뺐다
        ["AMD", "INTC", "MRVL", "471760.KS", "367760.KS", "009150.KS", "007660.KS", "0225V0.KS"],
        ["LITE", "CIEN", "COHR", "0219B0.KS", "327260.KS", "010170.KS", "138080.KS", "0173Y0.KS"],
        ["PWR", "GEV", "487240.KS", "267260.KS", "0117V0.KS", "0209Z0.KS", "487230.KS", "491010.KS"],
        ["CCJ", "OKLO", "433500.KS", "0098F0.KS", "0091P0.KS", "034020.KS", "0051G0.KS", "0132H0.KS"],
        ["BE", "FSLR", "377990.KS", "009830.KS", "112610.KS", "457990.KS", "419420.KS", "419650.KS"],
        ["LIT", "305720.KS", "006400.KS", "373220.KS", "086520.KS", "394670.KS", "371460.KS"],   // 2차전지 — 미국은 LIT 하나만 끈다
        ["ITA", "RTX", "449450.KS", "0080G0.KS", "463250.KS", "012450.KS", "494840.KS", "0167Z0.KS"],   // 방산 — AI 밖이지만 미국이 끌고 온다
        ["BOTZ", "TER", "0148J0.KS", "445290.KS", "108490.KS", "277810.KS", "0038A0.KS"],   // 로봇 — 미국 로봇 ETF 가 끈다(개별주는 약함)
      ],
      // 소부장(전공정·후공정)은 맞는 미국 ETF 가 없어 일본 반도체 소부장 ETF — 일본장은 한국과 같은 시간이라 하루 시차가 없다
      extraTag: { "464920.KS": "🇯🇵 일본", "465660.KS": "🇯🇵 일본" },
      extras: ["0173Y0.KS", "464920.KS", "465660.KS", "419650.KS", "381180.KS", "0225V0.KS", "487230.KS", "491010.KS", "0051G0.KS", "0132H0.KS", "419420.KS", "494840.KS", "0167Z0.KS", "0038A0.KS", "394670.KS", "371460.KS"],
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
      // 한 줄 — 밤엔 7장이라 PC 에선 전체 폭 8칸(wide)으로 한 줄에 다 들어간다(낮엔 야간선물 둘이 빠져 5장)
      wide: true,
      rows: [["NQ=F", "ES=F", "SOX=F", "SKHY-PERP", "SMSN-PERP", "KORU", "^KS200N", "^KQ150N"]],
    },
    {
      id: "spot", short: "현물",
      label: "💵 현물 (원자재)",                        // 가격 자체가 신호
      // 한 줄(PC 전체 폭 8칸) — 금속·곡물 → 에너지 순. 암호화폐(BTC·ETH·XRP·SOL)는 뺐다.
      wide: true,
      rows: [["GC=F", "SI=F", "HG=F", "ZW=F", "CL=F", "BZ=F", "NG=F"]],
    },
    {
      id: "bigtech", short: "빅테크",
      label: "🍎 미국 빅테크",
      // 업종별 상자 — 첫 줄 [플랫폼 4 | AI 칩 2 | AI 클라우드 2], 둘째 줄 [클라우드·SW 4 | 머스크 2 | 기기 2] — 줄마다 8장.
      //   4장 상자를 왼쪽에 — 줄마다 같은 자리(4·2·2)라 상자 시작선이 위아래로 다 맞는다.
      //   엔비디아·브로드컴은 반도체 탭에도 있지만 야간 페이지엔 반도체 그룹이 없어 여기도 둔다.
      pairRows: true,
      boxLines: [3, 3],
      rowLabels: ["플랫폼", "AI 칩", "AI 클라우드", "클라우드·SW", "머스크", "기기"],
      rows: [
        ["GOOGL", "META", "AMZN", "NFLX"],   // 검색·광고·커머스·콘텐츠 — 구글·메타·아마존·넷플릭스
        ["NVDA", "AVGO"],                    // AI 칩 — 엔비디아·브로드컴
        ["CRWV", "NBIS"],                    // AI 클라우드(GPU 임대 '네오클라우드') — 코어위브·네비우스. 한국 연동은 약하다(0.2 안팎) — 미국 AI 투자 흐름용
        ["MSFT", "ORCL", "PLTR", "CRM"],     // 클라우드·기업용 AI 소프트웨어 — MS·오라클·팔란티어·세일즈포스
        ["TSLA", "SPCX"],                    // 머스크 — 테슬라·스페이스X
        ["AAPL", "DELL"],                    // 기기 — 애플 · 델(AI 서버·PC)
      ],
    },
    {
      id: "usetf", short: "ETF",
      label: "📦 미국 대표 ETF",
      // 지수 추종(SPY·QQQ·DIA·VTI·IWM)은 뺐다 — 바로 위 '미국 지수' 와 상관 0.99~1.00 으로 같은 카드였다.
      //   대신 화면에 없던 정보: 채권(금리·안전자산) · 반도체 · 개인 레버리지 심리 · 배당.
      //   SCHD 는 국내 '미국배당다우존스' ETF 들의 원본 지수라 같이 봐야 비교가 된다(ETF미국 탭).
      pairRows: true,
      boxesPerLine: 4,
      rowLabels: ["채권", "반도체", "레버리지", "배당"],
      rows: [
        ["TLT"],                             // 미국 장기국채 20년+ — 금리 하락·안전자산 수요
        ["SOXX"],                            // 미국 반도체 ETF — 야간 페이지에서 반도체 전체를 한 장으로
        ["TQQQ", "SOXL"],                    // 나스닥·반도체 3배 — 서학개미가 가장 많이 사는 ETF(개인 심리)
        ["SCHD", "JEPQ"],                    // 배당 — 배당성장(SCHD) · 나스닥 커버드콜(JEPQ)
      ],
    },
  ];
  return Object.fromEntries(sections.map(s => [s.id, s]));
}

export type DashboardPage = "day" | "night" | "semi" | "leaders";
// 지수 탭 셋 — 메뉴의 '📈 지수' 드롭다운에 들어간다. PC·모바일이 이 라벨 한 벌을 쓴다.
export const DASHBOARD_PAGES: { key: DashboardPage; emoji: string; tab: string; hint: string }[] = [
  { key: "day",   emoji: "🌞", tab: "지수(주간)",   hint: "한국장 + 미국 야간선물" },
  { key: "night", emoji: "🌙", tab: "지수(야간)",   hint: "미국장 + 한국 야간선물·24h" },
  { key: "semi",  emoji: "🔧", tab: "지수(반도체)", hint: "반도체 · 소부장 · AI 인프라 · 순환매" },
  { key: "leaders", emoji: "👑", tab: "지수(대장주)", hint: "섹터 ETF ➜ 대장주 — 산업재·금융·소비·헬스·콘텐츠" },
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
  // AI 인프라 주도주(aiinfra)는 뺐다 — 블룸에너지·루멘텀이 순환매 친환경·광통신 줄에 대장주로 있다.
  // 순환매 부가정보(rotation — 강세 묶음·다음 후보·과거 성적·일별 등락)는 뺐다. 카드 블록(rotflow)만 남긴다.
  // 반도체도 맨 아래에 공통 세트(환율·금리·투심 → 선물 → 현물). 선물은 시간 따라 주간/야간 그룹으로 바뀐다(buildDashboardPage).
  semi:  ["semi", "jpsemi", "rotflow", "krfx", "dayfut", "spot"],
  // 섹터 ETF ➜ 대장주, 모든 섹터. 맨 아래 공통 세트는 반도체 페이지와 같다.
  // 반도체·2차전지·전력도 넣는다(반도체 페이지와 겹쳐도 — 섹터 전체를 한 페이지에서 보게, 사용자 결정 2026-10-06).
  leaders: ["ldtech", "ldpower", "ldind", "ldfin", "ldlife", "ldcont", "krfx", "dayfut", "spot"],
};

// 한국 선물 가상심볼 — 같은 카드가 시간 따라 주간선물(09:00~15:45)·야간선물(18:00~05:00)이 된다.
const KR_FUT = new Set(["^KS200N", "^KQ150N"]);

/** `krNight` = 지금 한국 야간 세션인가(18:00~09:00 KST). 기본은 현재 시각 — 테스트는 직접 넘긴다. */
export function buildDashboardPage(page: DashboardPage, krNight = isKrNightNow()): DashboardSection[] {
  const m = sectionMap();
  // 반도체 페이지의 선물 자리 — 한국 밤엔 야간 그룹('밤의 한국' 선물)으로 바꿔 끼운다(이름이 시간과 맞게).
  const ids = (page === "semi" || page === "leaders") && krNight ? PAGE_IDS[page].map(id => id === "dayfut" ? "krnight" : id) : PAGE_IDS[page];
  const secs = ids.map(id => m[id]).filter((s): s is DashboardSection => !!s);
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
export const INDEX_GROUP_KEYS = new Set<string>(["__us-market__", "__idx-night__", "__idx-semi__", "__idx-leaders__"]);
export function indexPageOf(key: string): DashboardPage {
  return key === "__idx-night__" ? "night" : key === "__idx-semi__" ? "semi" : key === "__idx-leaders__" ? "leaders" : "day";
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
