// 데스크톱 앱 페이지 내 찾기(Ctrl+F / ⌘F) — 맥 앱 웹뷰(WKWebView)엔 브라우저 찾기 창이 없다(사용자 2026-11-02 "앱에서 ctrl+f 검색").
//   브라우저(웹)에선 브라우저 자체 찾기를 쓰므로 가로채지 않는다. window.find(웹킷·크로미엄 모두 지원)로 다음·이전 찾기, 개수는 본문 글자에서 센다.
import { useEffect, useRef, useState } from "react";
import { isDesktopApp } from "../lib/nativeProxy";

type FindFn = (s: string, caseSensitive?: boolean, backwards?: boolean, wrap?: boolean) => boolean;

function countIn(text: string, q: string): number {
  if (!q) return 0;
  const t = text.toLowerCase(), k = q.toLowerCase();
  let n = 0, i = t.indexOf(k);
  while (i >= 0 && n < 9999) { n++; i = t.indexOf(k, i + k.length); }
  return n;
}

export function FindBar() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [count, setCount] = useState(0);
  const [miss, setMiss] = useState(false);
  const inp = useRef<HTMLInputElement>(null);
  const app = isDesktopApp();

  useEffect(() => {
    if (!app) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => { inp.current?.focus(); inp.current?.select(); }, 0);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [app]);

  const find = (backwards = false) => {
    if (!q) return;
    const f = (window as unknown as { find?: FindFn }).find;
    const ok = f ? f.call(window, q, false, backwards, true) : false;
    setMiss(!ok);
    // 찾은 글자가 든 카드를 잠깐 빛낸다 — 글자 선택(파란 칠)만으론 종목 카드가 어디 있는지 한눈에 안 들어온다(사용자 "종목이 어디 있는지")
    if (ok) {
      const n = window.getSelection()?.anchorNode;
      const card = (n instanceof Element ? n : n?.parentElement)?.closest<HTMLElement>(".pg-card, tr, li") ?? null;
      if (card) {
        card.scrollIntoView({ block: "center", behavior: "smooth" });
        const prev = card.style.outline, prevOff = card.style.outlineOffset;
        card.style.outline = "3px solid #f59e0b"; card.style.outlineOffset = "2px";
        setTimeout(() => { card.style.outline = prev; card.style.outlineOffset = prevOff; }, 1600);
      }
    }
    setCount(countIn(document.body.innerText, q));
    // 찾은 곳으로 포커스가 넘어가도 계속 칠 수 있게
    setTimeout(() => inp.current?.focus(), 0);
  };
  const close = () => { setOpen(false); window.getSelection()?.removeAllRanges(); };

  if (!app || !open) return null;
  return (
    <div className="fixed top-2 right-2 z-[9999] flex items-center gap-1 rounded-lg border border-gray-300 bg-white shadow-lg px-2 py-1 text-sm pg-card">
      <input ref={inp} value={q} placeholder="페이지에서 찾기"
             onChange={e => { setQ(e.target.value); setMiss(false); setCount(0); }}
             onKeyDown={e => {
               if (e.key === "Enter") { e.preventDefault(); find(e.shiftKey); }
               else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
             }}
             className={`w-48 px-1.5 py-0.5 rounded border outline-none ${miss ? "border-rose-400 bg-rose-50" : "border-gray-300"}`} />
      <span className="text-[11px] text-gray-500 tabular-nums w-14 text-center">{q ? (miss ? "없음" : count ? `${count}개` : "") : ""}</span>
      <button onClick={() => find(true)} title="이전 (Shift+Enter)" className="px-1.5 rounded hover:bg-gray-100">▲</button>
      <button onClick={() => find(false)} title="다음 (Enter)" className="px-1.5 rounded hover:bg-gray-100">▼</button>
      <button onClick={close} title="닫기 (Esc)" className="px-1.5 rounded hover:bg-gray-100 text-gray-500">✕</button>
    </div>
  );
}
