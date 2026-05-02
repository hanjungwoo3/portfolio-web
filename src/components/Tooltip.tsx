import type { ReactNode } from "react";

// 호버 툴팁 — 줄바꿈·색상·rich content 지원.
// CSS group-hover 기반 (외부 라이브러리 없음).
//
// 주의: 부모에 overflow-hidden 이 있으면 툴팁이 잘릴 수 있음.
// 이 경우 부모를 overflow-visible 로 두거나 툴팁을 외곽 컨테이너에 배치.

interface Props {
  content: ReactNode;
  children: ReactNode;
  // top (children 위에) / bottom (children 아래에)
  position?: "top" | "bottom";
  className?: string;
}

export function Tooltip({ content, children, position = "top", className = "" }: Props) {
  const posCls = position === "top"
    ? "bottom-full mb-1.5"
    : "top-full mt-1.5";
  return (
    <span className={`relative inline-block group/tt ${className}`}>
      {children}
      {content && (
        <span
          role="tooltip"
          className={`hidden group-hover/tt:block absolute z-50
                      left-1/2 -translate-x-1/2 ${posCls}
                      px-3 py-2 rounded-md shadow-xl
                      bg-gray-900 text-white text-[11px] leading-relaxed
                      w-max max-w-[280px]
                      pointer-events-none whitespace-normal text-left`}>
          {content}
        </span>
      )}
    </span>
  );
}

// 색명 강조 헬퍼 — 툴팁 본문에 사용
const COLOR_CLASSES: Record<string, string> = {
  빨강:   "text-rose-400 font-bold",
  파랑:   "text-blue-400 font-bold",
  검정:   "text-gray-200 font-bold",
  회색:   "text-gray-300 font-bold",
  분홍:   "text-rose-300 font-bold",
  흰색:   "text-gray-100 font-bold",
};

export function ColorName({ name }: { name: string }) {
  return (
    <span className={COLOR_CLASSES[name] ?? "font-bold"}>{name}</span>
  );
}
