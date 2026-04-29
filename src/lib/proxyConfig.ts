// 전용 프록시 URL 관리 — localStorage 기반 (브라우저별)
// 입력 시 공개 4-way 라운드 로빈 대신 사용자 본인 worker 만 사용
// → 공개 인프라 부담 0, 사용자 본인 100k/일 무료 한도 전용

const KEY = "portfolio_personal_proxy_url";

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
