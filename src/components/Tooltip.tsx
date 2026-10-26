import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import type React from "react";

// 호버 툴팁 — 마우스 좌표를 따라가는 floating layer.
// position: fixed → overflow-hidden 부모와 무관, viewport 경계 자동 회피.
// 실제 렌더된 크기를 측정하여 정확히 배치 (작은 툴팁은 작게, 큰 툴팁은 크게 회피).

interface Props {
  content: ReactNode;
  children: ReactNode;
  className?: string;
  /** 클릭 방식 — 마우스를 올려도 안 뜨고, 오른쪽 아래 작은 "상세보기" 버튼을 누르면 뜬다(사용자 요청 2026-10-26).
   *  큰 표(수급 상세·60일 캔들)는 마우스를 따라다니면 읽기 어려웠다. 바깥 클릭·Esc·✕ 로 닫는다. */
  click?: boolean;
  detailLabel?: string;      // 버튼 글자 — 안 주면 테두리 없는 ▲ 하나(사용자 요청 2026-10-26)
  onOpen?: () => void;       // 열 때 — 긴 수급 이력처럼 열 때만 받는 자료를 요청하는 데 쓴다
}

interface Pos { x: number; y: number; }
interface Size { w: number; h: number; }

export function Tooltip({ content, children, className = "", click, detailLabel, onOpen }: Props) {
  if (click) return <ClickLayer content={content} className={className} label={detailLabel} onOpen={onOpen}>{children}</ClickLayer>;
  return <HoverTip content={content} className={className}>{children}</HoverTip>;
}

// 클릭 레이어 — 버튼 아래(오른쪽 맞춤)에 고정 위치로. 화면보다 크면 안에서 스크롤(툴팁처럼 줄이지 않는다 — 눌러서 보는 표는 읽어야 한다)
function ClickLayer({ content, children, className, label, onOpen }: { content: ReactNode; children: ReactNode; className: string; label?: string; onOpen?: () => void }) {
  const [anchor, setAnchor] = useState<{ right: number; top: number; bottom: number } | null>(null);
  const [size, setSize] = useState<Size | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const open = !!anchor;
  const close = () => { setAnchor(null); setSize(null); };
  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation(); e.preventDefault();
    if (open) { close(); return; }
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    onOpen?.();
    setAnchor({ right: r.right, top: r.top, bottom: r.bottom });
  };
  useLayoutEffect(() => {
    const el = layerRef.current;
    if (!open || !el) return;
    setSize({ w: el.offsetWidth, h: el.offsetHeight });
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setSize({ w: el.offsetWidth, h: el.offsetHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, content]);
  // 바깥 클릭·Esc 로 닫기
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (layerRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const PAD = 12;
  const placed = (() => {
    if (!anchor || typeof window === "undefined") return null;
    const maxW = window.innerWidth - PAD * 2, maxH = window.innerHeight - PAD * 2;
    const W = Math.min(size?.w ?? 320, maxW), H = Math.min(size?.h ?? 200, maxH);
    let x = anchor.right - W;                      // 버튼 오른쪽 끝에 맞춤
    if (x < PAD) x = PAD;
    if (x + W + PAD > window.innerWidth) x = window.innerWidth - W - PAD;
    let y = anchor.bottom + 6;                     // 버튼 아래
    if (y + H + PAD > window.innerHeight) y = Math.max(PAD, anchor.top - H - 6);   // 아래 모자라면 위로
    return { x, y, maxW, maxH };
  })();
  return (
    <span className={`relative inline-flex ${className}`}>
      {children}
      {/* 테두리 없는 ▲ 하나만(사용자 요청 2026-10-26) — 열려 있으면 진하게 */}
      <button ref={btnRef} type="button" onClick={toggle} title={label ?? (open ? "상세 닫기" : "상세 보기")}
              className={`absolute bottom-0.5 right-1 z-20 px-1 py-0.5 text-[11px] leading-none
                          ${open ? "text-gray-800" : "text-gray-400 hover:text-gray-700"}`}>
        {label ?? "▲"}
      </button>
      {placed && typeof document !== "undefined" && createPortal(
        <div ref={layerRef} role="dialog"
             style={{ position: "fixed", left: placed.x, top: placed.y, zIndex: 1000, maxWidth: placed.maxW, maxHeight: placed.maxH, opacity: size ? 1 : 0 }}
             className="pl-3 pr-7 py-2 rounded-md shadow-xl bg-white text-gray-800 text-[11px] leading-relaxed
                        border border-gray-200 w-max overflow-auto whitespace-normal text-left">
          <button type="button" onClick={close} aria-label="닫기"
                  className="absolute top-1 right-1 w-5 h-5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 leading-none">✕</button>
          {content ?? <div className="text-gray-400">불러오는 중…</div>}
        </div>,
        document.body,
      )}
    </span>
  );
}

function HoverTip({ content, children, className = "" }: { content: ReactNode; children: ReactNode; className?: string }) {
  const [pos, setPos] = useState<Pos | null>(null);
  const [size, setSize] = useState<Size | null>(null);
  const ref = useRef<HTMLSpanElement | null>(null);
  const tipRef = useRef<HTMLSpanElement | null>(null);

  // 툴팁 DOM 이 마운트되면 실제 크기 측정 (한 프레임 invisible → measure → visible)
  useLayoutEffect(() => {
    if (!pos || !tipRef.current) { setSize(null); return; }
    // scroll* = transform(scale) 전 크기 + 넘친 내용까지 — getBoundingClientRect 는 줄인 뒤 크기라 줄이기↔되돌리기를 오간다
    setSize({ w: tipRef.current.scrollWidth, h: tipRef.current.scrollHeight });
  }, [pos, content]);
  // 안쪽이 나중에 커지는 툴팁(수급 표가 데이터를 받아 채워짐)도 다시 잰다 — content 가 같은 객체라 위 effect 만으론 못 잡는다
  const open = !!pos;
  useEffect(() => {
    const el = tipRef.current;
    if (!open || !el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setSize({ w: el.scrollWidth, h: el.scrollHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);

  // viewport 경계 회피 — 마우스 위치 기준 배치. 측정된 실제 크기 사용.
  //   가로: 우측 부족하면 좌측 뒤집기.
  //   세로: 기본 마우스 아래. 아래 공간 부족하면 마우스 위로 (실제 크기만큼만).
  const adjusted = (() => {
    if (!pos) return null;
    const PAD = 12;
    // 측정 전 임시 추정 — 평균적 작은 툴팁 크기. 측정 후 한 프레임 안에 정확값으로 갱신.
    // 화면보다 키 큰 툴팁은 줄여서(scale) 통째로 보이게 — 종목 수급 표에 매수·매도 줄을 넣자 위아래가 화면 밖으로 잘렸다(2026-10-22)
    //   가로도 — 줄바꿈 안 되는 넓은 표(매수·매도 줄)가 max-w 를 넘으면 상자 밖으로 삐져나왔다 → 상자를 내용만큼 넓히고 화면 폭에 맞춰 줄인다
    const fit = size && typeof window !== "undefined"
      ? Math.min(1, (window.innerHeight - PAD * 2) / size.h, (window.innerWidth - PAD * 2) / size.w) : 1;
    const W = (size?.w ?? 240) * fit;
    const H = (size?.h ?? 80) * fit;
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
    return { x, y, fit };
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
            transform: adjusted.fit < 1 ? `scale(${adjusted.fit})` : undefined, transformOrigin: "top left",
            maxWidth: size && size.w > 760 ? "none" : undefined,   // 넓은 표는 max-w-[760px] 를 풀어 상자가 감싸게
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
