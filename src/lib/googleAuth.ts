// Google Identity Services (GIS) 래퍼
// — Drive appdata 스코프 만 요청 (이메일·프로필 미요청)
// — 토큰은 메모리에만 (localStorage 저장 X)

const CLIENT_ID = "329003207663-t43ejjbg1plt0l5u2kftpa41ofkq7e1o.apps.googleusercontent.com";
const SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const GIS_SRC = "https://accounts.google.com/gsi/client";

type TokenClient = {
  requestAccessToken: (override?: { prompt?: string }) => void;
};
interface GisTokenResp {
  access_token?: string;
  expires_in?: number;
  error?: string;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (resp: GisTokenResp) => void;
          }) => TokenClient;
          revoke: (token: string, done?: () => void) => void;
        };
      };
    };
  }
}

let tokenClient: TokenClient | null = null;
let accessToken: string | null = null;
let tokenExpiresAt = 0;  // ms epoch
let scriptLoaded = false;

// localStorage 토큰 캐싱 — 새로고침 시 popup 회피
const TOKEN_KEY = "gdrive_token_cache";
interface CachedToken { token: string; expiresAt: number; }

function loadCachedToken(): void {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return;
    const cached = JSON.parse(raw) as CachedToken;
    if (cached.expiresAt > Date.now() + 30_000) {
      accessToken = cached.token;
      tokenExpiresAt = cached.expiresAt;
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch { /* noop */ }
}

function saveToken(token: string, expiresIn: number): void {
  accessToken = token;
  tokenExpiresAt = Date.now() + expiresIn * 1000;
  try {
    localStorage.setItem(TOKEN_KEY, JSON.stringify({
      token,
      expiresAt: tokenExpiresAt,
    } satisfies CachedToken));
  } catch { /* noop */ }
}

function clearToken(): void {
  accessToken = null;
  tokenExpiresAt = 0;
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* noop */ }
}

// 페이지 로드 시 즉시 캐시 복원
loadCachedToken();

// GIS 스크립트 로드 (1회)
async function loadGisScript(): Promise<void> {
  if (scriptLoaded) return;
  if (window.google?.accounts?.oauth2) {
    scriptLoaded = true;
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => { scriptLoaded = true; resolve(); };
    s.onerror = () => reject(new Error("GIS 스크립트 로드 실패"));
    document.head.appendChild(s);
  });
}

// 로그인 — 사용자 클릭 후 호출 (popup 띄움)
export async function signIn(): Promise<string> {
  await loadGisScript();
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) throw new Error("GIS 로드 실패");

  return new Promise<string>((resolve, reject) => {
    tokenClient = oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: (resp: GisTokenResp) => {
        if (resp.error) {
          reject(new Error(`로그인 실패: ${resp.error}`));
          return;
        }
        if (!resp.access_token) {
          reject(new Error("토큰 없음"));
          return;
        }
        saveToken(resp.access_token, resp.expires_in ?? 3600);
        try { localStorage.setItem("gdrive_was_signed_in", "1"); } catch { /* noop */ }
        resolve(resp.access_token);
      },
    });
    tokenClient.requestAccessToken({ prompt: "consent" });
  });
}

// 토큰 가져오기 — 캐시 우선, 만료 시 silent refresh 시도
export async function getAccessToken(): Promise<string | null> {
  // 캐시된 유효 토큰 있으면 즉시 반환 (새로고침 후에도 popup 없음)
  if (accessToken && Date.now() < tokenExpiresAt - 30_000) {
    return accessToken;
  }
  // 토큰 만료/없음 — silent refresh 시도 (다중 계정이면 popup 가능성)
  await loadGisScript();
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) return null;

  return new Promise<string | null>(resolve => {
    tokenClient = oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: (resp: GisTokenResp) => {
        if (resp.error || !resp.access_token) {
          resolve(null);
          return;
        }
        saveToken(resp.access_token, resp.expires_in ?? 3600);
        resolve(resp.access_token);
      },
    });
    tokenClient.requestAccessToken({ prompt: "" });
  });
}

// 로그아웃
export async function signOut(): Promise<void> {
  if (accessToken) {
    const t = accessToken;
    clearToken();
    await loadGisScript();
    const oauth2 = window.google?.accounts?.oauth2;
    if (oauth2) {
      await new Promise<void>(resolve => {
        oauth2.revoke(t, () => resolve());
      });
    }
  } else {
    clearToken();
  }
  try { localStorage.removeItem("gdrive_was_signed_in"); } catch { /* noop */ }
}

// 이전 로그인 흔적 — 재방문 시 자동 silent refresh 시도용
export function wasSignedIn(): boolean {
  try { return localStorage.getItem("gdrive_was_signed_in") === "1"; } catch { return false; }
}

// 현재 로그인 상태 (메모리 토큰 유효)
export function isSignedIn(): boolean {
  return !!accessToken && Date.now() < tokenExpiresAt - 30_000;
}
