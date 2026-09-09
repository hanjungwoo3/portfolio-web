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
// 이름과 내용이 어긋나는 상품을 못박는다(구성종목을 실제로 확인한 것만).
const OVERRIDE: Record<string, string> = {
  "0190C0": "auto",     // RISE 피지컬AI — 현대차 24%·기아 14%·현대모비스 13% (자동차 51%)
};

// ── 반도체는 자산군보다 먼저 ──────────────────────────────────────────────────
// 국내 시장에서 반도체는 그 자체로 한 덩어리라, 미국·일본 반도체가 '미국'·'일본' 으로 흩어지면
//   "반도체가 오늘 어떤가" 를 볼 수 없다. 그래서 반도체 규칙을 자산군보다 먼저 검사한다.
//   순서: 해외 → 소부장 → 밸류체인 → 국내. 앞의 것이 더 구체적인 성격이다.
const SEMI_DEFS: SectorDef[] = [
  // 해외 반도체 — 지역·지수 이름이 붙은 것. 미국 필라델피아·NYSE, 차이나, 일본, 글로벌 등.
  { key: "semiglobal", label: "반도체(해외)", kind: "sector",
    re: /(?=.*반도체)(?=.*(미국|중국|차이나|일본|글로벌|아시아|해외|나스닥|필라델피아|NYSE))/i },
  // 소부장·장비 — 공정·장비는 발주 사이클로 움직여 완제품과 리듬이 다르다.
  //   ★ '반도체 문맥' 을 함께 요구한다. 그냥 /소부장/ 이면 2차전지·자동차·의료기기 소부장까지
  //     끌려온다 — 실제로 그렇게 잘못 분류되고 있었다(실측 3종).
  { key: "semisobu",   label: "반도체 소부장·장비", kind: "sector",
    re: /(?=.*반도체)(?=.*(소부장|전공정|후공정|핵심공정|핵심장비))/ },
  // 밸류체인·공급망 — 완제품 지수가 아니라 후방까지 묶은 바스켓.
  { key: "semichain",  label: "반도체 밸류체인", kind: "sector",
    re: /(?=.*반도체)(?=.*(밸류체인|공급망|서플라이))|파운드리/ },
  // 국내 반도체 — 위에 안 걸린 나머지.
  { key: "semi",       label: "반도체(국내)", kind: "sector", re: /반도체|메모리|HBM|시스템반도체/ },
];

// ── 자산군 ────────────────────────────────────────────────────────────────────
const ASSET_DEFS: SectorDef[] = [
  // 채권을 맨 위에 — "단기선진하이일드" 처럼 해외 이름이 섞인 채권형이 해외주식으로 새지 않게.
  { key: "bond",     label: "채권·금리",  kind: "asset", re: /채권|국채|국고채|통안|물가채|금리|회사채|크레딧|하이일드|CD ?금리|KOFR|머니마켓|MMF|단기자금|파킹|만기매칭|국공채|하이인컴|특수채|전단채|주식혼합|혼합자산/ },
  { key: "fx",       label: "통화",       kind: "asset", re: /달러|엔화|위안|유로화|환율/ },
  { key: "commod",   label: "원자재·금",  kind: "asset", re: /금현물|골드|은현물|실버|원유|구리|니켈|원자재|농산물|천연가스|팔라듐|백금/ },
  { key: "crypto",   label: "가상자산",   kind: "asset", re: /비트코인|이더리움|가상자산|디지털자산|스테이블코인/ },
  // 해외는 지역별로 쪼갠다 — 240종을 한 칸에 몰면 "오늘 뭐가 갔나" 를 못 읽는다.
  //   S&P 단독은 지수 제공사 이름이라 국내 상품에도 붙는다(HK S&P코리아로우볼) → 500 을 함께 요구.
  { key: "us",       label: "미국",       kind: "asset", re: /미국|나스닥|S&P ?500|SNP500|다우|러셀|필라델피아|버크셔/ },
  { key: "china",    label: "중국·홍콩",  kind: "asset", re: /차이나|중국|항셍|홍콩|CSI|상해|심천/ },
  { key: "japan",    label: "일본",       kind: "asset", re: /일본|닛케이|TOPIX/ },
  //   MSCI 는 한국 지수에도 쓰인다 — 'MSCI KOREA' 는 대문자라 예전 lookahead 를 빠져나갔다(실측).
  { key: "overseas", label: "기타 해외",  kind: "asset", re: /글로벌|선진국|신흥국|인도|베트남|유럽|유로스톡스|유로스탁스|스탁스|브라질|멕시코|대만|아시아|월드|라틴|독일|DAX|MSCI(?!\s*KOREA)/i },
];

// ── 국내 업종·테마 ─────────────────────────────────────────────────────────────
//   구체적인 테마를 위에, 넓은 업종을 아래에 둔다("AI" 같은 넓은 말이 먼저 먹지 않게).
const SECTOR_DEFS: SectorDef[] = [
  { key: "nuclear",  label: "원자력·SMR",  kind: "sector", re: /원자력|원전|SMR/ },
  { key: "power",    label: "AI전력·전력설비", kind: "sector", re: /전력설비|전력기기|AI전력|전선|그리드|에너지인프라|변압기/ },
  { key: "ship",     label: "조선",        kind: "sector", re: /조선|해양플랜트/ },
  { key: "defense",  label: "방산·우주항공", kind: "sector", re: /방산|국방|K-?방산|우주|항공우주/ },
  { key: "battery",  label: "2차전지",     kind: "sector", re: /2차전지|이차전지|배터리|리튬|양극재|음극재/ },
  { key: "robot",    label: "로봇·AI",     kind: "sector", re: /로봇|피지컬AI|자동화|인공지능|AI/ },
  { key: "auto",     label: "자동차",      kind: "sector", re: /자동차|모빌리티|전기차|자율주행/ },
  { key: "build",    label: "건설·인프라",  kind: "sector", re: /건설|건자재|인프라|리모델링/ },
  { key: "steel",    label: "철강·소재",   kind: "sector", re: /철강|비철|소재|시멘트/ },
  { key: "machine",  label: "기계·산업재",  kind: "sector", re: /기계|장비|중공업|산업재|공작|CAPEX|설비투자/i },
  { key: "chem",     label: "화학·에너지",  kind: "sector", re: /화학|정유|에너지|태양광|수소|신재생|풍력|기후변화|탄소효율|그린뉴딜|친환경/ },
  { key: "bio",      label: "바이오·헬스케어", kind: "sector", re: /바이오|헬스|제약|의료|시밀러|의료기기/ },
  { key: "content",  label: "IT·인터넷·콘텐츠", kind: "sector", re: /인터넷|게임|콘텐츠|미디어|엔터|플랫폼|웹툰|K-?팝|KPOP|소프트웨어|클라우드|보안|\bIT\b|5G|e-?커머스|이커머스|메타버스|뉴딜|테크|BBIG|K컬처/i },
  { key: "consume",  label: "소비재·화장품", kind: "sector", re: /화장품|뷰티|소비재|음식료|식품|유통|리테일|여행|레저|K-?푸드|농업|골프/ },
  { key: "finance",  label: "금융",        kind: "sector", re: /은행|증권|보험|금융|카드|핀테크/ },
  { key: "reit",     label: "리츠·부동산",  kind: "sector", re: /리츠|부동산/ },
  { key: "transport", label: "운송·물류",  kind: "sector", re: /운송|물류|해운|택배/ },
  { key: "dividend", label: "배당",        kind: "sector", re: /배당|밸류업|우선주|주주가치|주주환원/ },
  { key: "holding",  label: "지주",        kind: "sector", re: /지주/ },
  { key: "group",    label: "그룹주",      kind: "sector", re: /삼성그룹|현대차그룹|LG그룹|SK그룹|포스코그룹|그룹주|그룹플러스|그룹포커스|\d대그룹/ },
  // 시장지수를 팩터보다 먼저 — "KODEX 200ESG", "200IT TR" 은 코스피200 파생이지 스타일 상품이 아니다.
  //   (업종 정의는 이보다 위에 있으므로 "TIGER 200 건설" 은 건설로 남는다)
  { key: "market",   label: "시장지수",    kind: "sector", re: /코스피|코스닥|KOSPI|KOSDAQ|200|대형주|중소형|전체시장|KRX\d|KTOP|MSCI\s?KOREA|대표주|코리아TOP/i },
  { key: "factor",   label: "팩터·전략",   kind: "sector", re: /로우볼|모멘텀|퀄리티|팩터|경기방어|동일가중|섹터가중|커버드콜|타겟|버퍼|우량|블루칩|가치주|밸류|성장주|주도|수출주|내수주|저변동|최소변동성|중형주|ESG|TRF|멀티에셋|TDF|타겟데이트|퀀트|혁신성장|혁신기술/i },
];

export const ALL_DEFS: SectorDef[] = [...SEMI_DEFS, ...ASSET_DEFS, ...SECTOR_DEFS];
const ETC: SectorDef = { key: "etc", label: "기타", kind: "asset", re: /(?:)/ };

// 레버리지·인버스·선물은 섹터 통계에서 항상 뺀다.
//   같은 섹터를 2배로 따라가는 상품이라 중앙값을 부풀리고, 인버스는 부호까지 뒤집어 놓는다.
const DERIVED = /레버리지|인버스|선물|2X|3X/i;
export function isDerivedEtf(name: string): boolean { return DERIVED.test(name); }

// ETF 이름(+코드) → 섹터 하나. 못 맞추면 "기타".
//   ★ 한 종목은 한 섹터에만 넣는다. 여러 곳에 넣어 봤더니 국내 '반도체' 에 미국·중국·일본
//     반도체 ETF 가 17종 섞여 들어와(TIGER 미국필라델피아반도체 등) 섹터가 뭉개졌다.
//     자산군(해외·채권·원자재)을 먼저 검사하는 지금 순서라야 국내 섹터가 국내만 담는다.
//   정의 순서가 곧 우선순위 — 구체적인 테마를 위에, 넓은 업종을 아래에 둔다.
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
  rows: EtfRankRow[];   // 그 섹터 전 종목, 거래대금 내림차순 (rows[0] = 대표 ETF)
}

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
      // 12종만 담다가 전체로 바꿨다 — 팝업에서 스크롤로 다 볼 수 있어야 한다.
      //   전 섹터 합쳐 1,100 행 남짓이라 localStorage 캐시에 부담이 안 된다.
      rows: byValue,
    });
  }
  return out.sort((a, b) => b.median - a.median);
}
