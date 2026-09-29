// 거래 기록이 바뀌었다는 알림 — 오늘 손익을 다시 계산하게 만든다.
//
// 왜 필요한가: 오늘 손익은 보유가 아니라 **거래 로그**에서 나온다(attachTodayBuys).
//   그런데 거래를 고치는 화면(기업가치 팝업의 TradeLogSection·내거래 탭)은 자기 목록만
//   다시 읽을 뿐, 앱이 들고 있는 거래 캐시는 건드리지 않았다. 그래서 잘못 넣은 매수를
//   지워도 **오늘 손익이 그 전 상태에 멈춰 있었다**(실측: 취소한 매수가 계속 반영돼
//   오늘이 +로 보였다).
//
// db.ts 의 거래 변경 함수에서 한 번만 쏘면 모든 호출부가 덮인다 — 화면마다 콜백을
//   꽂으면 새 화면이 생길 때마다 또 빠뜨린다.
export const TRADES_CHANGED_EVENT = "trades-changed";

export function notifyTradesChanged(): void {
  try { window.dispatchEvent(new Event(TRADES_CHANGED_EVENT)); } catch { /* SSR·테스트 */ }
}
