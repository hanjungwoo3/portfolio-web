// ETF 비교 카테고리 — 같은 기초지수를 추종하는 국내 ETF들을 묶어 운용사·보수·배당·수익률 비교.
//   순수 지수추종만 (커버드콜·레버리지·인버스·채권혼합·액티브 제외). (H)=환헤지형.
//   새 카테고리(S&P500·미국배당100 등)는 여기 배열에만 추가하면 됨.

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
];
