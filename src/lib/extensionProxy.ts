// 크롬 확장('포트폴리오 시세 프록시') 전송 계층.
//   확장이 설치돼 있으면 시세 요청을 브라우저가 직접 보낸다 — 가정용 IP 라 토스가
//   클라우드 egress 를 막아도(400 + 빈 본문) 영향을 받지 않고, 호출 한도도 없다.
//
//   페이지 JS 는 chrome.* 에 접근할 수 없으므로 콘텐트 스크립트와 window.postMessage 로
//   주고받는다(extension/content.js). 확장이 없으면 응답이 없고, 앱은 기존 프록시를 쓴다.
//
//   ⚠️ Yahoo 는 여기로 보내면 안 된다 — 가정용 IP 를 429 로 막는다. 라우팅은 api.ts 가 판단.

import { useSyncExternalStore } from "react";

const TAG = "__pfx";
const TIMEOUT_MS = 20_000;

interface ExtResponse {
  status?: number;
  contentType?: string;
  b64?: string;
  error?: string;
}

// 확장 버전(manifest) — 감지 전에는 null. ready 여부는 이 값으로 판단한다.
let version: string | null = null;
let ready = false;
const pending = new Map<string, (r: ExtResponse) => void>();
let seq = 0;
// ready 는 핸드셰이크 후 비동기로 켜진다 → 구독으로 알린다(폴링 없이 UI 가 따라오게).
const readyListeners = new Set<() => void>();

if (typeof window !== "undefined") {
  window.addEventListener("message", (e: MessageEvent) => {
    if (e.source !== window) return;
    const m = e.data as Record<string, unknown> | null;
    if (!m || typeof m !== "object") return;
    const kind = m[TAG];
    if (kind === "ready") {
      const v = typeof m.version === "string" ? m.version : "0.0.0";
      if (!ready || version !== v) {
        ready = true; version = v;
        readyListeners.forEach(l => l());
      }
      return;
    }
    if (kind !== "res") return;
    const cb = pending.get(String(m.id));
    if (cb) { pending.delete(String(m.id)); cb(m as ExtResponse); }
  });
  // 콘텐트 스크립트는 document_start 에 붙지만, 순서를 보장받지 않으므로 이쪽에서도 물어본다.
  window.postMessage({ [TAG]: "ping" }, "*");
}

export function isExtensionProxyReady(): boolean {
  return ready;
}

function subscribeReady(cb: () => void): () => void {
  readyListeners.add(cb);
  return () => { readyListeners.delete(cb); };
}

export function getExtensionVersion(): string | null {
  return version;
}

// 확장 버전을 구독하는 훅 — 감지되면 리렌더된다. null = 확장 없음.
//   (스냅샷은 문자열/ null 원시값이라 useSyncExternalStore 에 그대로 쓸 수 있다)
export function useExtensionProxyVersion(): string | null {
  return useSyncExternalStore(subscribeReady, getExtensionVersion, () => null);
}

export function useExtensionProxyReady(): boolean {
  return useExtensionProxyVersion() !== null;
}

// 앱이 기대하는 확장 버전 — 확장을 고칠 때 manifest.json 과 함께 올린다.
// 개발자 모드 설치는 자동 업데이트가 없어, 이 값보다 낮으면 설정에서 재설치를 안내한다.
export const EXPECTED_EXTENSION_VERSION = "1.0.0";

// "1.2.10" 같은 점 구분 버전 비교 — a < b 면 음수.
export function compareVersion(a: string, b: string): number {
  const pa = a.split(".").map(n => parseInt(n, 10) || 0);
  const pb = b.split(".").map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

// base64 → 바이트. 네이버 자금동향은 EUC-KR 이라 텍스트로 옮기면 깨진다 →
// 확장이 바이트를 base64 로 넘기고 여기서 되돌려 Response 로 만든다(디코딩은 호출측).
function fromBase64(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  return buf;   // ArrayBuffer 로 돌려야 Response 의 BodyInit 에 그대로 들어간다
}

export async function fetchViaExtension(targetUrl: string, init?: RequestInit): Promise<Response> {
  const id = `${Date.now()}-${seq++}`;
  const headers = (init?.headers ?? {}) as Record<string, string>;
  const res = await new Promise<ExtResponse>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("extension timeout"));
    }, TIMEOUT_MS);
    pending.set(id, r => { clearTimeout(timer); resolve(r); });
    window.postMessage({
      [TAG]: "req", id,
      url: targetUrl,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : undefined,
      contentType: headers["Content-Type"] ?? headers["content-type"],
    }, "*");
  });
  if (res.error) throw new Error(`extension: ${res.error}`);
  return new Response(fromBase64(res.b64 ?? ""), {
    status: res.status ?? 502,
    headers: { "Content-Type": res.contentType ?? "application/octet-stream" },
  });
}
