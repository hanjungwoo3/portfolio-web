import { useQuery } from "@tanstack/react-query";
import { fetchHlXyzPerps, fetchHlPerpCandles } from "../lib/api";
import { useAdaptiveRefreshMs } from "../lib/proxyStatus";
import { Sparkline } from "./Sparkline";
import { TickArrow } from "./TickArrow";

// 하이퍼리퀴드 주식 무기한선물 카드 — 지수탭 반도체 섹션에 다른 지수 카드와 동일 크기로 렌더.
//   24시간 거래(한국·미국 장마감 시간외도 실시간) → 시간외 가늠자. 데이터는 하이퍼리퀴드 직접 호출.
const BASE_REFRESH_MS = 15_000;

// 한국식 색: 상승 빨강 / 하락 파랑 / 보합 회색.
function pctColor(pct: number): string {
  return pct > 0 ? "text-rose-600" : pct < 0 ? "text-blue-600" : "text-gray-900";
}
function fmtPct(pct: number): string {
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

interface Props {
  coin: string;   // 짧은 이름 (예: "SKHY", "SMSN")
  name: string;   // 표시명 (예: "SK하이닉스 24h")
}
export function HlPerpCard({ coin, name }: Props) {
  const refreshMs = useAdaptiveRefreshMs(BASE_REFRESH_MS);
  const { data: perps } = useQuery({
    queryKey: ["hl-xyz-perps"],           // coin 무관 공유 — 한 번 fetch 로 여러 카드 커버
    queryFn: fetchHlXyzPerps,
    refetchInterval: refreshMs,
    staleTime: 5_000,
  });
  const { data: spark } = useQuery({
    queryKey: ["hl-perp-candles", coin],
    queryFn: () => fetchHlPerpCandles(`xyz:${coin}`),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const p = perps?.get(coin);
  const pct = p?.changePct ?? 0;
  const up = pct > 0, dn = pct < 0;
  // 24시간 거래라 흐림(dim) 없음.
  const bg = up ? "bg-rose-50 border-rose-200" : dn ? "bg-blue-50/70 border-blue-200" : "bg-white border-gray-200";
  const sign = pctColor(pct);
  const url = `https://app.hyperliquid.xyz/trade/xyz:${coin}`;

  return (
    <div className="relative h-full">
      <div className={`relative overflow-hidden h-full flex flex-col gap-0.5 rounded-lg border px-3 py-1.5 ${bg}`}>
        {spark && spark.length > 1 && (
          <Sparkline data={spark} width={400} height={80}
                     className="absolute inset-0 w-full h-full opacity-50 pointer-events-none" />
        )}
        <div className="relative z-10 flex items-baseline gap-1.5">
          <a href={url} target="_blank" rel="noopener noreferrer"
             title="하이퍼리퀴드 무기한선물 (24시간)"
             className="text-base font-bold text-gray-900 hover:underline min-w-0 truncate">
            {name}
          </a>
          <span className="ml-auto shrink-0 inline-flex items-center px-1 rounded text-[9px] font-bold leading-none
                           border border-violet-300 text-violet-700 bg-violet-50">
            24h
          </span>
        </div>
        <div className="relative z-10 text-[11px] text-gray-500 truncate">하이퍼리퀴드 무기한선물 · 24시간</div>
        <div className="relative z-10 flex items-end mt-auto">
          <span className={`flex-1 text-left tabular-nums ${sign}`}>
            <span className="text-sm">
              {p ? `$${p.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
            </span>
          </span>
          <span className={`flex-1 text-right text-xl font-bold tabular-nums ${sign}`}>
            <TickArrow value={p?.price} className="mr-1 text-sm" />
            {p && Math.abs(pct) >= 0.005 ? fmtPct(pct) : ""}
          </span>
        </div>
      </div>
    </div>
  );
}

export default HlPerpCard;
