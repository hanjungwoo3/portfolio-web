// Google OAuth 2.0 — 첫 로그인은 implicit flow redirect (모바일 안정성),
// 이후 토큰 갱신은 GIS Token Client 의 silent refresh (hidden iframe) 사용.
// — Drive appdata 스코프만 (이메일·프로필 미요청)
// — Token 은 localStorage 에 1시간 캐시
// — 만료 5분 전 자동 silent refresh 시도, 실패하면 다음 API 호출 시 null 반환

import { App as CapApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { isNativeApp, fetchViaNative } from "./nativeProxy";
import { getInstalledAppVersion } from "./appRelease";

// ─── 안드로이드 앱 경로 ───────────────────────────────────────
// 구글은 임베디드 웹뷰(Capacitor)에서의 OAuth 를 정책적으로 막는다(disallowed_useragent).
// 게다가 앱의 origin 은 https://localhost 라 redirect_uri 로 등록할 수도 없다.
//   → 시스템 브라우저(Custom Tabs)로 열고, 이미 등록된 gh-pages 주소로 돌아오게 한 뒤,
//     그 페이지가 커스텀 스킴으로 앱에 토큰을 넘긴다(중계). Cloud Console 설정 변경이 필요 없다.
//
//   ⚠️ 토큰이 커스텀 스킴을 지나므로, 같은 스킴을 등록한 다른 앱이 가로챌 수 있다.
//      개인용으로는 감수할 만하지만, 배포 범위를 넓힐 거면 Android 클라이언트 + PKCE 로 옮겨야 한다.
const APP_STATE_VALUE = "drive_auth_app_v1";
const APP_SCHEME_REDIRECT = "pfportfolio://oauth";      // AndroidManifest 의 intent-filter 와 짝
const WEB_RELAY_URI = "https://hanjungwoo3.github.io/portfolio-web/";   // Console 에 등록된 값

const CLIENT_ID = "329003207663-t43ejjbg1plt0l5u2kftpa41ofkq7e1o.apps.googleusercontent.com";

// ─── 앱: PKCE 경로 (v1.1.0+) ──────────────────────────────────
// 왜 바꾸나 — 위의 중계 방식은 access_token 만 받는다(implicit). refresh token 이 없어서
//   1시간 뒤 만료되면 끝이고, 앱은 GIS silent refresh 도 못 쓴다(위 주석) → 1시간마다 로그아웃.
//   Authorization Code + PKCE 로 바꾸면 refresh token 이 나와 조용히 갱신된다.
//   덤으로 커스텀 스킴 가로채기 위험도 사라진다 — code 를 훔쳐도 code_verifier 없이는 못 바꾼다.
//
// ★ 옛 APK 를 깨뜨리지 않는 게 핵심이다.
//   앱은 웹을 원격 로드(server.url)하므로 웹만 배포하면 옛 APK 도 이 코드를 받는다.
//   그런데 새 리다이렉트 스킴은 AndroidManifest 에 있어서 APK 를 갈아야 생긴다.
//   옛 APK 가 PKCE 를 타면 딥링크가 영영 안 돌아와 로그인이 먹통이 된다.
//   → 설치된 앱 버전으로 가른다. 미만이면 예전 중계 방식 그대로.
const PKCE_MIN_APP_VERSION = "1.1.0";
const ANDROID_CLIENT_ID = "329003207663-tc41dhub0pu2pqvcdc0oghru2ao5idkm.apps.googleusercontent.com";
// 구글 Android 클라이언트의 커스텀 스킴 = 클라이언트 ID 를 뒤집은 것.
//   AndroidManifest 의 intent-filter scheme 과 정확히 같아야 한다.
const PKCE_SCHEME = "com.googleusercontent.apps.329003207663-tc41dhub0pu2pqvcdc0oghru2ao5idkm";
const PKCE_REDIRECT = `${PKCE_SCHEME}:/oauth2redirect`;
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REFRESH_KEY = "gdrive_refresh_token";
const VERIFIER_KEY = "gdrive_pkce_verifier";

// "1.2.0" 같은 버전 문자열 비교. 자릿수가 달라도(1.10 vs 1.9) 맞게 판정한다.
function versionGte(a: string, b: string): boolean {
  const pa = a.split(".").map(n => parseInt(n, 10) || 0);
  const pb = b.split(".").map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0, y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

// 이 앱이 PKCE 를 탈 수 있나 — 매니페스트에 새 스킴이 있는 버전인가.
let pkceCapable: boolean | null = null;
async function canUsePkce(): Promise<boolean> {
  if (!isNativeApp()) return false;
  if (pkceCapable !== null) return pkceCapable;
  const v = await getInstalledAppVersion();
  pkceCapable = !!v && versionGte(v, PKCE_MIN_APP_VERSION);
  return pkceCapable;
}

// PKCE code_verifier / code_challenge (S256)
function randomVerifier(): string {
  const bytes = new Uint8Array(64);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function challengeOf(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const STATE_VALUE = "drive_auth_v1";

// ─── silent refresh 진단 ──────────────────────────────────────
// 왜 필요한가 — GIS 의 실패 사유가 전부 삼켜지고 있어서 1시간마다 로그아웃되는 원인을
//   짐작만 할 수 있었다(서드파티 쿠키 차단? interaction_required? 스크립트 로드 실패?).
//   사유마다 대응이 완전히 달라서, 추측으로 고치면 헛수고다. 마지막 1건만 남긴다.
const DIAG_KEY = "gdrive_auth_diag";

export interface AuthDiag {
  at: number;             // 실패 시각 (ms)
  stage: string;          // 어느 단계에서 실패했나
  error?: string;         // GIS 가 준 error 코드
  detail?: string;        // error_description 등
}

function noteAuthFailure(stage: string, err?: unknown): void {
  let error: string | undefined;
  let detail: string | undefined;
  if (err && typeof err === "object") {
    const o = err as Record<string, unknown>;
    error = typeof o.type === "string" ? o.type
      : typeof o.error === "string" ? o.error : undefined;
    detail = typeof o.error_description === "string" ? o.error_description
      : typeof o.message === "string" ? o.message : undefined;
  } else if (typeof err === "string") {
    error = err;
  }
  const diag: AuthDiag = { at: Date.now(), stage, error, detail };
  try { localStorage.setItem(DIAG_KEY, JSON.stringify(diag)); } catch { /* noop */ }
  console.warn("[googleAuth] silent refresh 실패", diag);
}

// 성공하면 지운다 — 옛 실패 기록이 남아 오해를 부르지 않게.
function clearAuthDiag(): void {
  try { localStorage.removeItem(DIAG_KEY); } catch { /* noop */ }
}

export function getAuthDiag(): AuthDiag | null {
  try {
    const raw = localStorage.getItem(DIAG_KEY);
    return raw ? JSON.parse(raw) as AuthDiag : null;
  } catch { return null; }
}

// localStorage keys
const TOKEN_KEY = "gdrive_token_cache";
const WAS_SIGNED_IN_KEY = "gdrive_was_signed_in";
const PRE_AUTH_PATH_KEY = "gdrive_pre_auth_path";

// silent refresh 를 토큰 만료 N ms 전에 시도
const SILENT_REFRESH_LEAD_MS = 5 * 60 * 1000;

interface CachedToken { token: string; expiresAt: number; }

interface GisTokenResponse {
  access_token?: string;
  expires_in?: string | number;
  error?: string;
}

interface GisTokenClient {
  requestAccessToken: (overrides?: { prompt?: string; hint?: string }) => void;
}

interface GoogleOAuth2 {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    callback: (resp: GisTokenResponse) => void;
    error_callback?: (err: unknown) => void;
    prompt?: string;
  }) => GisTokenClient;
}

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOAuth2 } };
  }
}

let accessToken: string | null = null;
let tokenExpiresAt = 0;
let refreshTimer: number | null = null;
let tokenClient: GisTokenClient | null = null;
let pendingSilentResolvers: Array<(t: string | null) => void> = [];

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
      token, expiresAt: tokenExpiresAt,
    } satisfies CachedToken));
    localStorage.setItem(WAS_SIGNED_IN_KEY, "1");
  } catch { /* noop */ }
  scheduleSilentRefresh();
}

function clearToken(): void {
  accessToken = null;
  tokenExpiresAt = 0;
  if (refreshTimer !== null) {
    window.clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(WAS_SIGNED_IN_KEY);
  } catch { /* noop */ }
}

// GIS 스크립트가 로드될 때까지 대기 후 token client 초기화 (idempotent)
function ensureTokenClient(): Promise<GisTokenClient | null> {
  if (isNativeApp()) return Promise.resolve(null);   // 앱은 GIS 를 안 쓴다(위 주석 참조)
  if (tokenClient) return Promise.resolve(tokenClient);
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const oauth2 = window.google?.accounts?.oauth2;
      if (oauth2) {
        tokenClient = oauth2.initTokenClient({
          client_id: CLIENT_ID,
          scope: SCOPE,
          callback: (resp) => {
            if (resp.error || !resp.access_token) {
              noteAuthFailure("callback", resp);
              resolveSilent(null);
              return;
            }
            clearAuthDiag();
            const exp = typeof resp.expires_in === "string"
              ? parseInt(resp.expires_in, 10)
              : (resp.expires_in ?? 3600);
            saveToken(resp.access_token, exp);
            resolveSilent(resp.access_token);
          },
          error_callback: (err) => {
            // GIS 가 popup/iframe 을 못 띄웠거나 세션이 없을 때 여기로 온다.
            noteAuthFailure("error_callback", err);
            resolveSilent(null);
          },
        });
        resolve(tokenClient);
        return;
      }
      // GIS 가 끝내 로드되지 않으면 (e.g. 네트워크 차단) 10초 후 포기
      if (Date.now() - start > 10_000) {
        noteAuthFailure("gis-load-timeout");
        resolve(null);
        return;
      }
      window.setTimeout(tick, 100);
    };
    tick();
  });
}

function resolveSilent(token: string | null): void {
  const list = pendingSilentResolvers;
  pendingSilentResolvers = [];
  list.forEach((r) => r(token));
}

// silent refresh 호출 — 사용자 동의 + Google 세션 있으면 hidden iframe 으로 새 토큰 발급
// 첫 로그인은 redirect 로 처리하므로 여기선 prompt: '' (interactive 없음) 만 사용
function requestSilentRefresh(): Promise<string | null> {
  // ★ 앱에서는 GIS 를 절대 태우지 않는다.
  //   GIS 는 숨은 iframe/팝업을 전제로 만들어졌는데 안드로이드 웹뷰엔 팝업이 없다.
  //   prompt:"none" 이어도 GIS 가 최상위 navigate 로 떨어뜨려, 설정만 열어도 앱이
  //   accounts.google.com 으로 이동해 웹페이지가 돼 버린다(실측: gsiwebsdk=gis_attributes 로 확인).
  //   앱은 토큰이 없으면 그냥 없는 것으로 두고, 재로그인은 Custom Tab 흐름(signIn)으로만 한다.
  if (isNativeApp()) return Promise.resolve(null);
  if (!wasSignedIn()) return Promise.resolve(null);
  return new Promise((resolve) => {
    pendingSilentResolvers.push(resolve);
    void ensureTokenClient().then((client) => {
      if (!client) {
        resolveSilent(null);
        return;
      }
      try {
        // prompt: "none" — 완전 silent. 사용자 동의 / 계정 선택 등 UI 없음.
        //   필요한 경우 error_callback 으로 실패 (popup 안 뜸).
        // 빈 문자열 "" 은 "처음만 안 묻고 그 외엔 popup 가능" 이라 토큰 만료 시 팝업 노출됨.
        client.requestAccessToken({ prompt: "none" });
      } catch (e) {
        noteAuthFailure("request-throw", e);
        resolveSilent(null);
      }
    });
  });
}

function scheduleSilentRefresh(): void {
  // 앱은 GIS 를 안 쓰지만(위 주석), PKCE refresh token 이 있으면 그걸로 갱신한다.
  if (isNativeApp()) {
    void canUsePkce().then((ok) => { if (ok) schedulePkceRefresh(); });
    return;
  }
  if (refreshTimer !== null) {
    window.clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  if (!accessToken) return;
  const delay = Math.max(0, tokenExpiresAt - Date.now() - SILENT_REFRESH_LEAD_MS);
  refreshTimer = window.setTimeout(() => {
    refreshTimer = null;
    void requestSilentRefresh();
  }, delay);
}

// 앱 전용 갱신 타이머 — 만료 5분 전에 refresh token 으로 조용히 바꾼다.
function schedulePkceRefresh(): void {
  if (refreshTimer !== null) {
    window.clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  if (!accessToken) return;
  const delay = Math.max(0, tokenExpiresAt - Date.now() - SILENT_REFRESH_LEAD_MS);
  refreshTimer = window.setTimeout(() => {
    refreshTimer = null;
    void refreshWithToken();
  }, delay);
}

// redirect_uri — Google Cloud Console 에 등록된 값과 정확히 일치해야 함
function getRedirectUri(): string {
  // gh-pages: https://hanjungwoo3.github.io/portfolio-web/
  // local:    http://localhost:5173/
  // pathname 끝에 슬래시 강제 (CSC 등록 형식 일치)
  const path = window.location.pathname.endsWith("/")
    ? window.location.pathname
    : window.location.pathname + "/";
  return window.location.origin + path;
}

// 페이지 로드 시 즉시 — 1) 캐시 복원, 2) URL fragment 의 token 처리
loadCachedToken();
handleAuthRedirect();
scheduleSilentRefresh();

// 앱: 브라우저에서 로그인을 마치고 커스텀 스킴으로 돌아오는 순간을 받는다.
if (isNativeApp()) {
  void CapApp.addListener("appUrlOpen", (e: { url: string }) => { handleAppAuthUrl(e.url); });
}

// 탭 전환 시 자동 silent refresh 제거 — Google 라이브러리가 prompt:"none" 이어도
// 가끔 hidden iframe UI 가 잠깐 보이는 문제. 토큰 갱신은 SettingsDialog 진입 시
// 또는 명시적 sync 액션(uploadToDrive 등) 시점에만 수행 (일관 정책).

// 로그인 — 전체 페이지가 google 로 redirect (사용자 클릭 후)
// Promise 안 반환 — redirect 후 다시 돌아올 때 token 처리됨
export function signIn(): void {
  // 로그인 후 돌아갈 path 저장 (예: 모달 다시 열림 등)
  try {
    localStorage.setItem(PRE_AUTH_PATH_KEY, window.location.pathname + window.location.search);
  } catch { /* noop */ }

  // 새 APK(v1.1.0+)는 PKCE 로. 옛 APK·웹은 아래 기존 경로 그대로.
  void canUsePkce().then((ok) => { if (ok) void signInPkce(); else signInLegacy(); });
}

// PKCE 로그인 — Custom Tab 으로 authorize 를 열고, 커스텀 스킴으로 code 를 받는다.
async function signInPkce(): Promise<void> {
  const verifier = randomVerifier();
  try { localStorage.setItem(VERIFIER_KEY, verifier); } catch { /* noop */ }
  const params = new URLSearchParams({
    client_id: ANDROID_CLIENT_ID,
    redirect_uri: PKCE_REDIRECT,
    response_type: "code",
    scope: SCOPE,
    state: APP_STATE_VALUE,
    code_challenge: await challengeOf(verifier),
    code_challenge_method: "S256",
    // refresh token 을 받으려면 둘 다 필요하다. prompt 를 빼면 재로그인 때 안 준다.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  });
  void Browser.open({ url: `${AUTH_URL}?${params}` });
}

function signInLegacy(): void {
  const native = isNativeApp();
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    // 앱은 등록된 웹 주소로 돌아온 뒤 그 페이지가 앱으로 넘긴다(위 주석 참조).
    redirect_uri: native ? WEB_RELAY_URI : getRedirectUri(),
    response_type: "token",
    scope: SCOPE,
    state: native ? APP_STATE_VALUE : STATE_VALUE,
    prompt: "consent",
    include_granted_scopes: "true",
  });
  const url = `${AUTH_URL}?${params}`;
  if (native) {
    // 웹뷰가 아니라 시스템 브라우저로 — 웹뷰로 열면 구글이 막는다.
    void Browser.open({ url });
    return;
  }
  window.location.href = url;
}

// 앱이 커스텀 스킴으로 돌려받은 URL 에서 토큰 추출. 앱에서만 호출된다.
export function handleAppAuthUrl(url: string): boolean {
  // PKCE — code 는 쿼리로 온다(fragment 가 아니다).
  if (url.startsWith(PKCE_SCHEME + ":")) {
    void Browser.close().catch(() => { /* 이미 닫혔으면 무시 */ });
    const q = url.indexOf("?");
    if (q < 0) return false;
    const params = new URLSearchParams(url.slice(q + 1));
    if (params.get("state") !== APP_STATE_VALUE) return false;
    const code = params.get("code");
    if (!code) {
      noteAuthFailure("pkce-authorize", { error: params.get("error") ?? "no-code" });
      return false;
    }
    void exchangeCode(code);
    return true;
  }
  const i = url.indexOf("#");
  if (i < 0) return false;
  const hash = new URLSearchParams(url.slice(i + 1));
  if (hash.get("state") !== APP_STATE_VALUE) return false;
  const token = hash.get("access_token");
  void Browser.close().catch(() => { /* 이미 닫혔으면 무시 */ });
  if (!token || hash.get("error")) return false;
  saveToken(token, parseInt(hash.get("expires_in") ?? "3600", 10));
  return true;
}

// authorization code → 토큰. CORS 때문에 웹뷰 fetch 로는 못 하고 네이티브 HTTP 로 보낸다.
async function exchangeCode(code: string): Promise<void> {
  let verifier = "";
  try { verifier = localStorage.getItem(VERIFIER_KEY) ?? ""; } catch { /* noop */ }
  if (!verifier) { noteAuthFailure("pkce-no-verifier"); return; }
  try {
    const resp = await fetchViaNative(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: ANDROID_CLIENT_ID,
        code,
        code_verifier: verifier,
        grant_type: "authorization_code",
        redirect_uri: PKCE_REDIRECT,
      }).toString(),
    });
    const data = await resp.json() as {
      access_token?: string; refresh_token?: string; expires_in?: number; error?: string;
      error_description?: string;
    };
    if (!resp.ok || !data.access_token) { noteAuthFailure("pkce-exchange", data); return; }
    // refresh token 은 최초 동의 때만 온다 — 오면 반드시 보관한다.
    if (data.refresh_token) {
      try { localStorage.setItem(REFRESH_KEY, data.refresh_token); } catch { /* noop */ }
    }
    try { localStorage.removeItem(VERIFIER_KEY); } catch { /* noop */ }
    clearAuthDiag();
    saveToken(data.access_token, data.expires_in ?? 3600);
  } catch (e) {
    noteAuthFailure("pkce-exchange-throw", e);
  }
}

// refresh token 으로 조용히 갱신 — 앱에서 1시간마다 로그아웃되던 것을 막는 핵심.
async function refreshWithToken(): Promise<string | null> {
  let rt = "";
  try { rt = localStorage.getItem(REFRESH_KEY) ?? ""; } catch { /* noop */ }
  if (!rt) return null;
  try {
    const resp = await fetchViaNative(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: ANDROID_CLIENT_ID,
        refresh_token: rt,
        grant_type: "refresh_token",
      }).toString(),
    });
    const data = await resp.json() as {
      access_token?: string; expires_in?: number; error?: string; error_description?: string;
    };
    if (!resp.ok || !data.access_token) {
      noteAuthFailure("pkce-refresh", data);
      // invalid_grant = 사용자가 접근을 취소했거나 토큰이 폐기됨 → 다시 로그인해야 한다.
      if (data.error === "invalid_grant") {
        try { localStorage.removeItem(REFRESH_KEY); } catch { /* noop */ }
      }
      return null;
    }
    clearAuthDiag();
    saveToken(data.access_token, data.expires_in ?? 3600);
    return data.access_token;
  } catch (e) {
    noteAuthFailure("pkce-refresh-throw", e);
    return null;
  }
}

// URL fragment 에서 token 추출 — 페이지 로드 시 자동 호출
export function handleAuthRedirect(): boolean {
  if (typeof window === "undefined" || !window.location.hash) return false;
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const state = hash.get("state");

  // 앱에서 시작한 로그인 — 이 페이지(gh-pages)는 중계소일 뿐이다. 커스텀 스킴으로 앱에 넘긴다.
  //   앱 안에서 이 분기를 타면 무한 반복이므로 웹에서만 중계한다.
  if (state === APP_STATE_VALUE && !isNativeApp()) {
    window.location.replace(`${APP_SCHEME_REDIRECT}#${window.location.hash.slice(1)}`);
    return false;
  }

  if (state !== STATE_VALUE) return false;

  const token = hash.get("access_token");
  const expiresIn = parseInt(hash.get("expires_in") ?? "3600", 10);
  const error = hash.get("error");

  // 에러 시 hash 제거하고 종료
  if (error || !token) {
    history.replaceState({}, "", window.location.pathname + window.location.search);
    return false;
  }

  saveToken(token, expiresIn);
  // URL hash 청소
  history.replaceState({}, "", window.location.pathname + window.location.search);
  return true;
}

// 토큰 가져오기 — 캐시 유효 시 즉시 반환, 만료/없음이면 silent refresh 시도
export async function getAccessToken(): Promise<string | null> {
  if (accessToken && Date.now() < tokenExpiresAt - 30_000) {
    return accessToken;
  }
  // 앱에 refresh token 이 있으면 그걸로 먼저 — GIS 를 안 타므로 웹뷰 이탈 문제가 없다.
  if (await canUsePkce()) {
    const t = await refreshWithToken();
    if (t) return t;
  }
  // 이전에 로그인한 적 있으면 silent refresh 시도 (사용자 클릭 불필요)
  if (wasSignedIn()) {
    const refreshed = await requestSilentRefresh();
    if (refreshed) return refreshed;
  }
  return null;  // 사용자가 다시 signIn() 호출 필요
}

// 로그아웃 — token revoke + localStorage 삭제
export async function signOut(): Promise<void> {
  const t = accessToken;
  clearToken();
  if (t) {
    try {
      await fetch(`${REVOKE_URL}?token=${encodeURIComponent(t)}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
    } catch { /* network 실패 무시 */ }
  }
}

// 이전 로그인 흔적 — UI 에서 "재로그인 가능" 힌트용
export function wasSignedIn(): boolean {
  try { return localStorage.getItem(WAS_SIGNED_IN_KEY) === "1"; } catch { return false; }
}

// 현재 토큰 유효 여부
export function isSignedIn(): boolean {
  return !!accessToken && Date.now() < tokenExpiresAt - 30_000;
}
