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

// 폴링 주기 — 전용 프록시 사용 시 5/10/30/60초 선택 가능
// 공개 프록시는 항상 10초 (rate limit 보호)
export const POLL_OPTIONS = [5_000, 10_000, 30_000, 60_000] as const;
export const DEFAULT_PUBLIC_POLL_MS = 10_000;

export function getPersonalPollMs(): number {
  try {
    const v = localStorage.getItem(POLL_KEY);
    if (!v) return DEFAULT_PUBLIC_POLL_MS;
    const n = Number(v);
    return Number.isFinite(n) && n >= 1000 ? n : DEFAULT_PUBLIC_POLL_MS;
  } catch {
    return DEFAULT_PUBLIC_POLL_MS;
  }
}

export function setPersonalPollMs(ms: number) {
  try {
    localStorage.setItem(POLL_KEY, String(ms));
  } catch {
    /* ignore */
  }
}

// 현재 effective poll 간격 (ms) — 전용 프록시 있으면 personal, 없으면 공개 default
export function getEffectivePollMs(): number {
  return getPersonalProxyUrl() ? getPersonalPollMs() : DEFAULT_PUBLIC_POLL_MS;
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
