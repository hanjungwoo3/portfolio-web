import { useQuery } from "@tanstack/react-query";
import { fetchHlXyzPerps, fetchHlPerpCandles, fetchHlPerpSession, fetchHlPerpTwoDay } from "../lib/api";
import { useChartRange } from "../lib/chartRange";
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
  const range = useChartRange();
  const day = range === "day";
  // 세션 = 한국 장 마감(15:30) ~ 다음 평일 15:30 — 다른 선물 카드처럼 세션 그래프(사용자 2026-11-02 "48시간 말고 세션으로").
  //   카드 % 도 그 세션 기준(한국 장 마감 가격 대비)으로 맞춘다 — 그래프 기준선과 % 가 다르면 둘을 같이 못 읽는다. 3개월·1년일 때도 % 때문에 받는다.
  const { data: two } = useQuery({
    queryKey: ["hl-perp-session", coin],
    queryFn: () => fetchHlPerpSession(`xyz:${coin}`),
    refetchInterval: 60_000, staleTime: 30_000,
  });
  // 그래프 = 48시간, 가운데(50%) 세로선 = 24시간 전 — 큰 숫자(24시간 전 대비)와 같은 기준(사용자 2026-11-03).
  //   오른쪽 절반 기준선 = 24시간 전 가격, 왼쪽 = 48시간 전. 위 세션 자료는 '15:30 후 %' 한 줄에만 쓴다
  const { data: two48 } = useQuery({
    queryKey: ["hl-perp-48h", coin],
    queryFn: async () => { const d = await fetchHlPerpTwoDay(`xyz:${coin}`); return d ? { ...d, markXs: (d.markXs ?? []).filter(m => m.close || m.x === 0.5) } : d; },   // 24시간 전(점선) + 한국 정규장 종가 15:30(실선, 사용자 2026-11-03)
    enabled: day, refetchInterval: day ? 60_000 : false, staleTime: 30_000,
  });
  const { data: spark } = useQuery({
    queryKey: ["hl-perp-daily", coin, range],   // 3개월 | 1년 일봉(상장이 짧으면 있는 만큼) — 하루 몇 번이면 충분
    queryFn: () => fetchHlPerpCandles(`xyz:${coin}`, range === "year" ? 366 : 92),
    enabled: !day, refetchInterval: !day ? 30 * 60_000 : false,
    staleTime: 10 * 60_000,
  });

  const p = perps?.get(coin);
  const sBase = two?.sessionBase;
  // 큰 숫자 = 하이퍼리퀴드와 같은 24시간 전 대비(사용자 2026-11-03 2안), 설명 줄에 한국 장 마감(15:30) 뒤 움직임
  const pct = p?.changePct ?? 0;
  const sPct = p && sBase && sBase > 0 ? (p.price - sBase) / sBase * 100 : null;
  const up = pct > 0, dn = pct < 0;
  // 24시간 거래라 흐림(dim) 없음.
  // 불투명 — 반투명(/70)이면 야간 배경이 비쳐 이 카드만 칙칙했다(사용자 지적 2026-10-30, 지수 카드와 같은 색)
  const bg = up ? "bg-rose-50 border-rose-200" : dn ? "bg-blue-50 border-blue-200" : "bg-white border-gray-200";
  const sign = pctColor(pct);
  const url = `https://app.hyperliquid.xyz/trade/xyz:${coin}`;

  return (
    <div className="pg-card relative h-full">
      {/* 한국 정규장 마감(15:30) 가격·그 뒤 움직임 — 위쪽 책갈피(지수 카드의 '마감' 책갈피와 같은 모양, 사용자 2026-11-03) */}
      {sBase != null && sPct != null && (
        <div className="absolute -top-2 right-1 z-20 px-1.5 py-0 border rounded bg-yellow-50 border-yellow-400/60 text-[10px] font-medium leading-tight whitespace-nowrap"
             title={`한국 정규장 마감(15:30) 가격 $${sBase.toFixed(2)} 대비 지금 ${sPct >= 0 ? "+" : ""}${sPct.toFixed(2)}% — 장 마감 뒤 시간외 움직임`}>
          <span className="tabular-nums text-gray-700">${sBase.toFixed(2)}</span>{" "}
          <span className={`tabular-nums font-bold ${sPct > 0 ? "text-rose-600" : sPct < 0 ? "text-blue-600" : "text-gray-600"}`}>({sPct >= 0 ? "+" : ""}{sPct.toFixed(2)}%)</span>
        </div>
      )}
      <div className={`relative overflow-hidden h-full flex flex-col gap-0.5 rounded-lg border px-3 py-1.5 ${bg}`}>
        {day && two48 && two48.closes.length > 1 ? (
          <Sparkline data={two48.closes} xs={two48.xs} baseline={p?.prevDay ?? two48.base} prevBaseline={two48.prevBase} breakIndex={two48.breakIdx} markXs={two48.markXs}
                     width={400} height={80} className="absolute inset-0 w-full h-full opacity-50 pointer-events-none" />
        ) : spark && spark.length > 1 && (
          <Sparkline data={spark} width={400} height={80}
                     className="absolute inset-0 w-full h-full opacity-50 pointer-events-none" />
        )}
        <div className="relative z-10 flex items-baseline gap-1.5">
          {/* 무기한 선물 — 종목명은 지수 카드의 선물과 같은 주황 */}
          <a href={url} target="_blank" rel="noopener noreferrer"
             title="하이퍼리퀴드 무기한선물 (24시간)"
             className="text-sm font-bold text-amber-700 hover:underline min-w-0 truncate">
            {name}
          </a>
          <span className="ml-auto shrink-0 inline-flex items-center px-1 rounded text-[9px] font-bold leading-none
                           border border-violet-300 text-violet-700 bg-violet-50">
            24h
          </span>
        </div>
        <div className="relative z-10 text-[11px] text-gray-500 truncate"
             title={sBase ? `큰 숫자 = 24시간 전 대비(하이퍼리퀴드 화면과 같음). 장 마감 후 % 기준 = ${new Date(two!.sessionStart).toLocaleString("ko-KR", { month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" })} 가격 $${sBase.toFixed(2)} — 매일 15:30 경계 24시간 세션 — 15:30 뒤엔 오늘 한국 장 마감 대비(시간외 움직임), 그 전엔 어제 15:30 대비` : undefined}>
          하이퍼리퀴드 · 24시간 전 대비</div>
        <div className="relative z-10 flex items-end mt-auto">
          <span className={`flex-1 text-left tabular-nums ${sign}`}>
            <span className="text-sm">
              {p ? `$${p.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
            </span>
          </span>
          {/* 가격 폰트 — 일반 지수 카드와 맞춘다: 모바일 text-base / PC(sm↑) text-xl.
              이 카드만 PC·모바일이 **같은 컴포넌트**라 한쪽 크기를 박아 두면 모바일에서
              이 두 장(하이닉스·삼성전자 24h)만 혼자 커 보인다(실측). */}
          <span className={`flex-1 text-right text-base sm:text-xl font-bold tabular-nums ${sign}`}>
            <TickArrow value={p?.price} className="mr-1 text-sm" />
            {p && Math.abs(pct) >= 0.005 ? fmtPct(pct) : ""}
          </span>
        </div>
      </div>
    </div>
  );
}

export default HlPerpCard;
