// 공시 분류·잡음 거르기 — 컨센서스 탭 '📋 최신공시'(보유 종목 전체 공시 목록, 사용자 요청 2026-10-28
//   "필요 없는 공시는 최대한 거르고"). 제목만 보고 정한다(네이버 공시 목록은 제목·시각만 준다).
//   noise = 기본 숨김('중요만' 끄면 보인다) — 매일·매번 반복되는 행정·ETF·파생 안내.

export type DiscCat = "실적" | "배당" | "자사주" | "계약" | "증자·CB" | "지분" | "IR" | "합병·분할" | "소송·제재" | "해명" | "정정" | "기타";
export const DISC_CATS: DiscCat[] = ["실적", "배당", "자사주", "계약", "증자·CB", "지분", "IR", "합병·분할", "소송·제재", "해명", "정정", "기타"];

const RULES: [DiscCat, RegExp][] = [
  ["실적", /잠정\)\s*실적|결산실적|매출액또는손익구조|손익구조|영업\(잠정\)|실적\s*(발표|공시)/],
  ["배당", /배당|주주명부폐쇄/],
  ["자사주", /자기주식|자사주|주식소각|소각\s*결정/],
  ["계약", /공급계약|판매ㆍ공급|판매·공급|수주|계약\s*체결|양수도|투자\s*판단\s*관련\s*주요경영사항/],
  ["증자·CB", /유상증자|무상증자|전환사채|신주인수권부사채|교환사채|신주발행|감자|주식관련사채/],
  ["지분", /대량보유|최대주주|주식등의\s*대량|특정증권등소유|소유상황보고|지분|타법인주식/],
  ["IR", /기업설명회|IR\)/],
  ["합병·분할", /합병|분할|영업양수|영업양도|자산양수|자산양도|주식교환|주식이전|공개매수/],
  ["소송·제재", /소송|횡령|배임|불성실|제재|과징금|거래정지|상장폐지|관리종목|투자주의|투자경고|투자위험|감사의견/],
  ["해명", /풍문|보도|조회공시/],
];

// 기본으로 숨길 잡음 — 매일 반복되거나 투자 판단과 거리가 먼 행정 공시
const NOISE: RegExp[] = [
  /ETF\s*기타시장안내|ETN|상장지수|집합투자|투자설명서|신탁계약|수익증권/,      // ETF·ETN 운용 안내
  /주식선물|주식옵션|가격제한폭/,                                                  // 파생 가격제한폭 확대요건 도달
  /임원ㆍ주요주주특정증권등소유상황보고서|임원·주요주주\s*특정증권등\s*소유상황보고서|특정증권등소유상황보고서/,   // 임원 소유 보고(건수 많음)
  /증권발행실적보고서|기업지배구조보고서|대규모기업집단|동일인등출자계열|계열회사\s*변경|특수관계인/,
  /주주총회\s*소집공고|참고서류|의결권대리행사|사외이사의\s*선임|정관변경/,
  /기재정정.*(사업보고서|분기보고서|반기보고서)|사업보고서|분기보고서|반기보고서|감사보고서제출/,
];

export function classifyDisclosure(title: string): { cat: DiscCat; noise: boolean; corrected: boolean } {
  const t = title.replace(/\s+/g, " ");
  const corrected = /^\s*\[?\(?\s*(기재)?정정/.test(t) || /\(정정\)/.test(t);
  const hit = RULES.find(([, re]) => re.test(t));
  const noise = NOISE.some(re => re.test(t)) && !/잠정\)\s*실적|결산실적|손익구조|배당|자기주식|공급계약|유상증자|전환사채|합병|분할|최대주주/.test(t);
  return { cat: hit ? hit[0] : corrected ? "정정" : "기타", noise, corrected };
}

// 종류별 색 — 줄의 종류 표시와 위쪽 종류 필터 버튼이 같은 색(사용자 요청 2026-10-28 "각각 색을 다르게, 상단 버튼도")
//   tag = 연한 바탕+진한 글자(줄 표시·꺼진 버튼), on = 진한 바탕+흰 글자(켜진 버튼)
export const DISC_CAT_TONE: Record<DiscCat, { tag: string; on: string }> = {
  실적:      { tag: "bg-rose-100 text-rose-700 border-rose-200",       on: "bg-rose-600 text-white border-rose-600" },
  배당:      { tag: "bg-emerald-100 text-emerald-700 border-emerald-200", on: "bg-emerald-600 text-white border-emerald-600" },
  자사주:    { tag: "bg-sky-100 text-sky-700 border-sky-200",          on: "bg-sky-600 text-white border-sky-600" },
  계약:      { tag: "bg-indigo-100 text-indigo-700 border-indigo-200", on: "bg-indigo-600 text-white border-indigo-600" },
  "증자·CB": { tag: "bg-orange-100 text-orange-700 border-orange-200", on: "bg-orange-600 text-white border-orange-600" },
  지분:      { tag: "bg-violet-100 text-violet-700 border-violet-200", on: "bg-violet-600 text-white border-violet-600" },
  IR:        { tag: "bg-teal-100 text-teal-700 border-teal-200",       on: "bg-teal-600 text-white border-teal-600" },
  "합병·분할": { tag: "bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200", on: "bg-fuchsia-600 text-white border-fuchsia-600" },
  "소송·제재": { tag: "bg-red-200 text-red-800 border-red-300",        on: "bg-red-700 text-white border-red-700" },
  해명:      { tag: "bg-amber-100 text-amber-800 border-amber-200",    on: "bg-amber-500 text-white border-amber-500" },
  정정:      { tag: "bg-slate-200 text-slate-700 border-slate-300",    on: "bg-slate-600 text-white border-slate-600" },
  기타:      { tag: "bg-gray-100 text-gray-600 border-gray-200",       on: "bg-gray-600 text-white border-gray-600" },
};
