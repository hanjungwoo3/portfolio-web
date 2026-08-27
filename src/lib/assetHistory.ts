// 일별 자산 추이 역산 — 거래 로그 + 보유현황 + 과거 종가로 "그날의 평가금액·매입원금"을 되짚는다.
//
// 앱에 과거 스냅샷이 없어서(예수금도 현재값만 존재) 과거 곡선을 보려면 재구성뿐이다.
// 재료: trades(매수/매도 로그) + 종목별 일봉 종가 + 지금 보유현황(정답지).
//
// 원가 계산은 평균단가법 — 국내 증권사 MTS 와 같은 방식.
//   매수: qty += q,  cost += 매수금액
//   매도: 실현손익 += 매도금액 − 평단×q,  cost -= 평단×q,  qty -= q
// 그래서 "매입원금(principal)"은 지금 들고 있는 수량의 취득원가이지, 누적 투입금이 아니다.
// 누적 투입금(netInvested)도 같이 내보내 필요에 따라 고를 수 있게 한다.
//
// ★ 기초 잔고(baseline) — 거래 로그는 '내주식'의 전부가 아니다.
//   토스 거래내역을 가져오기 전부터 들고 있던 종목, 수기로 입력한 보유는 로그에 없다.
//   로그만 합치면 마지막 시점 합계가 내주식 화면(총원금/평가액)과 어긋난다.
//   → 로그를 끝까지 재생한 결과와 실제 보유현황의 차이를 "처음부터 들고 있던 수량"으로 보고
//     전 구간에 상수로 깔아 준다(computeBaseline). 마지막 점은 항상 내주식과 일치한다.
//   취득 시점을 모르니 과거 구간에서도 계속 보유한 것으로 가정한다 — 화면에 그 사실을 밝힌다.

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

// 거래 로그로 설명되지 않는 보유분 — 전 구간에 상수로 깔린다. 음수면 '기록 밖 매도'.
export interface BaselineLot { qty: number; cost: number }

interface Pos { qty: number; cost: number }

function sortTrades(trades: Trade[]): Trade[] {
  return [...trades]
    .filter(t => t.date && t.qty > 0)
    .sort((a, b) => (a.date === b.date
      ? (a.createdAt ?? 0) - (b.createdAt ?? 0)
      : a.date < b.date ? -1 : 1));
}

// 거래 1건을 포지션에 반영 — 평균단가법. 실현손익과 순투입 변화를 돌려준다.
function applyTrade(pos: Map<string, Pos>, t: Trade): { realized: number; net: number } {
  const p = pos.get(t.ticker) ?? { qty: 0, cost: 0 };
  let realized = 0;
  let net: number;
  if (t.type === "buy") {
    p.qty += t.qty;
    p.cost += t.amount;
    net = t.amount;
  } else {
    const avg = p.qty > 0 ? p.cost / p.qty : 0;
    const q = Math.min(t.qty, p.qty);          // 로그가 어긋나도 음수 보유는 만들지 않는다
    realized = t.amount - avg * q;
    p.qty -= q;
    p.cost -= avg * q;
    net = -t.amount;
    if (p.qty <= 0) { p.qty = 0; p.cost = 0; }  // 전량 매도 — 반올림 잔여 제거
  }
  pos.set(t.ticker, p);
  return { realized, net };
}

// 거래 로그를 끝까지 재생한 '지금' 포지션 — 보유현황과 맞대 볼 기준.
function replayToEnd(trades: Trade[]): Map<string, Pos> {
  const pos = new Map<string, Pos>();
  for (const t of sortTrades(trades)) applyTrade(pos, t);
  return pos;
}

// 기초 잔고 = 실제 보유현황 − 거래 로그가 설명하는 몫.
//   holdings 는 '내주식'과 같은 기준(ticker 중복 제거 완료)으로 넘길 것.
//   · 로그에 없는 보유          → 양수 lot (처음부터 보유한 것으로 간주)
//   · 로그엔 남았는데 보유 없음 → 음수 lot (기록 밖 매도 — 마지막 점에서 정확히 0 이 된다)
export function computeBaseline(
  trades: Trade[],
  holdings: { ticker: string; shares: number; avg_price: number }[],
): Map<string, BaselineLot> {
  const pos = replayToEnd(trades);
  const out = new Map<string, BaselineLot>();
  const seen = new Set<string>();
  for (const h of holdings) {
    if (!(h.shares > 0) || seen.has(h.ticker)) continue;
    seen.add(h.ticker);
    const l = pos.get(h.ticker);
    const dq = h.shares - (l?.qty ?? 0);
    const dc = h.shares * h.avg_price - (l?.cost ?? 0);
    if (Math.abs(dq) < 1e-9 && Math.abs(dc) < 1) continue;   // 로그가 이미 정확 — 손댈 것 없음
    out.set(h.ticker, { qty: dq, cost: dc });
  }
  for (const [ticker, l] of pos) {
    if (l.qty <= 0 || seen.has(ticker)) continue;
    out.set(ticker, { qty: -l.qty, cost: -l.cost });
  }
  return out;
}

// closes: ticker → (date → 종가·원). 없는 날은 직전 종가를 이어 쓴다(휴장·거래정지).
// baseline: 거래 로그 밖 보유분(computeBaseline). 넘기지 않으면 예전처럼 로그만으로 그린다.
export function buildAssetHistory(
  trades: Trade[],
  closes: Map<string, Map<string, number>>,
  baseline?: Map<string, BaselineLot>,
): AssetPoint[] {
  const sorted = sortTrades(trades);
  const base = baseline ?? new Map<string, BaselineLot>();
  let baseCost = 0;
  let hasBase = false;
  for (const b of base.values()) {
    if (b.qty > 1e-9) { hasBase = true; baseCost += Math.max(0, b.cost); }
  }
  if (sorted.length === 0 && !hasBase) return [];

  // 날짜 축 = 종가가 존재하는 모든 날(= 거래일).
  //   기초 잔고가 있으면 첫 거래 이전에도 보유가 있었다는 뜻이라 조회 가능한 전 구간을 그린다.
  //   기초 잔고가 없으면 예전대로 첫 거래일 이후만.
  //   거래일이 축에 없을 수도 있어(데이터 누락) 거래는 '축 날짜 <= 거래일' 조건으로 흘려보낸다.
  const floor = hasBase ? "" : sorted[0].date;
  const axis = new Set<string>();
  for (const m of closes.values()) {
    for (const d of m.keys()) if (d >= floor) axis.add(d);
  }
  const dates = [...axis].sort();
  if (dates.length === 0) return [];

  const pos = new Map<string, Pos>();
  const lastClose = new Map<string, number>();
  const universe = new Set<string>(base.keys());   // 한 번이라도 등장한 종목
  let realizedCum = 0;
  let netInvested = baseCost;      // 기초 잔고는 시작 시점에 투입된 것으로 본다
  let ti = 0;
  const out: AssetPoint[] = [];

  for (const d of dates) {
    // 이 날짜까지의 거래를 모두 반영 (같은 날 여러 건도 순서대로)
    while (ti < sorted.length && sorted[ti].date <= d) {
      const t = sorted[ti++];
      const r = applyTrade(pos, t);
      realizedCum += r.realized;
      netInvested += r.net;
      universe.add(t.ticker);
    }

    let value = 0, principal = 0, held = 0, priced = 0;
    for (const ticker of universe) {
      const p = pos.get(ticker);
      const b = base.get(ticker);
      const qty = (p?.qty ?? 0) + (b?.qty ?? 0);
      if (qty <= 1e-9) continue;                  // 기록 밖 매도분이 로그 잔량을 다 상쇄한 구간
      const cost = Math.max(0, (p?.cost ?? 0) + (b?.cost ?? 0));
      held++;
      principal += cost;
      const c = closes.get(ticker)?.get(d);
      if (c != null && c > 0) { lastClose.set(ticker, c); priced++; }
      const px = c ?? lastClose.get(ticker);
      if (px != null && px > 0) value += qty * px;
      else value += cost;        // 종가를 끝내 못 구하면 원가로 — 곡선이 0 으로 꺼지는 것보다 낫다
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

// 자산추이 색 — 차트 곡선과 탭 범례가 어긋나지 않도록 한 곳에서만 정한다.
export const ASSET_UP_COLOR   = "#dc2626";   // 이익 — red-600
export const ASSET_DN_COLOR   = "#2563eb";   // 손실 — blue-600
export const ASSET_COST_COLOR = "#9ca3af";   // 매입원금 — gray-400
export const ASSET_INDEX_COLORS: Record<string, string> = {
  kospi:  "#ef4444",   // red-500 — 자산 곡선(이익 시 #dc2626)보다 밝고 선이 얇아 구분된다
  kosdaq: "#f59e0b",   // amber-500
};
// 평가금액 곡선 색 — 마지막 시점이 이익이면 빨강, 손실이면 파랑(한국식)
export function assetLineColor(unrealized: number): string {
  return unrealized >= 0 ? ASSET_UP_COLOR : ASSET_DN_COLOR;
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
