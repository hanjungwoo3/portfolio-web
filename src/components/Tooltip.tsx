import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

// 호버 툴팁 — 마우스 좌표를 따라가는 floating layer.
// position: fixed → overflow-hidden 부모와 무관, viewport 경계 자동 회피.

interface Props {
  content: ReactNode;
  children: ReactNode;
  className?: string;
}

interface Pos { x: number; y: number; }

export function Tooltip({ content, children, className = "" }: Props) {
  const [pos, setPos] = useState<Pos | null>(null);
  const ref = useRef<HTMLSpanElement | null>(null);

  // viewport 경계 회피 — 우측/하단 너무 가까우면 좌/상으로 뒤집기
  const adjusted = (() => {
    if (!pos) return null;
    const PAD = 12;
    const W = 320;  // tooltip 최대 폭 추정 (max-w-[300px] + padding)
    const H = 200;  // 높이 여유
    let x = pos.x + 14;  // 마우스 우측
    let y = pos.y + 14;  // 마우스 아래
    if (typeof window !== "undefined") {
      if (x + W + PAD > window.innerWidth) x = pos.x - W - 14;
      if (y + H + PAD > window.innerHeight) y = pos.y - H - 14;
      if (x < PAD) x = PAD;
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
      onMouseLeave={() => setPos(null)}
      className={`relative ${className}`}>
      {children}
      {adjusted && content && (
        <span
          role="tooltip"
          style={{ position: "fixed", left: adjusted.x, top: adjusted.y, zIndex: 1000 }}
          className="px-3 py-2 rounded-md shadow-xl
                     bg-white text-gray-800 text-[11px] leading-relaxed
                     border border-gray-200
                     w-max max-w-[300px]
                     pointer-events-none whitespace-normal text-left">
          {content}
        </span>
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
