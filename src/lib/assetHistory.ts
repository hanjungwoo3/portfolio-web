// 일별 자산 추이 역산 — 거래 로그 + 과거 종가로 "그날의 평가금액·매입원금"을 되짚는다.
//
// 앱에 과거 스냅샷이 없어서(예수금도 현재값만 존재) 과거 곡선을 보려면 재구성뿐이다.
// 재료: trades(매수/매도 로그) + 종목별 일봉 종가. 둘 다 이미 앱에 있다.
//
// 원가 계산은 평균단가법 — 국내 증권사 MTS 와 같은 방식.
//   매수: qty += q,  cost += 매수금액
//   매도: 실현손익 += 매도금액 − 평단×q,  cost -= 평단×q,  qty -= q
// 그래서 "매입원금(principal)"은 지금 들고 있는 수량의 취득원가이지, 누적 투입금이 아니다.
// 누적 투입금(netInvested)도 같이 내보내 필요에 따라 고를 수 있게 한다.

import type { Trade } from "./db";

export interface AssetPoint {
  date: string;
  principal: number;     // 매입금액 — 보유분 취득원가
  value: number;         // 평가금액 — 보유수량 × 그날 종가
  unrealized: number;    // 평가손익 = value − principal
  realizedCum: number;   // 그날까지 누적 실현손익
  totalPnl: number;      // 평가손익 + 누적실현손익
  returnPct: number;     // 평가손익률 = unrealized ÷ principal × 100
  netInvested: number;   // 누적 순투입 = 매수총액 − 매도총액
  held: number;          // 보유 종목 수
  priced: number;        // 그중 그날 종가를 구한 종목 수 (신뢰도)
}

interface Pos { qty: number; cost: number }

// closes: ticker → (date → 종가). 없는 날은 직전 종가를 이어 쓴다(휴장·거래정지).
export function buildAssetHistory(
  trades: Trade[],
  closes: Map<string, Map<string, number>>,
): AssetPoint[] {
  const sorted = [...trades]
    .filter(t => t.date && t.qty > 0)
    .sort((a, b) => (a.date === b.date
      ? (a.createdAt ?? 0) - (b.createdAt ?? 0)
      : a.date < b.date ? -1 : 1));
  if (sorted.length === 0) return [];

  // 날짜 축 = 종가가 존재하는 모든 날(= 거래일) 중 첫 거래일 이후.
  //   거래일이 축에 없을 수도 있어(데이터 누락) 거래는 '축 날짜 <= 거래일' 조건으로 흘려보낸다.
  const firstTrade = sorted[0].date;
  const axis = new Set<string>();
  for (const m of closes.values()) {
    for (const d of m.keys()) if (d >= firstTrade) axis.add(d);
  }
  const dates = [...axis].sort();
  if (dates.length === 0) return [];

  const pos = new Map<string, Pos>();
  const lastClose = new Map<string, number>();
  let realizedCum = 0;
  let netInvested = 0;
  let ti = 0;
  const out: AssetPoint[] = [];

  for (const d of dates) {
    // 이 날짜까지의 거래를 모두 반영 (같은 날 여러 건도 순서대로)
    while (ti < sorted.length && sorted[ti].date <= d) {
      const t = sorted[ti++];
      const p = pos.get(t.ticker) ?? { qty: 0, cost: 0 };
      if (t.type === "buy") {
        p.qty += t.qty;
        p.cost += t.amount;
        netInvested += t.amount;
      } else {
        const avg = p.qty > 0 ? p.cost / p.qty : 0;
        const q = Math.min(t.qty, p.qty);          // 로그가 어긋나도 음수 보유는 만들지 않는다
        realizedCum += t.amount - avg * q;
        p.qty -= q;
        p.cost -= avg * q;
        netInvested -= t.amount;
        if (p.qty <= 0) { p.qty = 0; p.cost = 0; }  // 전량 매도 — 반올림 잔여 제거
      }
      pos.set(t.ticker, p);
    }

    let value = 0, principal = 0, held = 0, priced = 0;
    for (const [ticker, p] of pos) {
      if (p.qty <= 0) continue;
      held++;
      principal += p.cost;
      const c = closes.get(ticker)?.get(d);
      if (c != null && c > 0) { lastClose.set(ticker, c); priced++; }
      const px = c ?? lastClose.get(ticker);
      if (px != null && px > 0) value += p.qty * px;
      else value += p.cost;        // 종가를 끝내 못 구하면 원가로 — 곡선이 0 으로 꺼지는 것보다 낫다
    }
    if (held === 0 && out.length === 0) continue;   // 첫 매수 전 구간은 그리지 않는다

    const unrealized = value - principal;
    out.push({
      date: d, principal, value, unrealized, realizedCum,
      totalPnl: unrealized + realizedCum,
      returnPct: principal > 0 ? (unrealized / principal) * 100 : 0,
      netInvested, held, priced,
    });
  }
  return out;
}

// 표시 기간 — MTS 관행(1개월/3개월/6개월/1년/전체)
export const RANGE_OPTS = [
  { key: "1m", label: "1개월", days: 30 },
  { key: "3m", label: "3개월", days: 90 },
  { key: "6m", label: "6개월", days: 180 },
  { key: "1y", label: "1년", days: 365 },
  { key: "all", label: "전체", days: 0 },
] as const;
export type RangeKey = typeof RANGE_OPTS[number]["key"];

export function sliceByRange(points: AssetPoint[], range: RangeKey): AssetPoint[] {
  const opt = RANGE_OPTS.find(o => o.key === range);
  if (!opt || opt.days === 0 || points.length === 0) return points;
  const last = points[points.length - 1].date;
  const from = new Date(new Date(`${last}T00:00:00Z`).getTime() - opt.days * 86400_000)
    .toISOString().slice(0, 10);
  return points.filter(p => p.date >= from);
}

// 스냅샷 병합 — 실측이 있는 날은 역산 대신 실측값을 쓴다.
//   역산은 거래 로그에 없는 매매·수기 조정을 못 담으므로, 같은 날짜면 실측이 우선.
//   누적 실현손익은 스냅샷에 없으므로 역산값을 그대로 유지한다(원가 흐름은 거래 로그가 유일한 근거).
//   역산 축에 없는 날짜(휴장 중 기록 등)의 스냅샷은 뒤에 덧붙인다.
export function mergeSnapshots(
  points: AssetPoint[],
  snaps: { date: string; value: number; principal: number }[],
): AssetPoint[] {
  if (snaps.length === 0) return points;
  const byDate = new Map(points.map(p => [p.date, p]));
  const recalc = (base: AssetPoint, value: number, principal: number): AssetPoint => {
    const unrealized = value - principal;
    return {
      ...base, value, principal, unrealized,
      totalPnl: unrealized + base.realizedCum,
      returnPct: principal > 0 ? (unrealized / principal) * 100 : 0,
    };
  };
  const extra: AssetPoint[] = [];
  const lastPoint = points[points.length - 1];
  for (const s of snaps) {
    if (!(s.value > 0)) continue;
    const hit = byDate.get(s.date);
    if (hit) { byDate.set(s.date, recalc(hit, s.value, s.principal)); continue; }
    if (lastPoint && s.date > lastPoint.date) {
      // 역산 축보다 나중(예: 시세 캐시가 아직 오늘을 못 받은 경우) — 마지막 상태를 이어 붙인다
      extra.push(recalc({ ...lastPoint, date: s.date }, s.value, s.principal));
    }
  }
  return [...byDate.values(), ...extra].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
