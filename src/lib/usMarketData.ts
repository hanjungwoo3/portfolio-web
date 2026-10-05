// 데스크톱 v2 fetch_us_indices_with_futures 의 pairs 리스트 그대로 이식
// + ETFS_BY_SECTOR 매핑 그대로

export type Tier = "T0" | "T1" | "T2";

export interface Pair {
  symbol: string;       // Yahoo 심볼 (^GSPC, NVDA, KRW=X 등)
  name: string;         // 표시명
  desc: string;         // 부가 설명
  future?: string;      // 대응 선물 심볼 (있으면)
  tier: Tier;
  sector: string;
  direction: "direct" | "inverse" | "neutral";
  // 토스 미국 종목 코드 — 24시간 ECN Overnight 가격 추적용 (Yahoo postMarketPrice 보다 최신)
  tossUsCode?: string;
  // 한국 **개별주**('6자리.KS') — ETF 가 아니다. 카드의 'ETF' 책갈피(구성종목 모달)를 달지 않는다.
  //   코스닥 종목도 '.KS' 로 둔다 — 시세(토스)·차트(토스 일봉) 모두 코드만 보고, 야후를 안 쓴다.
  krStock?: boolean;
}

// ⚠️ 이 맵은 **어디서도 참조하지 않는다**(2026-09-30 확인). 실제 시세 코드는
//   api.ts 의 TOSS_US_STOCK_CODE 다 — 새 미국 종목은 거기에 넣어야 한다(SCHD 흐림 사고 참고).
// Yahoo 심볼 → 토스 미국 종목 코드 매핑 (24시간 가격용)
export const TOSS_US_CODE: Record<string, string> = {
  "MU":   "US19890516001",
  "NVDA": "US19990122001",
  "AMAT": "US19721012001",
  "LRCX": "US19840504001",
  "ASML": "US19950315001",
  "QCOM": "US19911213001",
};

export const US_PAIRS: Pair[] = [
  // Tier 0: 핵심 대시보드 — 데스크탑은 UsMarketTab T0_SECTIONS(한국시장 영향 관계) 기준으로 그룹 표시
  // 행 1 — 한국 지수 (맨 위)
  { symbol: "^KS11",    name: "KOSPI",       desc: "코스피 종합 지수", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "^KS200N",  name: "코스피200 야간선물", desc: "yasun.gg · 18:00~05:00 KST", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "069500.KS", name: "KODEX 200",  desc: "KOSPI 200 추종 ETF — 실물 매매 가능", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "229200.KS", name: "KODEX 코스닥150", desc: "코스닥150 추종 ETF — 실물 매매 가능", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "^KQ11",    name: "KOSDAQ",      desc: "코스닥 종합 지수", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "^KQ150N",  name: "코스닥150 야간선물", desc: "yasun.gg · 18:00~05:00 KST", tier: "T0", sector: "dashboard", direction: "direct" },
  // 행 2 — 환율 + 매크로 + 외국인 투심 + 공포
  { symbol: "KRW=X",    name: "달러환율",     desc: "USD/KRW 원달러 환율 — 수출주·외국인 수급", tier: "T0", sector: "dashboard", direction: "inverse" },
  { symbol: "JPYKRW=X", name: "엔화환율",     desc: "JPY/KRW 100엔당 원 — 오르면 엔 강세(엔캐리 청산 위험) 또는 원화 약세. 둘 다 한국 증시엔 악재", tier: "T0", sector: "dashboard", direction: "inverse" },
  { symbol: "DX-Y.NYB", name: "달러 인덱스",  desc: "DXY — 6개 통화 대비 달러 강도", tier: "T0", sector: "dashboard", direction: "inverse" },
  { symbol: "^US2Y",    name: "미국 2Y",     desc: "미 2년 국채금리 — Fed 정책금리 기대. 10Y 보다 높으면(역전) 침체 신호", tier: "T0", sector: "dashboard", direction: "inverse" },
  { symbol: "^TNX",     name: "미국 10Y",    desc: "미 10년 국채금리 — 외국인 수급·성장주 할인율·시장 벤치마크", tier: "T0", sector: "dashboard", direction: "inverse" },
  { symbol: "^TYX",     name: "미국 30Y",    desc: "미 30년 국채금리 — 장기 인플레·재정 우려. 10Y 보다 가파르게 오르면(스티프닝) 재정·수급 부담 신호", tier: "T0", sector: "dashboard", direction: "inverse" },
  { symbol: "EWY",      name: "EWY",         desc: "MSCI Korea — 외국인 투심", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "KORU",     name: "KORU(3x한국)", desc: "Direxion Daily South Korea Bull 3X — MSCI 한국 3배 레버리지(EWY×3). 한국 증시 선행·외국인 투심 증폭 게이지", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "^VIX",     name: "VIX",         desc: "공포지수 — 20↑ 경계, 30↑ 공포", tier: "T0", sector: "dashboard", direction: "inverse" },
  { symbol: "^TIPS10",  name: "미국 10Y 실질", desc: "10년 물가연동국채(TIPS) 실질금리 = FRED DFII10 — 오르면 성장주·금에 부담. CNBC", tier: "T0", sector: "dashboard", direction: "inverse" },
  { symbol: "^MOVE",    name: "MOVE",        desc: "채권 공포지수 — 미 국채 변동성. 100↑ 경계, 120↑ 불안", tier: "T0", sector: "dashboard", direction: "inverse" },
  { symbol: "VKOSPI",   name: "V-KOSPI",     desc: "코스피200 변동성지수 — 한국 공포지수 (20↑ 경계, 30↑ 공포). CNBC", tier: "T0", sector: "dashboard", direction: "inverse" },
  // 행 2 — 원자재 + 위험자산
  { symbol: "GC=F",     name: "금",          desc: "Gold — 안전자산 / risk-off 지표", tier: "T0", sector: "dashboard", direction: "neutral" },
  { symbol: "SI=F",     name: "은",          desc: "Silver — 산업금속 + 안전자산 양성격", tier: "T0", sector: "dashboard", direction: "neutral" },
  { symbol: "HG=F",     name: "구리",        desc: "Dr. Copper — 글로벌 경기 선행지표", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "CL=F",     name: "WTI 원유",    desc: "국제 유가(미국 서부텍사스산) — 정유·에너지·인플레", tier: "T0", sector: "dashboard", direction: "neutral" },
  // 브렌트는 토스 원자재 목록에 없다(실측: GC/SI/CL/NG/HG/W 6종뿐) → 토스 코드 없이 야후로만 받는다.
  //   유럽·중동·아시아 도입 원유의 기준이라 국내 정유주는 WTI 보다 이쪽에 더 붙는다.
  { symbol: "BZ=F",     name: "브렌트유",     desc: "국제 유가(북해) — 국내 정유·항공 원가의 기준", tier: "T0", sector: "dashboard", direction: "neutral" },
  { symbol: "NG=F",     name: "천연가스",     desc: "헨리허브 — LNG·발전·난방·화학", tier: "T0", sector: "dashboard", direction: "neutral" },
  { symbol: "ZW=F",     name: "밀",          desc: "시카고 소맥 선물 — 사료·식품 원가. 토스 원자재에 같이 온다", tier: "T0", sector: "dashboard", direction: "neutral" },
  // 암호화폐 — 토스가 **원화(VWAP.KRW-*)** 로 준다. 심볼은 야후식(-USD)이지만 값은 원이다.
  { symbol: "BTC-USD",  name: "비트코인",    desc: "위험자산 — 한국 IT/플랫폼 상관", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "ETH-USD",  name: "이더리움",    desc: "알트 대장 — 스테이블·디파이 기반. BTC 보다 위험선호에 민감", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "XRP-USD",  name: "리플",        desc: "국내 거래 비중이 큰 코인 — 개인 위험선호의 온도계", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "SOL-USD",  name: "솔라나",      desc: "고성능 체인 — 알트 랠리의 선행 지표로 자주 쓰인다", tier: "T0", sector: "dashboard", direction: "direct" },
  // 한국 국고채 금리 — 토스 채권 카테고리(KR1BENCH*). 미 국채와 나란히 봐야 금리차가 읽힌다.
  { symbol: "^KR2Y",    name: "한국 2Y",     desc: "국고채 2년 — 기준금리 기대. 미 2Y 와의 차이가 환율 압력", tier: "T0", sector: "dashboard", direction: "inverse" },
  { symbol: "^KR10Y",   name: "한국 10Y",    desc: "국고채 10년 — 성장·물가 기대. 은행·보험 수익성", tier: "T0", sector: "dashboard", direction: "inverse" },
  { symbol: "^KR30Y",   name: "한국 30Y",    desc: "국고채 30년 — 초장기 수요(보험·연기금)", tier: "T0", sector: "dashboard", direction: "inverse" },
  // 행 3 — 미국 지수 + 야간 선물 + 닛케이 + 반도체 (필반·필반선물)
  // 미국 전체 시장 지수 — 대표 3대(나스닥·S&P·다우)보다 넓은 커버리지.
  //   윌셔5000 은 야후 장중 갱신이 죽어 있어 뺐다(dashboardGroups 주석 참고).
  { symbol: "^RUA",     name: "러셀3000",    desc: "Russell 3000 — 미국 시총 ~98% 커버(대형+중소형 전체)", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "^NYA",     name: "NYSE종합",    desc: "NYSE Composite — NYSE 상장 전체 종목 시가총액 가중", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "^IXIC",    name: "나스닥",      desc: "미국 기술주 전체", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "NQ=F",     name: "나스닥 선물",  desc: "미장 외 흐름 — 다음 한국장 영향 (24h)", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "^GSPC",    name: "S&P 500",     desc: "미국 대형주 — 글로벌 리스크 온/오프", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "ES=F",     name: "S&P 500 선물", desc: "미장 외 흐름 — 다음 한국장 영향 (24h)", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "^DJI",     name: "다우존스",     desc: "다우 30 산업평균 — 미국 대형 우량주", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "RTY=F",    name: "러셀2000 선물", desc: "E-mini Russell 2000 선물 — 미국 소형주 야간 흐름 (24h)", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "^SOX",     name: "필라델피아반도체", desc: "미국 반도체 30개사 평균 지수", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "SOX=F",    name: "필라델피아반도체 선물", desc: "야간 24시간 거래 — 다음 정규장 가격 미리 가늠", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "MU",       name: "마이크론",     desc: "Micron — 미국 메모리 반도체 (삼성·하이닉스 직접 경쟁사·메모리 사이클 가늠자)", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "NVDA",     name: "엔비디아",     desc: "Nvidia — AI 수요 대표주. MU 와 동행이면 메모리 사이클 동조화 신호", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "SNDK",     name: "샌디스크",     desc: "SanDisk — NAND 플래시/SSD (WD 에서 분사, 2025 상장). 삼성·하이닉스 NAND 메모리 가늠자", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "SKHY",     name: "SK하이닉스(ADR)", desc: "SK Hynix ADR(나스닥 상장, 2026) — 삼성과 함께 메모리·HBM 대표. 원화 시세는 토스", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "STX",      name: "씨게이트",     desc: "Seagate — HDD·니어라인 스토리지. AI 데이터센터 대용량 저장수요 가늠자", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "DRAM",     name: "DRAM ETF",    desc: "Roundhill Memory ETF(AMEX) — 메모리 반도체 바스켓(마이크론·삼성·하이닉스 등 메모리 사이클)", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "AMAT",     name: "어플라이드머티리얼즈", desc: "반도체 식각·증착 장비 회사 — AI 메모리 생산 설비 투자 가늠자", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "LRCX",     name: "램리서치",     desc: "Lam Research — 식각·증착 장비. HBM 핵심 공정", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "ASML",     name: "ASML",        desc: "EUV 노광 독점 — 첨단 반도체 공정 필수", tier: "T0", sector: "dashboard", direction: "direct" },
  // AI 인프라 주도주 — 각 테마에서 수익률·거래대금 1위(2026-09-30 실측). AI 데이터센터 투자 흐름의 가늠자.
  { symbol: "BE",       name: "블룸에너지",   desc: "Bloom Energy — 데이터센터 현장 발전(연료전지). 전력 테마 주도주(1년 +300%, 거래대금 테마 1위)", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "LITE",     name: "루멘텀",       desc: "Lumentum — 광트랜시버·레이저. 광통신 테마 주도주(1년 +490%, 거래대금 테마 1위)", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "NBIS",     name: "네비우스",     desc: "Nebius — GPU 클라우드(네오클라우드). AI 데이터센터 주도주(1년 +117%, 코어위브 -29%)", tier: "T0", sector: "dashboard", direction: "direct" },
  // AI 순환매 대장주 — 간밤 미국 수익률이 한국 해당 단계의 다음 날 수익률과 가장 붙는 종목.
  { symbol: "ONTO",     name: "온투",         desc: "Onto Innovation — 후공정·첨단패키징 검사계측. 한국 후공정 소부장(한미반도체·ISC·테크윙) 다음 날 상관 +0.32", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "PWR",      name: "콴타서비스",   desc: "Quanta Services — 미국 송전망 공사 1위. 한국 전력기기(HD현대일렉트릭·LS일렉트릭·효성중공업) 다음 날 상관 +0.35", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "CCJ",      name: "카메코",       desc: "Cameco — 우라늄 채굴·연료. 한국 원자력(두산에너빌리티·한전기술) 다음 날 상관 +0.34", tier: "T0", sector: "dashboard", direction: "direct" },
  // AI 순환매 — 한국 단계별 종목(개별주). 지수 카드와 **같은 카드**로 그리려고 등록한다.
  //   시세는 토스 배치(.KS 한 콜에 합류), 차트는 토스 일봉(fetchDashboardChart) — 추가 호출 거의 없음.
  { symbol: "005930.KS", name: "삼성전자", desc: "메모리·파운드리·스마트폰", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "000660.KS", name: "SK하이닉스", desc: "HBM·D램·낸드", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "396500.KS", name: "TIGER 반도체TOP10", desc: "국내 반도체 상위 10종 — 섹터 ETF", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "091160.KS", name: "KODEX 반도체", desc: "국내 반도체 업종 — 섹터 ETF", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "091230.KS", name: "TIGER 반도체", desc: "국내 반도체 업종 — 섹터 ETF", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "475300.KS", name: "SOL 반도체전공정", desc: "증착·식각·세정 장비 — 섹터 ETF", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "471990.KS", name: "KODEX AI반도체핵심장비", desc: "HBM·AI 반도체 장비 — 섹터 ETF", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "471760.KS", name: "TIGER AI반도체핵심공정", desc: "AI 반도체 핵심 공정 장비 — 섹터 ETF", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "475310.KS", name: "SOL 반도체후공정", desc: "패키징·테스트 — 섹터 ETF", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "455850.KS", name: "SOL AI반도체소부장", desc: "AI 반도체 소재·부품·장비 — 섹터 ETF", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "487240.KS", name: "KODEX AI전력핵심설비", desc: "변압기·전선·전력기기 — 섹터 ETF", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "491820.KS", name: "HANARO 전력설비투자", desc: "전력 설비 투자 수혜 — 섹터 ETF", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "0117V0.KS", name: "TIGER 코리아AI전력기기TOP3플러스", desc: "HD현대일렉·LS일렉·효성중공업 중심 — 섹터 ETF", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "433500.KS", name: "ACE 원자력TOP10", desc: "원전 상위 10종 — 섹터 ETF", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "0098F0.KS", name: "KODEX 원자력SMR", desc: "원전·SMR — 섹터 ETF", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "0091P0.KS", name: "TIGER 코리아원자력", desc: "국내 원전 밸류체인 — 섹터 ETF", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "377990.KS", name: "TIGER Fn신재생에너지", desc: "태양광·풍력·수소 — 섹터 ETF", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "385510.KS", name: "KODEX 신재생에너지액티브", desc: "신재생 액티브 — 섹터 ETF", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "381570.KS", name: "HANARO Fn친환경에너지", desc: "친환경 에너지 — 섹터 ETF", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "KLAC", name: "KLA", desc: "KLA — 검사·계측 장비 1위. 한국 후공정 다음 날 상관 1위", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "AMKR", name: "앰코", desc: "Amkor — 미국 최대 후공정(OSAT)·첨단 패키징(CoWoS 외주). 한국 후공정·하이닉스 다음 날 상관 상위", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "MPWR", name: "MPS", desc: "Monolithic Power — AI 서버·GPU 전원 칩(엔비디아 공급). 하이닉스·삼성 다음 날 상관 0.22~0.23", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "GEV", name: "GE버노바", desc: "GE Vernova — 가스터빈·전력망 설비", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "OKLO", name: "오클로", desc: "Oklo — 소형모듈원전(SMR) 개발", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "FSLR", name: "퍼스트솔라", desc: "First Solar — 미국 최대 태양광 모듈", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "0080G0.KS", name: "KODEX 방산TOP10", desc: "방산 상위 10종 — 섹터 ETF", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "463250.KS", name: "TIGER K방산&우주", desc: "방산·우주항공 — 섹터 ETF", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "ITA", name: "미국 방산 ETF", desc: "iShares 미국 항공우주·방산 — 한국 방산 다음 날 상관 1위", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "RTX", name: "레이시온", desc: "RTX — 미사일·항공엔진. 미국 방산 대표", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "0225V0.KS", name: "KODEX 미국CPU반도체TOP10", desc: "미국 CPU 반도체 10종 — 간밤 미국을 하루 시차로 따라간다", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "009150.KS", name: "삼성전기", desc: "FC-BGA 기판·MLCC — CPU·AI 서버 기판", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "353200.KS", name: "대덕전자", desc: "FC-BGA·메모리 기판", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "195870.KS", name: "해성디에스", desc: "리드프레임·패키지 기판", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "381180.KS", name: "TIGER 미국필라델피아반도체나스닥", desc: "필라델피아 반도체 30종 — 국내 상장, 하루 시차로 간밤 미국을 따라간다", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "390390.KS", name: "KODEX 미국반도체", desc: "미국 반도체 대표주 — 국내 상장, 하루 시차로 간밤 미국을 따라간다", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "487230.KS", name: "KODEX 미국AI전력핵심인프라", desc: "미국 전력 설비·유틸리티 — 국내 상장, 하루 시차로 간밤 미국을 따라간다", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "491010.KS", name: "TIGER 글로벌AI전력인프라액티브", desc: "글로벌 AI 전력 인프라 — 국내 상장, 하루 시차로 간밤 미국을 따라간다", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "0051G0.KS", name: "SOL 미국원자력SMR", desc: "미국 원전·SMR — 국내 상장, 하루 시차로 간밤 미국을 따라간다", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "0132H0.KS", name: "KODEX 미국원자력SMR", desc: "미국 원전·SMR — 국내 상장, 하루 시차로 간밤 미국을 따라간다", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "419420.KS", name: "KODEX 미국클린에너지나스닥", desc: "미국 클린에너지 — 거래 적음 — 국내 상장, 하루 시차로 간밤 미국을 따라간다", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "494840.KS", name: "TIGER 미국방산TOP10", desc: "미국 방산 10종 — 국내 상장, 하루 시차로 간밤 미국을 따라간다", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "0167Z0.KS", name: "KODEX 미국우주항공", desc: "미국 우주항공 — 국내 상장, 하루 시차로 간밤 미국을 따라간다", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "464920.KS", name: "PLUS 일본반도체소부장", desc: "일본 반도체 소재·부품·장비 — 국내 상장, 일본장은 한국과 같은 시간", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "465660.KS", name: "TIGER 일본반도체FACTSET", desc: "일본 반도체 장비·소재 — 국내 상장, 일본장은 한국과 같은 시간", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "469160.KS", name: "ACE 일본반도체", desc: "일본 반도체 대표주 — 국내 상장, 일본장은 한국과 같은 시간", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "CIEN", name: "시에나", desc: "Ciena — 광통신 네트워크 장비. 한국 광통신주 다음 날 상관 상위", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "138080.KS", name: "오이솔루션", desc: "광 트랜시버", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "010170.KS", name: "대한광통신", desc: "광섬유·광케이블", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "327260.KS", name: "RF머트리얼즈", desc: "광통신·RF 패키지 — 루멘텀 공급", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "0219B0.KS", name: "KoAct 광통신&위성네트워크액티브", desc: "국내 광통신·위성 — RF머트리얼즈·우리로·대한광통신·오이솔루션 등", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "0173Y0.KS", name: "KODEX 미국AI광통신네트워크", desc: "미국 광통신 — 국내 상장, 하루 시차로 간밤 미국을 따라간다", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "0215T0.KS", name: "HANARO 미국AI광통신TOP10", desc: "미국 광통신 10종 — 국내 상장, 하루 시차로 간밤 미국을 따라간다", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "367760.KS", name: "RISE 네트워크인프라", desc: "삼성전기·LG이노텍·이수페타시스 등 — 기판·부품 비중", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "0239Y0.KS", name: "PLUS 코리아HBM반도체", desc: "HBM 소부장 — 섹터 ETF", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "0005G0.KS", name: "IBK K-AI반도체코어테크", desc: "삼성전기·이수페타시스 등 기판 비중 — 섹터 ETF", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "0209Z0.KS", name: "ACE 코리아AI전력TOP10", desc: "국내 전력기기 10종 — 섹터 ETF", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "0092B0.KS", name: "SOL 한국원자력SMR", desc: "국내 원전·SMR — 섹터 ETF", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "457990.KS", name: "PLUS 태양광&ESS", desc: "태양광·ESS — 섹터 ETF", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "490480.KS", name: "SOL K방산", desc: "국내 방산 — 섹터 ETF", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "007660.KS", name: "이수페타시스", desc: "AI 서버·네트워크용 고다층 기판(MLB)", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "COHR", name: "코히런트", desc: "Coherent — 광 트랜시버·레이저. 한국 광통신 최근 6개월 다음 날 상관 2위", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "012450.KS", name: "한화에어로스페이스", desc: "방산 대장주 — 지상장비·항공엔진·우주", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "WDC", name: "웨스턴디지털", desc: "Western Digital — HDD(샌디스크 분사 후). SK하이닉스 다음 날 상관 3위권", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "0224D0.KS", name: "KIWOOM 미국CPU반도체TOP4+", desc: "미국 CPU 4종 — 국내 상장, 하루 시차로 간밤 미국을 따라간다", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "419650.KS", name: "PLUS 글로벌수소&차세대연료전지", desc: "글로벌 수소·연료전지 — 국내 상장, 거래 적음", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "PLTR", name: "팔란티어", desc: "Palantir — AI 데이터 분석·정부/기업 소프트웨어", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "NFLX", name: "넷플릭스", desc: "Netflix — 스트리밍·광고", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "CRWV", name: "코어위브", desc: "CoreWeave — GPU 임대 AI 클라우드(네오클라우드)", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "CRM", name: "세일즈포스", desc: "Salesforce — CRM·기업용 AI 에이전트(Agentforce)", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "NOW", name: "서비스나우", desc: "ServiceNow — 기업 업무 자동화·AI 에이전트", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "DELL", name: "델", desc: "Dell Technologies — AI 서버·PC", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "TLT", name: "TLT", desc: "iShares 미국 장기국채 20년+ — 금리 하락·안전자산 수요", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "SOXX", name: "SOXX", desc: "iShares 미국 반도체 ETF — 반도체 전체 흐름", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "TQQQ", name: "TQQQ", desc: "나스닥100 3배 — 개인 투자자 위험 선호", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "SOXL", name: "SOXL", desc: "반도체 3배 — 서학개미 최다 보유권", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "JEPQ", name: "JEPQ", desc: "JPMorgan 나스닥 커버드콜 — 월배당·인컴 수요", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "SMH", name: "SMH", desc: "VanEck 반도체 ETF — 엔비디아·TSMC 비중 큼(SOXX 보다 대형주 집중)", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "MRVL", name: "마벨", desc: "Marvell — 맞춤형 AI 칩(ASIC)·광통신·고속 네트워크 칩", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "ARM", name: "ARM", desc: "ARM Holdings — CPU 설계(IP) 1위. AI 서버 CPU 다수가 ARM 기반", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "CDNS", name: "케이던스", desc: "Cadence — 반도체 설계 소프트웨어(EDA) 양강", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "357780.KS", name: "솔브레인", desc: "식각액·반도체 공정 소재", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "005290.KS", name: "동진쎄미켐", desc: "포토레지스트·공정 소재", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "064760.KS", name: "티씨케이", desc: "SiC 링 — 식각 장비 소모 부품", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "166090.KS", name: "하나머티리얼즈", desc: "실리콘·SiC 식각 부품", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "240810.KS", name: "원익IPS", desc: "증착(CVD·ALD) 장비", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "036930.KS", name: "주성엔지니어링", desc: "ALD·증착 장비", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "319660.KS", name: "피에스케이", desc: "드라이 스트립·세정 장비", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "084370.KS", name: "유진테크", desc: "LPCVD·ALD 장비", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "042700.KS", name: "한미반도체", desc: "HBM TC 본더", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "095340.KS", name: "ISC", desc: "반도체 테스트 소켓", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "089030.KS", name: "테크윙", desc: "테스트 핸들러", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "067310.KS", name: "하나마이크론", desc: "패키징·테스트(OSAT)", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "267260.KS", name: "HD현대일렉트릭", desc: "변압기·전력기기", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "010120.KS", name: "LS일렉트릭", desc: "전력기기·배전반", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "298040.KS", name: "효성중공업", desc: "초고압 변압기", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "034020.KS", name: "두산에너빌리티", desc: "원전 주기기·SMR", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "052690.KS", name: "한전기술", desc: "원전 설계", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "051600.KS", name: "한전KPS", desc: "원전 정비", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "009830.KS", name: "한화솔루션", desc: "태양광(큐셀)", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "112610.KS", name: "씨에스윈드", desc: "풍력 타워", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "336260.KS", name: "두산퓨얼셀", desc: "연료전지", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "UCTT",     name: "울트라클린",   desc: "Ultra Clean — 반도체 장비 부품·가스 서브시스템. 한국 부품(원익QnC·하나머티리얼즈·티씨케이) 다음 날 상관 +0.31", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "ENTG",     name: "엔테그리스",   desc: "Entegris — 웨이퍼 소모품·특수화학 소재. 한국 소재(솔브레인·동진쎄미켐·한솔케미칼) 다음 날 상관 +0.26", tier: "T0", sector: "dashboard", direction: "direct" },
  // AI 반도체·인프라 대표주 (NVDA 는 위 메모리/AI 줄)
  { symbol: "AMD",      name: "AMD",         desc: "AMD — CPU·GPU. NVDA 의 AI 가속기 경쟁자", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "AVGO",     name: "브로드컴",     desc: "Broadcom — AI 네트워킹·커스텀 실리콘(ASIC). NVDA 다음 AI 핵심", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "ORCL",     name: "오라클",       desc: "Oracle — 클라우드(OCI)·AI 캐펙스 수혜", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "INTC",     name: "인텔",         desc: "Intel — CPU·파운드리. 미국 반도체 심리 게이지", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "QCOM",     name: "퀄컴",         desc: "Qualcomm — 모바일 AP(스냅드래곤)·모뎀 팹리스. 스마트폰 수요·온디바이스 AI 가늠자", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "TSM",      name: "TSMC(ADR)",   desc: "TSMC ADR(뉴욕 상장) — 세계 최대 파운드리(NVDA·AMD·애플 칩 위탁생산). 반도체 전방수요·삼성 파운드리 경쟁 가늠자", tier: "T0", sector: "dashboard", direction: "direct" },
  // 일본 반도체 — 한국과 같은 시간에 열리는 도쿄 본주(야후). 한국 반도체와 당일 상관 0.5~0.69.
  { symbol: "^N225",    name: "닛케이",       desc: "닛케이225 — 도쿄일렉트론·어드반테스트 등 반도체 비중 큼", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "8035.T",   name: "도쿄일렉트론", desc: "Tokyo Electron — 세계 3위 전공정 장비(증착·식각·코터). 한국 전공정 장비 가늠자", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "6857.T",   name: "어드반테스트", desc: "Advantest — 반도체 테스터 1위(HBM·AI칩 테스트). 한국 후공정·테스트 가늠자", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "285A.T",   name: "키옥시아",     desc: "Kioxia 도쿄 본주(엔) — NAND 메모리. 삼성·하이닉스 메모리와 같은 사이클", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "6146.T",   name: "디스코",       desc: "DISCO — 웨이퍼 절단·연마 장비 1위(HBM 적층 필수). 한국 장비주(HPSP·전공정)와 가장 붙어 다님", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "4186.T",   name: "도쿄오카",     desc: "Tokyo Ohka(TOK) — 포토레지스트 소재. 일본 소재주 중 하이닉스와 동행 최고", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "4062.T",   name: "이비덴",       desc: "Ibiden — AI·서버 CPU 패키지 기판(엔비디아·인텔). 한국 기판주 가늠자", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "KXIAY",    name: "키오시아(ADR)", desc: "Kioxia ADR(미국 OTC) — NAND 플래시 대표(구 도시바 메모리). 삼성·하이닉스 NAND 경쟁 가늠자. 토스 미지원 → 달러 표시", tier: "T0", sector: "dashboard", direction: "direct" },
  // 행 3.5 — 미국 빅테크 개별주 (Mag7 + 스페이스X, NVDA 는 반도체 줄에 있음). 가격·링크 모두 토스.
  { symbol: "AAPL",     name: "애플",         desc: "Apple — 아이폰·서비스. 미국 시총 1위급 소비 가늠자", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "MSFT",     name: "마이크로소프트", desc: "Microsoft — 클라우드(Azure)·AI(코파일럿). 엔터프라이즈 대표", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "GOOGL",    name: "알파벳",       desc: "Alphabet(구글) — 검색·유튜브·클라우드·제미나이", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "AMZN",     name: "아마존",       desc: "Amazon — 이커머스·AWS 클라우드", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "META",     name: "메타",         desc: "Meta — 광고·SNS·AI 인프라 투자", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "TSLA",     name: "테슬라",       desc: "Tesla — 전기차·로보택시·에너지", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "SPCX",     name: "스페이스X",    desc: "SpaceX (SPCX) — 우주 발사·스타링크. NASDAQ 상장 주식", tier: "T0", sector: "dashboard", direction: "direct" },
  // 행 4 — 미국 대표 ETF
  { symbol: "SPY",      name: "SPY",         desc: "SPDR S&P 500 — 미국 대형주 추종", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "QQQ",      name: "QQQ",         desc: "Invesco NASDAQ 100 — 미국 대형 기술주", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "DIA",      name: "DIA",         desc: "SPDR Dow Jones 30 — 미국 대형주 30선", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "IWM",      name: "IWM",         desc: "iShares Russell 2000 — 미국 소형주", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "VTI",      name: "VTI",         desc: "Vanguard Total Stock Market — 미국 전체", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "SCHD",     name: "SCHD",        desc: "Schwab US Dividend Equity — 미국 우량 고배당 100선. 국내 '미국배당다우존스' ETF 들의 원본 지수", tier: "T0", sector: "dashboard", direction: "direct" },
  // 행 6 — 한국 섹터 KODEX ETF (대표 1개씩, .KS suffix → Yahoo 통해 일관 fetch)
  { symbol: "091160.KS", name: "KODEX 반도체",     desc: "한국 반도체 ETF — 삼성·하이닉스 대표", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "117700.KS", name: "KODEX 건설",       desc: "한국 건설주 ETF — 현대건설/삼성물산/GS건설", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "305720.KS", name: "KODEX 2차전지",    desc: "2차전지 산업 ETF — LG·SK", tier: "T0", sector: "dashboard", direction: "direct" },
  // 지수(대장주) 페이지 — 섹터 ETF ➜ 대장주(최근 3개월 거래대금 순, 2026-10-06)
  { symbol: "066970.KS", name: "엘앤에프", desc: "양극재", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "247540.KS", name: "에코프로비엠", desc: "양극재", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "348370.KS", name: "엔켐", desc: "전해액", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "307950.KS", name: "현대오토에버", desc: "차량 SW·IT", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "018880.KS", name: "한온시스템", desc: "열관리 부품", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "011210.KS", name: "현대위아", desc: "부품·공작기계", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "082740.KS", name: "한화엔진", desc: "선박 엔진", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "443060.KS", name: "HD현대마린솔루션", desc: "선박 AS·친환경 개조", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "028050.KS", name: "삼성E&A", desc: "플랜트 EPC", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "294870.KS", name: "HDC현대산업개발", desc: "건설 — 주택", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "103140.KS", name: "풍산", desc: "구리 가공·탄약", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "001430.KS", name: "세아베스틸지주", desc: "특수강", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "000670.KS", name: "영풍", desc: "비철 제련", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "460860.KS", name: "동국제강", desc: "철강", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "011790.KS", name: "SKC", desc: "화학·동박", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "011780.KS", name: "금호석유화학", desc: "합성고무", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "298020.KS", name: "효성티앤씨", desc: "스판덱스", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "024110.KS", name: "기업은행", desc: "국책 은행", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "323410.KS", name: "카카오뱅크", desc: "인터넷 은행", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "138930.KS", name: "BNK금융지주", desc: "지방 금융지주", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "016360.KS", name: "삼성증권", desc: "증권", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "003540.KS", name: "대신증권", desc: "증권", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "001450.KS", name: "현대해상", desc: "손해보험", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "000370.KS", name: "한화손해보험", desc: "손해보험", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "003690.KS", name: "코리안리", desc: "재보험", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "028300.KS", name: "HLB", desc: "항암 신약(리보세라닙)", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "141080.KS", name: "리가켐바이오", desc: "ADC 기술이전", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "216080.KS", name: "제테마", desc: "필러·톡신", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "200670.KS", name: "휴메딕스", desc: "필러", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "099430.KS", name: "바이오플러스", desc: "필러", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "257720.KS", name: "실리콘투", desc: "K뷰티 유통", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "483650.KS", name: "달바글로벌", desc: "화장품", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "051900.KS", name: "LG생활건강", desc: "화장품·생활용품", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "004370.KS", name: "농심", desc: "라면", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "005180.KS", name: "빙그레", desc: "유제품·빙과", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "007310.KS", name: "오뚜기", desc: "식품", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "022100.KS", name: "포스코DX", desc: "IT 서비스·자동화", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "377300.KS", name: "카카오페이", desc: "핀테크", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "030520.KS", name: "한글과컴퓨터", desc: "SW", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "263750.KS", name: "펄어비스", desc: "게임 — 붉은사막", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "112040.KS", name: "위메이드", desc: "게임·블록체인", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "293490.KS", name: "카카오게임즈", desc: "게임", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "035760.KS", name: "CJ ENM", desc: "미디어·콘텐츠", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "376300.KS", name: "디어유", desc: "팬 플랫폼(버블)", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "253450.KS", name: "스튜디오드래곤", desc: "드라마 제작", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "462900.KS", name: "KoAct 바이오헬스케어", desc: "바이오·헬스케어 액티브 ETF — 바이오 ETF 중 거래대금 1위", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "157490.KS", name: "TIGER 소프트웨어", desc: "국내 소프트웨어·인터넷 ETF", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "373220.KS", name: "LG에너지솔루션", desc: "2차전지 셀 1위", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "006400.KS", name: "삼성SDI", desc: "2차전지 셀", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "086520.KS", name: "에코프로", desc: "양극재 지주", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "003670.KS", name: "포스코퓨처엠", desc: "양극재·음극재", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "005380.KS", name: "현대차", desc: "완성차 1위", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "012330.KS", name: "현대모비스", desc: "자동차 부품·모듈", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "000270.KS", name: "기아", desc: "완성차", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "204320.KS", name: "HL만도", desc: "제동·조향 부품", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "329180.KS", name: "HD현대중공업", desc: "조선 — 상선·방산함", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "042660.KS", name: "한화오션", desc: "조선 — LNG선·잠수함", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "010140.KS", name: "삼성중공업", desc: "조선 — LNG선·해양플랜트", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "009540.KS", name: "HD한국조선해양", desc: "조선 지주", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "047040.KS", name: "대우건설", desc: "건설 — 주택·해외(원전)", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "006360.KS", name: "GS건설", desc: "건설 — 주택", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "000720.KS", name: "현대건설", desc: "건설 대장 — 원전·해외", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "375500.KS", name: "DL이앤씨", desc: "건설 — 주택·플랜트", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "005490.KS", name: "POSCO홀딩스", desc: "철강·2차전지 소재 지주", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "010130.KS", name: "고려아연", desc: "비철금속 제련", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "004020.KS", name: "현대제철", desc: "철강", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "096770.KS", name: "SK이노베이션", desc: "정유·배터리", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "010950.KS", name: "S-Oil", desc: "정유", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "051910.KS", name: "LG화학", desc: "석유화학·배터리 소재", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "011170.KS", name: "롯데케미칼", desc: "석유화학", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "105560.KS", name: "KB금융", desc: "금융지주 1위", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "055550.KS", name: "신한지주", desc: "금융지주", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "086790.KS", name: "하나금융지주", desc: "금융지주", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "316140.KS", name: "우리금융지주", desc: "금융지주", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "006800.KS", name: "미래에셋증권", desc: "증권 1위", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "071050.KS", name: "한국금융지주", desc: "한국투자증권 지주", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "039490.KS", name: "키움증권", desc: "리테일 증권", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "005940.KS", name: "NH투자증권", desc: "증권", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "032830.KS", name: "삼성생명", desc: "생명보험 1위", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "000810.KS", name: "삼성화재", desc: "손해보험 1위", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "005830.KS", name: "DB손해보험", desc: "손해보험", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "088350.KS", name: "한화생명", desc: "생명보험", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "196170.KS", name: "알테오젠", desc: "피하주사 플랫폼(ALT-B4) 기술이전", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "068270.KS", name: "셀트리온", desc: "바이오시밀러", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "207940.KS", name: "삼성바이오로직스", desc: "바이오 CDMO 1위", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "000100.KS", name: "유한양행", desc: "제약 — 렉라자", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "307510.KS", name: "TIGER 의료기기", desc: "의료기기 ETF — 파마리서치·씨젠·클래시스 등", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "214450.KS", name: "파마리서치", desc: "리쥬란 — 스킨부스터", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "145020.KS", name: "휴젤", desc: "보툴리눔 톡신", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "214150.KS", name: "클래시스", desc: "미용 의료기기(슈링크)", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "336570.KS", name: "원텍", desc: "미용 레이저 장비", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "278470.KS", name: "에이피알", desc: "뷰티 디바이스·화장품", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "161890.KS", name: "한국콜마", desc: "화장품 ODM", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "090430.KS", name: "아모레퍼시픽", desc: "화장품 대장", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "192820.KS", name: "코스맥스", desc: "화장품 ODM", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "003230.KS", name: "삼양식품", desc: "불닭 — K푸드 수출", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "033780.KS", name: "KT&G", desc: "담배·건기식", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "271560.KS", name: "오리온", desc: "제과", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "097950.KS", name: "CJ제일제당", desc: "식품·바이오", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "035420.KS", name: "NAVER", desc: "검색·커머스·AI", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "035720.KS", name: "카카오", desc: "플랫폼", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "018260.KS", name: "삼성SDS", desc: "IT 서비스·클라우드", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "259960.KS", name: "크래프톤", desc: "게임 — 배틀그라운드", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "036570.KS", name: "엔씨소프트", desc: "게임 — 리니지", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "251270.KS", name: "넷마블", desc: "게임", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "462870.KS", name: "시프트업", desc: "게임 — 스텔라블레이드", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "352820.KS", name: "하이브", desc: "엔터 대장", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "035900.KS", name: "JYP Ent.", desc: "엔터", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "041510.KS", name: "에스엠", desc: "엔터", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "122870.KS", name: "와이지엔터테인먼트", desc: "엔터", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "244580.KS", name: "KODEX 바이오",     desc: "한국 바이오 ETF", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "091170.KS", name: "KODEX 은행",       desc: "한국 은행주 ETF", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "449450.KS", name: "K-방산",         desc: "한국 방산 ETF — 한화에어로/LIG넥스원/KAI/현대로템", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "266420.KS", name: "KODEX 헬스케어",    desc: "한국 헬스케어 ETF", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "266410.KS", name: "KODEX 필수소비재",  desc: "한국 필수소비재 ETF — 음식료·생활필수품 방어주", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "228790.KS", name: "TIGER 화장품",      desc: "한국 화장품 ETF — 아모레퍼시픽/LG생활건강/코스맥스 등", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "0190C0.KS", name: "RISE 피지컬AI",    desc: "RISE 현대차고정피지컬AI — 현대차 25% + 국내 피지컬AI 밸류체인(LG CNS·현대오토에버·두산로보틱스·레인보우로보틱스·에스피지). 미국 KOID 선행에 대응하는 한국 타깃", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "487240.KS", name: "KODEX AI전력핵심설비", desc: "AI 데이터센터 전력설비 ETF — 변압기·전선·발전기 등 전력기기 밸류체인", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "445290.KS", name: "KODEX 로봇",       desc: "한국 로봇 ETF — 레인보우로보틱스/두산로보틱스/에스피지 등", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "BOTZ", name: "로봇 ETF", desc: "Global X 로봇·AI ETF — 한국 로봇주 다음 날 상관 0.33(1년)·0.39(3개월), 미국 쪽 1위", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "TER", name: "테라다인", desc: "Teradyne — 협동로봇(유니버설로봇)·반도체 테스트. 한국 로봇 다음 날 상관 0.17~0.22(엔비디아 다음)", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "0148J0.KS", name: "TIGER 코리아휴머노이드", desc: "한국 휴머노이드 로봇 산업 ETF — 로봇 ETF 중 거래대금 1위", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "108490.KS", name: "로보티즈", desc: "로봇 액추에이터(다이나믹셀)·휴머노이드 부품", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "277810.KS", name: "레인보우로보틱스", desc: "협동로봇·휴머노이드 — 삼성전자 최대주주", tier: "T0", sector: "dashboard", direction: "direct", krStock: true },
  { symbol: "0038A0.KS", name: "KODEX 미국휴머노이드로봇", desc: "미국 휴머노이드 로봇 — 국내 상장, 하루 시차로 간밤 미국을 따라간다", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "091180.KS", name: "KODEX 자동차",     desc: "한국 자동차 ETF — 현대차/기아/현대모비스 등", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "102970.KS", name: "KODEX 증권",       desc: "한국 증권주 ETF — 미래에셋/삼성증권/키움 등", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "117680.KS", name: "KODEX 철강",       desc: "한국 철강 ETF — 포스코/현대제철 등", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "117460.KS", name: "KODEX 에너지화학",  desc: "한국 에너지·화학 ETF — LG화학/롯데케미칼/S-Oil 등", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "466920.KS", name: "SOL 조선TOP3플러스", desc: "한국 조선 ETF — HD현대중공업/삼성중공업/한화오션", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "433500.KS", name: "ACE 원자력TOP10", desc: "한국 원전 ETF — 두산에너빌리티/현대건설/대우건설 등 원전 밸류체인", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "266360.KS", name: "KODEX K콘텐츠",    desc: "한국 엔터·콘텐츠 ETF — 하이브/JYP/에스엠/CJ ENM", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "300950.KS", name: "KODEX 게임산업",   desc: "한국 게임 ETF — 크래프톤/엔씨소프트/넷마블 등", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "140700.KS", name: "KODEX 보험",       desc: "한국 보험 ETF — 삼성생명/삼성화재/DB손보 등", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "329200.KS", name: "TIGER 리츠부동산인프라", desc: "한국 리츠·부동산 ETF — 배당·금리인하 수혜", tier: "T0", sector: "dashboard", direction: "direct" },
  // 반도체 TOP2+ / HBM 테마 ETF — 삼성전자·SK하이닉스 집중
  { symbol: "395160.KS", name: "KODEX AI반도체TOP2플러스", desc: "삼성전자·SK하이닉스 집중 + AI반도체 밸류체인", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "395270.KS", name: "HANARO Fn K-반도체",   desc: "한국 반도체 대표 — 삼성·하이닉스 TOP2 비중", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "0167A0.KS", name: "SOL AI반도체TOP2플러스", desc: "삼성전자·SK하이닉스 집중 + AI반도체", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "0210A0.KS", name: "ACE K반도체TOP2+",    desc: "삼성전자·SK하이닉스 집중 반도체", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "442580.KS", name: "PLUS 글로벌HBM반도체",  desc: "글로벌 HBM 밸류체인 — 하이닉스·마이크론·엔비디아 등", tier: "T0", sector: "dashboard", direction: "direct" },
  // 반도체 소부장(소재·부품·장비)·공정 테마 ETF
  { symbol: "475300.KS", name: "SOL 반도체전공정",      desc: "반도체 전공정 소부장 ETF — 장비·소재 밸류체인", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "482030.KS", name: "KoAct 반도체&2차전지핵심소재", desc: "반도체·2차전지 핵심소재 액티브 ETF", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "476260.KS", name: "HANARO 반도체핵심공정주도주", desc: "반도체 핵심공정 주도주 ETF — 소부장 대표", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "455850.KS", name: "SOL AI반도체소부장",     desc: "AI반도체 소재·부품·장비 ETF", tier: "T0", sector: "dashboard", direction: "direct" },
  { symbol: "471990.KS", name: "KODEX AI반도체핵심장비",  desc: "AI반도체 핵심장비 ETF — 전공정 장비주", tier: "T0", sector: "dashboard", direction: "direct" },
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

// yasun.gg 에서 가져오는 야선 가상 심볼 — Yahoo 배치에서 제외해야 함
const YASUN_VIRTUAL = new Set<string>(["^KS200N", "^KQ150N"]);

// 모든 Yahoo 심볼 한 번에 fetch 하기 위한 평탄화 (현물 + 선물)
export function allYahooSymbols(): { symbol: string; name: string }[] {
  const result: { symbol: string; name: string }[] = [];
  for (const p of US_PAIRS) {
    if (YASUN_VIRTUAL.has(p.symbol)) continue;   // yasun 별도 fetch
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
