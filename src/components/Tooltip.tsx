import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";

// 호버 툴팁 — 마우스 좌표를 따라가는 floating layer.
// position: fixed → overflow-hidden 부모와 무관, viewport 경계 자동 회피.
// 실제 렌더된 크기를 측정하여 정확히 배치 (작은 툴팁은 작게, 큰 툴팁은 크게 회피).

interface Props {
  content: ReactNode;
  children: ReactNode;
  className?: string;
}

interface Pos { x: number; y: number; }
interface Size { w: number; h: number; }

export function Tooltip({ content, children, className = "" }: Props) {
  const [pos, setPos] = useState<Pos | null>(null);
  const [size, setSize] = useState<Size | null>(null);
  const ref = useRef<HTMLSpanElement | null>(null);
  const tipRef = useRef<HTMLSpanElement | null>(null);

  // 툴팁 DOM 이 마운트되면 실제 크기 측정 (한 프레임 invisible → measure → visible)
  useLayoutEffect(() => {
    if (!pos || !tipRef.current) { setSize(null); return; }
    const r = tipRef.current.getBoundingClientRect();
    setSize({ w: r.width, h: r.height });
  }, [pos, content]);

  // viewport 경계 회피 — 마우스 위치 기준 배치. 측정된 실제 크기 사용.
  //   가로: 우측 부족하면 좌측 뒤집기.
  //   세로: 기본 마우스 아래. 아래 공간 부족하면 마우스 위로 (실제 크기만큼만).
  const adjusted = (() => {
    if (!pos) return null;
    const PAD = 12;
    // 측정 전 임시 추정 — 평균적 작은 툴팁 크기. 측정 후 한 프레임 안에 정확값으로 갱신.
    const W = size?.w ?? 240;
    const H = size?.h ?? 80;
    let x = pos.x + 14;
    let y = pos.y + 14;
    if (typeof window !== "undefined") {
      if (x + W + PAD > window.innerWidth) x = pos.x - W - 14;
      if (x < PAD) x = PAD;
      // 세로 — 아래 공간 부족 시 마우스 위로. 실측 H 기준이라 작은 툴팁은 살짝만 위로.
      if (y + H + PAD > window.innerHeight) {
        y = pos.y - H - 14;
      }
      if (y < PAD) y = PAD;
    }
    return { x, y };
  })();

  // 모바일·터치 환경 — mouseleave 가 잘 안 발생할 수 있어 수동 cleanup
  useEffect(() => {
    if (!pos) return;
    const onScroll = () => setPos(null);
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [pos]);

  return (
    <span
      ref={ref}
      onMouseEnter={e => setPos({ x: e.clientX, y: e.clientY })}
      onMouseMove={e => setPos({ x: e.clientX, y: e.clientY })}
      onMouseLeave={() => { setPos(null); setSize(null); }}
      className={`relative inline-flex ${className}`}>
      {children}
      {adjusted && content && typeof document !== "undefined" && createPortal(
        <span
          ref={tipRef}
          role="tooltip"
          style={{
            position: "fixed", left: adjusted.x, top: adjusted.y, zIndex: 1000,
            opacity: size ? 1 : 0,  // 측정 전엔 보이지 않게 (한 프레임 깜빡임 방지)
          }}
          className="px-3 py-2 rounded-md shadow-xl
                     bg-white text-gray-800 text-[11px] leading-relaxed
                     border border-gray-200
                     w-max max-w-[760px]
                     pointer-events-none whitespace-normal text-left">
          {content}
        </span>,
        document.body,
      )}
    </span>
  );
}

// 색명 강조 헬퍼 — 흰색 배경 툴팁에 가독성 좋게
const COLOR_CLASSES: Record<string, string> = {
  빨강:   "text-rose-600 font-bold",
  파랑:   "text-blue-600 font-bold",
  검정:   "text-gray-900 font-bold",
  회색:   "text-gray-500 font-bold",
  분홍:   "text-rose-400 font-bold",
  흰색:   "text-gray-700 font-bold underline decoration-dotted underline-offset-2",
};

export function ColorName({ name }: { name: string }) {
  return (
    <span className={COLOR_CLASSES[name] ?? "font-bold"}>{name}</span>
  );
}
