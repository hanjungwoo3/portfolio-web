// 토스 Open API 일봉(`/api/v1/candles?interval=1d`) — 데스크톱 앱 + 토스 연동이 켜져 있을 때 **야후 일봉 대신** 쓴다.
//   왜: 야후가 '너무 많다(429)'로 막으면 화면 전체의 일봉이 비는데(2026-10-23 실측), 토스 공식 API 는 초당 20건 한도가
//   따로 있고 응답도 작다. 계획서 docs/broker-api-integration-plan.md §4 "시세·정보 (대체 가능)".
//   · 휴대폰·웹은 그대로 야후(공식 API 는 앱에서만 부를 수 있다 — 허용 IP·키 보관함).
//   · 안 되는 심볼(지수 ^KS11·환율 KRW=X·해외 거래소 .T 등)은 야후로. 404(종목 없음)·한도·토큰 문제도 전부 야후로 되돌아간다.
//   · 배당·액면분할 이벤트는 안 준다 → 이벤트가 필요한 호출(fetchKrPriceHistoryWithEvents)은 야후 그대로.
//   · 수정주가(adjusted=true, 기본) — 야후 chart close 도 분할 반영이라 같은 성격.
//   응답(실측 문서 2026-10-26): candles[] **최신순**, timestamp ISO(+09:00), 숫자는 전부 문자열, 최대 200봉, nextBefore 로 이어받기.
import { brokerGet, BrokerError, isTossLinkOn } from "./broker";
import type { PricePoint } from "./api";

export interface TossCandle {
  timestamp: string; openPrice: string; highPrice: string; lowPrice: string; closePrice: string; volume: string; currency?: string;
}
interface CandlePage { candles?: TossCandle[]; nextBefore?: string | null }

/** 야후 심볼 → 토스 심볼. 못 바꾸면 null(야후로). 국내 6자리(.KS/.KQ 떼고)·미국 티커(AAPL, BRK-B)만 */
const NOT_TOSS = new Set(["CNNFG"]);   // 앱 안 가상 심볼(미국 티커 모양이지만 토스에 없다)
export function tossCandleSymbol(symbol: string): string | null {
  if (NOT_TOSS.has(symbol)) return null;
  const kr = /^([\dA-Za-z]{6})\.(KS|KQ)$/.exec(symbol);
  if (kr) return /\d/.test(kr[1]) ? kr[1] : null;
  if (/^[\dA-Za-z]{6}$/.test(symbol) && /\d/.test(symbol)) return symbol;     // 접미사 없는 국내 코드
  if (/^[A-Z]{1,5}(-[A-Z])?$/.test(symbol)) return symbol;                   // 미국 티커(^지수·=환율·.해외거래소 제외)
  return null;
}

/** 야후 range → 필요한 봉 수. 없는 range(10y·max·ytd)는 토스로 안 간다(페이지가 너무 많다) */
export const TOSS_RANGE_BARS: Record<string, number> = { "1d": 1, "5d": 5, "1mo": 23, "3mo": 66, "6mo": 130, "1y": 252, "2y": 504, "5y": 1260 };

// 키 없음·토큰 실패 같은 '지금은 안 되는' 상태면 10분 동안 토스를 건너뛴다(심볼마다 실패를 반복하지 않게)
let disabledUntil = 0;
export function tossCandlesUsable(): boolean {
  return isTossLinkOn() && Date.now() >= disabledUntil;
}

/** 최신순 페이지들 → 오름차순 PricePoint(날짜 중복 제거). 순수 함수(테스트) */
export function mapTossCandles(pages: TossCandle[][]): PricePoint[] {
  const byDate = new Map<string, PricePoint>();
  for (const page of pages) for (const c of page) {
    const date = (c.timestamp ?? "").slice(0, 10);
    const close = Number(c.closePrice);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !(close > 0)) continue;
    const n = (s: string | undefined) => { const v = Number(s); return Number.isFinite(v) && v > 0 ? v : undefined; };
    byDate.set(date, { date, close, volume: Number(c.volume) || 0, open: n(c.openPrice), high: n(c.highPrice), low: n(c.lowPrice) });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** 토스 일봉 — bars 개수만큼(최대 7페이지). null = 종목 없음(404). 그 밖의 실패는 던진다(호출 쪽이 야후로) */
export async function fetchTossDailyCandles(symbol: string, range: string): Promise<PricePoint[] | null> {
  const want = TOSS_RANGE_BARS[range];
  if (!want) throw new Error(`toss candles: unsupported range ${range}`);
  const pages: TossCandle[][] = [];
  let got = 0;
  let before: string | null = null;
  try {
    for (let i = 0; i < 7 && got < want; i++) {
      const count = Math.min(200, want - got);
      const q = `symbol=${encodeURIComponent(symbol)}&interval=1d&count=${count}${before ? `&before=${encodeURIComponent(before)}` : ""}`;
      const r: CandlePage = await brokerGet<CandlePage>("toss", `/api/v1/candles?${q}`);
      const cs = r?.candles ?? [];
      if (!cs.length) break;
      pages.push(cs); got += cs.length;
      if (!r.nextBefore) break;
      before = r.nextBefore;
    }
  } catch (e) {
    if (e instanceof BrokerError) {
      if (e.status === 404) return null;                       // 종목 없음 — 야후가 알 수도 있다
      if (e.status !== 429) disabledUntil = Date.now() + 10 * 60_000;   // 키·토큰·앱 아님 — 잠시 토스 건너뜀
    }
    throw e;
  }
  return mapTossCandles(pages);
}
