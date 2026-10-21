// 지수 카드의 한국 종목·ETF '24시간' 배경 차트 — 토스 10분봉(NXT 08:00~20:00 포함).
//   종목당 1콜이라 **화면에 보이는 카드만** 받는다(IntersectionObserver). 못 받으면 넘겨받은 3개월 차트로.
//   어제 종가 가로 점선(위 빨강·아래 파랑) + 09:00 정규장 시작 세로 점선 — 미국 카드(야후 spark)와 같은 모양.
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchKrDayCandles } from "../lib/api";
import { Sparkline } from "./Sparkline";

const kstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

export function KrDaySparkline({ code, fallback, live, width, height, color, dim, className }: {
  code: string; fallback: number[]; width: number; height: number;
  live?: number;    // 카드의 지금 가격(5초 폴링) — 오늘 차트 끝에 '지금 시각' 위치로 붙인다(분봉은 5분마다라)
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
  const day0 = data && data.closes.length > 0 ? data : null;
  // 지금 가격을 오늘 차트 끝(지금 시각 위치)에 붙인다 — 차트가 오늘 것이고 지금이 08:00~20:00 이며 마지막 봉보다 뒤일 때만
  const day = (() => {
    if (!day0 || !(live && live > 0) || !day0.xs?.length || day0.date !== kstToday()) return day0;
    const now = new Date(Date.now() + 9 * 3600_000);
    const f = (now.getUTCHours() * 60 + now.getUTCMinutes() - 8 * 60) / (12 * 60);
    const x = day0.twoDay ? 0.5 + f * 0.5 : f;   // 어제+오늘 축이면 오늘은 오른쪽 절반
    // 토스 봉 시각은 '끝나는 시각'(09:00~09:10 봉 = 09:10) — 지금이 진행 중인 봉 안이면 그 봉 바로 뒤에 붙인다
    const lastX = day0.xs[day0.xs.length - 1];
    if (x > 1 || x < lastX - (day0.twoDay ? 0.5 : 1) * 10 / (12 * 60)) return day0;
    return { ...day0, closes: [...day0.closes, live], xs: [...day0.xs, Math.max(x, lastX + 0.002)] };
  })();
  const dayOk = day && day.closes.length > 1 ? day : null;   // 봉 1개 + 끝점이 없으면(장 밖) 3개월로
  return (
    <div ref={ref} className="absolute inset-0 pointer-events-none">
      <Sparkline data={dayOk ? dayOk.closes : fallback} width={width} height={height}
                 color={dayOk && !dim ? undefined : color} baseline={dayOk?.base} markIndex={dayOk?.openIdx} xs={dayOk?.xs}
                 className={className} />
    </div>
  );
}
