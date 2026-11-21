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
import { useShortStats, ShortDetail, fmtWon, fmtPct, type ShortStats } from "./ShortAnalysisCard";

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
  const sa = useShortStats();
  const ss = sa.stats.filter((x): x is ShortStats => !!x);
  const { head, sub, reasons, watch } = conclude(gauges, ss);

  // 결론 → 근거 → 자세히(사용자 2026-11-21 "좀 더 쉽게 이해할 수 있는 구조, 결론을 먼저, 근거(이유)를, 시황분석과 엮어서")
  return (
    <div className="relative rounded-xl border border-gray-300 bg-white pg-box p-3 pt-4 mt-1.5">
      <span className="pg-title absolute -top-3 left-3 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-gray-300 bg-gray-50 text-sm font-bold text-gray-700">
        🔎 시황 분석 <span className="text-[11px] font-normal text-gray-400">{loading > 0 || sa.loading ? "받는 중…" : sa.date ? `공매도·대차 ${+sa.date.slice(5, 7)}/${+sa.date.slice(8, 10)} 기준` : ""}</span>
      </span>
      {/* ① 결론 */}
      <div className={`rounded-lg border px-3 py-2 ${TONE[v.tone].cls}`}>
        <div className="flex items-center gap-2 text-[15px] font-bold"><span className={`w-2.5 h-2.5 rounded-full shrink-0 ${TONE[v.tone].dot}`} />{head}</div>
        {sub && <div className="mt-0.5 text-[12.5px] leading-snug">{sub}</div>}
        {watch && <div className="mt-1 text-[12px] text-gray-700"><b>지켜볼 자리</b> · {watch}</div>}
      </div>
      {/* ② 근거 — 한 줄씩, 왼쪽 꼬리표가 방향 */}
      <div className="mt-2 text-[12px] font-bold text-gray-600">왜 그렇게 보나요?</div>
      <ul className="mt-0.5 space-y-0.5">
        {reasons.map((r, k) => (
          <li key={k} className="flex items-start gap-1.5 text-[12px] leading-snug">
            <span className={`shrink-0 mt-px rounded border px-1 text-[10.5px] font-bold ${r.tag === "fuel" ? "text-amber-700 bg-amber-50 border-amber-200" : TONE[r.tag].cls}`}>{r.tag === "fuel" ? "반등 연료" : TONE[r.tag].label}</span>
            <span><b className="text-gray-800">{r.title}</b> <span className="text-gray-600">— {r.text}</span></span>
          </li>
        ))}
      </ul>
      {/* ③ 자세히 — 지표 6개 카드 + 종목별 공매도 숫자 */}
      <details className="mt-2">
        <summary className="cursor-pointer select-none text-[12px] font-bold text-indigo-600">자세히 보기 — 지표 6개와 종목별 공매도·대차 숫자</summary>
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
        <div className="mt-2 grid gap-2 lg:grid-cols-2">{sa.stats.map((x, i) => <ShortDetail key={i} s={x} />)}</div>
        <div className="mt-1.5 text-[10.5px] text-gray-400 leading-snug">
          공매도 평균가 = 그 기간 날마다의 공매도 평균가를 수량으로 가중 평균한 값(추정 원가). 대차잔고 = 빌려 간 주식(공매도 말고 차익거래·대여 물량도 섞임).
        </div>
      </details>
      <div className="mt-2 text-[10.5px] text-gray-400 leading-snug">
        <b className="text-rose-600">완화</b> = 누르는 힘이 약해짐 · <b className="text-blue-600">하방 강화</b> = 누르는 힘이 세짐 · <b className="text-amber-700">반등 연료</b> = 오를 때 되사기로 오름폭을 키울 수 있는 물량.
        미래를 맞히는 게 아니라 <b>지금 상태</b>입니다. 출처: 다음(선물), 토스(현물·대차·공매도), 한경(옵션), CNBC(V-KOSPI).
      </div>
    </div>
  );
}

type Reason = { tag: Tone | "fuel"; title: string; text: string };
/** 결론 한 줄 + 보조 한 줄 + 근거 목록 + 지켜볼 자리 — 숫자로 확인되는 것만 말한다 */
function conclude(gs: Gauge[], ss: ShortStats[]): { head: string; sub: string; reasons: Reason[]; watch: string } {
  const b = gs.filter(g => g.tone === "better").length, w = gs.filter(g => g.tone === "worse").length;
  const head = !gs.length ? "자료를 받는 중입니다"
    : b >= w + 2 ? "지수를 누르는 힘이 약해지고 있습니다"
    : w >= b + 2 ? "아직 지수를 누르는 힘이 더 셉니다"
    : "누르는 힘은 아직 그대로 — 바닥 신호는 약합니다";
  const fuel = ss.filter(s => (s.c20 ?? 0) >= 15);
  const allProfit = ss.length > 0 && ss.every(s => (s.pnl20 ?? 0) >= 5);
  const subs: string[] = [];
  if (fuel.length) subs.push(`다만 ${fuel.map(s => s.name).join("·")}는 공매도용으로 빌려 간 주식이 크게 늘어(20일 ${fuel.map(s => fmtPct(s.c20!)).join("·")}), 반등이 시작되면 되사기로 오름폭이 커질 수 있습니다.`);
  if (allProfit) subs.push("공매도한 쪽은 아직 이익이라 급하게 되살 압박은 약합니다.");
  const reasons: Reason[] = gs.map(g => ({ tag: g.tone, title: g.title, text: g.text }));
  for (const s of ss) {
    if ((s.c20 ?? 0) >= 15) reasons.push({ tag: "fuel", title: `${s.name} 대차잔고`, text: `빌려 간 주식이 20일 새 ${fmtPct(s.c20!)}${s.pos >= 0.95 ? "(100일 중 최고)" : ""} — 오를 때 되사기 물량이 된다` });
    if (s.pnl20 != null) reasons.push({ tag: s.pnl20 >= 5 ? "flat" : "better", title: `${s.name} 공매도 손익`, text: s.pnl20 >= 0 ? `최근 20일 공매도한 쪽이 약 ${s.pnl20.toFixed(0)}% 이익 — ${s.pnl20 >= 5 ? "급하게 되살 이유가 약하다" : "본전 근처"}` : `최근 20일 공매도한 쪽이 약 ${(-s.pnl20).toFixed(0)}% 손해 — 되사기 압박이 생기는 쪽` });
  }
  const ord = { fuel: 0, better: 1, worse: 2, flat: 3 } as const;   // 방향이 있는 근거를 위로, 그대로는 아래로
  reasons.sort((x, y) => ord[x.tag] - ord[y.tag]);
  const watch = ss.filter(s => s.toBE != null && s.toBE > 0 && s.toBE <= 10 && s.a5).map(s => `${s.name} ${fmtWon(s.a5!)}(${fmtPct(s.toBE!)})`).join(" · ");
  return { head, sub: subs.join(" "), reasons, watch: watch ? `${watch} — 최근 5일 공매도 본전, 여기까지 오르면 되사기가 나올 수 있는 자리` : "" };
}
