import { useQuery } from "@tanstack/react-query";
import { fetchValueupIndex } from "../lib/api";
import { requestHeatmap } from "../lib/heatmapNav";
import { useAdaptiveRefreshMs } from "../lib/proxyStatus";
import { getDimSleepingEnabled } from "../lib/proxyConfig";
import { isMarketOpen } from "../lib/format";
import { Sparkline } from "./Sparkline";

// 코리아 밸류업 지수 (네이버 KVALUE) — 지수탭 한국 시장 행에 다른 지수와 같은 크기의 카드로 렌더.
//   Yahoo 미제공·TradingView symbolset 미지원이라 지수 시세는 네이버 m.stock 별도 사용.
//   구성종목 100은 '히트맵' 버튼 → 히트맵 탭(kr_valueup 소스, 편입종목 100 tickers)으로 이동.
const BASE_REFRESH_MS = 15_000;
const INDEX_URL = "https://m.stock.naver.com/domestic/index/KVALUE";

// 한국식 색: 상승 빨강 / 하락 파랑 / 보합 회색.
function pctColor(pct: number): string {
  return pct > 0 ? "text-rose-600" : pct < 0 ? "text-blue-600" : "text-gray-900";
}
function fmtPct(pct: number): string {
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

// 지수 카드 셀 — UsMarketTab/MobileSimpleView 의 지수 카드와 동일 크기·마크업.
export function ValueupMiniCard() {
  const refreshMs = useAdaptiveRefreshMs(BASE_REFRESH_MS);
  const { data: idx } = useQuery({
    queryKey: ["valueup-index"],
    queryFn: fetchValueupIndex,
    refetchInterval: refreshMs,
    staleTime: 5_000,
  });

  const pct = idx?.changePct ?? 0;
  const up = pct > 0, dn = pct < 0;
  // 코리아 밸류업(KRX)은 한국 정규장에서만 산출 → 한국장 마감이면 다른 지수 카드와 동일하게 흐림(dim).
  const dimNow = getDimSleepingEnabled() && !isMarketOpen("KR");
  const dimCls = dimNow ? "opacity-60" : "";
  const bg = dimNow ? "bg-gray-100 border-transparent"
    : up ? "bg-rose-50 border-rose-200" : dn ? "bg-blue-50/70 border-blue-200" : "bg-white border-gray-200";
  const sign = dimNow ? "text-gray-500" : pctColor(pct);

  return (
    <div className="relative h-full">
      <div className={`relative overflow-hidden h-full flex flex-col gap-0.5 rounded-lg border px-3 py-1.5 ${bg}`}>
        {idx && idx.sparkline.length > 1 && (
          <Sparkline data={idx.sparkline} width={400} height={80}
                     color={dimNow ? "#94a3b8" : undefined}
                     className={`absolute inset-0 w-full h-full opacity-50 pointer-events-none ${dimCls}`} />
        )}
        <div className={`relative z-10 flex items-baseline gap-1.5 ${dimCls}`}>
          <a href={INDEX_URL} target="_blank" rel="noopener noreferrer"
             title="코리아 밸류업 지수 자세히 보기"
             className="text-base font-bold text-gray-900 hover:underline min-w-0 truncate">
            코리아 밸류업
          </a>
          <button onClick={() => requestHeatmap("kr_valueup", { sizeMode: "volume" })} title="구성종목 100 히트맵(거래량) 보기"
                  className="ml-auto shrink-0 inline-flex items-center px-1 rounded text-[9px] font-bold leading-none
                             border border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition">
            🗺️히트맵
          </button>
        </div>
        <div className={`relative z-10 text-[11px] text-gray-500 truncate ${dimCls}`}>KRX 코리아 밸류업 지수</div>
        <div className={`relative z-10 flex items-end mt-auto ${dimCls}`}>
          <span className={`flex-1 text-left tabular-nums ${sign}`}>
            <span className="text-sm">
              {idx ? idx.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
            </span>
          </span>
          <span className={`flex-1 text-right text-xl font-bold tabular-nums ${sign}`}>
            {idx && Math.abs(pct) >= 0.005 ? fmtPct(pct) : ""}
          </span>
        </div>
      </div>
    </div>
  );
}
