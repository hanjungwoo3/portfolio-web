// 지수 탭 카드의 흐림(장 닫힘) 판정 — PC(UsMarketTab)·모바일(MobileSimpleView) 카드와 줄 정렬이 **같은 함수**를 쓴다.
//   예전엔 두 화면 카드 반복문 안에 같은 코드가 두 벌 있었고, 정렬에서는 쓸 수 없었다
//   (사용자 2026-10-28 "프리장에서 안 열린 종목은(흐린) 뒤로").
import type { UsIndex } from "./api";
import {
  isKrHoldingClosed, isSymbolSleeping, marketOfSymbol, isUsExtendedTradingOpen,
  isQuoteStale, isUsRateSymbol, isFxFuturesWeekendClosed,
} from "./format";

export function dashboardCardDim(p: { symbol: string; krStock?: boolean }, q: UsIndex | undefined, dimEnabled: boolean): boolean {
  if (!dimEnabled) return false;
  // 한국 종목·ETF(.KS) — 보유 종목 카드와 같은 규칙: 프리(08:00~)·애프터(~20:00)에 실제 체결이 들어오면 열림,
  //   단일가 진행 중이면 열림, ETF·ETN 은 15:30 이후 바로 마감
  const sleeping = /^[\dA-Za-z]{6}\.KS$/.test(p.symbol)
    ? isKrHoldingClosed(undefined, undefined, q?.singlePrice, q?.freshTime ?? 0, !p.krStock)
    : isSymbolSleeping(p.symbol);
  const is24h = marketOfSymbol(p.symbol) === "OTHER";
  const isClosed = !is24h && q?.marketState != null && ["POST", "POSTPOST", "PREPRE", "CLOSED"].includes(q.marketState);
  const inSession = !!(q?.marketState && ["REGULAR", "PRE", "POST", "POSTPOST", "PREPRE"].includes(q.marketState))
    || (marketOfSymbol(p.symbol) === "US" && isUsExtendedTradingOpen());
  const stale = isQuoteStale(q?.freshTime);
  // 국채 yield 는 아시아·런던 세션에도 움직인다 — 주말 휴장만 흐림
  if (isUsRateSymbol(p.symbol)) return isFxFuturesWeekendClosed(p.symbol);
  const weekendClosed = is24h && isFxFuturesWeekendClosed(p.symbol);
  return stale || weekendClosed || (!inSession && (sleeping || isClosed));
}
