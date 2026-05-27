// 전용 프록시 URL 관리 — localStorage 기반 (브라우저별)
// 입력 시 공개 4-way 라운드 로빈 대신 사용자 본인 worker 만 사용
// → 공개 인프라 부담 0, 사용자 본인 100k/일 무료 한도 전용

const KEY = "portfolio_personal_proxy_url";
const POLL_KEY = "portfolio_personal_poll_ms";

export function getPersonalProxyUrl(): string | null {
  try {
    const v = localStorage.getItem(KEY);
    if (!v) return null;
    const trimmed = v.trim().replace(/\/+$/, "");  // 끝 슬래시 제거
    return trimmed || null;
  } catch {
    return null;
  }
}

export function setPersonalProxyUrl(url: string | null) {
  try {
    if (!url || url.trim() === "") {
      localStorage.removeItem(KEY);
    } else {
      localStorage.setItem(KEY, url.trim());
    }
  } catch {
    /* ignore quota / privacy errors */
  }
}

// 폴링 주기 — 전용 프록시 사용 시 5/10/30/60초 선택 가능. 0 = 수동(자동 갱신 끔).
// 공개 프록시는 30초 (무료 워커 호출 한도 보호 — 24h 폴링이라 호출수가 병목).
// 더 빠른 갱신이 필요하면 설정에서 개인 프록시 등록(5/10초).
// 수동(0)은 프록시 무관 항상 선택 가능 — 버튼/메뉴 진입 시에만 갱신(부하 최소).
export const MANUAL_POLL_MS = 0;
export const POLL_OPTIONS = [MANUAL_POLL_MS, 5_000, 10_000, 30_000, 60_000] as const;
export const DEFAULT_PUBLIC_POLL_MS = 30_000;

// ─── 개인 프록시 기능별 호환성 검증 ─────────────────────────
// 기능마다 조건이 다름 → 별도 검사 (한 status 로 합치지 않음):
//  · POST 지원      : 컨센서스 예상치 API (POST) — 구버전 405
//  · investing 허용 : VKOSPI 등 (api.investing.com) — 구버전 403 "Host not allowed"
// 각 검사 세션당 1회만 호출하고 결과 캐시 (URL 바뀌면 재검증).
export type PersonalProxyStatus = "ok" | "outdated" | "no-personal" | "error";

let cachedPostStatus: { url: string; status: PersonalProxyStatus } | null = null;
let cachedInvestStatus: { url: string; status: PersonalProxyStatus } | null = null;

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

// investing 호스트 허용 검사 (VKOSPI) — 워커 자체 403 "Host not allowed" 면 구버전.
export async function checkPersonalProxyInvestingSupport(): Promise<PersonalProxyStatus> {
  const personal = getPersonalProxyUrl();
  if (!personal) { cachedInvestStatus = null; return "no-personal"; }
  if (cachedInvestStatus && cachedInvestStatus.url === personal) return cachedInvestStatus.status;
  try {
    const target = "https://api.investing.com/api/financialdata/956761/historical/chart/?interval=P1D&pointscount=2";
    const r = await fetch(`${personal}/?url=${encodeURIComponent(target)}`, {
      signal: AbortSignal.timeout(6000),
    });
    let status: PersonalProxyStatus;
    if (r.status === 403 && (await r.text().catch(() => "")).includes("Host not allowed")) {
      status = "outdated";          // 워커 화이트리스트에 investing 없음
    } else if (r.ok) {
      status = "ok";
    } else {
      status = "error";            // investing/Cloudflare 일시 오류 — 구버전 아님
    }
    cachedInvestStatus = { url: personal, status };
    return status;
  } catch {
    cachedInvestStatus = { url: personal, status: "error" };
    return "error";
  }
}

// 워커 URL 변경/해제 시 캐시 무효화
export function invalidatePersonalProxyStatusCache(): void {
  cachedPostStatus = null;
  cachedInvestStatus = null;
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

// 현재 effective poll 간격 (ms) — 수동(0)은 프록시 무관, 그 외엔 전용=personal / 공개=default
export function getEffectivePollMs(): number {
  const ms = getPersonalPollMs();
  if (ms === MANUAL_POLL_MS) return 0;   // 수동 — 자동 폴링 끔
  return getPersonalProxyUrl() ? ms : DEFAULT_PUBLIC_POLL_MS;
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
