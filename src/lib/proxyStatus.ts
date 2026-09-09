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

// ── (호스트, 공급자) 단위 차단 기억 ──────────────────────────────────────────
// 왜 필요한가 — 토스 wts-info-api 는 Cloudflare egress 를 400 으로 거부하는데
//   wts-cert-api·네이버·야후는 같은 워커로 잘 된다(실측). 공급자 전체를 죽은 것으로 치면
//   멀쩡한 요청까지 잃고, 아무것도 안 하면 매 요청마다 400 을 한 번 맞고 폴백으로 넘어간다.
//   → '이 호스트에서 이 공급자는 안 된다' 만 기억해 그 조합만 뒤로 미룬다.
//   시간창을 둬서 상대가 풀어주면 저절로 회복된다. 하드코딩이 아니라 실측으로 배운다.
const HOST_BLOCK_WINDOW_MS = 10 * 60 * 1000;
const HOST_BLOCK_THRESHOLD = 2;            // 연속 2회 하드 실패면 차단으로 본다
const hostBlocks = new Map<string, { fail: number; at: number }>();
const hostKey = (host: string, provider: string) => `${host}|${provider}`;

export function noteHostFailure(host: string, provider: string): void {
  const k = hostKey(host, provider);
  const cur = hostBlocks.get(k);
  const fresh = cur && Date.now() - cur.at < HOST_BLOCK_WINDOW_MS ? cur.fail : 0;
  hostBlocks.set(k, { fail: fresh + 1, at: Date.now() });
}

export function noteHostSuccess(host: string, provider: string): void {
  hostBlocks.delete(hostKey(host, provider));
}

export function isHostBlocked(host: string, provider: string): boolean {
  const s = hostBlocks.get(hostKey(host, provider));
  if (!s) return false;
  if (Date.now() - s.at >= HOST_BLOCK_WINDOW_MS) { hostBlocks.delete(hostKey(host, provider)); return false; }
  return s.fail >= HOST_BLOCK_THRESHOLD;
}

// ★ '내가 의존하는' 프록시 중 죽은 수. 폴링을 늦출 근거는 이것뿐이다.
//   stats 에는 공용·개인이 섞여 들어온다(폴백으로 한 번이라도 때리면 공용도 들어온다).
//   그걸 그대로 세면, 내 워커는 멀쩡한데 공용이 소진됐다는 이유로 내 갱신이 느려진다
//   — 실제로 개인 워커 사용자들이 "사용량 남았는데 갱신이 안 된다" 고 겪은 문제다.
export function myDownCount(): number {
  const mine = getEnabledPersonalProxies().filter(u => !isSyntheticProxyUrl(u));
  // 전용 프록시가 없으면 공용이 곧 내 주력 → 전체 다운 수가 그대로 근거가 된다.
  if (mine.length === 0) return lastState.downHosts.length;
  // 전용 프록시가 있으면 '내 것' 이 죽었을 때만 늦춘다. 공용은 폴백일 뿐이다.
  return mine.filter(u => isProxyDown(u)).length;
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
import { hasDedicatedTransport, hasDirectTransport, getEnabledPersonalProxies, isSyntheticProxyUrl } from "./proxyConfig";
import { useExtensionProxyReady } from "./extensionProxy";
import { isAnyMarketActive } from "./format";

const MARKET_CLOSED_MIN_MS = 60_000;

export function useAdaptiveRefreshMs(baseMs: number): number {
  const [ms, setMs] = useState(baseMs);
  // 확장 감지는 postMessage 핸드셰이크라 마운트 뒤에 켜질 수 있다 → 의존성에 넣어 즉시 재계산.
  const extReady = useExtensionProxyReady();
  useEffect(() => {
    let downCount = myDownCount();
    const compute = () => {
      // 수동(0) — 자동 폴링 없음. throttle/adaptive 우회.
      if (baseMs <= 0) { setMs(0); return; }
      // 공개 프록시 + 양 시장 마감 → 최소 60초.
      //   전용 프록시나 확장이 있으면 공개 인프라를 안 쓰므로 base 를 그대로 유지한다.
      const closedThrottle =
        !hasDedicatedTransport() && !isAnyMarketActive() ? MARKET_CLOSED_MIN_MS : 0;
      const effBase = Math.max(baseMs, closedThrottle);
      // ★ 다운 페널티는 '프록시를 실제로 거치는' 경우에만.
      //   확장·앱은 프록시 목록을 통과하지 않으므로 공용 프록시가 죽어도 느려질 이유가 없다.
      //   (마감 스로틀에만 게이트를 걸고 여기는 빠뜨려서, 확장을 쓰는데 5초가 10초로 늦춰졌다)
      const penalty = hasDirectTransport() ? 0 : downCount * effBase;
      setMs(effBase + penalty);
    };
    const unsub = subscribeProxyStatus(() => { downCount = myDownCount(); compute(); });
    compute();
    // 시장 개장/마감 전환 감지 — 1분마다 재평가
    const timer = setInterval(compute, 60_000);
    return () => { unsub(); clearInterval(timer); };
  }, [baseMs, extReady]);
  return ms;
}
