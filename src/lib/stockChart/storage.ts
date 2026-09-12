// 그리기 저장·복원 — 사양서 §6.
//
// 키를 종목·주기별로 나눈다(`stock-chart:v1:{symbol}:{interval}`). 주기를 바꾸면 그 주기의
//   선만 불러오고 다른 주기 것은 건드리지 않는다. P0 에서는 주기 간 좌표 변환을 하지 않는다.
//
// 저장소가 막혔거나(시크릿 모드·용량 초과) 손상돼도 화면이 멈추면 안 된다 →
//   메모리 모드로 계속 쓰고 호출부가 '이번 세션에서만 유지' 안내를 띄운다.
//   손상된 항목은 건너뛰되 **원본을 즉시 덮어쓰지 않는다** — 다음 저장 때 정리된다.

import type { Drawing, Interval } from "./types";

export const STORAGE_PREFIX = "stock-chart:v1";
export const storageKey = (symbol: string, interval: Interval) =>
  `${STORAGE_PREFIX}:${symbol}:${interval}`;

export interface LoadResult {
  drawings: Drawing[];
  skipped: number;       // 손상돼 건너뛴 항목 수
  memoryOnly: boolean;   // localStorage 를 못 써서 메모리로만 유지 중
}

const memory = new Map<string, Drawing[]>();

function storageAvailable(): boolean {
  try {
    const k = `${STORAGE_PREFIX}:probe`;
    localStorage.setItem(k, "1");
    localStorage.removeItem(k);
    return true;
  } catch { return false; }
}

// 최소한의 형태 검증 — schemaVersion 이 다르거나 필드가 깨진 건 버린다.
export function isValidDrawing(v: unknown): v is Drawing {
  if (typeof v !== "object" || v === null) return false;
  const d = v as Record<string, unknown>;
  if (d.schemaVersion !== 1) return false;
  if (typeof d.id !== "string" || typeof d.symbol !== "string") return false;
  const anchorOk = (a: unknown): boolean => {
    if (typeof a !== "object" || a === null) return false;
    const x = a as Record<string, unknown>;
    if (typeof x.price !== "number" || !Number.isFinite(x.price)) return false;
    const t = x.time as Record<string, unknown> | undefined;
    if (!t) return false;
    if (t.kind === "date") return typeof t.value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.value);
    if (t.kind === "unix") return typeof t.value === "number" && Number.isFinite(t.value);
    return false;
  };
  switch (d.type) {
    case "horizontal":
    case "price":
      return typeof d.price === "number" && Number.isFinite(d.price) && d.price > 0;
    case "trend":
      return anchorOk(d.a) && anchorOk(d.b);
    case "fibonacci":
      return anchorOk(d.a) && anchorOk(d.b) && Array.isArray(d.levels);
    default:
      return false;
  }
}

export function loadDrawings(symbol: string, interval: Interval): LoadResult {
  const key = storageKey(symbol, interval);
  if (!storageAvailable()) {
    return { drawings: memory.get(key) ?? [], skipped: 0, memoryOnly: true };
  }
  let raw: string | null = null;
  try { raw = localStorage.getItem(key); } catch { /* 위에서 걸렀지만 방어 */ }
  if (!raw) return { drawings: [], skipped: 0, memoryOnly: false };
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch {
    // 통째로 깨졌다 — 원본은 남겨 두고 빈 목록으로 시작한다.
    return { drawings: [], skipped: -1, memoryOnly: false };
  }
  if (!Array.isArray(parsed)) return { drawings: [], skipped: -1, memoryOnly: false };
  const ok: Drawing[] = [];
  let skipped = 0;
  for (const item of parsed) {
    if (isValidDrawing(item)) ok.push(item); else skipped++;
  }
  return { drawings: ok, skipped, memoryOnly: false };
}

/** 저장 실패는 삼키지 않고 알린다 — 호출부가 '메모리 전용' 배지를 띄운다. */
export function saveDrawings(symbol: string, interval: Interval, drawings: Drawing[]): boolean {
  const key = storageKey(symbol, interval);
  memory.set(key, drawings);
  try {
    localStorage.setItem(key, JSON.stringify(drawings));
    return true;
  } catch {
    return false;   // 용량 초과·차단 — 메모리에는 이미 넣었다
  }
}
