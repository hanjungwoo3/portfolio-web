// AI 하드웨어 vs 소프트웨어 상대강도 — 지수(주간) 페이지 블록. PC·모바일 공용.
//   진영 구성·판정 규칙·근거(실측)는 lib/aiCamp. 데이터 = 토스 일봉(ETF 14개 × 1콜, 10분 캐시).
//   ETF 는 'ETF 포함 종목' 팝업과 같은 카드로 보여 준다(사용자 요청 2026-10-12) — 카드의 기간 수익률(크롤러)과
//   위 진영 표가 같은 기준(지난 거래일 종가)이라 숫자가 서로 맞는다.
import { useQuery, useQueries } from "@tanstack/react-query";
import { fetchTossKrCandles, fetchTossPrices, fetchKrPriceHistory, type PricePoint } from "../lib/api";
import { AI_CAMPS, AI_CAMP_CODES, PERIOD_BARS, PERIOD_LABEL, LEAN_GAP, campReturn, leanOf, type CampKey, type Period } from "../lib/aiCamp";
import { StockCard } from "./EtfCompositionDialog";
import { EtfStatsBox } from "./EtfStatsBox";
import { useEtfReturns } from "../lib/etfReturns";

const PERIODS: Period[] = ["d1", "w1", "m1", "m3"];
const CANDLE_MS = 10 * 60_000;
const CAMP_TONE: Record<CampKey, string> = { hw: "text-rose-700", sw: "text-indigo-700", ref: "text-gray-500" };
const pctCls = (v: number | null) => v == null ? "text-gray-300" : v > 0 ? "text-rose-600" : v < 0 ? "text-blue-600" : "text-gray-700";
const fmt = (v: number | null, unit = "%") => v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}${unit}`;
const kstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

// cards=false — 판정·표만(지수(미국순환)처럼 아래에 ETF ➜ 종목 줄이 따로 있을 때)
export function AiCampCard({ onOpenEtf, small = false, cards = true }: { onOpenEtf?: (code: string, name: string) => void; small?: boolean; cards?: boolean }) {
  const qs = useQueries({
    queries: AI_CAMP_CODES.map(code => ({
      queryKey: ["ai-camp-candles", code],
      queryFn: () => fetchTossKrCandles(code, "day", PERIOD_BARS.m3 + 5),
      staleTime: CANDLE_MS, refetchInterval: CANDLE_MS, refetchOnWindowFocus: false, retry: 1,
    })),
  });
  const candles = new Map<string, PricePoint[]>();
  qs.forEach((q, i) => { if (q.data?.length) candles.set(AI_CAMP_CODES[i], q.data); });
  const loading = qs.some(q => q.isLoading);

  // 카드용 — 현재가(1콜, 1분)·배경 추세(ETF 포함 종목 팝업과 같은 쿼리키라 캐시 공유)
  const { data: priceList } = useQuery({
    queryKey: ["ai-camp-prices", AI_CAMP_CODES.join(",")],
    queryFn: () => fetchTossPrices(AI_CAMP_CODES),
    enabled: cards,   // 요약만 그릴 땐 카드용 시세를 안 받는다
    staleTime: 30_000, refetchInterval: 60_000,
  });
  const priceMap = new Map((priceList ?? []).map(p => [p.ticker, p]));
  const histQs = useQueries({
    queries: AI_CAMP_CODES.map(code => ({
      queryKey: ["price-history", code, "6mo"],
      queryFn: () => fetchKrPriceHistory(code, "6mo"),
      enabled: cards,
      staleTime: 60 * 60_000, refetchOnWindowFocus: false,
    })),
  });
  const histMap = new Map(AI_CAMP_CODES.map((c, i) => [c, (histQs[i]?.data ?? []).map(p => p.close)]));

  const today = kstToday();
  // 1주·1개월·3개월 = 카드 오른쪽 박스(크롤러)와 **같은 값**의 평균 — 크롤러가 늦게 돌아 장중 가격이 섞여도 카드와 표가 같이 움직인다
  const crawled = useEtfReturns(true)?.returns;
  const camp = (k: CampKey, p: Period) => campReturn(k, candles, p, today, crawled);
  const gap = (p: Period) => { const h = camp("hw", p), s = camp("sw", p); return h == null || s == null ? null : h - s; };
  const { lean, turning } = leanOf(gap("m1"), gap("w1"));
  const text = small ? "text-[11px]" : "text-[12px]";

  return (
    <div className={`space-y-2 ${text}`}>
      {/* 판정 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className={`px-2 py-0.5 rounded-full font-bold border
                          ${lean === "hw" ? "bg-rose-50 text-rose-700 border-rose-200"
                            : lean === "sw" ? "bg-indigo-50 text-indigo-700 border-indigo-200"
                            : "bg-gray-50 text-gray-600 border-gray-200"}`}>
          {loading && candles.size === 0 ? "불러오는 중…"
            : lean === "hw" ? "🔧 하드웨어 쪽으로 기움" : lean === "sw" ? "💻 소프트웨어 쪽으로 기움" : "⚖️ 비슷 (1개월 차이 작음)"}
        </span>
        {turning && (
          <span className="px-1.5 py-0.5 rounded font-bold bg-amber-100 text-amber-800 border border-amber-300">
            ↩ 최근 1주는 반대 — 전환 조짐
          </span>
        )}
        <span className="text-[10px] text-gray-400">
          1개월 차이 {LEAN_GAP}%p↑ 이면 기움 · 하드웨어가 크게 빠질 때 소프트웨어로 피신하는 순환(15개월 실측)
        </span>
      </div>

      {/* 진영 평균 + 차이 — 1주·1개월·3개월은 지난 거래일 종가 기준(아래 카드의 기간 수익률과 같은 값의 평균) */}
      {/* PC 전체 폭으로 늘리면 숫자 칸이 너무 벌어진다 — max-w-xl */}
      <table className="w-full max-w-xl tabular-nums">
        <thead>
          <tr className="text-[10px] text-gray-500">
            <th className="text-left font-normal py-0.5">진영 (ETF 평균)</th>
            {PERIODS.map(p => <th key={p} className="text-right font-normal">{PERIOD_LABEL[p]}</th>)}
          </tr>
        </thead>
        <tbody>
          {(["hw", "sw"] as const).map(k => (
            <tr key={k} className="border-t border-gray-100">
              <td className={`py-0.5 font-bold ${CAMP_TONE[k]}`}>{k === "hw" ? "🔧" : "💻"} {AI_CAMPS[k].label}</td>
              {PERIODS.map(p => <td key={p} className={`text-right ${pctCls(camp(k, p))}`}>{fmt(camp(k, p))}</td>)}
            </tr>
          ))}
          <tr className="border-t border-gray-200 bg-gray-50/70">
            <td className="py-0.5 font-bold text-gray-700" title="하드웨어 평균 − 소프트웨어 평균. +면 하드웨어가 앞섬">차이 (하드 − 소프트)</td>
            {PERIODS.map(p => {
              const g = gap(p);
              return <td key={p} className={`text-right font-bold ${g == null ? "text-gray-300" : g > 0 ? "text-rose-700" : g < 0 ? "text-indigo-700" : "text-gray-700"}`}>{fmt(g, "%p")}</td>;
            })}
          </tr>
        </tbody>
      </table>
      <div className="text-[10px] text-gray-400">1주·1개월·3개월 = ETF 기간 수익률(매일 아침 갱신, ETF 카드 오른쪽 박스와 같은 값)의 평균 · 오늘 = 지금</div>

      {/* 진영별 ETF 카드 — 'ETF 포함 종목' 팝업과 같은 카드. 꼬리표 = 섹터, 🍱 = 구성종목 */}
      {cards && (["hw", "sw", "ref"] as const).map(k => (
        <div key={k} className="space-y-1">
          <div className={`font-bold ${CAMP_TONE[k]}`}>
            {k === "hw" ? "🔧 " : k === "sw" ? "💻 " : ""}{AI_CAMPS[k].label}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
            {AI_CAMPS[k].etfs.map(e => (
              <StockCard key={e.code} i={0}
                         item={{ stockCode: e.code, name: `${e.name} (${e.code})`, ratio: 0 }} hideRatio
                         price={priceMap.get(e.code)} chart={histMap.get(e.code) ?? []}
                         boxMinH="min-h-[92px]"
                         boxRight={<EtfStatsBox code={e.code} volume={priceMap.get(e.code)?.volume} />}
                         actionLeft={onOpenEtf ? (
                           <button onClick={ev => { ev.preventDefault(); ev.stopPropagation(); onOpenEtf(e.code, e.name); }}
                                   title={`${e.name} 구성종목 보기`}
                                   className="px-1.5 py-0.5 rounded-t-md text-[10px] font-bold leading-none
                                              bg-amber-50 text-amber-700 border-t border-l border-r border-amber-300
                                              hover:bg-amber-100">
                             🍱
                           </button>
                         ) : undefined}
                         rightTag={
                           <div className={`border rounded px-1 py-0 leading-tight text-[11px] font-bold bg-white whitespace-nowrap ${CAMP_TONE[k]}`}
                                style={{ borderColor: k === "hw" ? "#fecaca" : k === "sw" ? "#c7d2fe" : "#e5e7eb" }}>
                             {e.short}
                           </div>
                         } />
            ))}
          </div>
        </div>
      ))}
      <div className="text-[10px] text-gray-400">국내 상장 미국 ETF(원화) · 미국장은 하루 늦게 반영된다</div>
    </div>
  );
}
