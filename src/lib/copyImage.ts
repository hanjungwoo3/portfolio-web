// 화면 일부를 그림(PNG)으로 찍어 클립보드에 — 구글 AI 에 붙여넣어(Cmd/Ctrl+V) 그래프째 묻기(사용자 2026-11-05 "이미지 전송도 될까?" → "이미지 복사 테스트부터").
//   구글 AI 는 주소(?q=)로만 질문을 받아 그림을 같이 못 보낸다 → 클립보드에 넣고 사람이 붙여넣는다.
//   순서: ① 데스크톱 앱 = 앱 명령 copy_image(시간 제한 없음, 0.1.13+)
//         ② 웹·옛 앱 = navigator.clipboard.write — 클릭 직후만 허락돼, 그림 만드는 게 2초를 넘으면 맥 앱에서
//            "not allowed by the user agent" 로 거절됐다(사용자 2026-11-05). 그래서 Promise 를 바로 넘긴다
//         ③ 다 안 되면 PNG 파일로 내려받기 — 그 파일을 AI 창에 끌어 넣는다
import { toBlob } from "html-to-image";
import { isDesktopApp } from "./nativeProxy";

export type CopyResult = { ok: true; ms: number; bytes: number; via: "app" | "web" | "file" } | { ok: false; reason: string };

function shoot(el: HTMLElement): Promise<Blob> {
  return toBlob(el, {
    pixelRatio: Math.min(2, window.devicePixelRatio || 1),
    backgroundColor: getComputedStyle(document.body).backgroundColor || "#ffffff",
    cacheBust: true,
    // data-noshot = 찍지 않을 것(버튼 자신), 다른 사이트 그림(로고 등)은 막혀 실패할 수 있어 뺀다
    filter: n => !(n instanceof HTMLElement && n.dataset.noshot != null) && !(n instanceof HTMLImageElement && n.src && !n.src.startsWith(location.origin) && !n.src.startsWith("data:")),
  }).then(b => { if (!b) throw new Error("그림을 만들지 못했습니다"); return b; });
}

const b64 = (b: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] ?? ""); r.onerror = () => rej(r.error); r.readAsDataURL(b); });

function download(b: Blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(b);
  a.download = `수급-${new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 16).replace(/\D/g, "")}.png`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

export async function copyNodeImage(el: HTMLElement): Promise<CopyResult> {
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  const blobP = shoot(el);
  // ② 웹 클립보드는 클릭 직후에 불러야 해서 앱이어도 먼저 걸어 둔다(앱 명령이 되면 결과는 무시)
  const webP = typeof ClipboardItem !== "undefined" && navigator.clipboard?.write
    ? navigator.clipboard.write([new ClipboardItem({ "image/png": blobP })]).then(() => true, () => false)
    : Promise.resolve(false);
  let blob: Blob;
  try { blob = await blobP; } catch (e) { return { ok: false, reason: String((e as Error)?.message ?? e) }; }
  if (isDesktopApp()) {
    const t = (window as unknown as { __TAURI_INTERNALS__?: { invoke: (c: string, a: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__;
    try { await t?.invoke("copy_image", { pngB64: await b64(blob) }); return { ok: true, ms: ms(), bytes: blob.size, via: "app" }; }
    catch { /* 0.1.12 이하 앱 — 명령 없음 → 웹 결과로 */ }
  }
  if (await webP) return { ok: true, ms: ms(), bytes: blob.size, via: "web" };
  download(blob);
  return { ok: true, ms: ms(), bytes: blob.size, via: "file" };
}
