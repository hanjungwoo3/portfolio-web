// 화면 일부를 그림(PNG)으로 찍어 클립보드에 — 구글 AI 에 붙여넣어(Cmd/Ctrl+V) 그래프째 묻기(사용자 2026-11-05 "이미지 전송도 될까?" → "이미지 복사 테스트부터").
//   구글 AI 는 주소(?q=)로만 질문을 받아 그림을 같이 못 보낸다 → 클립보드에 넣고 사람이 붙여넣는다.
//   ★ 클릭 직후(사용자 동작 안)에 clipboard.write 를 불러야 한다 — 그림 만드는 데 시간이 걸리므로 ClipboardItem 에 Promise 를 넘긴다(크롬·사파리 둘 다 지원).
import { toBlob } from "html-to-image";

export type CopyResult = { ok: true; ms: number; bytes: number } | { ok: false; reason: string };

export async function copyNodeImage(el: HTMLElement): Promise<CopyResult> {
  const t0 = performance.now();
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) return { ok: false, reason: "이 창은 클립보드에 그림을 넣을 수 없습니다(ClipboardItem 없음)" };
  let bytes = 0;
  const blob = toBlob(el, {
    pixelRatio: Math.min(2, window.devicePixelRatio || 1),
    backgroundColor: getComputedStyle(document.body).backgroundColor || "#ffffff",
    cacheBust: true,
    // 다른 사이트 그림(로고 등)은 막혀 실패할 수 있다 — 빼고 찍는다
    filter: n => !(n instanceof HTMLElement && n.dataset.noshot != null) && !(n instanceof HTMLImageElement && n.src && !n.src.startsWith(location.origin) && !n.src.startsWith("data:")),   // data-noshot = 찍지 않을 것(버튼 자신)
  }).then(b => { if (!b) throw new Error("그림을 만들지 못했습니다"); bytes = b.size; return b; });
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return { ok: true, ms: Math.round(performance.now() - t0), bytes };
  } catch (e) {
    return { ok: false, reason: String((e as Error)?.message ?? e) };
  }
}
