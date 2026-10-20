// 지수 카드의 한국 종목·ETF '24시간' 배경 차트 — 토스 10분봉(NXT 08:00~20:00 포함).
//   종목당 1콜이라 **화면에 보이는 카드만** 받는다(IntersectionObserver). 못 받으면 넘겨받은 3개월 차트로.
//   어제 종가 가로 점선(위 빨강·아래 파랑) + 09:00 정규장 시작 세로 점선 — 미국 카드(야후 spark)와 같은 모양.
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchKrDayCandles } from "../lib/api";
import { Sparkline } from "./Sparkline";

export function KrDaySparkline({ code, fallback, width, height, color, dim, className }: {
  code: string; fallback: number[]; width: number; height: number;
  color?: string;   // 3개월 폴백·흐린 카드용 강제 색
  dim?: boolean;    // 흐린 카드 — 당일 차트도 회색 한 색(분할 색칠 안 함)
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const { data } = useQuery({
    queryKey: ["kr-day-candles", code],
    queryFn: () => fetchKrDayCandles(code),
    enabled: seen,
    staleTime: 4 * 60_000, refetchInterval: seen ? 5 * 60_000 : false, refetchOnWindowFocus: false,
  });
  const day = data && data.closes.length > 1 ? data : null;
  return (
    <div ref={ref} className="absolute inset-0 pointer-events-none">
      <Sparkline data={day ? day.closes : fallback} width={width} height={height}
                 color={day && !dim ? undefined : color} baseline={day?.base} markIndex={day?.openIdx} xs={day?.xs}
                 className={className} />
    </div>
  );
}
