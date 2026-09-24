// ETF 비교 카테고리 — 같은 기초지수를 추종하는 국내 ETF들을 묶어 운용사·보수·배당·수익률 비교.
//   순수 지수추종만 (커버드콜·레버리지·인버스·채권혼합·액티브 제외). (H)=환헤지형.
//   새 카테고리(S&P500·미국배당100 등)는 여기 배열에만 추가하면 됨.
//
// ⚠️ 아래 '반도체' 3개 그룹은 성격이 다르다. S&P500·나스닥100 처럼 **같은 지수**를 여러 운용사가
//   따라가는 게 아니라, 운용사마다 지수를 따로 만들어 쓴다(iSelect·Solactive·FnGuide…).
//   그래서 보수를 견줘 싼 걸 고르는 용도가 아니라 **무엇을 담았나를 견주는** 용도다 —
//   구성종목이 실제로 크게 다르다(실측: KODEX 미국CPU반도체TOP10 은 KODEX 미국AI반도체TOP3플러스와
//   84% 겹치지만, RISE 글로벌AI낸드메모리반도체와는 Marvell 한 종목만 겹친다).
//   각 그룹 desc 에 그 사실을 적어 둔다.

export interface EtfCompareItem {
  code: string;   // 6자리 종목코드
  name: string;   // ETF 정식명
}
export interface EtfCompareGroup {
  id: string;
  label: string;      // 탭/버튼 라벨
  benchmark: string;  // 추종 기초지수 (부제)
  desc?: string;      // 한 줄 설명
  items: EtfCompareItem[];
}

export const ETF_COMPARE_GROUPS: EtfCompareGroup[] = [
  {
    id: "schd",
    label: "미국배당다우존스",
    benchmark: "Dow Jones U.S. Dividend 100 (≈ SCHD)",
    desc: "미국 우량 고배당주 100선 — 배당성장 + 저보수 경쟁",
    items: [
      { code: "458730", name: "TIGER 미국배당다우존스" },
      { code: "446720", name: "SOL 미국배당다우존스" },
      { code: "489250", name: "KODEX 미국배당다우존스" },
      { code: "402970", name: "ACE 미국배당다우존스" },
      { code: "452360", name: "SOL 미국배당다우존스(H)" },
    ],
  },
  {
    id: "sp500",
    label: "미국S&P500",
    benchmark: "S&P 500 (≈ SPY/VOO/IVV)",
    desc: "미국 대형주 500선 — 미국 시장 전체 대표 벤치마크",
    items: [
      { code: "360750", name: "TIGER 미국S&P500" },
      { code: "379800", name: "KODEX 미국S&P500" },
      { code: "360200", name: "ACE 미국S&P500" },
      { code: "379780", name: "RISE 미국S&P500" },
      { code: "433330", name: "SOL 미국S&P500" },
      { code: "429760", name: "PLUS 미국S&P500" },
      { code: "432840", name: "HANARO 미국S&P500" },
      { code: "449770", name: "KIWOOM 미국S&P500" },
      { code: "0026S0", name: "1Q 미국S&P500" },
      { code: "449180", name: "KODEX 미국S&P500(H)" },
      { code: "448290", name: "TIGER 미국S&P500(H)" },
    ],
  },
  {
    id: "qqq",
    label: "미국나스닥100",
    benchmark: "NASDAQ-100 (≈ QQQ)",
    desc: "미국 나스닥 대형 100선 — 빅테크 성장주 집중",
    items: [
      { code: "133690", name: "TIGER 미국나스닥100" },
      { code: "379810", name: "KODEX 미국나스닥100" },
      { code: "367380", name: "ACE 미국나스닥100" },
      { code: "368590", name: "RISE 미국나스닥100" },
      { code: "476030", name: "SOL 미국나스닥100" },
      { code: "0069M0", name: "1Q 미국나스닥100" },
      { code: "448300", name: "TIGER 미국나스닥100(H)" },
      { code: "449190", name: "KODEX 미국나스닥100(H)" },
      { code: "453080", name: "KIWOOM 미국나스닥100(H)" },
    ],
  },
  {
    id: "ussemi",
    label: "미국반도체",
    benchmark: "필라델피아 반도체(SOX) · MVIS · NYSE 반도체",
    desc: "미국 반도체 전반 — 여기까지는 널리 쓰이는 지수라 운용사 간 구성이 비슷하다",
    items: [
      { code: "381180", name: "TIGER 미국필라델피아반도체나스닥" },
      { code: "497570", name: "TIGER 미국필라델피아AI반도체나스닥" },
      { code: "390390", name: "KODEX 미국반도체" },
      { code: "469060", name: "RISE 미국반도체NYSE" },
      { code: "469050", name: "RISE 미국반도체NYSE(H)" },
    ],
  },
  {
    id: "aimem",
    label: "AI메모리·낸드·HBM",
    benchmark: "운용사별 자체 지수 (공통 지수 없음)",
    desc: "메모리·낸드·HBM 집중 — 지수가 제각각이라 보수보다 구성종목을 봐야 한다",
    items: [
      { code: "0238F0", name: "KODEX 미국AI메모리TOP2플러스" },
      { code: "0181B0", name: "HANARO 미국AI메모리반도체TOP4+" },
      { code: "0233N0", name: "RISE 글로벌AI낸드메모리반도체" },
      { code: "442580", name: "PLUS 글로벌HBM반도체" },
    ],
  },
  {
    id: "aichip",
    label: "AI반도체·CPU",
    benchmark: "운용사별 자체 지수 (공통 지수 없음)",
    desc: "CPU·GPU·팹리스 등 연산칩 중심 — 같은 '반도체' 라도 메모리형과 겹치는 종목이 거의 없다",
    items: [
      { code: "0151S0", name: "KODEX 미국AI반도체TOP3플러스" },
      { code: "0225V0", name: "KODEX 미국CPU반도체TOP10" },
      { code: "0224D0", name: "KIWOOM 미국CPU반도체TOP4+" },
      { code: "446770", name: "ACE 글로벌반도체TOP4 Plus" },
      { code: "494340", name: "ACE 글로벌AI맞춤형반도체" },
      { code: "491830", name: "TIGER 미국AI반도체팹리스" },
      { code: "479620", name: "SOL 미국AI반도체칩메이커" },
      { code: "473490", name: "KIWOOM 글로벌AI반도체" },
    ],
  },
  {
    id: "robot",
    label: "로봇·피지컬AI",
    benchmark: "운용사별 자체 지수 (공통 지수 없음)",
    desc: "휴머노이드·로보틱스(미국·글로벌·중국) — 상장이 최근이라 1년 수익률이 아직 없는 종목이 많다",
    items: [
      { code: "0038A0", name: "KODEX 미국휴머노이드로봇" },
      { code: "0036R0", name: "RISE 미국휴머노이드로봇" },
      { code: "0078V0", name: "PLUS 미국로보택시" },
      { code: "464310", name: "TIGER 글로벌AI&로보틱스 INDXX" },
      // 중국 — 휴머노이드는 중국 비중이 커서 미국물과 같이 봐야 그림이 보인다.
      //   구성이 완전히 달라 겹치지 않는다(UBTECH·Dobot·Inovance 등 현지 상장).
      { code: "0048K0", name: "KODEX 차이나휴머노이드로봇" },
      { code: "0053L0", name: "TIGER 차이나휴머노이드로봇" },
      // 뺀 것 — 이름만 보고 넣으면 안 되는 두 종류(실측으로 걸러냈다):
      //   · RISE AI&로봇(469070) = **국내 종목** ETF (LG전자·로보티즈·두산로보틱스…).
      //     이 탭은 해외 투자 ETF 비교라 성격이 다르다.
      //   · KODEX 글로벌로봇(합성)(276990) = **스왑형**. 구성이 '스왑(미래에셋증권) 100%' 하나라
      //     구성종목 비교가 아예 불가능하다.
    ],
  },
];
