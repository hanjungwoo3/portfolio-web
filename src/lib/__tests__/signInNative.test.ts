// 안드로이드 앱 로그인은 **끝나야 한다** — 2026-10-26 사용자 신고 재발 방지.
//
// 실제로 있었던 일: 앱에서 Google 로그인을 누르면 토큰은 받아지는데(창을 닫으면 로그인돼 있음)
//   "Google 로그인 중..." 에서 영원히 안 넘어갔다. 10-22 데스크톱 로그인 추가 때 signIn() 을
//   Promise 로 바꾸면서 안드로이드 네이티브 경로를 웹(redirect)처럼 '안 끝나는 Promise' 로 뒀기 때문.
//   enableSync() 가 그 Promise 를 기다리므로 모바일 설정 버튼이 멈췄다.

import { describe, it, expect, vi, beforeEach } from "vitest";

const plugin = { getAccessToken: vi.fn<(o: unknown) => Promise<unknown>>() };
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => true, Plugins: { GoogleAuth: plugin } } }));
vi.mock("@capacitor/app", () => ({ App: { addListener: async () => ({ remove() {} }), getInfo: async () => ({ version: "1.2.4" }) } }));
vi.mock("@capacitor/browser", () => ({ Browser: { open: async () => {}, close: async () => {} } }));
vi.mock("../nativeProxy", () => ({ isNativeApp: () => true, isDesktopApp: () => false, isDirectApp: () => true }));
vi.mock("../appRelease", () => ({ getInstalledAppVersion: async () => "1.2.4" }));
vi.mock("../extensionProxy", () => ({
  isExtensionProxyReady: () => false, getGoogleTokenViaExtension: async () => null,
  getGoogleTokenViaExtensionDetailed: async () => ({ error: "no" }), clearGoogleTokenViaExtension: async () => {},
}));

// node 환경 — googleAuth 가 모듈 로드 때 만지는 브라우저 전역을 최소로 흉내낸다
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); },
};
(globalThis as unknown as { window: unknown }).window = Object.assign(globalThis, {
  location: { pathname: "/", search: "", hash: "" }, addEventListener() {}, removeEventListener() {},
});

const withTimeout = <T,>(p: Promise<T>, ms = 1000) =>
  Promise.race([p, new Promise<"timeout">(r => setTimeout(() => r("timeout"), ms))]);

describe("signIn() — 안드로이드 네이티브 인증", () => {
  beforeEach(() => { plugin.getAccessToken.mockReset(); store.clear(); });

  it("토큰을 받으면 true 로 끝난다(스피너가 걷힌다)", async () => {
    plugin.getAccessToken.mockResolvedValue({ accessToken: "ya29.x", expiresIn: 3600 });
    const { signIn, isSignedIn } = await import("../googleAuth");
    expect(await withTimeout(signIn())).toBe(true);
    expect(isSignedIn()).toBe(true);
    expect(plugin.getAccessToken).toHaveBeenCalledWith({ scope: "https://www.googleapis.com/auth/drive.appdata", interactive: true });
  });

  it("취소·실패면 false 로 끝난다 — 옛 브라우저 경로(폐기됨)로 떨어뜨리지 않는다", async () => {
    plugin.getAccessToken.mockRejectedValue(new Error("consent-result-failed"));
    const { signIn } = await import("../googleAuth");
    expect(await withTimeout(signIn())).toBe(false);
  });
});
