// 거래(trades) 실현손익 계산 — 내거래 테이블·간트 차트 공용.
import type { Trade } from "./db";

export interface RealizedInfo {
  realized: number;   // 실현손익(원)
  pct: number;        // 수익률(%)
  cost: number;       // 청산분 원가(소계 % 계산용)
}

// 종목(독립모드는 종목+그룹)별 매칭 키
export function tradeKey(t: Trade, independent: boolean): string {
  return independent ? `${t.ticker}␟${t.account ?? ""}` : t.ticker;
}

// 매도 건별 실현손익 — 종목별 시간순 처리하는 이동평균 원가법.
//   매수: 보유수량·원가총액 누적.  매도: (매도단가 − 그 시점 평단가) × 매칭수량 = 실현손익.
//   평단가는 매도로 변하지 않음(원가·수량 비례 차감). 보유 없이 나온 매도는 원가 불명 → 제외.
//   ⚠️ 반드시 전체 거래로 계산(기간필터 무관) — 기간 잘리면 원가가 어긋남.
// 반환: tradeId → RealizedInfo
export function computeRealizedByTrade(
  all: Trade[], independent: boolean,
): Map<string, RealizedInfo> {
  const out = new Map<string, RealizedInfo>();
  const groups = new Map<string, Trade[]>();
  for (const t of all) {
    const k = tradeKey(t, independent);
    const arr = groups.get(k);
    if (arr) arr.push(t); else groups.set(k, [t]);
  }
  for (const rows of groups.values()) {
    const sorted = [...rows].sort((a, b) =>
      a.date.localeCompare(b.date) || (a.createdAt ?? 0) - (b.createdAt ?? 0));
    let qty = 0, cost = 0;   // 보유수량, 보유원가총액(= qty × 평단)
    for (const t of sorted) {
      if (t.type === "buy") { qty += t.qty; cost += t.amount; continue; }
      if (qty <= 0 || t.qty <= 0) continue;                 // 원가 불명 매도 → skip
      const avg = cost / qty;
      const sellAvg = t.amount / t.qty;
      const matched = Math.min(t.qty, qty);
      const basis = avg * matched;
      out.set(t.id, {
        realized: Math.round((sellAvg - avg) * matched),
        pct: avg > 0 ? (sellAvg - avg) / avg * 100 : 0,
        cost: basis,
      });
      cost -= basis; qty -= matched;                        // 이동평균: 평단 유지
    }
  }
  return out;
}

// 익절/손절 칩 — 솔리드 배경(이익 빨강 / 손실 파랑 / 본전 회색) + 라벨
export function realizedChip(n: number): { bg: string; label: string } {
  if (n > 0) return { bg: "bg-rose-500", label: "익절" };
  if (n < 0) return { bg: "bg-blue-500", label: "손절" };
  return { bg: "bg-gray-400", label: "본전" };
}
