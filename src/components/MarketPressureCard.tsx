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
      {/* ① 결론 — 맨 위 한 상자 */}
      <div className={`rounded-lg border px-3 py-2 ${TONE[v.tone].cls}`}>
        <div className="flex items-center gap-2 text-[15px] font-bold"><span className={`w-2.5 h-2.5 rounded-full shrink-0 ${TONE[v.tone].dot}`} />{head}</div>
        {sub && <div className="mt-0.5 text-[12.5px] leading-snug">{sub}</div>}
        {watch && <div className="mt-1 text-[12px] text-gray-700"><b>지켜볼 자리</b> · {watch}</div>}
      </div>
      {/* ② 근거 — 하나씩 카드(사용자 2026-11-21 "왜 그렇게 보나요 부분을 각각 카드로"), 방향 있는 것 먼저 */}
      <div className="mt-2 text-[12px] font-bold text-gray-600">왜 그렇게 보나요?</div>
      {/* 종류별로 묶음 — 완화(+반등 연료) · 하방 강화 · 그대로(사용자 2026-11-21 "종류별로 묶으면?") */}
      <div className="mt-1 grid gap-2 grid-cols-1 lg:grid-cols-4">
        {([
          { key: "better", label: "완화", desc: "누르는 힘이 약해지는 근거", cls: "text-rose-700 border-rose-200 bg-rose-50/40", span: "", cols: "", items: reasons.filter(r => r.tag === "better" || r.tag === "fuel") },
          { key: "worse", label: "하방 강화", desc: "누르는 힘이 세지는 근거", cls: "text-blue-700 border-blue-200 bg-blue-50/40", span: "", cols: "", items: reasons.filter(r => r.tag === "worse") },
          { key: "flat", label: "그대로", desc: "뚜렷한 변화 없음", cls: "text-gray-600 border-gray-200 bg-gray-50/60", span: "lg:col-span-2", cols: "sm:grid-cols-2", items: reasons.filter(r => r.tag === "flat") },
        ] as const).map(g => (
          <div key={g.key} className={`rounded-lg border p-1.5 ${g.cls} ${g.span}`}>
            <div className="px-0.5 pb-1 text-[12px] font-bold">{g.label} <span className="font-normal text-gray-500">{g.items.length}개 · {g.desc}</span></div>
            {g.items.length ? (
              <div className={`grid gap-1.5 grid-cols-1 ${g.cols}`}>
                {g.items.map((r, k) => <ReasonCard key={k} r={r} />)}
              </div>
            ) : <div className="px-0.5 pb-1 text-[11.5px] text-gray-400">없음</div>}
          </div>
        ))}
      </div>
      {/* ③ 자세히 — 지표 6개 카드 + 종목별 공매도 숫자 */}
      <details className="mt-2">
        <summary className="cursor-pointer select-none text-[12px] font-bold text-indigo-600">자세히 보기 — 종목별 공매도·대차 숫자</summary>
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

function ReasonCard({ r }: { r: Reason }) {
  const chip = r.tag === "fuel" ? "text-amber-700 bg-amber-50 border-amber-200" : TONE[r.tag].cls;
  return (
    <div className="relative overflow-hidden rounded-lg border border-gray-200 bg-white p-2 min-h-[72px] text-left">
      {r.series && r.series.length > 1 && (
        <div className="absolute inset-x-0 bottom-0 h-[50%] opacity-35 pointer-events-none">
          <Sparkline data={r.series} width={300} height={44} className="w-full h-full" strokeWidth={1.2} color={r.tag === "fuel" ? "#d97706" : undefined} />
        </div>
      )}
      <div className="relative flex items-center gap-1.5">
        <b className="text-[12.5px] text-gray-800 truncate">{r.title}</b>
        {r.tag === "fuel" && <span className={`ml-auto shrink-0 rounded border px-1 text-[10.5px] font-bold ${chip}`}>반등 연료</span>}
      </div>
      {r.value && <div className="relative text-[15px] font-bold tabular-nums text-gray-900">{r.value}</div>}
      <div className="relative text-[11.5px] text-gray-700 leading-snug">{r.text}</div>
      {r.help && <details className="relative mt-0.5 text-[10.5px] text-gray-500"><summary className="cursor-pointer select-none text-indigo-600">이게 뭔가요?</summary><div className="leading-snug mt-0.5">{r.help}</div></details>}
    </div>
  );
}
type Reason = { tag: Tone | "fuel"; title: string; text: string; value?: string; series?: number[]; help?: string };
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
  const reasons: Reason[] = gs.map(g => ({ tag: g.tone, title: g.title, text: g.text, value: g.value, series: g.series, help: g.help }));
  for (const s of ss) {
    if ((s.c20 ?? 0) >= 15) reasons.push({ tag: "fuel", title: `${s.name} 대차잔고`, value: `20일 ${fmtPct(s.c20!)}`, series: s.bal.slice(-60), text: `빌려 간 주식이 크게 늘었다${s.pos >= 0.95 ? "(100일 중 최고)" : ""} — 오를 때 되사기 물량이 된다`,
      help: "대차잔고는 공매도 등에 쓰려고 빌려 간 주식 수입니다. 빌린 주식은 결국 되사서 갚아야 해서, 많이 쌓인 상태에서 주가가 오르기 시작하면 되사기(숏커버링)가 몰려 오름폭이 커질 수 있습니다. 차익거래·대여 물량도 섞여 있습니다." });
    if (s.pnl20 != null) reasons.push({ tag: s.pnl20 >= 5 ? "flat" : "better", title: `${s.name} 공매도 손익`, value: s.pnl20 >= 0 ? `이익 ${s.pnl20.toFixed(0)}%` : `손해 ${(-s.pnl20).toFixed(0)}%`,
      text: s.pnl20 >= 0 ? `최근 20일 공매도 평균가 ${s.a20 ? fmtWon(s.a20) : ""} — ${s.pnl20 >= 5 ? "이익 중이라 급하게 되살 이유가 약하다" : "본전 근처"}` : `최근 20일 공매도 평균가 ${s.a20 ? fmtWon(s.a20) : ""} — 손해라 되사기 압박이 생기는 쪽`,
      help: "최근 20거래일 동안 공매도한 가격의 평균(수량 가중)과 지금 값을 비교했습니다. 공매도는 비싸게 팔고 싸게 되사야 이익이라, 지금 값이 평균가보다 낮으면 공매도한 쪽이 이익입니다. 이익 중이면 급하게 되살 이유가 적고, 손해로 돌아서면 되사기(숏커버링) 압박이 커집니다." });
  }
  const ord = { fuel: 0, better: 1, worse: 2, flat: 3 } as const;   // 방향이 있는 근거를 위로, 그대로는 아래로
  reasons.sort((x, y) => ord[x.tag] - ord[y.tag]);
  const watch = ss.filter(s => s.toBE != null && s.toBE > 0 && s.toBE <= 10 && s.a5).map(s => `${s.name} ${fmtWon(s.a5!)}(${fmtPct(s.toBE!)})`).join(" · ");
  return { head, sub: subs.join(" "), reasons, watch: watch ? `${watch} — 최근 5일 공매도 본전, 여기까지 오르면 되사기가 나올 수 있는 자리` : "" };
}
