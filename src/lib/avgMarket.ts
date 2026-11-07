// 지수(업종) 평균을 어느 시장으로 낼까 — 한국(국내 종목) / 미국(칸의 미국 대장주)(사용자 2026-11-05
//   "국장 종료 8시 이후에는 평균값들 미국장 정보로 … 한국/미국 선택 가능하게").
//   기본 = 시간 자동: 평일 08:00~20:00(KST, NXT 애프터까지) 한국, 그 밖·주말 미국.
//   직접 고르면 그 시간대(자동값이 바뀌기 전)까지만 유지 — 다음 날 아침엔 다시 한국으로 돌아온다.
import { useSyncExternalStore } from "react";
import { isMarketOpen } from "./format";
import { rowLead, type DashboardSection } from "./dashboardGroups";

export type AvgMarket = "KR" | "US";
const KEY = "avg_market_pick";
export function autoAvgMarket(t = Date.now()): AvgMarket {
  const k = new Date(t + 9 * 3600_000), d = k.getUTCDay(), m = k.getUTCHours() * 60 + k.getUTCMinutes();
  return d >= 1 && d <= 5 && m >= 8 * 60 && m < 20 * 60 ? "KR" : "US";
}
let cur: AvgMarket = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as { v: AvgMarket; auto: AvgMarket; day: string } | null;
    if (v && v.auto === autoAvgMarket() && Date.now() - Date.parse(`${v.day}T00:00:00+09:00`) < 36 * 3600_000) return v.v;
  } catch { /* 없음 */ }
  return autoAvgMarket();
})();
const ls = new Set<() => void>();
let lastAuto = autoAvgMarket();
// 자동 구간이 바뀌면(20:00·08:00) 직접 고른 것을 풀고 자동으로
if (typeof window !== "undefined") setInterval(() => {
  const a = autoAvgMarket();
  if (a !== lastAuto) { lastAuto = a; cur = a; try { localStorage.removeItem(KEY); } catch { /* noop */ } ls.forEach(f => f()); }
}, 60_000);

export const avgMarketNow = () => cur;
export function setAvgMarket(v: AvgMarket) {
  cur = v;
  try { localStorage.setItem(KEY, JSON.stringify({ v, auto: autoAvgMarket(), day: new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10) })); } catch { /* 이번만 */ }
  ls.forEach(f => f());
}
export function useAvgMarket(): AvgMarket {
  return useSyncExternalStore(cb => { ls.add(cb); return () => { ls.delete(cb); }; }, () => cur, () => cur);
}
/** 해외 대장주(미국·일본) — 국내 .KS/.KQ·지수(^) 빼고(사용자 2026-11-05 "국내/해외") */
export const isOverseasTicker = (s: string) => !/\.(KS|KQ)$/.test(s) && !s.startsWith("^");

/** 정규장 밖 구간 이름 — 국내는 15:30 뒤 '애프터'(NXT), 미국은 한국 시각으로 09~17시 '데이'(오버나잇)·17시~정규장 '프리'·정규장 뒤 '애프터'(주말은 금요일 애프터)(사용자 2026-11-07 "프리장·애프터·정규장까지") */
export type Ses = "프리" | "애프터" | "데이";
export function usSessionLabel(t = Date.now()): Ses {
  const k = new Date(t + 9 * 3600_000), d = k.getUTCDay(), m = k.getUTCHours() * 60 + k.getUTCMinutes();
  if (d === 0 || (d === 6 && m >= 9 * 60) || (d === 1 && m < 9 * 60)) return "애프터";
  return m >= 9 * 60 && m < 17 * 60 ? "데이" : m >= 17 * 60 ? "프리" : "애프터";
}
/** 미국 대장주가 정규장 밖(프리·애프터·데이)일 때 — 정규장 등락(책갈피)과 그 뒤 움직임(본문 큰 %).
 *  지수 탭 미국 카드와 같은 규칙: 장 밖 현재가 = postPrice(있으면), 기준 = 최근 정규장 종가(사용자 2026-11-05 "해외 미국도 정규장/프리장 구분") */
export function usRegExtOf(sym: string, q?: { price: number; postPrice?: number | null; regularPrice?: number | null; regularPct?: number | null; marketState?: string | null }): { reg: number; aft: number; price: number; regPrice: number; ses: Ses } | null {
  if (!q || !isOverseasTicker(sym) || /\.T$/.test(sym) || isMarketOpen("US_INDEX")) return null;
  if (!(q.regularPrice && q.regularPrice > 0) || q.regularPct == null) return null;
  const off = ["PRE", "POST", "POSTPOST", "PREPRE", "CLOSED"].includes(q.marketState ?? "");
  const p = off && q.postPrice ? q.postPrice : q.price;
  return { reg: q.regularPct, aft: (p / q.regularPrice - 1) * 100, price: p, regPrice: q.regularPrice, ses: usSessionLabel() };
}

// 순환매(한눈에) 줄 요약 — 해외(미국 대장주)·국내(한국 종목, 참고 ETF 제외) 평균. PC·모바일 한 벌(사용자 2026-11-07 "한눈에 1·2번")
//   pctOf = 카드 본문 %, regExtOf = 정규장 등락 + 그 뒤(애프터·프리) — 있으면 평균은 정규장, 꼬리표는 그 뒤
export type RowAvg = { avg: number; aft: number | null; up: number; n: number; ses: Ses | null };
export function avgOfSyms(syms: string[], pctOf: (s: string) => number | null, regExtOf: (s: string) => { reg: number; aft: number; ses?: Ses } | null): RowAvg | null {
  const v = syms.map(x => { const e = regExtOf(x); return { p: e?.reg ?? pctOf(x), a: e?.aft ?? null, ses: e?.ses ?? null }; }).filter(x => x.p != null && Number.isFinite(x.p));
  if (!v.length) return null;
  // 정확히 0 = 그 뒤 체결이 없어 정규장 종가를 그대로 쓴 것(값 없음) — 평균에서 빼고 꼬리표도 안 단다(사용자 2026-11-07 "해외 상황인데 0.00%?")
  const as = v.flatMap(x => x.a != null && Number.isFinite(x.a) && Math.abs(x.a) >= 0.005 ? [x.a] : []);
  return { avg: v.reduce((t, x) => t + x.p!, 0) / v.length, aft: as.length ? as.reduce((t, x) => t + x, 0) / as.length : null, up: v.filter(x => x.p! > 0).length, n: v.length,
    ses: v.find(x => x.ses)?.ses ?? null };
}
export function rotRowAvg(section: DashboardSection, ri: number, pctOf: (s: string) => number | null, regExtOf: (s: string) => { reg: number; aft: number; ses?: Ses } | null): { ov: RowAvg | null; kr: RowAvg | null } {
  const row = section.rows[ri] ?? [], n = rowLead(section, ri);
  return { ov: avgOfSyms(row.slice(0, n), pctOf, regExtOf), kr: avgOfSyms(row.slice(n).filter(x => !(section.extras ?? []).includes(x)), pctOf, regExtOf) };
}
/** 순환매 줄 순서 — 해외 평균 큰 순(값 없는 줄 뒤, 같으면 원래 순서) */
export function rotRowOrder(section: DashboardSection, pctOf: (s: string) => number | null, regExtOf: (s: string) => { reg: number; aft: number; ses?: Ses } | null): number[] {
  const ov = section.rows.map((_, i) => rotRowAvg(section, i, pctOf, regExtOf).ov?.avg ?? -Infinity);
  return section.rows.map((_, i) => i).sort((a, b) => (ov[b] - ov[a]) || a - b);
}
