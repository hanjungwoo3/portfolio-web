// 다중 proxy 상태 추적 — 사용자에게 다운 알림
export type ProxyHealth = "ok" | "degraded" | "down";

interface PerProxy {
  ok: number;
  fail: number;
  lastFailAt?: number;
}

const stats = new Map<string, PerProxy>();
const listeners = new Set<(s: ProxyState) => void>();

export interface ProxyState {
  health: ProxyHealth;
  total: number;
  downHosts: string[];        // 호스트명 목록 (UI 툴팁용)
}

let lastState: ProxyState = { health: "ok", total: 0, downHosts: [] };

const RECENT_WINDOW_MS = 30_000;  // 최근 30초 윈도우 (빠른 복구)
const FAIL_THRESHOLD = 5;         // 30초 안에 5번 연속 실패면 down 판정 (덜 민감)

function urlHost(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

function getOrInit(url: string): PerProxy {
  let s = stats.get(url);
  if (!s) { s = { ok: 0, fail: 0 }; stats.set(url, s); }
  return s;
}

export function reportProxySuccess(url: string) {
  const s = getOrInit(url);
  s.ok += 1;
  s.fail = 0;          // 성공하면 fail 카운트 리셋 (자동 복구)
  s.lastFailAt = undefined;
  recompute();
}

export function reportProxyFailure(url: string) {
  const s = getOrInit(url);
  s.fail += 1;
  s.lastFailAt = Date.now();
  recompute();
}

export function isProxyDown(url: string): boolean {
  const s = stats.get(url);
  if (!s) return false;
  if (s.fail < FAIL_THRESHOLD) return false;
  if (!s.lastFailAt) return false;
  return Date.now() - s.lastFailAt < RECENT_WINDOW_MS;
}

function isDown(s: PerProxy): boolean {
  if (s.fail < FAIL_THRESHOLD) return false;
  if (!s.lastFailAt) return false;
  return Date.now() - s.lastFailAt < RECENT_WINDOW_MS;
}

function recompute() {
  const total = stats.size;
  const downHosts: string[] = [];
  for (const [url, s] of stats) {
    if (isDown(s)) downHosts.push(urlHost(url));
  }
  const downCount = downHosts.length;
  const health: ProxyHealth =
    downCount === 0 ? "ok"
    : downCount >= total ? "down"
    : "degraded";
  const next: ProxyState = { health, total, downHosts };
  if (next.health === lastState.health
      && next.downHosts.length === lastState.downHosts.length) {
    lastState = next;
    return;
  }
  lastState = next;
  listeners.forEach(fn => fn(next));
}

export function subscribeProxyStatus(fn: (s: ProxyState) => void): () => void {
  listeners.add(fn);
  fn(lastState);
  return () => { listeners.delete(fn); };
}

export function getProxyState(): ProxyState {
  return lastState;
}

// React 훅 — 프록시 다운 수에 따라 폴링 간격 자동 증가 (부하 완화)
// 예: base 10초, 1개 다운 → 20초, 2개 다운 → 30초
import { useEffect, useState } from "react";
export function useAdaptiveRefreshMs(baseMs: number): number {
  const [ms, setMs] = useState(baseMs);
  useEffect(() => {
    return subscribeProxyStatus(s => {
      setMs(baseMs + s.downHosts.length * baseMs);
    });
  }, [baseMs]);
  return ms;
}
