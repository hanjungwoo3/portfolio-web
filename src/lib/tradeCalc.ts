// 거래(trades) 실현손익 계산 — 내거래 테이블·간트 차트 공용.
import type { Trade } from "./db";
import type { Stock } from "../types";
import { isTodayKst } from "./format";
import { normalizeAccount } from "./account";

// 보유에 '오늘 매수분'(todayShares/todayCost)을 거래 로그로부터 주입.
//  추가매수로 holding.buy_date 가 오늘이 되면 holdingYesterdayBaseSum 이 '보유 전체를 오늘 산 것'으로
//  잡아 오늘 손익 = 전체 손익이 되던 버그 방지 — 실제 오늘 산 수량만 분리해 어제분과 합산.
//  · 독립 보유 ON: 그룹마다 별도 보유 → (종목+그룹)으로 매칭.
//  · 동기화 OFF(기본): 같은 종목이 모든 그룹에 미러링, 거래는 한 그룹에만 기록 →
//    종목으로만 매칭해 모든 미러 행에 동일하게 주입(특정 그룹 카드만 어긋나던 문제 해결).
export function attachTodayBuys(holdings: Stock[], trades: Trade[], independent: boolean): Stock[] {
  const keyOf = (ticker: string, account?: string) =>
    independent ? `${ticker}|${normalizeAccount(account)}` : ticker;
  // 키별 전체 거래를 FIFO(선입선출)로 처리해 '현재 보유분 중 실제 오늘 매수분' 수량·원가 산출.
  //  ⚠️ 오늘 매수만 합산하면(과거 방식) 오늘 아침에 사고판(왕복) 물량까지 오늘매수로 잡혀
  //     현재 보유분 오늘 원가가 오염됨(오늘 손익 오류). 매도가 오래된 랏부터 소진(FIFO)해야
  //     '지금 들고 있는 게 오늘 산 것인지'가 정확히 갈림.
  const byKey = new Map<string, Trade[]>();
  for (const t of trades) {
    const k = keyOf(t.ticker, t.account);
    const arr = byKey.get(k); if (arr) arr.push(t); else byKey.set(k, [t]);
  }
  const todayByKey = new Map<string, { shares: number; cost: number }>();
  for (const [k, rows] of byKey) {
    const sorted = [...rows].sort((a, b) =>
      a.date.localeCompare(b.date) || (a.createdAt ?? 0) - (b.createdAt ?? 0));
    const lots: { qty: number; price: number; today: boolean }[] = [];
    for (const t of sorted) {
      if (t.type === "buy") {
        if (t.qty > 0) lots.push({ qty: t.qty, price: t.amount / t.qty, today: isTodayKst(t.date) });
      } else {
        let sell = t.qty;
        while (sell > 0 && lots.length > 0) {           // 오래된 랏부터 소진(FIFO)
          const lot = lots[0];
          const take = Math.min(sell, lot.qty);
          lot.qty -= take; sell -= take;
          if (lot.qty <= 1e-9) lots.shift();
        }
      }
    }
    let shares = 0, cost = 0;                            // 잔여 랏 중 '오늘 산 것'만 합산
    for (const lot of lots) if (lot.today) { shares += lot.qty; cost += lot.qty * lot.price; }
    if (shares > 0) todayByKey.set(k, { shares, cost });
  }
  // 묵은 todayShares/todayCost(과거에 DB 로 새어들어간 값)는 항상 먼저 제거 — 이 함수가 유일 권위.
  //  안 그러면 오늘 거래가 없어도 어제 굳은 값이 살아남아 '오늘=전체손익' 으로 표시됨.
  return holdings.map(s => {
    const { todayShares: _ts, todayCost: _tc, ...base } = s;
    const tb = todayByKey.get(keyOf(base.ticker, base.account));
    if (!tb || !(tb.shares > 0) || !(base.shares > 0)) return base;
    const todayShares = Math.min(tb.shares, base.shares);          // 거래로그-보유 불일치 시 보유 초과분 캡
    const todayCost = Math.round(tb.cost * (todayShares / tb.shares));
    return { ...base, todayShares, todayCost };
  });
}

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
