// 전용 프록시 URL 관리 — localStorage 기반 (브라우저별)
// 입력 시 공개 4-way 라운드 로빈 대신 사용자 본인 worker 만 사용
// → 공개 인프라 부담 0, 사용자 본인 100k/일 무료 한도 전용

const KEY = "portfolio_personal_proxy_url";        // 레거시 단일 URL (마이그레이션/호환)
const LIST_KEY = "portfolio_personal_proxies";     // 신규 — 여러 개 {url, enabled}
const POLL_KEY = "portfolio_personal_poll_ms";

export interface PersonalProxy { url: string; enabled: boolean }

function normUrl(u: string): string {
  return u.trim().replace(/\/+$/, "");
}

// 전용 프록시 목록 — 신규 LIST_KEY 우선, 없으면 레거시 단일 KEY 에서 1회 마이그레이션.
export function getPersonalProxies(): PersonalProxy[] {
  try {
    const raw = localStorage.getItem(LIST_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        return arr
          .filter((p): p is { url: unknown; enabled?: unknown } => !!p && typeof p === "object")
          .map(p => ({ url: normUrl(String((p as { url: unknown }).url ?? "")), enabled: (p as { enabled?: unknown }).enabled !== false }))
          .filter(p => p.url);
      }
    }
    const old = localStorage.getItem(KEY);
    if (old && old.trim()) {
      const list: PersonalProxy[] = [{ url: normUrl(old), enabled: true }];
      localStorage.setItem(LIST_KEY, JSON.stringify(list));
      return list;
    }
  } catch { /* noop */ }
  return [];
}

export function setPersonalProxies(list: PersonalProxy[]) {
  try {
    const clean = list
      .map(p => ({ url: normUrl(p.url), enabled: !!p.enabled }))
      .filter(p => p.url);
    if (clean.length === 0) localStorage.removeItem(LIST_KEY);
    else localStorage.setItem(LIST_KEY, JSON.stringify(clean));
    // 레거시 단일 키 동기화(구버전 앱·호환) — 첫 enabled 항목
    const firstEnabled = clean.find(p => p.enabled)?.url;
    if (firstEnabled) localStorage.setItem(KEY, firstEnabled);
    else localStorage.removeItem(KEY);
  } catch { /* ignore quota / privacy errors */ }
}

// 켜진 전용 프록시 URL 들 (요청 라우팅용 — 여러 개면 fetchProxied 가 랜덤 분산)
export function getEnabledPersonalProxies(): string[] {
  return getPersonalProxies().filter(p => p.enabled).map(p => p.url);
}

// 대표 전용 프록시(첫 enabled) — 상태/배지/폴링 판정 호환용
export function getPersonalProxyUrl(): string | null {
  return getEnabledPersonalProxies()[0] ?? null;
}

// 레거시 단일 setter — 구 백업(personalProxyUrl) import 호환
export function setPersonalProxyUrl(url: string | null) {
  if (!url || url.trim() === "") setPersonalProxies([]);
  else setPersonalProxies([{ url: normUrl(url), enabled: true }]);
}

// 워커 사용량 — 신버전 워커의 GET /usage 엔드포인트 ({requests, limit}).
// 구버전 워커(미지원)는 다른 응답/에러 → null 반환 (앱은 안내 문구 표시).
export interface ProxyUsage { requests: number; limit: number }
export async function fetchProxyUsage(base: string): Promise<ProxyUsage | null> {
  try {
    const resp = await fetch(`${normUrl(base)}/usage`, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return null;
    const j = await resp.json() as { requests?: unknown; limit?: unknown };
    if (typeof j.requests !== "number") return null;
    return { requests: j.requests, limit: typeof j.limit === "number" ? j.limit : 100_000 };
  } catch { return null; }
}

// 폴링 주기 — 전용 프록시 사용 시 5/10/30/60초 선택 가능. 0 = 수동(자동 갱신 끔).
// 공개 프록시는 기본 60초, 30초까지 선택 가능 (무료 워커 호출 한도 보호 — 호출수가 병목).
// 더 빠른 갱신(5/10초)이 필요하면 설정에서 개인 프록시 등록.
// 수동(0)은 프록시 무관 항상 선택 가능 — 버튼/메뉴 진입 시에만 갱신(부하 최소).
export const MANUAL_POLL_MS = 0;
export const POLL_OPTIONS = [MANUAL_POLL_MS, 5_000, 10_000, 30_000, 60_000] as const;
export const DEFAULT_PUBLIC_POLL_MS = 60_000;   // 공개 기본
export const PUBLIC_MIN_POLL_MS = 30_000;        // 공개에서 선택 가능한 최소 주기(이보다 빠른 건 전용 전용)

// ─── 개인 프록시 기능별 호환성 검증 ─────────────────────────
// 기능마다 조건이 다름 → 별도 검사 (한 status 로 합치지 않음):
//  · POST 지원   : 컨센서스 예상치 API (POST) — 구버전 405
//  · yasun 허용  : 코스피200/코스닥150 야간선물 — 구버전 403 "Host not allowed"
// 각 검사 세션당 1회만 호출하고 결과 캐시 (URL 바뀌면 재검증).
//
// 주의 — "값이 비었다"를 워커 구버전 근거로 쓰지 말 것. 업스트림 차단(예: investing.com 의
//   Cloudflare 봇 챌린지)까지 워커 탓으로 오진한다. 반드시 이 검사들의 "outdated" 로만 판단한다.
export type PersonalProxyStatus = "ok" | "outdated" | "no-personal" | "error";

let cachedPostStatus: { url: string; status: PersonalProxyStatus } | null = null;
let cachedYasunStatus: { url: string; status: PersonalProxyStatus } | null = null;

// POST 지원 검사 (컨센서스 예상치) — 구버전(405) 판정. 지난번과 동일.
export async function checkPersonalProxyPostSupport(): Promise<PersonalProxyStatus> {
  const personal = getPersonalProxyUrl();
  if (!personal) { cachedPostStatus = null; return "no-personal"; }
  if (cachedPostStatus && cachedPostStatus.url === personal) return cachedPostStatus.status;
  try {
    const target = "https://wts-info-api.tossinvest.com/api/v2/companies/A005930/financial/estimate/revenue";
    const r = await fetch(`${personal}/?url=${encodeURIComponent(target)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(6000),
    });
    let status: PersonalProxyStatus;
    if (r.status === 405) status = "outdated";
    else if (r.ok) status = "ok";
    else status = "error";
    cachedPostStatus = { url: personal, status };
    return status;
  } catch {
    cachedPostStatus = { url: personal, status: "error" };
    return "error";
  }
}

// yasun.gg 호스트 허용 검사 (코스피200/코스닥150 야간선물) — 구버전 워커 화이트리스트엔 없음.
export async function checkPersonalProxyYasunSupport(): Promise<PersonalProxyStatus> {
  const personal = getPersonalProxyUrl();
  if (!personal) { cachedYasunStatus = null; return "no-personal"; }
  if (cachedYasunStatus && cachedYasunStatus.url === personal) return cachedYasunStatus.status;
  try {
    const target = "https://yasun.gg/api/candles?symbol=%5EKS200&interval=1m&limit=5&session=night";
    const r = await fetch(`${personal}/?url=${encodeURIComponent(target)}`, {
      signal: AbortSignal.timeout(6000),
    });
    let status: PersonalProxyStatus;
    if (r.status === 403 && (await r.text().catch(() => "")).includes("Host not allowed")) {
      status = "outdated";          // 워커 화이트리스트에 yasun.gg 없음
    } else if (r.ok) {
      status = "ok";
    } else {
      status = "error";
    }
    cachedYasunStatus = { url: personal, status };
    return status;
  } catch {
    cachedYasunStatus = { url: personal, status: "error" };
    return "error";
  }
}

// 워커 URL 변경/해제 시 캐시 무효화
export function invalidatePersonalProxyStatusCache(): void {
  cachedPostStatus = null;
  cachedYasunStatus = null;
}

export function getPersonalPollMs(): number {
  try {
    const v = localStorage.getItem(POLL_KEY);
    if (v === null || v === "") return DEFAULT_PUBLIC_POLL_MS;
    const n = Number(v);
    // 0 = 수동(허용), 그 외엔 1초 이상만 유효
    if (n === 0) return 0;
    return Number.isFinite(n) && n >= 1000 ? n : DEFAULT_PUBLIC_POLL_MS;
  } catch {
    return DEFAULT_PUBLIC_POLL_MS;
  }
}

// 수동 모드 여부 — 자동 폴링 끔 (버튼/메뉴 진입 시에만 갱신)
export function isManualPoll(): boolean {
  return getPersonalPollMs() === MANUAL_POLL_MS;
}

export function setPersonalPollMs(ms: number) {
  try {
    localStorage.setItem(POLL_KEY, String(ms));
  } catch {
    /* ignore */
  }
}

// 현재 effective poll 간격 (ms).
//  - 수동(0): 프록시 무관 자동 폴링 끔
//  - 전용 프록시: 사용자 설정 그대로(5/10/30/60초)
//  - 공개 프록시: 기본(30초)보다 느린(≥) 선택만 허용(부하↓), 더 빠른 값은 30초로 클램프
export function getEffectivePollMs(): number {
  const ms = getPersonalPollMs();
  if (ms === MANUAL_POLL_MS) return 0;
  if (getPersonalProxyUrl()) return ms;
  // 공개: 30초 이상만 허용(30/60초), 더 빠른 값은 기본(60초)으로 클램프
  return ms >= PUBLIC_MIN_POLL_MS ? ms : DEFAULT_PUBLIC_POLL_MS;
}

// 장 마감 / 비활동 종목 카드 흐리게 표시 여부 (default ON)
const DIM_KEY = "portfolio_dim_sleeping";
export function getDimSleepingEnabled(): boolean {
  try {
    const v = localStorage.getItem(DIM_KEY);
    if (v === null) return true;  // default ON
    return v === "1";
  } catch {
    return true;
  }
}
export function setDimSleepingEnabled(enabled: boolean) {
  try {
    localStorage.setItem(DIM_KEY, enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
}
