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

// 프록시 URL 변경 시 — 옛 통계 리셋 (down 상태 / 부정확한 health 영향 제거)
export function resetProxyStats(): void {
  stats.clear();
  lastState = { health: "ok", total: 0, downHosts: [] };
  listeners.forEach(fn => fn(lastState));
}

// React 훅 — 폴링 간격 자동 조절 (무료 워커 부하 완화)
//  1) 프록시 다운 수만큼 간격 증가 (예: base 30초, 1개 다운 → 60초)
//  2) 양 시장(한국·미국) 모두 마감 시 60초로 throttle — 단, 공개(무료) 프록시일 때만.
//     개인 프록시 사용자는 본인이 설정한 주기를 그대로 유지.
import { useEffect, useState } from "react";
import { getPersonalProxyUrl } from "./proxyConfig";
import { isAnyMarketActive } from "./format";

const MARKET_CLOSED_MIN_MS = 60_000;

export function useAdaptiveRefreshMs(baseMs: number): number {
  const [ms, setMs] = useState(baseMs);
  useEffect(() => {
    let downCount = getProxyState().downHosts.length;
    const compute = () => {
      // 수동(0) — 자동 폴링 없음. throttle/adaptive 우회.
      if (baseMs <= 0) { setMs(0); return; }
      // 공개 프록시 + 양 시장 마감 → 최소 60초 (개인 프록시는 base 유지)
      const closedThrottle =
        !getPersonalProxyUrl() && !isAnyMarketActive() ? MARKET_CLOSED_MIN_MS : 0;
      const effBase = Math.max(baseMs, closedThrottle);
      setMs(effBase + downCount * effBase);
    };
    const unsub = subscribeProxyStatus(s => { downCount = s.downHosts.length; compute(); });
    compute();
    // 시장 개장/마감 전환 감지 — 1분마다 재평가
    const timer = setInterval(compute, 60_000);
    return () => { unsub(); clearInterval(timer); };
  }, [baseMs]);
  return ms;
}
