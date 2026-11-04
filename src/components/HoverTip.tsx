// 마우스를 올리면 뜨는 설명 레이어 — 브라우저 기본 툴팁(title)은 늦게·작게·회색으로 떠 읽기 어렵다(사용자 2026-11-04 "hover 메시지는 레이어로 다").
//   감싼 요소에 마우스를 올리면 바로 아래(화면 밖이면 위) 흰 상자. 첫 줄은 굵게, 나머지는 회색. 공시·밸류업 꼬리표와 같은 useHoverLayer.
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { useHoverLayer, layerStyle } from "../lib/useHoverLayer";

export function HoverTip({ tip, children, width = 280, className = "" }: { tip: string | null | undefined; children: ReactNode; width?: number; className?: string }) {
  const hl = useHoverLayer();
  if (!tip) return <>{children}</>;
  const [head, ...rest] = tip.split("\n");
  return (
    <>
      <span className={`inline-flex ${className}`} onMouseEnter={hl.enter} onMouseLeave={hl.leave}>{children}</span>
      {hl.pos && createPortal(
        <div className="fixed z-[1000] rounded-lg border border-gray-300 bg-white shadow-xl p-2 text-[11px] leading-snug pg-card pointer-events-none"
             style={layerStyle(hl.pos, width, 40 + rest.length * 16)}>
          <div className="font-bold text-[12px] text-gray-800">{head}</div>
          {rest.map((l, i) => <div key={i} className="text-gray-600">{l}</div>)}
        </div>, document.body)}
    </>
  );
}
