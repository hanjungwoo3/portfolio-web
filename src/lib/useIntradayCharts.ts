// 종목 카드 배경 '24시간' 그래프 — 토스 10분봉(종목당 1콜). PC·모바일 공용(같은 쿼리키라 캐시 공유).
//   그래프 설정이 24시간일 때만, 넘겨받은 종목만 받는다(3개월이면 호출 0).
import { useQueries } from "@tanstack/react-query";
import { fetchTossIntraday, type DaySeries } from "./api";
import { useChartRange } from "./chartRange";

const INTRADAY_MS = 5 * 60_000;   // 10분봉이라 5분이면 충분 — 프록시 호출 수 절약

export function useIntradayCharts(tickers: string[], enabled = true): Map<string, DaySeries> {
  const on = useChartRange() === "day" && enabled;
  const qs = useQueries({
    queries: tickers.map(t => ({
      queryKey: ["toss-intraday-v2", t],   // 반환이 배열 → 시계열 객체로 바뀌어 키를 올렸다
      queryFn: () => fetchTossIntraday(t),
      enabled: on,
      staleTime: INTRADAY_MS,
      refetchInterval: on ? INTRADAY_MS : (false as const),
      refetchOnWindowFocus: false,
    })),
  });
  const m = new Map<string, DaySeries>();
  qs.forEach((q, i) => { if (q.data && q.data.closes.length > 1) m.set(tickers[i], q.data); });
  return m;
}
