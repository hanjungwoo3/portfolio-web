// 순수 계산 — 차트 인스턴스를 모른다. 단위 테스트 대상.

import type { Anchor, BarTime, Drawing } from "./types";
import { barTimeToSortable } from "./types";

export interface Pt { x: number; y: number }

// 사양서 §5.5 — level(r) = priceA + (priceB - priceA) × r. A 가 0%, B 가 100%.
//   역방향(B < A)으로 그려도 같은 식을 쓴다.
export function fibLevelPrice(priceA: number, priceB: number, ratio: number): number {
  return priceA + (priceB - priceA) * ratio;
}
export function fibLevels(priceA: number, priceB: number, ratios: number[]): { ratio: number; price: number }[] {
  return ratios.map(r => ({ ratio: r, price: fibLevelPrice(priceA, priceB, r) }));
}

// 점과 선분 사이 거리 — 선 선택 판정용. 선보다 넉넉히 잡아야 마우스·터치로 집힌다.
export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// 숫자 입력 검증 — 빈 값·음수·NaN·무한대는 거부한다(사양서 §5.6).
export function parsePriceInput(raw: string): number | null {
  const t = raw.replace(/,/g, "").trim();
  if (!t) return null;
  const v = Number(t);
  if (!Number.isFinite(v) || v <= 0) return null;
  return v;
}

// 그리기의 대표 가격 — 목록 정렬·표시용.
export function primaryPrice(d: Drawing): number | null {
  switch (d.type) {
    case "horizontal":
    case "price": return d.price;
    case "trend":
    case "fibonacci": return d.a.price;
  }
}

// 앵커 시간을 가장 가까운 실제 봉으로 맞춘다(사양서 §5.1 — 가격은 그대로, 시간만 스냅).
export function snapToBar(times: BarTime[], target: number): BarTime | null {
  if (times.length === 0) return null;
  let best = times[0], bestD = Math.abs(barTimeToSortable(times[0]) - target);
  for (let i = 1; i < times.length; i++) {
    const d = Math.abs(barTimeToSortable(times[i]) - target);
    if (d < bestD) { best = times[i]; bestD = d; }
  }
  return best;
}

// 두 점 도형의 유효성 — 길이 0 인 선과 가격이 같은 피보나치는 확정하지 않는다.
export function isDegenerate(type: "trend" | "fibonacci", a: Anchor, b: Anchor): boolean {
  if (type === "fibonacci") return a.price === b.price;
  return a.price === b.price && barTimeToSortable(a.time) === barTimeToSortable(b.time);
}

// 봉 인덱스 이동량 → 시간. 드래그는 논리적 봉 간격으로 계산하고 저장 시 실제 시간으로 바꾼다.
export function shiftAnchorTime(times: BarTime[], time: BarTime, deltaBars: number): BarTime {
  const key = barTimeToSortable(time);
  let idx = 0, bestD = Infinity;
  for (let i = 0; i < times.length; i++) {
    const d = Math.abs(barTimeToSortable(times[i]) - key);
    if (d < bestD) { idx = i; bestD = d; }
  }
  const next = Math.max(0, Math.min(times.length - 1, idx + Math.round(deltaBars)));
  return times[next];
}

/**
 * 종가 단순이동평균 — **입력과 길이가 같은 배열**을 돌려준다(워밍업 구간은 null).
 *
 * lib/indicators 의 sma() 는 {date, close} 를 받아 값이 있는 구간만 돌려준다. 차트에
 * 붙일 때는 인덱스가 캔들과 1:1 로 맞아야 툴팁·시리즈가 어긋나지 않아서 여기서 따로 둔다.
 * N 개 미만 구간에 값을 만들지 않는 규칙은 사양서 §4 와 같다.
 */
export function smaAligned(closes: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (period < 1 || closes.length < period) return out;
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= period) sum -= closes[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}
