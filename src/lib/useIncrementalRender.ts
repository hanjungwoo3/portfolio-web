import { useEffect, useRef, useState } from "react";

// 긴 카드 리스트 점진 렌더 — 처음 batch 개만 그리고, 하단 sentinel 이 보이면 batch 만큼 추가.
//  한 번에 수십~수백 개를 렌더하지 않아 초기 페인트가 가벼워짐. 데이터(가격 등)는 상위에서 일괄 prefetch 하므로
//  여기선 'DOM 렌더 개수'만 제어한다. resetKey(탭/정렬 등) 가 바뀌면 처음부터 다시.
export function useIncrementalRender<T extends HTMLElement = HTMLDivElement>(
  total: number,
  batch = 20,
  resetKey?: unknown,
): { count: number; sentinelRef: React.RefObject<T | null>; hasMore: boolean } {
  const [count, setCount] = useState(batch);
  const sentinelRef = useRef<T | null>(null);

  // 탭·정렬 등 변경 → 처음부터
  useEffect(() => { setCount(batch); }, [resetKey, batch]);

  // 하단 근처(rootMargin)면 다음 배치 — count < total 일 때만 관찰
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || count >= total) return;
    const io = new IntersectionObserver(
      entries => { if (entries.some(e => e.isIntersecting)) setCount(c => Math.min(c + batch, total)); },
      { rootMargin: "800px 0px" },   // 화면 도달 전 미리 추가
    );
    io.observe(el);
    return () => io.disconnect();
  }, [count, total, batch]);

  return { count: Math.min(count, total), sentinelRef, hasMore: count < total };
}
