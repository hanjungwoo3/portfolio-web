import { useEffect, useRef, useState } from "react";
import type { DashboardNavItem } from "../lib/dashboardGroups";

// label:true 면 클릭 불가 그룹 라벨(작은 글씨 + 세로 구분선), 아니면 클릭 칩
export type GroupNavItem = DashboardNavItem & { label?: boolean };

interface GroupNavBarProps {
  items: GroupNavItem[];
  idPrefix: string;          // 섹션 element id = idPrefix + item.id
  scrollMarginTop: number;   // 섹션 scroll-margin-top 과 동일값 — 스크롤 착지 위치 보정용
  stickyTop?: number;        // sticky 고정 위치(px) — 헤더·메인 탭바 아래 (sticky 시)
  sticky?: boolean;          // 기본 true. false 면 부모가 위치 제어(예: 정렬 툴바에 인라인)
  compact?: boolean;         // 모바일: 더 작은 폰트/패딩
  className?: string;        // 추가 클래스 (non-sticky 배치용)
  bleedClass?: string;       // sticky 시 가로 블리드 — 부모 padding 에 맞춤 (기본 -mx-3 px-3)
  floating?: boolean;        // 세로 스크롤 시에만 떠서 보이는 오버레이(레이아웃 공간 차지 안 함)
}

// 지수 그룹 색인 칩바 — 상단 고정. 칩 클릭 시 해당 그룹으로 부드럽게 스크롤,
//   스크롤 위치에 따라 현재 보는 그룹 칩 자동 하이라이트(scroll-spy) + 바 안에서 가운데로 이동.
export function GroupNavBar({ items, idPrefix, scrollMarginTop, stickyTop = 0, sticky = true, compact, className, bleedClass = "-mx-3 px-3", floating }: GroupNavBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const firstChip = items.find(i => !i.label)?.id ?? "";
  const [active, setActive] = useState(firstChip);
  const [shown, setShown] = useState(false);       // floating: 스크롤 중에만 표시
  const hideTimer = useRef<number | undefined>(undefined);

  // scroll-spy — sticky 바 바로 아래(probe)를 지나간 마지막 섹션을 현재 그룹으로 (라벨은 제외)
  useEffect(() => {
    const handler = () => {
      const probe = scrollMarginTop + 4;
      let cur = items.find(i => !i.label)?.id ?? "";
      for (const it of items) {
        if (it.label) continue;
        const el = document.getElementById(idPrefix + it.id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= probe) cur = it.id;
        else break;
      }
      setActive(cur);
    };
    handler();
    window.addEventListener("scroll", handler, { passive: true });
    window.addEventListener("resize", handler);
    return () => {
      window.removeEventListener("scroll", handler);
      window.removeEventListener("resize", handler);
    };
  }, [items, idPrefix, scrollMarginTop]);

  // floating — 실제 세로 스크롤에만 표시(재렌더로 깜빡이지 않게 별도 effect, deps=floating 으로 1회 구독)
  useEffect(() => {
    if (!floating) return;
    const onScroll = () => {
      setShown(true);
      window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => setShown(false), 5000);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); window.clearTimeout(hideTimer.current); };
  }, [floating]);

  // 활성 칩을 바(가로 스크롤) 안에서 보이게 — 페이지 스크롤은 건드리지 않고 바만 이동
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const el = bar.querySelector<HTMLElement>(`[data-chip="${active}"]`);
    if (!el) return;
    const left = el.offsetLeft;
    const right = left + el.offsetWidth;
    if (left < bar.scrollLeft) bar.scrollTo({ left: left - 8, behavior: "smooth" });
    else if (right > bar.scrollLeft + bar.clientWidth) {
      bar.scrollTo({ left: right - bar.clientWidth + 8, behavior: "smooth" });
    }
  }, [active]);

  const go = (id: string) => {
    const el = document.getElementById(idPrefix + id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    setActive(id);
  };

  if (items.length === 0) return null;

  return (
    <div ref={barRef} data-noswipe
         style={(floating || sticky) ? { top: stickyTop } : undefined}
         className={`flex gap-1
                     ${floating
                       ? `fixed left-0 z-30 flex-col items-start max-h-[74vh] overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden pl-0 pr-0.5 py-1
                          transition-all duration-200 ${shown ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-3 pointer-events-none"}`
                       : sticky ? `sticky z-30 ${bleedClass} py-1.5 items-center overflow-x-auto whitespace-nowrap bg-white/95 backdrop-blur border-b border-gray-200`
                                : "items-center overflow-x-auto whitespace-nowrap"}
                     ${className ?? ""}`}>
      {items.map(it => {
        // 그룹 라벨 — 클릭 불가, 작은 회색 글씨 + 왼쪽 세로 구분선(│)
        if (it.label) {
          return (
            <span key={it.id}
                  className={`shrink-0 inline-flex items-center font-bold text-gray-400
                              ${compact ? "text-[10px]" : "text-[11px]"}
                              ${floating ? "[writing-mode:vertical-rl] [text-orientation:upright] tracking-tight pt-1.5 mt-1 border-t border-gray-300"
                                         : "pl-2 ml-1 border-l border-gray-300"}`}>
              {it.short}
            </span>
          );
        }
        const on = it.id === active;
        return (
          <button key={it.id} data-chip={it.id} onClick={() => go(it.id)}
                  title={`${it.short}${it.emoji ? ` ${it.emoji}` : ""} 로 이동`}
                  className={`shrink-0 rounded-full transition inline-flex items-center gap-1
                              ${floating ? `backdrop-blur-sm [writing-mode:vertical-rl] [text-orientation:upright] tracking-tight px-0.5 py-1.5 ${compact ? "text-[11px]" : "text-xs"}`
                                         : `${compact ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs"}`}
                              ${on ? (floating ? "bg-blue-600/45 text-white font-bold"
                                               : "bg-blue-600 text-white font-bold")
                                   : (floating ? "bg-gray-100/20 text-gray-500/90 hover:bg-gray-100/50"
                                               : "bg-gray-100 text-gray-600 hover:bg-gray-200")}`}>
            {it.emoji && <span>{it.emoji}</span>}
            <span>{it.short}</span>
          </button>
        );
      })}
    </div>
  );
}
