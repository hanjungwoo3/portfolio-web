// 🔎 시황 분석 — 하방 압력 계기판(사용자 2026-11-20 "증시 탭에 분석/시황으로"). 증시 탭 맨 위, PC·모바일 공용(StockMarketTab).
//   외국인 선물·현물, 대차잔고, 공매도 비중, 옵션 풋/콜, V-KOSPI 를 지표마다 '하방 강화 / 그대로 / 완화' 로 — 판정 규칙은 lib/marketPressure.
//   예측이 아니라 지금 상태. 일별 자료는 1시간, 옵션·변동성은 5분마다.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchKrFuturesDays, fetchKrMarketFlow, fetchKrLendingTrading, fetchKrShortSelling,
  fetchKrFuturesLive, fetchKospi200OptionSummary, fetchYahooBatch, fetchDashboardChart,
} from "../lib/api";
import { futuresGauge, spotGauge, lendingGauge, shortGauge, optionGauge, volGauge, verdict, type Gauge, type Tone } from "../lib/marketPressure";
import { useShortStats, fmtWon, fmtPct, type ShortStats } from "./ShortAnalysisCard";

const BIG = [{ code: "005930", name: "삼성전자" }, { code: "000660", name: "SK하이닉스" }];
const HOUR = 60 * 60_000;
const TONE: Record<Tone, { label: string; cls: string; dot: string }> = {
  worse:  { label: "하방 강화", cls: "text-blue-700 bg-blue-50 border-blue-200", dot: "bg-blue-500" },
  flat:   { label: "중립",   cls: "text-gray-600 bg-gray-50 border-gray-200", dot: "bg-gray-400" },
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
  // V-KOSPI 3개월(타일 그래프 — 사용자 2026-11-21 "변동성 그래프도 없는데")
  const vkHist = useQuery({ queryKey: ["mp-vk-hist"], queryFn: () => fetchDashboardChart("VKOSPI", "3mo"), staleTime: HOUR, retry: 1 });
  const vk = useQuery({ queryKey: ["mp-vk"], queryFn: () => fetchYahooBatch([{ symbol: "VKOSPI", name: "V-KOSPI" }]), staleTime: 5 * 60_000, refetchInterval: 5 * 60_000, retry: 1 });

  const gauges = [
    fut.data && futuresGauge(fut.data),
    spot.data && spotGauge(spot.data),
    lend.data && lendingGauge(lend.data),
    short.data && shortGauge(short.data),
    optionGauge(opt.data),
    volGauge(vk.data?.get("VKOSPI"), vkHist.data),
  ].filter((g): g is Gauge => !!g);
  const loading = [fut, spot, lend, short, opt, vk].filter(q => q.isLoading).length;
  const v = verdict(gauges);
  const sa = useShortStats();
  const [pick, setPick] = useState<number | null>(null);   // 누른 타일 — 아래에 설명
  const ss = sa.stats.filter((x): x is ShortStats => !!x);
  const { head, sub, reasons, watch } = conclude(gauges, ss);

  // 한눈에(사용자 2026-11-21 "좀 더 한눈에 보는 방법, 자세히 보기까지 포함해서") —
  //   ① 결론 한 줄 + 줄다리기 막대(하방 강화 · 그대로 · 완화 개수) ② 지표 타일 한 줄(눌러서 설명) ③ 종목별 공매도 두 줄 표
  const cnt = { worse: reasons.filter(r => r.tag === "worse").length, flat: reasons.filter(r => r.tag === "flat").length, better: reasons.filter(r => r.tag === "better" || r.tag === "fuel").length };
  const tot = Math.max(1, cnt.worse + cnt.flat + cnt.better);
  return (
    <div className="relative rounded-xl border border-gray-300 bg-white pg-box p-3 pt-4 mt-1.5">
      <span className="pg-title absolute -top-3 left-3 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-gray-300 bg-gray-50 text-sm font-bold text-gray-700">
        🔎 시황 분석 <span className="text-[11px] font-normal text-gray-400">{loading > 0 || sa.loading ? "받는 중…" : sa.date ? `공매도·대차 ${+sa.date.slice(5, 7)}/${+sa.date.slice(8, 10)} 기준` : ""}</span>
      </span>
      {/* ① 결론 + 줄다리기 */}
      {/* 위·아래 같은 칸 나눔(60:40) — 위 = 결론 | 줄다리기, 아래 = 종목 표 | 지표 타일(사용자 2026-11-21 "타일을 오른쪽으로, 줄다리기를 넓혀서 위아래 맞춰") */}
      <div className="lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-stretch lg:gap-3">
        <div className={`flex-1 min-w-0 rounded-lg border px-3 py-1.5 ${TONE[v.tone].cls}`}>
          <div className="flex items-center gap-2 text-[14.5px] font-bold"><span className={`w-2.5 h-2.5 rounded-full shrink-0 ${TONE[v.tone].dot}`} />{head}</div>
          {sub && <div className="text-[12px] leading-snug">{sub}</div>}
          {watch && <div className="text-[11.5px] text-gray-700"><b>지켜볼 자리</b> · {watch}</div>}
        </div>
        <div className="mt-1.5 lg:mt-0 rounded-lg border border-gray-200 px-2 py-1.5 flex flex-col justify-center" title="근거 카드 개수 — 왼쪽 파랑이 길면 누르는 힘이 세고, 오른쪽 빨강이 길면 약해지는 중">
          <div className="flex justify-between text-[11px] font-bold">
            <span className="text-blue-700">하방 강화 {cnt.worse}</span><span className="text-gray-500" title="판정 기준선 안쪽 — 누르는 힘이 세졌다고도 약해졌다고도 말하기 어려움">중립 {cnt.flat}</span><span className="text-rose-700">완화 {cnt.better}</span>
          </div>
          <div className="mt-1 flex h-3 rounded overflow-hidden border border-gray-200">
            <div className="bg-blue-500" style={{ width: `${(cnt.worse / tot) * 100}%` }} />
            <div className="bg-gray-300" style={{ width: `${(cnt.flat / tot) * 100}%` }} />
            <div className="bg-rose-500" style={{ width: `${(cnt.better / tot) * 100}%` }} />
          </div>
          <div className="mt-0.5 text-[10px] text-gray-400 text-center">완화 쪽(빨강)이 길어지면 바닥을 다지는 중</div>
        </div>
      </div>
      {/* ② 지표 타일 한 줄 — 방향별로 왼쪽 띠 색, 누르면 아래에 설명 */}
      {/* 넓은 화면: 왼쪽 지표 타일(3×3) · 오른쪽 종목 표(사용자 2026-11-21 50:50 → "40:60") */}
      <div className="mt-2 lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-3 lg:items-start">
      <div className="lg:order-2">
      <div className="grid gap-1.5 grid-cols-2 sm:grid-cols-3">
        {reasons.map((r, k) => {
          const bar = r.tag === "fuel" ? "border-l-amber-500" : r.tag === "better" ? "border-l-rose-500" : r.tag === "worse" ? "border-l-blue-500" : "border-l-gray-300";
          const on = pick === k;
          return (
            <button key={k} type="button" onClick={() => setPick(on ? null : k)}
                    className={`relative text-left rounded-md border border-gray-200 border-l-4 ${bar} bg-white px-1.5 py-1 hover:bg-gray-50 ${on ? "ring-2 ring-indigo-300" : ""}`}>
              {r.series && r.series.length > 1 && <div className="absolute inset-x-0 bottom-0 h-[70%] opacity-35 pointer-events-none overflow-hidden rounded-b-md"><MiniLine data={r.series} ref0={r.ref} hiLast={r.hiLast} color={r.tag === "fuel" ? "#d97706" : r.tag === "better" ? "#e11d48" : r.tag === "worse" ? "#2563eb" : "#6b7280"} /></div>}
              <div className="relative text-[10.5px] text-gray-500 truncate">{r.title}</div>
              {/* 값과 방향을 한 줄로(사용자 2026-11-21 "3줄인데 2줄로") */}
              <div className="relative flex items-baseline gap-1.5 min-w-0">
                <span className="text-[13px] font-bold tabular-nums text-gray-900 truncate">{r.value ?? "—"}</span>
                {/* 꼬리표에 마우스를 올리면 '왜' 레이어(타일 안 한 줄은 숨김 — 사용자 2026-11-21 "아래쪽은 숨기고 hover 시 레이어로") */}
                <span className={`group/why relative ml-auto shrink-0 text-[10px] font-bold cursor-help underline decoration-dotted underline-offset-2 ${r.tag === "fuel" ? "text-amber-700" : r.tag === "better" ? "text-rose-600" : r.tag === "worse" ? "text-blue-600" : "text-gray-400"}`}>
                  {r.tag === "fuel" ? "반등 연료" : TONE[r.tag].label}
                  {(r.why || r.rule) && (
                    <span className="hidden group-hover/why:block absolute right-0 top-full mt-1 z-40 w-[260px] rounded-md border border-gray-300 bg-white shadow-lg px-2 py-1.5 text-left text-[11.5px] font-normal text-gray-700 leading-snug no-underline">
                      {r.tag === "flat" && <span className="block text-gray-500 mb-0.5">중립 = 기준선 안쪽이라 어느 쪽도 아님</span>}
                      {r.why && <span className="block"><b>왜?</b> {r.why}</span>}
                      {r.rule && <span className="block mt-0.5 text-[10.5px] text-indigo-700"><b>판정 기준</b> · {r.rule}</span>}
                    </span>
                  )}
                </span>
              </div>
            </button>
          );
        })}
      </div>
      {pick != null && reasons[pick] && (
        <div className="mt-1.5 rounded-md border border-indigo-200 bg-indigo-50/50 px-2 py-1.5 text-[12px] leading-snug">
          <b>{reasons[pick].title}</b> — {reasons[pick].text}
          {reasons[pick].why && <div className="mt-0.5 text-[11.5px]"><b>이 판정이 나온 이유</b> · {reasons[pick].why}</div>}
          {reasons[pick].rule && <div className="mt-0.5 text-[11px] text-indigo-700"><b>판정 기준</b> · {reasons[pick].rule}</div>}
          {reasons[pick].help && <div className="mt-0.5 text-[11px] text-gray-600">{reasons[pick].help}</div>}
        </div>
      )}
      </div>
      {/* ③ 종목별 공매도·대차 — 두 줄 표(예전 '자세히 보기') */}
      <div className="mt-2 lg:mt-0 lg:order-1 overflow-x-auto">
        <table className="w-full text-[11.5px] tabular-nums">
          <thead><tr className="text-[10.5px] text-gray-500 text-left">
            <th className="font-normal py-0.5">종목</th><th className="font-normal">종가</th>
            <th className="font-normal" title="최근 5·20거래일 공매도 평균가(수량 가중) — 공매도한 쪽 추정 원가">공매도 평균가 5일 · 20일</th>
            <th className="font-normal" title="지금 값 기준 — 이익이면 급하게 되살 이유가 약하다">공매도 쪽 손익(20일)</th>
            <th className="font-normal" title="최근 5일 공매도 평균가까지 주가가 몇 % 올라야 하나 — 여기서 되사기가 나올 수 있다">본전까지</th>
            <th className="font-normal" title="빌려 간 주식 — 많이 쌓이면 오를 때 되사기 물량">대차잔고 20일</th>
            <th className="font-normal w-[200px]" title="최근 30일 — 연한 위 = 새로 빌려 감, 연한 아래 = 갚음, 진한 막대 = 그 차이(주황 위 = 늘어남, 회색 아래 = 줄어듦)">대차 하루 증감(30일)</th>
            <th className="font-normal" title="그날 거래량 중 공매도 비중 / 20일 평균">공매도 비중</th>
          </tr></thead>
          <tbody>
            {sa.stats.map((x, i) => !x ? <tr key={i}><td colSpan={8} className="text-gray-400 py-1">받는 중…</td></tr> : (
              <tr key={i} className="border-t border-gray-100">
                <td className="py-0.5 font-bold text-gray-800 whitespace-nowrap text-[12.5px]">{x.name}</td>
                <td className="whitespace-nowrap">{x.close ? fmtWon(x.close) : "—"}</td>
                <td className="whitespace-nowrap">{x.a5 ? fmtWon(x.a5) : "—"} · {x.a20 ? fmtWon(x.a20) : "—"}</td>
                <td className={`whitespace-nowrap font-bold ${x.pnl20 != null && x.pnl20 >= 0 ? "text-gray-600" : "text-rose-600"}`}>{x.pnl20 == null ? "—" : x.pnl20 >= 0 ? `이익 ${x.pnl20.toFixed(0)}%` : `손해 ${(-x.pnl20).toFixed(0)}%`}</td>
                <td className="whitespace-nowrap font-bold text-rose-700">{x.toBE != null ? fmtPct(x.toBE) : "—"}</td>
                <td className={`whitespace-nowrap font-bold ${(x.c20 ?? 0) >= 15 ? "text-amber-700" : "text-gray-600"}`}>{x.c20 != null ? fmtPct(x.c20) : "—"}{x.pos >= 0.95 ? " · 100일 최고" : ""}</td>
                <td><DeltaBars newV={x.newV} repV={x.repV} /></td>
                <td className={`whitespace-nowrap ${x.rNow >= x.r20 + 1 ? "text-blue-700 font-bold" : "text-gray-600"}`}>{x.rNow.toFixed(1)}% <span className="font-normal text-gray-400">/ {x.r20.toFixed(1)}%</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </div>
      <div className="mt-1.5 text-[10.5px] text-gray-400 leading-snug">
        타일 왼쪽 띠: <b className="text-rose-600">빨강 완화</b> · <b className="text-blue-600">파랑 하방 강화</b> · <b className="text-amber-700">주황 반등 연료</b>(오를 때 되사기로 오름폭을 키울 물량) · 회색 <b>중립</b>(기준선 안쪽이라 어느 쪽도 아님) · 타일을 누르면 설명과 판정 기준. 미래를 맞히는 게 아니라 <b>지금 상태</b>입니다.
        출처: 다음(선물), 토스(현물·대차·공매도, 일별 장 마감 뒤), 한경(옵션), CNBC(V-KOSPI).
      </div>
    </div>
  );
}

/** 타일 배경 미니 그래프 — 선 + 가운데 평균 가로 점선(사용자 2026-11-21 "여기 중심 가로선 말한 건데") */
//   ref0 = 점선 자리(공매도 손익 = 20일 공매도 평균가), 없으면 평균. hiLast = 끝에서 N개를 판정 구간으로 옅게 칠한다(외국인 선물·공매도 비중 = 최근 5일)
function MiniLine({ data, color, ref0, hiLast }: { data: number[]; color: string; ref0?: number; hiLast?: number }) {
  const vals = ref0 != null ? [...data, ref0] : data;
  const W = 200, H = 40, lo = Math.min(...vals), hi = Math.max(...vals), r = hi - lo || 1;
  const y = (v: number) => 3 + (1 - (v - lo) / r) * (H - 6);
  const av = ref0 ?? data.reduce((a, v) => a + v, 0) / data.length;
  const xOf = (i: number) => (i / (data.length - 1)) * W;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="none">
      {hiLast && data.length > hiLast && <rect x={xOf(data.length - 1 - hiLast)} y={0} width={W - xOf(data.length - 1 - hiLast)} height={H} fill="#6366f1" opacity={0.12} />}
      <line x1={0} x2={W} y1={y(av)} y2={y(av)} stroke="#6b7280" strokeDasharray="4 3" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <polyline fill="none" stroke={color} strokeWidth={1.3} vectorEffect="non-scaling-stroke" points={data.map((v, i) => `${(i / (data.length - 1)) * W},${y(v)}`).join(" ")} />
    </svg>
  );
}
/** 대차잔고 하루 증감 막대(최근 30일) — 잔고 자체는 큰 값이 조금씩 움직여 선으로도 차이가 안 보였다(사용자 2026-11-21 "바그래프가 더 잘 보일 것 같은데")
 *  주황 위 = 빌려 감(늘어남), 회색 아래 = 갚음(줄어듦). 높이는 30일 중 가장 큰 변화 기준 */
//   → 신규(위)·상환(아래)은 연하게, 그 차이(+ 늘어남 주황 위 / − 줄어듦 회색 아래)만 진하게(사용자 2026-11-21 "상하를 투명하게 하고 +-로 차익만 진하게")
function DeltaBars({ newV, repV }: { newV: number[]; repV: number[] }) {
  const nv = newV.slice(-30), rv = repV.slice(-30);
  const d = nv.map((v, i) => v - (rv[i] ?? 0));
  const mx = Math.max(1, ...nv, ...rv);
  const W = 200, H = 60, mid = H / 2, bw = W / Math.max(1, d.length);   // 왼쪽 타일(2줄×3) 높이에 맞춤(사용자 2026-11-21 "오른쪽 높이도 낮춰서 맞추자")   // 높이 크게(사용자 2026-11-21 "높이를 더 크게") — 왼쪽 타일 3줄 높이에 맞춤   // 크게(사용자 2026-11-21 "그래프가 너무 안 보여")
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-[200px] h-[60px]" preserveAspectRatio="none">
      <line x1={0} x2={W} y1={mid} y2={mid} stroke="#e5e7eb" strokeWidth={0.6} />
      {d.map((v, i) => {
        const hh = (x: number) => Math.sqrt(Math.max(0, x) / mx) * (mid - 1);   // 제곱근 눈금 — 작은 날도 보이게
        const x0 = i * bw + 0.3, w = Math.max(0.6, bw - 0.6), h = hh(Math.abs(v));
        return <g key={i}>
          <rect x={x0} y={mid - hh(nv[i])} width={w} height={hh(nv[i])} fill="#d97706" opacity={0.18} />
          <rect x={x0} y={mid} width={w} height={hh(rv[i] ?? 0)} fill="#6b7280" opacity={0.18} />
          <rect x={x0} y={v >= 0 ? mid - h : mid} width={w} height={Math.max(0.4, h)} fill={v >= 0 ? "#d97706" : "#6b7280"} opacity={0.9} />
        </g>;
      })}
    </svg>
  );
}
type Reason = { tag: Tone | "fuel"; title: string; text: string; value?: string; series?: number[]; help?: string; rule?: string; why?: string; ref?: number; hiLast?: number };   // ref = 점선 자리(없으면 평균), hiLast = 끝에서 N개를 판정 구간으로 칠함
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
  const reasons: Reason[] = gs.map(g => ({ tag: g.tone, title: g.title, text: g.text, value: g.value, series: g.series, help: g.help, rule: g.rule, why: g.why, hiLast: g.key === "fut" || g.key === "short" ? 5 : undefined }));
  for (const s of ss) {
    if ((s.c20 ?? 0) >= 15) reasons.push({ tag: "fuel", title: `${s.name} 대차잔고`, value: `20일 ${fmtPct(s.c20!)}`, series: s.bal.slice(-60), text: `빌려 간 주식이 크게 늘었다${s.pos >= 0.95 ? "(100일 중 최고)" : ""} — 오를 때 되사기 물량이 된다`,
      rule: "그 종목 대차잔고가 20거래일 전보다 15% 넘게 늘면 '반등 연료'", why: `빌린 주식 ${(s.b0 / 1e4).toFixed(0)}만 주 — 되사서 갚아야 할 물량`,
      help: "대차잔고는 공매도 등에 쓰려고 빌려 간 주식 수입니다. 빌린 주식은 결국 되사서 갚아야 해서, 많이 쌓인 상태에서 주가가 오르기 시작하면 되사기(숏커버링)가 몰려 오름폭이 커질 수 있습니다. 차익거래·대여 물량도 섞여 있습니다." });
    if (s.pnl20 != null) reasons.push({ tag: s.pnl20 >= 5 ? "flat" : "better", title: `${s.name} 공매도 손익`, series: s.closes, ref: s.a20, value: s.pnl20 >= 0 ? `이익 ${s.pnl20.toFixed(0)}%` : `손해 ${(-s.pnl20).toFixed(0)}%`,
      text: s.pnl20 >= 0 ? `최근 20일 공매도 평균가 ${s.a20 ? fmtWon(s.a20) : ""} — ${s.pnl20 >= 5 ? "이익 중이라 급하게 되살 이유가 약하다" : "본전 근처"}` : `최근 20일 공매도 평균가 ${s.a20 ? fmtWon(s.a20) : ""} — 손해라 되사기 압박이 생기는 쪽`,
      why: s.pnl20 >= 5 ? `평균 ${s.a20 ? fmtWon(s.a20) : ""}에 팔아 지금 이익 — 급히 되살 이유 없음` : s.pnl20 >= 0 ? "본전 근처 — 더 오르면 되사기 압박" : "손해 중 — 되사기 압박",
      rule: "최근 20일 공매도 평균가 대비 지금 값 — 공매도 쪽이 5% 넘게 이익이면 중립(급히 되살 이유 약함), 그보다 덜 이익이거나 손해면 완화(되사기 압박)",
      help: "최근 20거래일 동안 공매도한 가격의 평균(수량 가중)과 지금 값을 비교했습니다. 공매도는 비싸게 팔고 싸게 되사야 이익이라, 지금 값이 평균가보다 낮으면 공매도한 쪽이 이익입니다. 이익 중이면 급하게 되살 이유가 적고, 손해로 돌아서면 되사기(숏커버링) 압박이 커집니다." });
  }
  const ord = { fuel: 0, better: 1, worse: 2, flat: 3 } as const;   // 방향이 있는 근거를 위로, 그대로는 아래로
  reasons.sort((x, y) => ord[x.tag] - ord[y.tag]);
  const watch = ss.filter(s => s.toBE != null && s.toBE > 0 && s.toBE <= 10 && s.a5).map(s => `${s.name} ${fmtWon(s.a5!)}(${fmtPct(s.toBE!)})`).join(" · ");
  return { head, sub: subs.join(" "), reasons, watch: watch ? `${watch} — 최근 5일 공매도 본전, 여기까지 오르면 되사기가 나올 수 있는 자리` : "" };
}
