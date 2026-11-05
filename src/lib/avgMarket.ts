// 지수(업종) 평균을 어느 시장으로 낼까 — 한국(국내 종목) / 미국(칸의 미국 대장주)(사용자 2026-11-05
//   "국장 종료 8시 이후에는 평균값들 미국장 정보로 … 한국/미국 선택 가능하게").
//   기본 = 시간 자동: 평일 08:00~20:00(KST, NXT 애프터까지) 한국, 그 밖·주말 미국.
//   직접 고르면 그 시간대(자동값이 바뀌기 전)까지만 유지 — 다음 날 아침엔 다시 한국으로 돌아온다.
import { useSyncExternalStore } from "react";

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
