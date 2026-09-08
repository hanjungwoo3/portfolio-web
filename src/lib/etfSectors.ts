// ETF 랭킹 → 섹터 묶음. 828종 전수 랭킹을 이름으로 분류해 "오늘 어느 섹터가 가는가"를 만든다.
//
// 왜 이름으로 분류하나 — 구성종목으로 나누면 정확하지만 ETF 당 1콜씩 828콜이다.
//   랭킹은 이미 받아온 데이터라 추가 호출이 0 이어야 의미가 있다. 그래서 이름 규칙으로 나눈다.
//   한계는 분명하다: 이름과 내용이 다른 ETF 는 틀린다(예: RISE 피지컬AI 는 현대차·기아·모비스가
//   51% 라 사실상 자동차 ETF). 그런 건 OVERRIDE 에 코드로 박아 바로잡는다.
//
// 순서가 규칙이다 — 위에서부터 처음 걸리는 곳으로 간다.
//   자산군(채권·통화·원자재·해외)을 국내 테마보다 먼저 본다. 안 그러면
//   "TIGER 미국반도체" 가 국내 반도체로, "ACE 미국SMR원자력TOP10" 이 국내 원자력으로 섞인다.

import type { EtfRankRow } from "./etfRanking";

export type SectorKind = "sector" | "asset";   // 국내 업종·테마 / 그 밖의 자산군

export interface SectorDef {
  key: string;
  label: string;
  kind: SectorKind;
  re: RegExp;
}

// 이름과 내용이 어긋나는 ETF — 구성종목을 실제로 확인하고 바로잡은 것만 넣는다.
//   (2026-09-07 토스 구성 조회 기준. 근거 없는 추측으로 채우지 말 것)
const OVERRIDE: Record<string, string> = {
  "0190C0": "auto",    // RISE 피지컬AI — 현대차 24%·기아 14%·현대모비스 13% (자동차 51%)
  "433500": "nuclear", // ACE 원자력TOP10 — 두산에너빌리티 26%, 다만 건설(현대건설 22%)과 39% 겹침
};

// ── 자산군 먼저 ────────────────────────────────────────────────────────────────
const ASSET_DEFS: SectorDef[] = [
  // 채권을 맨 위에 — "단기선진하이일드" 처럼 해외 이름이 섞인 채권형이 해외주식으로 새지 않게.
  { key: "bond",     label: "채권·금리",  kind: "asset", re: /채권|국채|국고채|통안|물가채|금리|회사채|크레딧|하이일드|CD ?금리|KOFR|머니마켓|MMF|단기자금|파킹|만기매칭|국공채|하이인컴|주식혼합|혼합자산/ },
  { key: "fx",       label: "통화",       kind: "asset", re: /달러|엔화|위안|유로화|환율/ },
  { key: "commod",   label: "원자재·금",  kind: "asset", re: /금현물|골드|은현물|실버|원유|구리|니켈|원자재|농산물|천연가스|팔라듐|백금/ },
  { key: "crypto",   label: "가상자산",   kind: "asset", re: /비트코인|이더리움|가상자산|디지털자산|스테이블코인/ },
  // 해외는 지역별로 쪼갠다 — 240종을 한 칸에 몰면 "오늘 뭐가 갔나" 를 못 읽는다.
  { key: "us",       label: "미국",       kind: "asset", re: /미국|나스닥|S&P|SNP|다우|러셀|필라델피아/ },
  { key: "china",    label: "중국·홍콩",  kind: "asset", re: /차이나|중국|항셍|홍콩|CSI|상해|심천/ },
  { key: "japan",    label: "일본",       kind: "asset", re: /일본|닛케이|TOPIX/ },
  { key: "overseas", label: "기타 해외",  kind: "asset", re: /글로벌|선진국|신흥국|인도|베트남|유럽|유로스톡스|유로스탁스|스탁스|브라질|멕시코|대만|아시아|월드|라틴|MSCI(?! Korea)/ },
];

// ── 국내 업종·테마 ─────────────────────────────────────────────────────────────
//   구체적인 테마를 위에, 넓은 업종을 아래에 둔다("AI" 같은 넓은 말이 먼저 먹지 않게).
const SECTOR_DEFS: SectorDef[] = [
  { key: "semi",     label: "반도체",      kind: "sector", re: /반도체|메모리|HBM|파운드리|소부장|시스템반도체/ },
  { key: "nuclear",  label: "원자력·SMR",  kind: "sector", re: /원자력|원전|SMR/ },
  { key: "power",    label: "AI전력·전력설비", kind: "sector", re: /전력설비|전력기기|AI전력|전선|그리드|에너지인프라|변압기/ },
  { key: "ship",     label: "조선",        kind: "sector", re: /조선|해양플랜트/ },
  { key: "defense",  label: "방산·우주항공", kind: "sector", re: /방산|국방|K-?방산|우주|항공우주/ },
  { key: "battery",  label: "2차전지",     kind: "sector", re: /2차전지|이차전지|배터리|리튬|양극재|음극재/ },
  { key: "robot",    label: "로봇·AI",     kind: "sector", re: /로봇|피지컬AI|자동화|인공지능|AI/ },
  { key: "auto",     label: "자동차",      kind: "sector", re: /자동차|모빌리티|전기차|자율주행/ },
  { key: "build",    label: "건설·인프라",  kind: "sector", re: /건설|건자재|인프라|리모델링/ },
  { key: "steel",    label: "철강·소재",   kind: "sector", re: /철강|비철|소재|시멘트/ },
  { key: "machine",  label: "기계·산업재",  kind: "sector", re: /기계|장비|중공업|산업재|공작/ },
  { key: "chem",     label: "화학·에너지",  kind: "sector", re: /화학|정유|에너지|태양광|수소|신재생|풍력/ },
  { key: "bio",      label: "바이오·헬스케어", kind: "sector", re: /바이오|헬스|제약|의료|시밀러|의료기기/ },
  { key: "content",  label: "IT·인터넷·콘텐츠", kind: "sector", re: /인터넷|게임|콘텐츠|미디어|엔터|플랫폼|웹툰|K-?팝|소프트웨어|클라우드|보안|\bIT\b|5G|e-?커머스|이커머스/ },
  { key: "consume",  label: "소비재·화장품", kind: "sector", re: /화장품|뷰티|소비재|음식료|식품|유통|리테일|여행|레저/ },
  { key: "finance",  label: "금융",        kind: "sector", re: /은행|증권|보험|금융|카드|핀테크/ },
  { key: "reit",     label: "리츠·부동산",  kind: "sector", re: /리츠|부동산/ },
  { key: "transport", label: "운송·물류",  kind: "sector", re: /운송|물류|해운|택배/ },
  { key: "dividend", label: "배당",        kind: "sector", re: /배당|밸류업|우선주/ },
  { key: "holding",  label: "지주",        kind: "sector", re: /지주/ },
  { key: "group",    label: "그룹주",      kind: "sector", re: /삼성그룹|현대차그룹|LG그룹|SK그룹|그룹주|그룹플러스|\d대그룹/ },
  // 시장지수를 팩터보다 먼저 — "KODEX 200ESG", "200IT TR" 은 코스피200 파생이지 스타일 상품이 아니다.
  //   (업종 정의는 이보다 위에 있으므로 "TIGER 200 건설" 은 건설로 남는다)
  { key: "market",   label: "시장지수",    kind: "sector", re: /코스피|코스닥|KOSPI|KOSDAQ|200|대형주|중소형|전체시장|KRX\d|KTOP|MSCI ?Korea|대표주|코리아TOP/ },
  { key: "factor",   label: "팩터·전략",   kind: "sector", re: /로우볼|모멘텀|퀄리티|팩터|경기방어|동일가중|섹터가중|커버드콜|타겟|버퍼|우량|블루칩|가치주|밸류|성장주|주도|수출주|내수주|저변동|최소변동성|중형주|ESG|TRF|멀티에셋/ },
];

export const ALL_DEFS: SectorDef[] = [...ASSET_DEFS, ...SECTOR_DEFS];
const ETC: SectorDef = { key: "etc", label: "기타", kind: "asset", re: /(?:)/ };

// 레버리지·인버스·선물은 섹터 통계에서 항상 뺀다.
//   같은 섹터를 2배로 따라가는 상품이라 중앙값을 부풀리고, 인버스는 부호까지 뒤집어 놓는다.
const DERIVED = /레버리지|인버스|선물|2X|3X/i;
export function isDerivedEtf(name: string): boolean { return DERIVED.test(name); }

// ETF 이름(+코드) → 섹터. 못 맞추면 "기타".
export function classifyEtf(name: string, code?: string): SectorDef {
  if (code && OVERRIDE[code]) {
    const hit = ALL_DEFS.find(d => d.key === OVERRIDE[code]);
    if (hit) return hit;
  }
  return ALL_DEFS.find(d => d.re.test(name)) ?? ETC;
}

// 거래대금(추정) = 현재가 × 거래량. 대표 ETF 를 고르는 기준 — 실제로 사고팔 수 있는 것부터.
export function tradeValue(r: EtfRankRow): number {
  return (r.price || 0) * (r.volume || 0);
}

export interface EtfSectorStat {
  key: string;
  label: string;
  kind: SectorKind;
  count: number;        // 분류된 ETF 수 (레버리지·인버스·선물 제외)
  median: number;       // 중앙값 등락률(%) — 평균은 한 종목의 급등에 휘둘린다
  upRatio: number;      // 오른 종목 비율(0~1) — 섹터가 고르게 갔는지
  best: EtfRankRow;     // 그날 가장 많이 오른 것
  rows: EtfRankRow[];   // 거래대금 상위 (rows[0] = 대표 ETF)
}

export const SECTOR_ROWS = 12;   // 섹터당 보관할 대표 ETF 수 (캐시 용량 고려)

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// 전체 랭킹 행 → 섹터 통계. 중앙값 내림차순(오늘 잘 간 섹터부터).
export function buildSectorStats(rows: EtfRankRow[]): EtfSectorStat[] {
  const bucket = new Map<string, { def: SectorDef; rows: EtfRankRow[] }>();
  for (const r of rows) {
    if (isDerivedEtf(r.name)) continue;
    const def = classifyEtf(r.name, r.code);
    const b = bucket.get(def.key) ?? { def, rows: [] };
    b.rows.push(r);
    bucket.set(def.key, b);
  }
  const out: EtfSectorStat[] = [];
  for (const { def, rows: rs } of bucket.values()) {
    if (rs.length === 0) continue;
    const byValue = [...rs].sort((a, b) => tradeValue(b) - tradeValue(a));
    const byPct = [...rs].sort((a, b) => b.pct - a.pct);
    out.push({
      key: def.key, label: def.label, kind: def.kind,
      count: rs.length,
      median: median(rs.map(r => r.pct)),
      upRatio: rs.filter(r => r.pct > 0).length / rs.length,
      best: byPct[0],
      rows: byValue.slice(0, SECTOR_ROWS),
    });
  }
  return out.sort((a, b) => b.median - a.median);
}
