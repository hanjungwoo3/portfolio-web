// 하단 지수 티커바 — 펼침/접힘 상태(localStorage). PC·모바일 공용.
//  모바일은 합계바(fixed bottom)가 이미 있어 티커바 높이만큼 위로 올려야 하므로
//  상태를 공유해 양쪽이 같은 값을 본다.
import { useEffect, useState } from "react";

const KEY = "ticker_bar_open";
const EVENT = "ticker-bar-change";

// 바 높이(px) — 모바일 합계바 bottom 오프셋 계산에 사용
export const TICKER_BAR_H = 30;

export function getTickerBarOpen(): boolean {
  try { return localStorage.getItem(KEY) !== "0"; }   // 기본 = 펼침
  catch { return true; }
}

export function setTickerBarOpen(open: boolean): void {
  try { localStorage.setItem(KEY, open ? "1" : "0"); }
  catch { /* noop */ }
  window.dispatchEvent(new Event(EVENT));
}

export function useTickerBarOpen(): boolean {
  const [open, setOpen] = useState(getTickerBarOpen);
  useEffect(() => {
    const h = () => setOpen(getTickerBarOpen());
    window.addEventListener(EVENT, h);
    return () => window.removeEventListener(EVENT, h);
  }, []);
  return open;
}

// 국내 / 해외 / 환율·금리 묶음 선택 — 마지막 선택 유지
export type TickerScope = "kr" | "us" | "fx";
const SCOPE_KEY = "ticker_bar_scope";
const SCOPE_VALUES: TickerScope[] = ["kr", "us", "fx"];

export function getTickerScope(): TickerScope {
  try {
    const v = localStorage.getItem(SCOPE_KEY) as TickerScope | null;
    return v && SCOPE_VALUES.includes(v) ? v : "us";   // 기본 = 해외
  } catch { return "us"; }
}
export function setTickerScope(v: TickerScope): void {
  try { localStorage.setItem(SCOPE_KEY, v); }
  catch { /* noop */ }
}
