// 마우스를 올리면 뜨는 레이어 — 꼬리표에서 벗어나도 잠깐(250ms) 기다려, 레이어로 마우스를 옮기면 열린 채로 둔다.
//   공시 종류·밸류업 꼬리표가 같이 쓴다(사용자 2026-11-03 "hover 로"). 위치는 꼬리표 바로 아래(화면 밖이면 위로).
import { useEffect, useRef, useState } from "react";

export interface HoverPos { x: number; y: number; top: number }
export function useHoverLayer() {
  const [pos, setPos] = useState<HoverPos | null>(null);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keep = () => { if (t.current) { clearTimeout(t.current); t.current = null; } };
  const close = () => { keep(); setPos(null); };
  const leave = () => { keep(); t.current = setTimeout(() => setPos(null), 250); };
  const enter = (e: { currentTarget: EventTarget }) => {
    keep();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPos({ x: r.left, y: r.bottom + 4, top: r.top });
  };
  useEffect(() => {
    if (!pos) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    const onScroll = (e: Event) => { if (e.target === document || e.target === document.documentElement) close(); };
    window.addEventListener("keydown", onKey); window.addEventListener("scroll", onScroll, true);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("scroll", onScroll, true); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos]);
  useEffect(() => keep, []);
  return { pos, enter, leave, keep, close };
}
/** 레이어 위치 — 폭 w, 높이 h 를 화면 안에 */
export function layerStyle(p: HoverPos, w: number, h: number): { left: number; top: number; width: number } {
  const left = Math.max(8, Math.min(p.x, window.innerWidth - w - 8));
  const top = p.y + h > window.innerHeight ? Math.max(8, p.top - h - 4) : p.y;
  return { left, top, width: w };
}
