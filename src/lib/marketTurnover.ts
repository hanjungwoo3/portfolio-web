// 시장 거래대금 표시 헬퍼 — 카드(MarketTurnoverCard)와 차트(MarketTurnoverChart)가 공유.
//   컴포넌트 파일에서 함수를 export 하면 fast-refresh 가 깨져 lib 으로 분리.

import type { MarketTurnoverPoint, IntradayVolumePoint } from "./api";

export const MA_DAYS = 20;

// 원 → 조/억. 1조 미만은 억으로.
export function fmtAmount(won: number): string {
  const jo = won / 1e12;
  if (jo >= 1) return `${jo.toFixed(2)}조`;
  return `${Math.round(won / 1e8).toLocaleString()}억`;
}

// 20일 이동평균 (trailing, 앞쪽 부족분은 있는 만큼 평균)
export function movingAvg(points: MarketTurnoverPoint[], days = MA_DAYS): number[] {
  return points.map((_, i) => {
    const win = points.slice(Math.max(0, i - (days - 1)), i + 1);
    return win.reduce((a, p) => a + p.amount, 0) / win.length;
  });
}

// ── 장중 진행률 ────────────────────────────────────────────────────────────────
// 왜 필요한가 — 장중 거래대금은 '지금까지 누적' 인데 20일 평균은 '종일' 값이다.
//   그대로 나누면 개장 직후 -80%, 마감 직전 -5% 처럼 시간이 흐를수록 회복되는 착시가 생긴다.
//   (실제로 11시에 "평균대비 -54%" 가 떠서 제보됨 — 거래가 적어서가 아니라 하루가 안 끝나서였다)
//
// 어떻게 — 지난 거래일들이 '이 시각까지' 전체 거래량의 몇 %를 채웠는지를 평균 내어,
//   그 비율만큼 20일 평균을 깎아 비교 기준으로 삼는다.
//   금액이 아니라 거래량으로 재는 이유는 분봉에 amount 가 없기 때문(api.ts 주석 참조).
//   즉 '금액과 수량의 장중 분포가 비슷하다' 는 가정이 하나 들어간다.

const PROFILE_DAYS = 3;      // 진행률을 평균 낼 과거 거래일 수
const MIN_PROGRESS = 0.02;   // 이보다 이르면(개장 직후) 보정값이 요동쳐서 안 쓴다

function hhmmToMin(hhmm: string): number {
  const h = parseInt(hhmm.slice(0, 2), 10);
  const m = parseInt(hhmm.slice(3, 5), 10);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : -1;
}

// 지금(KST) 기준 장중 진행률 0~1. 과거 거래일이 없거나 너무 이르면 null.
export function sessionProgress(points: IntradayVolumePoint[], nowMs = Date.now()): number | null {
  if (points.length === 0) return null;
  // dt 는 "2026-09-09T11:50:00+09:00" — 이미 KST 라 문자열을 그대로 쓴다.
  const nowKst = new Date(nowMs + 9 * 3600_000).toISOString();
  const today = nowKst.slice(0, 10);
  const nowMin = hhmmToMin(nowKst.slice(11, 16));
  if (nowMin < 0) return null;

  const byDay = new Map<string, IntradayVolumePoint[]>();
  for (const p of points) {
    const d = p.dt.slice(0, 10);
    if (d === today) continue;                 // 오늘은 아직 안 끝나 기준이 못 된다
    (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(p);
  }
  const days = [...byDay.keys()].sort().slice(-PROFILE_DAYS);
  const ratios: number[] = [];
  for (const d of days) {
    const cs = byDay.get(d)!;
    let total = 0, upto = 0;
    for (const c of cs) {
      total += c.volume;
      if (hhmmToMin(c.dt.slice(11, 16)) <= nowMin) upto += c.volume;
    }
    if (total > 0) ratios.push(upto / total);
  }
  if (ratios.length === 0) return null;
  const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  if (!(avg > MIN_PROGRESS)) return null;
  return Math.min(1, avg);
}
