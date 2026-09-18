// 가격대별 투자자 순매수(매물대) 계산 — 화면 두 곳이 같은 숫자를 쓰도록 여기 한 곳에만 둔다.
//   ① 기업가치 모달의 '🧱 가격대별 순매수' 막대
//   ② 일봉 차트의 '매물대' 오버레이 (토글)
//
// 일별 순매수(수량)를 **그 날 종가**의 가격대 칸에 쌓는다. 날짜 축으로는 안 보이는 것,
//   즉 "어느 가격대에서 사서 어느 가격대에서 팔았나" 를 본다.
//
// ★ 금융투자를 기관에서 뺀 값을 기본으로 둔다. 금융투자는 증권사 자기매매라 ETF 설정·차익·헤지가
//   섞이고, 합쳐 놓으면 방향이 서로 희석된다. 실측(성호전자 120일):
//     기관계        평균매수 38,177 / 평균매도 30,112 (차 +8,065)
//     금융투자      평균매수 25,818 / 평균매도 31,847 (차 −6,029)  ← 반대로 움직였다
//     기관(금투 제외) 평균매수 38,716 / 평균매도 29,589 (차 +9,126)  ← 분리하니 선명해진다

import type { Investor } from "../types";

export type ProfileWho =
  | "inst_ex_fin" | "financialInvestment" | "pensionFund" | "trust" | "foreigner" | "individual";

export interface ProfileBin { lo: number; hi: number; value: number }
export interface PriceProfile {
  bins: ProfileBin[];
  lo: number; hi: number;
  days: number;        // 실제로 쓴 일수
  max: number;         // 막대 정규화용 (|value| 최대)
  avgBuy: number | null;   // 순매수한 날들의 가중평균 단가
  avgSell: number | null;  // 순매도한 날들의 가중평균 단가
  net: number;
}

/** 그 날 그 투자자의 순매수 수량. 기관(금투 제외)만 계산이 들어간다. */
export function investorVolume(d: Investor, who: ProfileWho): number {
  switch (who) {
    case "inst_ex_fin":         return (d.기관 ?? 0) - (d.금융투자 ?? 0);
    case "financialInvestment": return d.금융투자 ?? 0;
    case "pensionFund":         return d.연기금 ?? 0;
    case "trust":               return d.투신 ?? 0;
    case "foreigner":           return d.외국인 ?? 0;
    case "individual":          return d.개인 ?? 0;
  }
}

/**
 * @param history 최신→과거 순 (토스 trading-trend). 종가가 있는 날만 쓴다.
 * @param won true 면 값이 금액(수량 × 그 날 종가), false 면 수량(주)
 */
export function buildPriceProfile(
  history: Investor[], who: ProfileWho, days: number, won = false, buckets = 12,
): PriceProfile | null {
  const rows = history.filter(d => (d.종가 ?? 0) > 0).slice(0, days);
  if (rows.length < 5) return null;

  const prices = rows.map(d => d.종가 as number);
  const lo = Math.min(...prices), hi = Math.max(...prices);
  const width = (hi - lo) / buckets || 1;
  const bins: ProfileBin[] = Array.from({ length: buckets }, (_, i) => ({
    lo: lo + i * width, hi: lo + (i + 1) * width, value: 0,
  }));

  // 평균 단가는 버킷 중앙값이 아니라 **일별 종가 가중**으로 낸다 — 그게 더 정확하다.
  let buyQty = 0, buyAmt = 0, sellQty = 0, sellAmt = 0;
  for (const d of rows) {
    const px = d.종가 as number;
    const q = investorVolume(d, who);
    if (!q) continue;
    const idx = Math.min(buckets - 1, Math.max(0, Math.floor((px - lo) / width)));
    bins[idx].value += won ? q * px : q;
    if (q > 0) { buyQty += q; buyAmt += q * px; }
    else { sellQty += -q; sellAmt += -q * px; }
  }

  return {
    bins, lo, hi, days: rows.length,
    max: Math.max(...bins.map(b => Math.abs(b.value)), 1),
    avgBuy: buyQty > 0 ? buyAmt / buyQty : null,
    avgSell: sellQty > 0 ? sellAmt / sellQty : null,
    net: bins.reduce((a, b) => a + b.value, 0),
  };
}
