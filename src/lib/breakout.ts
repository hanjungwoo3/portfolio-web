// 횡보 돌파 — 한동안 좁은 박스에서 움직이다 최근 거래량을 싣고 박스 위로 뚫은 종목.
//   (사용자 요청 2026-10-09: "횡보 중이다가 급등하는 주" 중 '방금 터진 것')
//
//   박스 = 최근 RECENT 봉을 뺀 그 앞 BASE 봉. 고가~저가 폭이 MAX_WIDTH 이내면 횡보로 본다.
//   돌파 = 최근 RECENT 봉 안에서 종가가 박스 상단(최고가)을 넘고, 그날 거래량이 박스 평균의 VOL_X 배 이상.
//   유지 = 지금 종가가 아직 박스 상단 위 — 다시 박스 안으로 밀린 실패 돌파는 뺀다.
import type { PricePoint } from "./api";

export const BREAKOUT_BASE = 60;      // 박스 기간(거래일) ≈ 3개월
export const BREAKOUT_RECENT = 5;     // '방금' = 최근 5거래일
export const BREAKOUT_MAX_WIDTH = 35; // 박스 폭 상한(%) — 고가/저가 − 1. 25% 는 2026-10 장에서 185종목 중 0건(3개월 폭 중앙값 62%)
export const BREAKOUT_VOL_X = 2;      // 돌파일 거래량 ≥ 박스 평균 × 2

export interface Breakout {
  daysAgo: number;      // 돌파일이 마지막 봉에서 몇 봉 전인가(0 = 마지막 봉, 장 전엔 어제)
  date: string;
  boxTop: number;
  boxWidth: number;     // 박스 폭(%)
  aboveTop: number;     // 지금 종가가 박스 상단보다 몇 % 위
  volX: number;         // 돌파일 거래량 ÷ 박스 평균 거래량
}

/** candles 는 과거→최신 오름차순. 조건이 안 맞거나 봉이 모자라면 null. */
export function detectBreakout(candles: PricePoint[] | undefined): Breakout | null {
  if (!candles || candles.length < BREAKOUT_BASE + BREAKOUT_RECENT) return null;
  const n = candles.length;
  const base = candles.slice(n - BREAKOUT_RECENT - BREAKOUT_BASE, n - BREAKOUT_RECENT);
  const recent = candles.slice(n - BREAKOUT_RECENT);
  const boxTop = Math.max(...base.map(c => c.high ?? c.close));
  const boxLow = Math.min(...base.map(c => c.low ?? c.close).filter(v => v > 0));
  if (!(boxTop > 0 && boxLow > 0)) return null;
  const boxWidth = (boxTop / boxLow - 1) * 100;
  if (boxWidth > BREAKOUT_MAX_WIDTH) return null;
  const avgVol = base.reduce((s, c) => s + (c.volume || 0), 0) / base.length;
  if (!(avgVol > 0)) return null;
  const i = recent.findIndex(c => c.close > boxTop && c.volume >= avgVol * BREAKOUT_VOL_X);
  if (i < 0) return null;
  const last = recent[recent.length - 1].close;
  if (last <= boxTop) return null;   // 박스 안으로 되돌아왔다 — 실패 돌파
  return {
    daysAgo: recent.length - 1 - i,
    date: recent[i].date,
    boxTop, boxWidth,
    aboveTop: (last / boxTop - 1) * 100,
    volX: recent[i].volume / avgVol,
  };
}
