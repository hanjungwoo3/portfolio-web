// 🔎 시황 분석 — 하방 압력 계기판(사용자 2026-11-20 "증시 탭에 분석/시황으로"). 증시 탭 맨 위, PC·모바일 공용(StockMarketTab).
//   외국인 선물·현물, 대차잔고, 공매도 비중, 옵션 풋/콜, V-KOSPI 를 지표마다 '하방 강화 / 그대로 / 완화' 로 — 판정 규칙은 lib/marketPressure.
//   예측이 아니라 지금 상태. 일별 자료는 1시간, 옵션·변동성은 5분마다.
import { useQuery } from "@tanstack/react-query";
import {
  fetchKrFuturesDays, fetchKrMarketFlow, fetchKrLendingTrading, fetchKrShortSelling,
  fetchKrFuturesLive, fetchKospi200OptionSummary, fetchYahooBatch,
} from "../lib/api";
import { futuresGauge, spotGauge, lendingGauge, shortGauge, optionGauge, volGauge, verdict, type Gauge, type Tone } from "../lib/marketPressure";
import { Sparkline } from "./Sparkline";

const BIG = [{ code: "005930", name: "삼성전자" }, { code: "000660", name: "SK하이닉스" }];
const HOUR = 60 * 60_000;
const TONE: Record<Tone, { label: string; cls: string; dot: string }> = {
  worse:  { label: "하방 강화", cls: "text-blue-700 bg-blue-50 border-blue-200", dot: "bg-blue-500" },
  flat:   { label: "그대로",   cls: "text-gray-600 bg-gray-50 border-gray-200", dot: "bg-gray-400" },
  better: { label: "완화",     cls: "text-rose-700 bg-rose-50 border-rose-200", dot: "bg-rose-500" },
};

export function MarketPressureCard() {
  const fut = useQuery({ queryKey: ["mp-fut-days"], queryFn: () => fetchKrFuturesDays(60), staleTime: HOUR, retry: 1 });
  const spot = useQuery({ queryKey: ["mp-spot-flow"], queryFn: () => fetchKrMarketFlow("KOSPI", 60), staleTime: HOUR, retry: 1 });
  const lend = useQuery({ queryKey: ["mp-lend"], queryFn: () => Promise.all(BIG.map(async s => ({ name: s.name, pts: await fetchKrLendingTrading(s.code, 3) }))), staleTime: HOUR, retry: 1 });
  const short = useQuery({ queryKey: ["mp-short"], queryFn: () => Promise.all(BIG.map(async s => ({ name: s.name, pts: await fetchKrShortSelling(s.code, 3) }))), staleTime: HOUR, retry: 1 });
  const opt = useQuery({
    queryKey: ["mp-opt"], staleTime: 5 * 60_000, refetchInterval: 5 * 60_000, retry: 1,
    queryFn: async () => { const f = await fetchKrFuturesLive("kospi200"); return f ? fetchKospi200OptionSummary(f.price) : null; },
  });
  const vk = useQuery({ queryKey: ["mp-vk"], queryFn: () => fetchYahooBatch([{ symbol: "VKOSPI", name: "V-KOSPI" }]), staleTime: 5 * 60_000, refetchInterval: 5 * 60_000, retry: 1 });

  const gauges = [
    fut.data && futuresGauge(fut.data),
    spot.data && spotGauge(spot.data),
    lend.data && lendingGauge(lend.data),
    short.data && shortGauge(short.data),
    optionGauge(opt.data),
    volGauge(vk.data?.get("VKOSPI")),
  ].filter((g): g is Gauge => !!g);
  const loading = [fut, spot, lend, short, opt, vk].filter(q => q.isLoading).length;
  const v = verdict(gauges);

  return (
    <div className="relative rounded-xl border border-gray-300 bg-white pg-box p-3 pt-4 mt-1.5">
      <span className="pg-title absolute -top-3 left-3 px-2 py-0.5 rounded-md border border-gray-300 bg-gray-50 text-sm font-bold text-gray-700">🔎 시황 분석 — 지수를 누르는 힘이 약해지고 있나?</span>
      {/* 초보용 한 줄 설명(사용자 2026-11-20 "주식 초보들이 이해할 수 있게") */}
      <div className="mb-1.5 text-[12px] text-gray-600 leading-snug">
        지수가 떨어질 때는 외국인 매도·공매도·하락 베팅 같은 <b>'누르는 힘'</b>이 함께 커집니다. 아래 6가지 중 <b className="text-rose-600">완화</b>(누르는 힘이 약해짐)가 많아지면 바닥을 다지고 반등할 여지가 커진다고 봅니다. 칸마다 <span className="text-indigo-600">이게 뭔가요?</span>를 누르면 쉬운 설명이 나옵니다.
      </div>
      <div className={`inline-flex items-center gap-2 rounded-md border px-2 py-1 text-[13px] font-bold ${TONE[v.tone].cls}`}>
        <span className={`w-2 h-2 rounded-full ${TONE[v.tone].dot}`} />{v.text}
        {loading > 0 && <span className="text-[11px] font-normal text-gray-400">(받는 중 {loading})</span>}
      </div>
      <div className="mt-2 grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {gauges.map(g => (
          <div key={g.key} className="relative overflow-hidden rounded-lg border border-gray-200 bg-white p-2 min-h-[78px]">
            {g.series && g.series.length > 1 && (
              <div className="absolute inset-x-0 bottom-0 h-[55%] opacity-40 pointer-events-none">
                <Sparkline data={g.series} width={300} height={44} className="w-full h-full" strokeWidth={1.2} />
              </div>
            )}
            <div className="relative flex items-center gap-1.5">
              <b className="text-[12.5px] text-gray-800 truncate">{g.title}</b>
              <span className={`ml-auto shrink-0 rounded border px-1 text-[10.5px] font-bold ${TONE[g.tone].cls}`}>{TONE[g.tone].label}</span>
            </div>
            <div className="relative text-[15px] font-bold tabular-nums text-gray-900">{g.value}</div>
            <div className="relative text-[11.5px] text-gray-700 leading-snug">{g.text}</div>
            {g.help && <details className="relative mt-0.5 text-[10.5px] text-gray-500"><summary className="cursor-pointer select-none text-indigo-600">이게 뭔가요?</summary><div className="leading-snug mt-0.5">{g.help}</div></details>}
          </div>
        ))}
      </div>
      <div className="mt-2 text-[10.5px] text-gray-400 leading-snug">
        <b className="text-rose-600">완화</b> = 누르는 힘이 약해짐 · <b className="text-blue-600">하방 강화</b> = 누르는 힘이 세짐 · 그대로 = 뚜렷한 변화 없음. 미래를 맞히는 게 아니라 <b>지금 상태</b>를 보여 줍니다.
        출처: 다음(선물 일별·미결제), 토스(외국인 현물·대차·공매도), 한경(옵션, 오늘), CNBC(V-KOSPI). 대차·공매도는 시총 1·2위 두 종목 기준.
      </div>
    </div>
  );
}
