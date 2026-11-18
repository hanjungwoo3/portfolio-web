// 지수 서랍 '고정' — 서랍이 닫혀 있을 때 오른쪽 손잡이 아래에 작게 띄울 카드(사용자 2026-11-19 "지수 창에서 보여줄 값을 check").
//   서랍 카드의 📌 로 켜고 끈다. 이 기기 localStorage, 순서 = 고른 순서. 처음엔 코스피·코스닥.
import { useSyncExternalStore } from "react";

const KEY = "index_drawer_pins";
const DEFAULT = ["^KS11", "^KQ11"];
const ls = new Set<() => void>();
function read(): string[] {
  try { const v = localStorage.getItem(KEY); return v ? (JSON.parse(v) as string[]).filter(x => typeof x === "string") : DEFAULT; } catch { return DEFAULT; }
}
let cur = read();
export function getDrawerPins(): string[] { return cur; }
export function toggleDrawerPin(sym: string): void {
  cur = cur.includes(sym) ? cur.filter(x => x !== sym) : [...cur, sym];
  try { localStorage.setItem(KEY, JSON.stringify(cur)); } catch { /* 이번만 */ }
  ls.forEach(f => f());
}
export function useDrawerPins(): string[] {
  return useSyncExternalStore(cb => { ls.add(cb); return () => { ls.delete(cb); }; }, () => cur, () => cur);
}
