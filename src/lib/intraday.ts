// 시간대 겹침(intraday overlay) 변환 — 분봉을 "하루 중 시각"으로 정렬해 30일치를 겹친다.
// 각 날을 그날 시초가(첫 봉) 대비 %로 정규화 → 가격 레벨 차이 제거, 순수 하루 모양만 비교.
// 평균선 = 시각 버킷별 평균 → "전형적인 하루 패턴".

import { krRegStart, krRegEnd } from "./format";
import type { IntradayBar } from "./api";

// 시장별 정규장 시간 (KST 분 단위, 자정 0시 기준).
// KR: 09:00~15:30. (US 추가 시 ET→KST 변환 필요 — 현재 KR만)
export interface SessionConfig {
  openMin: number;   // 장 시작 (분)
  closeMin: number;  // 장 마감 (분)
}
// 토스 시간표를 따른다(수능 등 늦춰진 날) — 읽을 때마다 오늘 값
export const KR_SESSION: SessionConfig = { get openMin() { return krRegStart(); }, get closeMin() { return krRegEnd(); } };

export interface OverlayDay {
  date: string;                       // YYYY-MM-DD (KST)
  weekday: number;                    // 0=일 … 6=토 (KST 기준)
  points: { x: number; y: number }[]; // x = 장 시작 후 경과 분(0~390), y = 시초가 대비 %
}
export interface IntradayOverlay {
  days: OverlayDay[];
  openMin: number;
  closeMin: number;
  sessionMins: number;     // closeMin - openMin (예: 390)
}
export type AvgPoint = { x: number; y: number; n: number }; // 시각 버킷별 평균 % (+ 표본 수)

// epoch초(UTC) → KST 벽시계 (UTC+9 를 더해 UTC 필드로 추출)
function kstParts(epochSec: number): { date: string; minsOfDay: number } {
  const d = new Date((epochSec + 9 * 3600) * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return { date: `${y}-${m}-${day}`, minsOfDay: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

// 분봉 → 시간대 겹침 구조. 정규장 구간만 사용, 날짜별 시초가 대비 %.
export function buildIntradayOverlay(
  bars: IntradayBar[],
  session: SessionConfig = KR_SESSION,
): IntradayOverlay {
  const { openMin, closeMin } = session;
  const sessionMins = closeMin - openMin;

  // 1) 날짜별로 묶기 (정규장 구간만)
  const byDay = new Map<string, { x: number; close: number }[]>();
  for (const b of bars) {
    const { date, minsOfDay } = kstParts(b.t);
    if (minsOfDay < openMin || minsOfDay > closeMin) continue;
    const x = minsOfDay - openMin;
    const arr = byDay.get(date) ?? [];
    arr.push({ x, close: b.close });
    byDay.set(date, arr);
  }

  // 2) 날짜별 시초가 대비 % 정규화
  const days: OverlayDay[] = [];
  for (const [date, raw] of byDay) {
    if (raw.length < 2) continue;
    raw.sort((a, b) => a.x - b.x);
    const base = raw[0].close;
    if (!(base > 0)) continue;
    // 요일 — KST 달력일 기준 (정오 UTC 로 파싱해 로컬 tz 영향 제거)
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    days.push({
      date, weekday,
      points: raw.map(p => ({ x: p.x, y: (p.close / base - 1) * 100 })),
    });
  }
  days.sort((a, b) => a.date.localeCompare(b.date));

  return { days, openMin, closeMin, sessionMins };
}

// 시각 버킷별 평균 (x 가 동일 분이면 같은 버킷). 요일 필터 후 재계산용으로 분리.
export function computeAvg(days: OverlayDay[]): AvgPoint[] {
  const bucket = new Map<number, { sum: number; n: number }>();
  for (const d of days) {
    for (const p of d.points) {
      const acc = bucket.get(p.x) ?? { sum: 0, n: 0 };
      acc.sum += p.y; acc.n += 1;
      bucket.set(p.x, acc);
    }
  }
  return Array.from(bucket.entries())
    .map(([x, { sum, n }]) => ({ x, y: sum / n, n }))
    .sort((a, b) => a.x - b.x);
}

// 장 시작 후 경과 분 → "HH:MM" (KST)
export function minsToHHMM(openMin: number, x: number): string {
  const total = openMin + x;
  const hh = String(Math.floor(total / 60)).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

// 평균선에서 가장 낮은/높은 시각 — "평균적으로 싼/비싼 시각" 인사이트.
// 표본(n)이 너무 적은 버킷은 제외해 노이즈 줄임.
export function overlayInsight(avg: AvgPoint[], dayCount: number, openMin: number): {
  lowAt?: string; lowPct?: number; lowX?: number;
  highAt?: string; highPct?: number; highX?: number;
} {
  const minN = Math.max(2, Math.ceil(dayCount * 0.5));
  const solid = avg.filter(p => p.n >= minN);
  if (solid.length === 0) return {};
  let lo = solid[0], hi = solid[0];
  for (const p of solid) {
    if (p.y < lo.y) lo = p;
    if (p.y > hi.y) hi = p;
  }
  return {
    lowAt: minsToHHMM(openMin, lo.x), lowPct: lo.y, lowX: lo.x,
    highAt: minsToHHMM(openMin, hi.x), highPct: hi.y, highX: hi.x,
  };
}
