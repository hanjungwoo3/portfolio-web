// Google OAuth 2.0 — 첫 로그인은 implicit flow redirect (모바일 안정성),
// 이후 토큰 갱신은 GIS Token Client 의 silent refresh (hidden iframe) 사용.
// — Drive appdata 스코프만 (이메일·프로필 미요청)
// — Token 은 localStorage 에 1시간 캐시
// — 만료 5분 전 자동 silent refresh 시도, 실패하면 다음 API 호출 시 null 반환

import { App as CapApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import { isNativeApp } from "./nativeProxy";
import { getInstalledAppVersion } from "./appRelease";

// ─── 안드로이드 앱 경로 ───────────────────────────────────────
// 구글은 임베디드 웹뷰(Capacitor)에서의 OAuth 를 정책적으로 막는다(disallowed_useragent).
// 게다가 앱의 origin 은 https://localhost 라 redirect_uri 로 등록할 수도 없다.
//   → 시스템 브라우저(Custom Tabs)로 열고, 이미 등록된 gh-pages 주소로 돌아오게 한 뒤,
//     그 페이지가 커스텀 스킴으로 앱에 토큰을 넘긴다(중계). Cloud Console 설정 변경이 필요 없다.
//
//   ⚠️ 토큰이 커스텀 스킴을 지나므로, 같은 스킴을 등록한 다른 앱이 가로챌 수 있다.
//      v1.2.0 부터는 이 경로를 안 쓴다 — 아래 네이티브 인증으로 대체됐다.
//      옛 APK(1.1.x 이하)를 위해 남겨 둔다.
const APP_STATE_VALUE = "drive_auth_app_v1";
const APP_SCHEME_REDIRECT = "pfportfolio://oauth";      // AndroidManifest 의 intent-filter 와 짝
const WEB_RELAY_URI = "https://hanjungwoo3.github.io/portfolio-web/";   // Console 에 등록된 값

const CLIENT_ID = "329003207663-t43ejjbg1plt0l5u2kftpa41ofkq7e1o.apps.googleusercontent.com";
const SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const STATE_VALUE = "drive_auth_v1";

// ─── 앱: 네이티브 구글 인증 (v1.2.0+) ─────────────────────────
// 앱에서는 브라우저 기반 OAuth 를 쓸 수 없다.
//   · 구글은 임베디드 웹뷰의 OAuth 를 막는다(disallowed_useragent).
//   · Custom Tab + 커스텀 스킴 리다이렉트도 안드로이드에서 폐기됐다
//     ("Custom URI schemes are no longer supported on Android" — 실측: 400 invalid_request).
//   → 플레이 서비스의 AuthorizationClient 를 네이티브 플러그인으로 부른다(GoogleAuthPlugin.java).
//
// 이게 1시간 로그아웃을 푸는 방식이다. refresh token 을 쓰지 않는다 —
//   계정이 기기에 있으니 한 번 동의한 뒤로는 authorize() 를 다시 부르면 UI 없이 새 토큰이 나온다.
//
// ★ 옛 APK 를 깨뜨리지 않는 게 핵심.
//   앱은 웹을 원격 로드하므로 웹만 배포해도 옛 APK 가 이 코드를 받는다. 그런데 플러그인은
//   APK 안에 있어서 옛 버전엔 없다. 없는 플러그인을 부르면 로그인이 먹통이 된다.
//   → 설치된 앱 버전으로 가른다. 미만이면 예전 중계 방식 그대로.
const NATIVE_AUTH_MIN_APP_VERSION = "1.2.0";

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

// 이 앱이 네이티브 인증을 탈 수 있나 — 플러그인이 들어 있는 버전인가.
let nativeAuthCapable: boolean | null = null;
async function canUseNativeAuth(): Promise<boolean> {
  if (!isNativeApp()) return false;
  if (nativeAuthCapable !== null) return nativeAuthCapable;
  const v = await getInstalledAppVersion();
  nativeAuthCapable = !!v && versionGte(v, NATIVE_AUTH_MIN_APP_VERSION);
  return nativeAuthCapable;
}

interface NativeAuthResult { accessToken?: string; expiresIn?: number; needsConsent?: boolean }

interface GoogleAuthNativePlugin {
  getAccessToken?: (o: unknown) => Promise<NativeAuthResult>;
  clearToken?: (o: { token: string }) => Promise<void>;
}

function nativePlugin(): GoogleAuthNativePlugin | undefined {
  return (Capacitor as unknown as {
    Plugins?: Record<string, GoogleAuthNativePlugin>;
  }).Plugins?.GoogleAuth;
}

// 네이티브 토큰 요청. interactive=false 면 동의가 필요할 때 UI 없이 needsConsent 로 돌아온다.
async function nativeAuthToken(interactive: boolean): Promise<string | null> {
  try {
    const plugin = nativePlugin();
    if (!plugin?.getAccessToken) { noteAuthFailure("native-plugin-missing"); return null; }
    const r = await plugin.getAccessToken({ scope: SCOPE, interactive });
    if (r.needsConsent) {
      // 조용한 갱신에서 동의가 필요하다고 나오면, 사용자가 로그인 버튼을 눌러야 한다.
      if (!interactive) noteAuthFailure("native-needs-consent");
      return null;
    }
    if (!r.accessToken) { noteAuthFailure("native-no-token"); return null; }
    clearAuthDiag();
    saveToken(r.accessToken, r.expiresIn ?? 3600);
    return r.accessToken;
  } catch (e) {
    noteAuthFailure("native-auth-throw", e);
    return null;
  }
}

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
  // 앱은 GIS 를 안 쓰지만(위 주석), 네이티브 인증이 되는 버전이면 그걸로 갱신한다.
  if (isNativeApp()) {
    void canUseNativeAuth().then((ok) => { if (ok) scheduleNativeRefresh(); });
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

// 앱 전용 갱신 타이머 — 만료 5분 전에 네이티브로 조용히 새 토큰을 받는다.
function scheduleNativeRefresh(): void {
  if (refreshTimer !== null) {
    window.clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  if (!accessToken) return;
  const delay = Math.max(0, tokenExpiresAt - Date.now() - SILENT_REFRESH_LEAD_MS);
  refreshTimer = window.setTimeout(() => {
    refreshTimer = null;
    void nativeAuthToken(false);
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

  // 새 APK(v1.2.0+)는 네이티브 인증으로. 옛 APK·웹은 아래 기존 경로 그대로.
  void canUseNativeAuth().then((ok) => {
    if (ok) {
      // 사용자가 누른 로그인이므로 필요하면 동의 화면을 띄운다(interactive=true).
      void nativeAuthToken(true).then((t) => {
        // 플러그인이 없거나 실패하면 옛 경로로 떨어뜨린다 — 로그인이 먹통이 되면 안 된다.
        if (!t) signInLegacy();
      });
    } else {
      signInLegacy();
    }
  });
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
  // 앱이면 네이티브로 조용히 받는다 — 이미 동의돼 있으면 UI 없이 새 토큰이 나온다.
  //   이게 앱의 1시간 로그아웃을 푸는 지점이다.
  if (await canUseNativeAuth()) {
    const t = await nativeAuthToken(false);
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
  const native = await canUseNativeAuth();
  clearToken();
  // ★ 앱에서는 revoke 를 부르지 않는다.
  //   revoke 는 서버 권한만 없애고, 플레이 서비스는 그 토큰을 캐시에서 계속 돌려준다.
  //   그러면 재로그인 때 동의 창 없이 "로그인됨" 이 되고 API 호출만 401 로 죽는다(실측).
  //   대신 네이티브 캐시를 비운다 — 다음 authorize() 가 새 토큰을 발급한다.
  //   (권한 자체를 끊고 싶으면 구글 계정 설정에서 앱 연결을 해제하면 된다)
  if (native) {
    if (t) { try { await nativePlugin()?.clearToken?.({ token: t }); } catch { /* noop */ } }
    return;
  }
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
// Drive 호출이 401 을 받았을 때 — 토큰이 무효(폐기·만료)라는 뜻이다.
//   앱에서는 플레이 서비스 캐시에 무효 토큰이 남아 있을 수 있어, 비우고 새로 받아야 한다.
//   비우지 않으면 같은 죽은 토큰을 계속 돌려받아 "로그인됐는데 호출만 실패" 가 반복된다.
export async function recoverFromUnauthorized(): Promise<string | null> {
  const dead = accessToken;
  clearToken();
  if (!(await canUseNativeAuth())) return null;
  if (dead) { try { await nativePlugin()?.clearToken?.({ token: dead }); } catch { /* noop */ } }
  return await nativeAuthToken(false);
}

export function isSignedIn(): boolean {
  return !!accessToken && Date.now() < tokenExpiresAt - 30_000;
}
