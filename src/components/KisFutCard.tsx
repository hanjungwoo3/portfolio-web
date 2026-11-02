// 국내 주식선물 카드(삼성전자·SK하이닉스 근월물) — 한국투자 Open API(lib/kisFutures). 앱에서 한투 연동이 켜졌을 때만 보인다.
//   모양은 하이퍼리퀴드 24h 카드(HlPerpCard)와 같게. % = 전일 종가 대비(한투 futs_prdy_ctrt).
import { useQuery } from "@tanstack/react-query";
import { fetchKisFutQuote, fetchKisFutDay, kisFutAvailable, KIS_STOCK_FUT } from "../lib/kisFutures";
import { useChartRange } from "../lib/chartRange";
import { Sparkline } from "./Sparkline";
import { TickArrow } from "./TickArrow";

export function KisFutCard({ symbol }: { symbol: string }) {
  const on = kisFutAvailable();
  const def = KIS_STOCK_FUT[symbol];
  const q = useQuery({
    queryKey: ["kis-fut-quote", symbol], queryFn: () => fetchKisFutQuote(symbol),
    enabled: on, refetchInterval: 10_000, staleTime: 5_000, retry: 1,
  });
  const day = useChartRange() === "day";
  const d = useQuery({
    queryKey: ["kis-fut-day", symbol], queryFn: () => fetchKisFutDay(symbol),
    enabled: on && day, refetchInterval: 60_000, staleTime: 30_000, retry: 1,
  });
  if (!on || !def) return null;
  const p = q.data;
  const pct = p?.pct ?? 0;
  const bg = pct > 0 ? "bg-rose-50 border-rose-200" : pct < 0 ? "bg-blue-50 border-blue-200" : "bg-white border-gray-200";
  const sign = pct > 0 ? "text-rose-600" : pct < 0 ? "text-blue-600" : "text-gray-900";
  const s = d.data;
  return (
    <div className="pg-card relative h-full">
      <div className={`relative overflow-hidden h-full flex flex-col gap-0.5 rounded-lg border px-3 py-1.5 ${bg}`}>
        {day && s && s.closes.length > 1 && (
          <Sparkline data={s.closes} xs={s.xs} baseline={s.base ?? p?.base} markXs={s.markXs}
                     width={400} height={80} className="absolute inset-0 w-full h-full opacity-50 pointer-events-none" />
        )}
        <div className="relative z-10 flex items-baseline gap-1.5">
          <span className="text-sm font-bold text-amber-700 min-w-0 truncate" title={p ? `근월물 ${p.code}` : undefined}>{def.name}</span>
          <span className="ml-auto shrink-0 inline-flex items-center px-1 rounded text-[9px] font-bold leading-none
                           border border-emerald-300 text-emerald-700 bg-emerald-50" title="한국투자 Open API(앱·본인 키)">한투</span>
        </div>
        <div className="relative z-10 text-[11px] text-gray-500 truncate">
          {q.error ? `⚠️ ${(q.error as Error).message}` : `주식선물 근월물${p ? ` ${p.code}` : ""} · 전일 종가 대비`}
        </div>
        <div className="relative z-10 flex items-end mt-auto">
          <span className={`flex-1 text-left tabular-nums ${sign}`}>
            <span className="text-sm">{p ? Math.round(p.price).toLocaleString() : "—"}</span>
          </span>
          <span className={`flex-1 text-right text-base sm:text-xl font-bold tabular-nums ${sign}`}>
            <TickArrow value={p?.price} className="mr-1 text-sm" />
            {p && Math.abs(pct) >= 0.005 ? `${pct > 0 ? "+" : ""}${pct.toFixed(2)}%` : ""}
          </span>
        </div>
      </div>
    </div>
  );
}
