// 시세 카드 — 지수 탭 종목 카드와 같은 모양: 배경 그래프(앱 설정 3개월 | 24시간) + 이름·설명 + 현재가·등락률 + 📊종목정보·🔍AI.
//   최신공시 왼쪽 카드(2026-10-28)와 히트맵 카드 보기(사용자 2026-10-30 "동일하게 다 넣자", "버튼들도 24시간 3개월도")가 같이 쓴다.
//   두 곳이 각자 그리면 같은 종목이 다르게 보이기 시작한다 — 여기 한 벌만.
//   24시간 = KrDaySparkline(보이는 카드만 받는다, 어제 종가 점선·시가·종가 세로선), 3개월 = 종목 카드와 같은 캐시의 일봉.
import { useQuery } from "@tanstack/react-query";
import { fetchKrPriceHistory } from "../lib/api";
import { useChartRange } from "../lib/chartRange";
import { openStockInfo } from "../lib/tickPopup";
import { openGoogleAi, STOCK_ANALYSIS_PROMPT, aiNowStamp } from "../lib/googleAi";
import { KrDaySparkline } from "./KrDaySparkline";
import { Sparkline } from "./Sparkline";

export function QuoteCard({ code, name, sub, px, dim, className = "w-[132px] sm:w-[176px] h-[88px] shrink-0" }: {
  code: string; name: string;
  sub?: string;                                 // 이름 아래 한 줄(섹터 등)
  px?: { price: number; pct: number };
  dim?: boolean;                                // 오늘 체결 없음(지난 거래일 값) — 흐리게
  className?: string;                           // 크기(공시 줄 = 고정 폭, 히트맵 격자 = 칸에 맞춤)
}) {
  const range = useChartRange();
  const hist = useQuery({
    queryKey: ["kr-price-history", code, "3mo"],   // 종목 카드(App chartQs)와 같은 키 — 이미 받은 종목은 다시 안 부른다
    queryFn: () => fetchKrPriceHistory(code, "3mo"),
    staleTime: 60 * 60 * 1000, refetchOnWindowFocus: false,
    enabled: range === "all",   // 24시간이면 안 받는다(공시 줄처럼 카드가 많은 곳에서 호출을 늘리지 않게)
  });
  const closes = (hist.data ?? []).map(p => p.close);
  const pct = px?.pct;
  const tone = pct == null ? "bg-gray-50 border-gray-200" : pct > 0 ? "bg-rose-50 border-rose-200" : pct < 0 ? "bg-blue-50 border-blue-200" : "bg-gray-50 border-gray-200";
  const col = pct == null ? "text-gray-700" : pct > 0 ? "text-rose-600" : pct < 0 ? "text-blue-600" : "text-gray-600";
  return (
    <div className={`relative overflow-hidden rounded-lg border ${tone} ${className} ${dim ? "opacity-60" : ""}`}>
      {range === "day"
        ? <KrDaySparkline code={code} fallback={closes} live={px?.price} width={300} height={80} dim={dim}
                          className="absolute inset-0 w-full h-full opacity-50 pointer-events-none" />
        : closes.length > 1 && <Sparkline data={closes} width={300} height={80}
                                          className="absolute inset-0 w-full h-full opacity-50 pointer-events-none" />}
      <div className="relative h-full flex flex-col px-2 py-1">
        <button type="button" onClick={() => openStockInfo(code, name)} title="종목정보"
                className={`text-left truncate font-bold text-[13px] ${col} hover:underline`}>{name}</button>
        {sub && <div className="truncate text-[10.5px] text-gray-500 -mt-0.5">{sub}</div>}
        <div className="mt-auto flex items-baseline justify-between gap-1 tabular-nums">
          <span className={`text-[12px] ${col}`}>{px ? Math.round(px.price).toLocaleString() : "—"}</span>
          <span className={`font-bold text-[16px] sm:text-[18px] ${col}`}>{pct == null ? "" : `${pct > 0 ? "+" : ""}${pct.toFixed(2)}%`}</span>
        </div>
        <div className="flex justify-end gap-0.5 -mb-0.5">
          <button type="button" onClick={() => openStockInfo(code, name)}
                  className="px-1 rounded border border-amber-300/70 bg-amber-50 text-amber-800 text-[9.5px] font-bold leading-[15px]">📊종목정보</button>
          <button type="button" title="구글 AI에 현재상태 분석 요청"
                  onClick={() => openGoogleAi(`${STOCK_ANALYSIS_PROMPT}\n\n[기준시각] ${aiNowStamp()}\n[분석 대상] ${name}(${code})${px ? `, 현재가 ${Math.round(px.price).toLocaleString()}원 (${pct! >= 0 ? "+" : ""}${pct!.toFixed(2)}%)` : ""}`)}
                  className="px-1 rounded border border-blue-300/70 bg-blue-50 text-blue-700 text-[9.5px] font-bold leading-[15px]">🔍AI</button>
        </div>
      </div>
    </div>
  );
}
