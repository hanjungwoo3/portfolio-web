// 🔔 지금 시끄러운 종목 — 최근 5분 사이 평소보다 돈이 확 몰린 종목(lib/hotNow). PC·모바일 같은 화면
import { useMemo } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { fetchHotNow, type HotRow } from "../lib/hotNow";
import { openTickPopup } from "../lib/tickPopup";
import { fetchTossPrices, fetchKrPriceHistory } from "../lib/api";
import { useChartRange, historyRange, trimByRange } from "../lib/chartRange";
import { ChartRangeToggle } from "./ChartRangeToggle";
import type { Price } from "../types";
import { fmtServerStamp } from "../lib/liveServer";
import { StockCard } from "./EtfCompositionDialog";

const eok = (won: number) => (won >= 1e12 ? `${(won / 1e12).toFixed(1)}조` : won >= 1e8 ? `${Math.round(won / 1e8).toLocaleString()}억` : `${Math.round(won / 1e4).toLocaleString()}만`);
const sign = (n: number, d = 2) => `${n > 0 ? "+" : ""}${n.toFixed(d)}%`;
const tone = (n: number) => (n > 0 ? "text-rose-600" : n < 0 ? "text-blue-600" : "text-gray-500");

export function HotNowTab({ compact = false }: { compact?: boolean }) {
  const q = useQuery({
    queryKey: ["hot-now"],
    queryFn: () => fetchHotNow(5),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    staleTime: 50_000,
    retry: 1,
  });
  const d = q.data;
  // 오른쪽 종목카드 시세 — 다른 카드와 같은 토스 시세(한 번에 최대 40종)(사용자 2026-11-09 "종목카드로 표시하는 게 더 좋을 것 같아")
  const codes = useMemo(() => (d?.rows ?? []).map(r => r.code), [d]);
  const { data: priceList } = useQuery({
    queryKey: ["hot-now-prices", codes],
    queryFn: () => fetchTossPrices(codes),
    enabled: codes.length > 0,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const priceMap = useMemo(() => new Map((priceList ?? []).map(p => [p.ticker, p])), [priceList]);
  // 카드 배경 차트 — 24시간 | 3개월 | 1년(앱 전체 설정, 사용자 2026-11-10 "여긴 그래프 기간 변경이 없어"). 24시간은 카드가 스스로 그린다
  const chartRange = useChartRange();
  const hist = historyRange(chartRange);
  const histQs = useQueries({
    queries: codes.map(code => ({
      queryKey: ["price-history", code, hist],
      queryFn: () => fetchKrPriceHistory(code, hist),
      enabled: chartRange !== "day",
      staleTime: 60 * 60_000,
    })),
  });
  const chartOf = (code: string) => { const i = codes.indexOf(code); return (histQs[i]?.data ?? []).map(p => p.close); };
  return (
    <div className={compact ? "space-y-2" : "max-w-[1680px] mx-auto p-3 space-y-3"}>
      <div className="pg-card rounded-lg border border-gray-200 bg-white p-3">
        <div className="flex items-baseline gap-2 flex-wrap">
          <b className="text-gray-800 text-[15px]">🔔 지금 시끄러운 종목</b>
          <span className="text-[12px] text-gray-500">
            최근 {d?.windowMin || 5}분 동안 <b>평소보다 돈이 확 몰린</b> 종목 · {d?.server ? "2분" : "1분"}마다 새로
          </span>
          {compact && <span className="ml-auto"><ChartRangeToggle /></span>}   {/* PC 는 헤더 오른쪽 끝(사용자 2026-11-13) */}
          {d && <span className="text-[11px] text-gray-400">{d.server ? "서버 수집 " : ""}{fmtServerStamp(d.at)} 기준</span>}
        </div>
        <div className="mt-1.5 text-[11.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 leading-relaxed">
          ⚠️ <b>사라는 신호가 아니에요.</b> 우리가 실제로 재 보니 이렇게 갑자기 몰린 종목을 따라 사면, 수수료·세금까지 치면 평균적으로 조금씩 손해였어요.
          "지금 어디로 돈이 몰리나"를 빨리 보는 용도로 쓰세요. 종목을 누르면 종목정보 창(실시간 체결·호가·단타 신호 성적)이 열려요.
        </div>
      </div>

      {q.isLoading ? <div className="text-gray-400 text-sm p-4">불러오는 중…</div>
        : q.isError && !d ? <div className="text-rose-600 text-sm p-4">순위를 못 받았어요 — 잠시 뒤 다시 시도합니다.</div>
        : !d || d.windowMin === 0 ? (
          <div className="pg-card rounded-lg border border-gray-200 bg-white p-4 text-[13px] text-gray-600 leading-relaxed">
            ⏳ 기록을 모으는 중이에요. 거래 순위를 1~2분마다 찍어 두고 <b>방금 전과 비교</b>해서 계산해요.
            <br />{d?.server ? "서버가 장 시간(08:00~20:20)에 모아요 — 장이 열리고 몇 분 뒤부터 보여요." : <>1분 뒤부터 보이고, <b>5분쯤 열어 두면</b> 더 정확해져요.</>}
          </div>
        ) : d.quiet ? (
          <div className="pg-card rounded-lg border border-gray-200 bg-white p-4 text-[13px] text-gray-600">
            😴 지금은 거래가 거의 없어요 — 장이 끝났거나 쉬는 시간이에요. 장 중(08:00~20:00, 정규장 09:00~15:30)에 열어 두면 보여요.
          </div>
        ) : !d.rows.length ? (
          <div className="pg-card rounded-lg border border-gray-200 bg-white p-4 text-[13px] text-gray-600">조용해요 — 최근 {d.windowMin}분 동안 평소보다 1.5배 넘게 몰린 종목이 없어요.</div>
        ) : (
          <div className="pg-card rounded-lg border border-gray-200 bg-white overflow-hidden">
            {d.windowMin < 4 && <div className="px-3 py-1 text-[11px] text-gray-500 bg-gray-50 border-b border-gray-100">아직 {d.windowMin}분 기록으로 계산했어요 — 5분쯤 지나면 더 정확해져요.</div>}
            <div className={compact ? "" : "grid lg:grid-cols-2 min-[1400px]:grid-cols-3"   /* 넓은 화면은 한 줄에 셋(사용자 2026-11-10) */}>
            {d.rows.map((r, i) => <Row key={r.code} r={r} i={i} win={d.windowMin} compact={compact} price={priceMap.get(r.code)} chart={chartRange === "day" ? [] : trimByRange(chartOf(r.code), chartRange)} />)}
            </div>
          </div>
        )}
    </div>
  );
}

function Row({ r, i, win, compact, price, chart }: { r: HotRow; i: number; win: number; compact: boolean; price?: Price; chart: number[] }) {
  const hot = r.times >= 5 ? "bg-rose-500 text-white" : r.times >= 3 ? "bg-orange-400 text-white" : "bg-amber-100 text-amber-800";
  return (
    <div className={`flex ${compact ? "flex-col" : "items-center"} gap-2 px-3 py-2 border-b border-gray-100 ${compact ? "" : "lg:max-[1399px]:odd:border-r min-[1400px]:[&:not(:nth-child(3n))]:border-r"}`}>
      {/* 왼쪽 = 왜 시끄러운가(몇 배·최근 거래대금·그 사이 변화·오늘 거래대금). 누르면 종목정보 */}
      <button type="button" onClick={() => openTickPopup(r.code, r.name)}
              className="min-w-0 flex-1 text-left flex items-center gap-2 rounded hover:bg-gray-50 p-1"
              title={`${r.name} — 최근 ${win}분 거래대금 ${eok(r.recentValue)}원 (오늘 1분 평균의 ${r.times.toFixed(1)}배), 그동안 값 ${sign(r.recentPct)}. 누르면 종목정보`}>
        <span className="w-5 shrink-0 text-[11px] text-gray-400 tabular-nums text-right">{i + 1}</span>
        <span className={`shrink-0 w-[64px] text-center rounded px-1 py-0.5 text-[12px] font-bold tabular-nums ${hot}`}>{r.times.toFixed(1)}배</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-1.5 min-w-0">
            <b className="truncate text-gray-900 text-[14px]">{r.name}</b>
            <span className="shrink-0 text-[10px] text-gray-400">{r.market}</span>
            {r.upper && <span className="shrink-0 px-1 rounded bg-rose-600 text-white text-[10px] font-bold">상한가</span>}
          </span>
          <span className="block text-[11.5px] text-gray-500">
            {win}분 동안 <b className="text-gray-700">{eok(r.recentValue)}원</b> 거래 · 그 사이 <b className={tone(r.recentPct)}>{sign(r.recentPct)}</b>
          </span>
          <span className="block text-[11px] text-gray-400">오늘 거래 {eok(r.value)}원</span>
        </span>
      </button>
      {/* 오른쪽 = 다른 화면과 같은 종목카드 */}
      <div className={compact ? "w-full" : "w-[230px] shrink-0"}>
        <StockCard i={i} item={{ stockCode: r.code, name: r.name, ratio: 0 }} hideRatio price={price} chart={chart} boxMinH="min-h-[72px]" />
      </div>
    </div>
  );
}
