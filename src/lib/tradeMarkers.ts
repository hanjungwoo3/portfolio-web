// 차트에 찍을 매수/매도 마커 — 거래로그(trades)를 날짜별로 접어서 만든다.
// 보유(shares/avg_price)와 무관한 순수 표시용. 같은 날 같은 방향 거래가 여러 건이면
// 증권사 앱처럼 한 점으로 합치고 평균단가를 보여준다 (건별로 찍으면 겹쳐서 안 읽힘).

import type { Trade } from "./db";

export interface TradeMarker {
  date: string;               // YYYY-MM-DD
  type: "buy" | "sell";
  qty: number;                // 그날 합계 수량
  avgPrice: number;           // 그날 평균단가 = 금액합 / 수량합
  accounts: string[];         // 어느 그룹에서의 거래인지 (중복 제거)
  count: number;              // 합쳐진 원본 거래 건수
}

const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];

// "2026-02-06" → "2026.02.06 (금)"
export function formatMarkerDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  // 로컬 타임존 파싱 (new Date("2026-02-06") 은 UTC 라 KST 에서 하루 밀림)
  const wd = WEEKDAY[new Date(y, m - 1, d).getDay()] ?? "";
  return `${y}.${String(m).padStart(2, "0")}.${String(d).padStart(2, "0")} (${wd})`;
}

export function aggregateTradeMarkers(trades: Trade[]): TradeMarker[] {
  const bucket = new Map<string, { qty: number; amount: number; accounts: Set<string>; count: number }>();

  for (const t of trades) {
    if (!t.date || !(t.qty > 0)) continue;          // 수량 0/음수 기록은 찍을 점이 없음
    const key = `${t.date}__${t.type}`;
    const cur = bucket.get(key);
    if (cur) {
      cur.qty += t.qty;
      cur.amount += t.amount;
      cur.count += 1;
      if (t.account) cur.accounts.add(t.account);
    } else {
      bucket.set(key, {
        qty: t.qty,
        amount: t.amount,
        accounts: new Set(t.account ? [t.account] : []),
        count: 1,
      });
    }
  }

  const out: TradeMarker[] = [];
  for (const [key, v] of bucket) {
    const [date, type] = key.split("__") as [string, "buy" | "sell"];
    out.push({
      date,
      type,
      qty: v.qty,
      avgPrice: v.qty > 0 ? v.amount / v.qty : 0,
      accounts: [...v.accounts].sort(),
      count: v.count,
    });
  }
  // 날짜 오름차순 — 같은 날이면 매수 먼저 (슬롯 배치가 안정적이도록)
  out.sort((a, b) => a.date.localeCompare(b.date) || (a.type === b.type ? 0 : a.type === "buy" ? -1 : 1));
  return out;
}
