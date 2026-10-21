// 💾 반도체 한눈에 — 현물·선물·옵션 수급과 삼성전자·SK하이닉스 실시간 체결을 **스크롤 없이 한 화면**에(2026-10-21 사용자 요청).
//   "실시간으로 어떻게 들어오는지 보면서 매수/매도 타이밍을 잡고 싶다" — 그래서 가운데가 **종목 체결 흐름**(5초)이다.
//   갱신 주기·지연이 소스마다 달라 칸마다 적어 둔다:
//     · 종목 체결(토스 ticks) 5초 — 화면을 켠 동안만 쌓인다(과거 체결 API 없음)
//     · 코스피 투자자(네이버) 1분 / 선물 투자자(네이버) **20분 지연** / 선물 시세·옵션(한경) 실시간
//   시세 카드는 지수 탭과 같은 쿼리키(yahoo-batch)라 캐시를 나눠 쓴다.
//   신호 줄은 **숫자로 확인되는 사실만** — 매수·매도 추천 문장은 쓰지 않는다.
import { useState } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import {
  fetchYahooBatch, fetchYahooSparkDay, fetchKrIntradayInvestorFlow, fetchKrDailyInvestorFlow, fetchInvestorHistory,
  fetchKrFuturesLive, fetchKrFuturesMinute, fetchDashboardChart, fetchTossDayStrength, fetchKospi200OptionSummary, fetchHlXyzPerps,
  type UsIndex, type IntradayFlow, type HlPerp, type DayStrength, type DaySeries,
} from "../lib/api";
import type { Investor } from "../types";
import { allYahooSymbols } from "../lib/usMarketData";
import { useAdaptiveRefreshMs } from "../lib/proxyStatus";
import { useTickFlow, strength, netAmt, BIG_TRADE_WON, type TickFlow } from "../lib/useTickFlow";
import { Sparkline } from "./Sparkline";
import { KrDaySparkline } from "./KrDaySparkline";

const STOCKS = [{ code: "005930", name: "삼성전자" }, { code: "000660", name: "SK하이닉스" }] as const;
const SPARK = ["^KS11", "^KQ11", "^SOX"];   // 야후 spark 1콜(어제+오늘 5분봉)
const FLOW_MS = 60_000;
const US_ROW = ["MU", "NVDA", "SKHY", "SNDK", "AMD", "DRAM"];
const MEM_ROW = ["DRAMIDX=ML", "DDR5=ML", "DDR4=ML", "NAND=ML"];
const PERPS = [["SKHY", "하이닉스"], ["SMSN", "삼성"], ["MU", "마이크론"], ["NVDA", "엔비디아"], ["TSM", "TSMC"], ["KR200", "코스피200"]] as const;

const upColor = (v: number) => (v > 0 ? "text-rose-600" : v < 0 ? "text-blue-600" : "text-gray-500");
const up = upColor;
const sgn = (v: number, d = 2) => `${v > 0 ? "+" : ""}${v.toFixed(d)}`;
const fmtP = (v: number) => (v >= 1000 ? Math.round(v).toLocaleString() : v >= 100 ? v.toFixed(1) : v.toFixed(2));
const eok = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v).toLocaleString()}`;
// 순매수 금액을 말로 — "순매수 −29억" 을 매수로 읽는 일이 있어(사용자 혼동 2026-10-21) 음수면 '순매도'로 쓴다
const netWord = (won: number) => `${won >= 0 ? "순매수" : "순매도"} ${Math.abs(Math.round(won / 1e8)).toLocaleString()}억`;
const sideWord = (st: number) => (st >= 120 ? "매수 우위" : st <= 80 ? "매도 우위" : "팽팽");

export function SemiDashTab() {
  const yahooSymbols = allYahooSymbols();
  const REFRESH_MS = useAdaptiveRefreshMs(5_000);
  const { data: quotes } = useQuery({
    queryKey: ["yahoo-batch", yahooSymbols.length],   // 지수 탭과 같은 키 — 캐시 공유
    queryFn: () => fetchYahooBatch(yahooSymbols),
    refetchInterval: REFRESH_MS,
  });
  const q = (s: string) => quotes?.get(s);
  const { data: spark } = useQuery({
    queryKey: ["semi-dash-spark"], queryFn: () => fetchYahooSparkDay(SPARK),
    refetchInterval: 5 * 60_000, staleTime: 4 * 60_000, refetchOnWindowFocus: false,
  });
  const { data: fut } = useQuery({
    queryKey: ["hk-futures-live", "kospi200"], queryFn: () => fetchKrFuturesLive("kospi200"), refetchInterval: 10_000, staleTime: 5_000,
  });
  const { data: futMin } = useQuery({
    queryKey: ["hk-futures-min", "kospi200"], queryFn: () => fetchKrFuturesMinute("kospi200"), refetchInterval: FLOW_MS, staleTime: 30_000,
  });
  // 코스닥150 선물 — 사용자 요청(2026-10-21). 같은 한경 소스(실시간 시세 + 1분봉 어제+오늘)
  const { data: futQ } = useQuery({
    queryKey: ["hk-futures-live", "kosdaq150"], queryFn: () => fetchKrFuturesLive("kosdaq150"), refetchInterval: 10_000, staleTime: 5_000,
  });
  const { data: futQMin } = useQuery({
    queryKey: ["hk-futures-min", "kosdaq150"], queryFn: () => fetchKrFuturesMinute("kosdaq150"), refetchInterval: FLOW_MS, staleTime: 30_000,
  });
  // V-KOSPI 일봉 — CNBC 는 분봉이 없다(1D·5D 빈 응답, 2026-10-21 실측). 지수 탭과 같은 쿼리키(캐시 공유)
  const { data: vkChart } = useQuery({
    queryKey: ["yahoo-chart", "VKOSPI", "3mo"], queryFn: () => fetchDashboardChart("VKOSPI"),
    staleTime: 60 * 60 * 1000, refetchOnWindowFocus: false,
  });
  const ks200 = fut?.price ?? 0;
  const { data: opt } = useQuery({
    queryKey: ["hk-option-summary", Math.round(ks200 / 2.5)], queryFn: () => fetchKospi200OptionSummary(ks200),
    enabled: ks200 > 0, refetchInterval: FLOW_MS, staleTime: 30_000, placeholderData: p => p,
  });
  const { data: perps } = useQuery({
    queryKey: ["hl-xyz-perps"], queryFn: fetchHlXyzPerps, refetchInterval: useAdaptiveRefreshMs(15_000), staleTime: 5_000,
  });
  const [kospiFlow, futFlow, kosdaqFlow] = useQueries({
    queries: (["kospi", "futures", "kosdaq"] as const).map(m => ({
      queryKey: ["semi-dash-flow", m], queryFn: () => fetchKrIntradayInvestorFlow(m),
      refetchInterval: FLOW_MS, staleTime: 30_000,
    })),
  });
  const [{ data: kospiDaily }, { data: kosdaqDaily }] = useQueries({
    queries: (["kospi", "kosdaq"] as const).map(m => ({
      queryKey: ["semi-dash-daily", m], queryFn: () => fetchKrDailyInvestorFlow(m, 20),
      staleTime: 10 * 60_000, refetchOnWindowFocus: false,
    })),
  });
  const stockInv = useQueries({
    queries: STOCKS.map(s => ({
      queryKey: ["semi-dash-inv", s.code], queryFn: () => fetchInvestorHistory(s.code, 20),
      refetchInterval: 5 * 60_000, staleTime: 60_000,
    })),
  });
  const ticks = [useTickFlow(STOCKS[0].code), useTickFlow(STOCKS[1].code)];
  const { data: dayStr } = useQuery({
    queryKey: ["toss-day-strength", STOCKS.map(s => s.code).join(",")],
    queryFn: () => fetchTossDayStrength(STOCKS.map(s => s.code)),
    refetchInterval: 10_000, staleTime: 5_000,
  });

  const kf = kospiFlow.data, ff = futFlow.data;
  const kLast = kf?.points[kf.points.length - 1], fLast = ff?.points[ff.points.length - 1];
  // 코스피 외국인 최근 5분 변화(속도) — 1분 단위 누적이라 5행 전과의 차
  const k5 = kf && kf.points.length > 5 ? kLast!.foreigners - kf.points[kf.points.length - 6].foreigners : undefined;
  const sox = q("^SOX"), soxF = q("SOX=F"), vk = q("VKOSPI");

  // ── 신호(숫자로 확인되는 것만) ──
  // d = 그 줄 아래 회색 설명(사용자 요청 — 숫자만으론 뜻을 모른다)
  const sig: { t: string; c: string; d?: string }[] = [];
  STOCKS.forEach((s, i) => {
    const ms = ticks[i].minutes;
    const st5 = strength(ms, 5), n5 = netAmt(ms, 5);
    if (st5 != null && ms.length >= 3) {
      sig.push({ t: `${s.name} 5분 ${sideWord(st5)} — 체결강도 ${st5.toFixed(0)} · ${netWord(n5)}`, c: st5 >= 120 ? "text-rose-600" : st5 <= 80 ? "text-blue-600" : "text-gray-700",
        d: `최근 5분 시장가로 사고 들어온 양이 팔고 나간 양의 ${(st5 / 100).toFixed(1)}배${st5 >= 100 ? " — 사는 쪽이 급하다" : " — 파는 쪽이 급하다"}. 120↑ 매수 우위 · 80↓ 매도 우위.` });
      const p0 = ms[Math.max(0, ms.length - 6)].close, p1 = ms[ms.length - 1].close;
      if (p1 > p0 && n5 < 0) sig.push({ t: `${s.name} 가격↑ 인데 체결은 매도 우위 (엇갈림)`, c: "text-amber-600", d: "오르는데 파는 체결이 더 많다 — 오름세 힘이 빠지는 신호일 수 있다." });
      if (p1 < p0 && n5 > 0) sig.push({ t: `${s.name} 가격↓ 인데 체결은 매수 우위 (엇갈림)`, c: "text-amber-600", d: "내리는데 사는 체결이 더 많다 — 저가 매수가 받치는 중일 수 있다." });
    }
  });
  if (k5 != null) sig.push({ t: `코스피 외국인 5분간 ${eok(k5)}억 (누적 ${eok(kLast!.foreigners)}억)`, c: up(k5),
    d: Math.sign(k5) === Math.sign(kLast!.foreigners) || k5 === 0
      ? `외국인이 지금도 ${kLast!.foreigners >= 0 ? "사는" : "파는"} 중 — 오늘 누적 ${kLast!.foreigners >= 0 ? "매수" : "매도"}세가 최근 5분에도 이어진다.`
      : `오늘 누적은 ${kLast!.foreigners >= 0 ? "매수" : "매도"}인데 최근 5분은 ${k5 > 0 ? "매수" : "매도"} — 외국인이 방향을 트는지 지켜볼 구간.` });
  if (fut) {
    const oiUp = fut.oiChg > 0;
    sig.push({
      t: `선물 ${sgn(fut.pct)}% · 미결제 ${eok(fut.oiChg)}계약 → ${fut.chg >= 0 ? (oiUp ? "상승+미결제 증가(신규 매수 유입)" : "상승+미결제 감소(숏 청산)") : (oiUp ? "하락+미결제 증가(신규 매도 유입)" : "하락+미결제 감소(매수 청산)")}`,
      c: up(fut.chg),
      // 지금 값으로 풀어 쓴다(사용자 요청) — 가격 방향 × 미결제 증감 네 경우
      d: (() => {
        const n = Math.abs(fut.oiChg).toLocaleString(), pc = `${sgn(fut.pct)}%`;
        if (fut.chg >= 0 && oiUp) return `선물이 ${pc} 오르면서 미결제도 ${n}계약 늘었다 → 새로 사는 돈(신규 매수)이 들어와 오름세를 밀고 있다.`;
        if (fut.chg >= 0) return `선물이 ${pc} 올랐는데 미결제는 ${n}계약 줄었다 → 새로 사는 돈보다 팔아 뒀던 계약을 되사서 정리(숏 청산)하며 오른 것. 새 매수가 붙지 않으면 오름세가 오래 못 갈 수 있다.`;
        if (oiUp) return `선물이 ${pc} 내리면서 미결제가 ${n}계약 늘었다 → 새로 파는 돈(신규 매도)이 들어와 내림세를 밀고 있다.`;
        return `선물이 ${pc} 내렸는데 미결제는 ${n}계약 줄었다 → 새 매도 공세보다 사 뒀던 계약을 정리(매수 청산)하며 내린 것.`;
      })(),
    });
  }
  if (opt && opt.callVol > 0) {
    const pcr = opt.putVol / opt.callVol;
    sig.push({ t: `옵션 풋/콜 거래량 ${pcr.toFixed(2)} ${pcr >= 1.2 ? "(풋 쏠림 — 하락 대비↑)" : pcr <= 0.8 ? "(콜 쏠림)" : ""}`, c: pcr >= 1.2 ? "text-blue-600" : pcr <= 0.8 ? "text-rose-600" : "text-gray-700",
      // 지금 값으로 풀어 쓴다(사용자 요청) — 비율 구간 + 오늘 미결제 증감
      d: (() => {
        const ratio = `지금 콜 100계약당 풋 ${Math.round(pcr * 100)}계약`;
        const read = pcr <= 0.6 ? "콜이 압도적 → 상승에 거는 쪽이 크게 우세. 이만큼 쏠리면 낙관 과열로도 본다."
          : pcr <= 0.8 ? "콜이 훨씬 많다 → 상승에 거는 쪽이 우세."
          : pcr < 1 ? "콜이 조금 더 많다 → 약간 상승 기대, 균형 범위."
          : pcr < 1.2 ? "풋이 조금 더 많다 → 하락 대비(보험)가 약간 우세하지만 균형 범위."
          : pcr < 1.5 ? "풋이 훨씬 많다 → 하락 대비 수요가 커졌다."
          : "풋이 압도적 → 공포 구간. 이만큼 치솟으면 공포의 끝(반등 신호)으로 거꾸로 보기도 한다.";
        const oi = `오늘 미결제는 콜 ${eok(opt.callOiChg)} · 풋 ${eok(opt.putOiChg)}계약`
          + (opt.putOiChg < 0 && opt.callOiChg >= 0 ? " → 하락 보험을 풀고 상승 쪽 포지션을 쌓는 중."
            : opt.putOiChg > 0 && opt.callOiChg <= 0 ? " → 하락 보험을 새로 사들이는 중."
            : opt.putOiChg > 0 && opt.callOiChg > 0 ? " → 양쪽 다 새 계약 — 큰 움직임에 대비."
            : " → 양쪽 다 정리 중.");
        return `${ratio}. ${read} ${oi} (근월물·현재가 근처 합산)`;
      })() });
  }

  return (
    <div className="flex flex-col gap-1.5 p-2 lg:h-[calc(100vh-150px)] lg:min-h-[700px] text-[12px] bg-gray-50">
      {/* ① 시세 */}
      <div className="grid grid-cols-2 lg:grid-cols-8 gap-1.5 auto-rows-[118px] shrink-0">
        {STOCKS.map(s => {
          const qq = q(`${s.code}.KS`);
          return <Card key={s.code} title={s.name} price={qq?.price} pct={qq?.pct} unit="원"
                       chart={<KrDaySparkline code={s.code} fallback={[]} live={qq?.price} width={300} height={70} className="w-full h-full" />} />;
        })}
        <Card title="코스피" price={q("^KS11")?.price} pct={q("^KS11")?.pct}
              chart={spark?.get("^KS11") && <SparkBg sp={spark.get("^KS11")!} base={q("^KS11")?.prevClose} />} />
        {/* 코스닥 — 사용자 요청(2026-10-21). 기준선은 카드 전일 종가(야후 ^KQ11 previousClose 가 그저께 값일 때가 있다) */}
        <Card title="코스닥" price={q("^KQ11")?.price} pct={q("^KQ11")?.pct}
              chart={spark?.get("^KQ11") && <SparkBg sp={spark.get("^KQ11")!} base={q("^KQ11")?.prevClose} />} />
        <Card title={`코스피200 선물${fut?.month ? ` ${fut.month}` : ""}`} price={fut?.price} pct={fut?.pct}
              sub={fut ? `미결제 ${fut.oi.toLocaleString()}(${eok(fut.oiChg)}) · 베이시스 ${fut.basis.toFixed(2)}` : "한경 실시간"}
              chart={futMin && futMin.closes.length > 1 && <FutSpark s={futMin} live={fut?.price} />} />
        <Card title={`코스닥150 선물${futQ?.month ? ` ${futQ.month}` : ""}`} price={futQ?.price} pct={futQ?.pct}
              sub={futQ ? `미결제 ${futQ.oi.toLocaleString()}(${eok(futQ.oiChg)})` : "한경 실시간"}
              chart={futQMin && futQMin.closes.length > 1 && <FutSpark s={futQMin} live={futQ?.price} />} />
        <Card title="V-KOSPI" price={vk?.price} pct={vk?.pct} inverse
              sub={vk ? `${vk.price >= 30 ? "공포" : vk.price >= 20 ? "경계" : "안정"} · 20↑ 경계 30↑ 공포 · 그래프 일봉` : undefined}
              chart={vkChart && vkChart.length > 1 && <Sparkline data={vkChart.slice(-60)} width={300} height={70} className="w-full h-full" strokeWidth={1.2}
                                                               color={vk && vk.pct > 0 ? "#2563eb" : "#dc2626"} />} />
        <Card title="필라델피아 반도체" price={sox?.price} pct={sox?.regularPct ?? sox?.pct}
              sub={soxF ? `선물 ${fmtP(soxF.price)} (${sgn(soxF.pct)}%)` : undefined}
              chart={spark?.get("^SOX") && <SparkBg sp={spark.get("^SOX")!} />} />
      </div>

      {/* ② 실시간 체결 + 신호 */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_440px] gap-1.5 lg:flex-1 min-h-0 auto-rows-[320px] lg:auto-rows-auto">
        {STOCKS.map((s, i) => <TickPanel key={s.code} name={s.name} flow={ticks[i]} day={dayStr?.get(s.code)} />)}
        <div className="rounded-lg border border-gray-200 bg-white p-2 flex flex-col min-h-0 overflow-hidden">
          <div className="font-bold text-gray-800 mb-1">지금 신호 <span className="font-normal text-[11px] text-gray-400">숫자로 확인되는 것만</span></div>
          <div className="space-y-1 overflow-auto">
            {sig.length ? sig.map((n, i) => (
              <div key={i} className="leading-snug">
                <div className={`font-semibold ${n.c}`}>• {n.t}</div>
                {n.d && <div className="pl-2.5 text-[11px] text-gray-500">{n.d}</div>}
              </div>))
              : <div className="text-gray-400">체결을 모으는 중… (1~2분)</div>}
          </div>
          <div className="mt-auto pt-2 border-t text-[11px] text-gray-500 leading-snug">
            체결강도 = 매수 체결량 ÷ 매도 체결량 × 100 (100 위 = 사는 쪽 우위). 큰 체결 = {BIG_TRADE_WON / 1e8}억 원 이상.
          </div>
        </div>
      </div>

      {/* ③ 현물·선물·옵션 수급 */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_1fr_1fr_1.1fr] gap-1.5 auto-rows-[200px] shrink-0">
        {/* 코스피·코스닥 현물을 나란히(전환 버튼 없이 바로 — 사용자 요청) */}
        <FlowBox title="현물 · 코스피" note="1분" flow={kf} unit="억" />
        <FlowBox title="현물 · 코스닥" note="1분" flow={kosdaqFlow.data} unit="억" />
        <FlowBox title="선물 · 코스피200" note="20분 지연(코스닥150 선물 수급은 소스 없음)" flow={ff} unit="계약" />
        <OptionBox opt={opt} vk={vk} />
        <StockFlowTable rows={STOCKS.map((s, i) => ({ ...s, hist: stockInv[i].data ?? [], price: q(`${s.code}.KS`)?.price }))}
                        fLast={fLast}
                        markets={[
                          { name: "코스피", last: kLast, daily: kospiDaily?.points ?? [] },
                          { name: "코스닥", last: kosdaqFlow.data?.points[kosdaqFlow.data.points.length - 1], daily: kosdaqDaily?.points ?? [] },
                        ]} />
      </div>

      {/* ④ 해외 선물·현물·미국 반도체 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-1.5 shrink-0">
        <ChipBox title="해외 선물 (24h)" items={[
          ...(["SOX=F", "NQ=F"].map(s => q(s)).filter((x): x is UsIndex => !!x).map(x => ({ k: x.symbol, name: x.symbol === "SOX=F" ? "SOX선물" : "나스닥선물", pct: x.pct }))),
          ...PERPS.map(([c, n]) => ({ k: c, name: n, pct: (perps?.get(c) as HlPerp | undefined)?.changePct })),
        ]} />
        <ChipBox title="메모리 현물" items={MEM_ROW.map(s => q(s)).filter((x): x is UsIndex => !!x).map(x => ({ k: x.symbol, name: x.name.replace(/\(.*\)/, ""), pct: x.pct }))} />
        <ChipBox title="미국 반도체 (간밤)" items={US_ROW.map(s => q(s)).filter((x): x is UsIndex => !!x).map(x => ({ k: x.symbol, name: x.name.replace(/\(.*\)/, ""), pct: x.regularPct ?? x.pct }))} />
      </div>
    </div>
  );
}

function Card({ title, price, pct, sub, chart, unit, inverse }: {
  title: string; price?: number; pct?: number; sub?: string; chart?: React.ReactNode; unit?: string;
  inverse?: boolean;   // 공포지수처럼 오르면 나쁜 것 — 색을 뒤집는다(지수 탭 direction=inverse 와 같은 규칙)
}) {
  const up = (v: number) => upColor(inverse ? -v : v);
  return (
    <div className="relative rounded-lg border border-gray-200 bg-white overflow-hidden">
      <div className="absolute inset-x-0 bottom-0 top-[40%] pointer-events-none">{chart}</div>
      <div className="relative px-2 pt-1.5">
        <div className="font-bold text-gray-800 truncate">{title}</div>
        <div className="flex items-baseline gap-1.5">
          {/* % 가 주인공(사용자 요청) — 크게, 가격은 옆에 작게 */}
          <span className={`text-[22px] leading-tight font-extrabold tabular-nums ${up(pct ?? 0)}`}>{pct != null ? `${sgn(pct)}%` : "-"}</span>
          <span className={`text-[12px] font-semibold tabular-nums ${up(pct ?? 0)}`}>{price != null ? fmtP(price) : "-"}{unit && price != null ? <span className="text-[10px]">{unit}</span> : null}</span>
        </div>
        {sub && <div className="text-[10.5px] text-gray-500 tabular-nums leading-tight">{sub}</div>}
      </div>
    </div>
  );
}

// 선물 1분봉(한경) 어제+오늘 + 끝에 지금 가격
function FutSpark({ s, live }: { s: DaySeries; live?: number }) {
  const on = !!live && !!s.xs;
  return <Sparkline data={on ? [...s.closes, live!] : s.closes} xs={on ? [...s.xs!, s.xs![s.xs!.length - 1] + 0.001] : s.xs}
                    width={300} height={70} className="w-full h-full" strokeWidth={1.2}
                    baseline={s.base} prevBaseline={s.prevBase} markIndex={s.openIdx} breakIndex={s.breakIdx} />;
}

// base = 카드의 전일 종가(한국 지수는 야후 previousClose 가 틀릴 때가 있어 카드 값을 우선)
function SparkBg({ sp, base }: { sp: { closes: number[]; openIdx?: number; prevClose?: number; breakIdx?: number; prevBase?: number }; base?: number }) {
  return <Sparkline data={sp.closes} width={300} height={70} className="w-full h-full" strokeWidth={1.2}
                    baseline={base && base > 0 ? base : sp.prevClose} markIndex={sp.openIdx} breakIndex={sp.breakIdx} prevBaseline={sp.prevBase} />;
}

// 종목 실시간 체결 — 1분 막대(순매수 체결 금액, 위 빨강·아래 파랑) + 가격 선(회색) + 누적 순매수 선(주황)
function TickPanel({ name, flow, day }: { name: string; flow: TickFlow; day?: DayStrength }) {
  const ms = flow.minutes.slice(-90);   // 최근 90분
  const W = 600, H = 220, PAD = 4;
  const nets = ms.map(m => m.buyAmt - m.sellAmt);
  const mxBar = Math.max(1, ...nets.map(Math.abs));
  let acc = 0;
  const cum = nets.map(v => (acc += v));
  const mxCum = Math.max(1, ...cum.map(Math.abs));
  const prices = ms.map(m => m.close);
  // 가격 축은 최소 ±0.2% 폭 — 켠 직후 한 호가(0.1%)만 움직여도 위아래 끝까지 그어져 세로선처럼 보였다
  const pMid = (Math.min(...prices) + Math.max(...prices)) / 2;
  const pR = Math.max(Math.max(...prices) - Math.min(...prices), pMid * 0.004) * 1.1, pMin = pMid - pR / 2;
  const bw = (W - PAD * 2) / Math.max(30, ms.length);
  const xOf = (i: number) => PAD + i * bw + bw / 2;
  const mid = H / 2;
  const st1 = strength(ms, 1), st5 = strength(ms, 5), stAll = strength(ms);
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-2 flex flex-col min-h-0">
      <div className="flex items-baseline gap-2">
        <span className="font-bold text-gray-800">{name} 실시간 체결</span>
        <span className="text-[11px] text-gray-400">{flow.since ? `${flow.since.slice(0, 5)}부터 · ${flow.last}` : "모으는 중…"}{flow.gaps ? ` · 빈 구간 ${flow.gaps}` : ""}{flow.error ? ` · ⚠️ ${flow.error}` : ""}</span>
      </div>
      <div className="flex gap-3 tabular-nums my-1">
        <Stat label="체결강도 1분" v={st1} />
        <Stat label="5분" v={st5} />
        <Stat label="켠 뒤 전체" v={stAll} />
        <span className="ml-auto">5분 <b className={up(netAmt(ms, 5))}>{netWord(netAmt(ms, 5))}</b> · 켠 뒤 <b className={up(netAmt(ms))}>{netWord(netAmt(ms))}</b></span>
      </div>
      {/* 오늘 하루 전체 — 토스 체결강도(장 시작부터 누적)로 역산. 켜기 전 구간까지 포함된 유일한 값 */}
      {day && (
        <div className="flex gap-3 tabular-nums -mt-0.5 mb-1 text-[11.5px]">
          <span className="text-gray-500">오늘 전체 체결강도 <b className={day.strength >= 100 ? "text-rose-600" : "text-blue-600"}>{day.strength.toFixed(0)}</b></span>
          <span className="text-gray-500">오늘 전체 <b className={up(day.netAmt)}>{netWord(day.netAmt)}</b> <span className="text-[10px] text-gray-400">(체결강도·거래대금 {Math.round(day.value / 1e8).toLocaleString()}억 역산)</span></span>
        </div>
      )}
      <div className="flex-1 min-h-0 flex gap-2">
        <div className="flex-1 min-w-0">
          {ms.length < 1 ? <div className="h-full flex items-center justify-center text-gray-400">체결을 모으는 중…</div> : (<div className="relative w-full h-full">
            {ms.length < 5 && <div className="absolute inset-x-0 bottom-1 text-center text-[11px] text-gray-400">켠 뒤 {ms.length}분째 — 10분쯤 지나면 흐름이 보입니다</div>}
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-full">
              <line x1={0} x2={W} y1={mid} y2={mid} stroke="#cbd5e1" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
              {nets.map((v, i) => {
                const h = (Math.abs(v) / mxBar) * (mid - PAD);
                return <rect key={i} x={xOf(i) - bw * 0.4} width={bw * 0.8} y={v >= 0 ? mid - h : mid} height={Math.max(0.5, h)} fill={v >= 0 ? "#f43f5e" : "#3b82f6"} opacity={0.75} />;
              })}
              <path d={prices.map((p, i) => `${i ? "L" : "M"} ${xOf(i)} ${PAD + (1 - (p - pMin) / pR) * (H - PAD * 2)}`).join(" ")}
                    fill="none" stroke="#334155" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
              <path d={cum.map((c, i) => `${i ? "L" : "M"} ${xOf(i)} ${mid - (c / mxCum) * (mid - PAD)}`).join(" ")}
                    fill="none" stroke="#ea580c" strokeWidth={2.2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />

              {ms.map((m, i) => (m.t.endsWith("0") && i % 10 === 0 ? <text key={m.t} x={xOf(i)} y={H - 2} fontSize="11" fill="#9ca3af">{m.t}</text> : null))}
            </svg>
            {/* 누적 끝값 — 막대(1분)와 축이 달라 선만으론 크기를 모른다. svg 가 늘어나므로 글자는 HTML 로 */}
            {cum.length > 0 && (() => {
              const lx = (xOf(cum.length - 1) / W) * 100, ly = ((mid - (cum[cum.length - 1] / mxCum) * (mid - PAD)) / H) * 100;
              return (
                <div className="absolute pointer-events-none flex items-center gap-1" style={{ left: `${Math.min(lx, 70)}%`, top: `${Math.max(4, Math.min(92, ly))}%`, transform: "translateY(-50%)" }}>
                  <span className="w-2 h-2 rounded-full bg-orange-600 shrink-0" style={{ marginLeft: lx > 70 ? 0 : -4 }} />
                  <span className="text-[11px] font-bold text-orange-600 bg-white/80 px-0.5 rounded whitespace-nowrap">누적 {netWord(cum[cum.length - 1])}</span>
                </div>
              );
            })()}
          </div>
          )}
        </div>
        <div className="w-[118px] shrink-0 overflow-hidden text-[11px] tabular-nums">
          <div className="text-gray-500 mb-0.5">큰 체결 ({BIG_TRADE_WON / 1e8}억↑)</div>
          {flow.big.slice(0, 12).map((b, i) => (
            <div key={i} className={`flex justify-between ${b.side === "BUY" ? "text-rose-600" : "text-blue-600"}`}>
              <span>{b.time}</span><b>{b.side === "BUY" ? "+" : "-"}{(b.amt / 1e8).toFixed(1)}억</b>
            </div>
          ))}
        </div>
      </div>
      <div className="flex gap-3 text-[10.5px] text-gray-500 mt-0.5">
        <span><i className="inline-block w-2 h-2 bg-rose-500 mr-0.5" />1분 순매수</span>
        <span><i className="inline-block w-2 h-2 bg-blue-500 mr-0.5" />1분 순매도</span>
        <span><i className="inline-block w-3 h-0.5 bg-slate-700 mr-0.5 align-middle" />가격</span>
        <span><i className="inline-block w-4 mr-0.5 align-middle border-t-2 border-dashed border-orange-600" />누적 순매수(켠 뒤 합계 · 축 별도)</span>
      </div>
    </div>
  );
}
function Stat({ label, v }: { label: string; v?: number }) {
  return <span className="text-gray-500">{label} <b className={v == null ? "text-gray-300" : v >= 100 ? "text-rose-600" : "text-blue-600"}>{v == null ? "-" : v.toFixed(0)}</b></span>;
}

// 시장 투자자 시간별 누적 — 외국인·기관(금투 제외)·개인
const LINES = [
  { k: "foreigners", label: "외국인", color: "#ea580c" },
  { k: "inst", label: "기관", color: "#2563eb" },
  { k: "individuals", label: "개인", color: "#7c3aed" },
] as const;
function FlowBox({ title, note, flow, unit, tabs, tab, onTab }: {
  title: string; note: string; flow?: IntradayFlow; unit: string;
  tabs?: [string, string][]; tab?: string; onTab?: (k: string) => void;   // 코스피/코스닥 전환(현물 칸)
}) {
  const pts = flow?.points ?? [];
  const val = (p: IntradayFlow["points"][number], k: (typeof LINES)[number]["k"]) =>
    k === "inst" ? p.institutions - (unit === "억" ? p.financialInvestment : 0) : p[k];
  const W = 400, H = 140, PX = 2, PY = 6;
  const tmin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const mx = Math.max(1, ...pts.flatMap(p => LINES.map(l => Math.abs(val(p, l.k)))));
  const x = (t: string) => PX + Math.min(1, Math.max(0, (tmin(t) - 9 * 60) / 390)) * (W - PX * 2);
  const y = (v: number) => H / 2 - (v / mx) * (H / 2 - PY);
  const last = pts[pts.length - 1];
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-2 flex flex-col min-h-0">
      <div className="flex items-baseline gap-2">
        <span className="font-bold text-gray-800 shrink-0">{title}</span>
        <span className="text-[11px] text-gray-400 truncate">{note}{last ? ` · ${last.time}` : ""} · {unit}{unit === "억" ? " · 기관=금투 제외" : ""}</span>
        {tabs && (
          <span className="ml-auto shrink-0 inline-flex rounded border border-gray-300 overflow-hidden text-[10.5px]">
            {tabs.map(([k, l]) => (
              <button key={k} onClick={() => onTab?.(k)}
                      className={`px-1.5 ${k === tab ? "bg-gray-700 text-white" : "text-gray-500 hover:bg-gray-100"}`}>{l}</button>
            ))}
          </span>
        )}
      </div>
      <div className="flex gap-2.5 tabular-nums">
        {LINES.map(l => (
          <span key={l.k}><i className="inline-block w-2 h-0.5 mr-0.5 align-middle" style={{ background: l.color }} />{l.label} <b className={last ? up(val(last, l.k)) : "text-gray-300"}>{last ? eok(val(last, l.k)) : "-"}</b></span>
        ))}
      </div>
      <div className="flex-1 min-h-0">
        {pts.length < 2 ? <div className="h-full flex items-center justify-center text-gray-400">{flow ? "장 시작 전" : "불러오는 중…"}</div> : (
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-full">
            <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="#94a3b8" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
            {["10:00", "12:00", "14:00"].map(t => <line key={t} x1={x(t)} x2={x(t)} y1={0} y2={H} stroke="#eef2f7" vectorEffect="non-scaling-stroke" />)}
            {LINES.map(l => (
              <path key={l.k} d={pts.map((p, i) => `${i ? "L" : "M"} ${x(p.time).toFixed(1)} ${y(val(p, l.k)).toFixed(1)}`).join(" ")}
                    fill="none" stroke={l.color} strokeWidth={1.8} vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
        )}
      </div>
    </div>
  );
}

// 풋/콜 비율 → 한 단어(0.8 이하 콜 쏠림 · 1.2 이상 풋 쏠림)
const pcrWord = (v?: number) => (v == null ? "" : v <= 0.8 ? "콜 쏠림" : v >= 1.2 ? "풋 쏠림" : "균형");
// 옵션 칸 '읽는 법' — 사용자 요청(2026-10-21). 칸이 작아 버튼을 누르면 칸 위에 겹쳐 펼친다.
const OPTION_GUIDE: [string, string][] = [
  ["콜·풋", "콜 = 정해진 값에 살 권리(오른다에 건다) · 풋 = 팔 권리(내린다에 걸거나 하락 보험)."],
  ["풋/콜 거래량", "풋 거래량 ÷ 콜 거래량. 0.71 = 콜 100계약 거래될 때 풋 71계약. 0.8 이하 콜 쏠림(상승 기대 우세) · 1.2 이상 풋 쏠림(하락 대비↑)."],
  ["거꾸로도 읽는다", "한쪽으로 너무 쏠리면 과열·공포의 끝으로 보기도 한다 — 방향 신호보다 분위기 온도계."],
  ["풋/콜 미결제", "아직 청산 안 된 계약 기준 — 오늘 거래량보다 느리게, 쌓인 포지션을 보여 준다."],
  ["미결제 증감", "전일 대비 미결제 변화. 콜↑ = 상승 쪽 새 포지션, 풋↑ = 하락 대비 새 포지션."],
  ["미결제 최대", "콜 미결제가 가장 많은 행사가는 위쪽 저항, 풋은 아래쪽 지지로 흔히 본다(만기 무렵 그 값 근처로 끌리기도)."],
  ["V-KOSPI", "옵션 가격으로 계산한 공포지수. 오르면 하락 보험 수요↑. 20↑ 경계 · 30↑ 공포."],
  ["한계", "근월물·현재가 ±37pt 행사가만 합산(주간 옵션 제외) · 누가 샀는지(외국인·개인)는 모른다."],
];
function OptionBox({ opt, vk }: { opt?: Awaited<ReturnType<typeof fetchKospi200OptionSummary>>; vk?: UsIndex }) {
  const [guide, setGuide] = useState(false);
  const pcr = opt && opt.callVol > 0 ? opt.putVol / opt.callVol : undefined;
  const pcrOi = opt && opt.callOi > 0 ? opt.putOi / opt.callOi : undefined;
  const tag = (t: string) => <span className="font-normal text-[10px] text-gray-400 ml-1">{t}</span>;
  return (
    <div className="relative rounded-lg border border-gray-200 bg-white p-2 flex flex-col min-h-0 tabular-nums">
      <div className="flex items-baseline gap-2">
        <span className="font-bold text-gray-800 shrink-0 whitespace-nowrap">옵션 · 코스피200</span>
        <span className="text-[11px] text-gray-400 truncate">{opt ? `${opt.month.slice(4, 6)}/${opt.month.slice(6)} 만기 · ${opt.time.slice(0, 5)}` : "한경 실시간"}</span>
        <button onClick={() => setGuide(g => !g)}
                className={`ml-auto shrink-0 px-1.5 rounded border text-[10.5px] ${guide ? "bg-gray-700 text-white border-gray-700" : "text-gray-500 border-gray-300 hover:bg-gray-100"}`}>
          {guide ? "닫기" : "읽는 법"}
        </button>
      </div>
      {!opt ? <div className="flex-1 flex items-center justify-center text-gray-400">불러오는 중…</div> : (
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 mt-1 text-[11.5px]">
          <span className="text-gray-500">풋/콜 거래량</span><b className={pcr != null && pcr >= 1 ? "text-blue-600" : "text-rose-600"}>{pcr?.toFixed(2) ?? "-"}{tag(pcrWord(pcr))}</b>
          <span className="text-gray-500">풋/콜 미결제</span><b className={pcrOi != null && pcrOi >= 1 ? "text-blue-600" : "text-rose-600"}>{pcrOi?.toFixed(2) ?? "-"}{tag(pcrWord(pcrOi))}</b>
          <span className="text-gray-500">콜 미결제 증감</span><b className={up(opt.callOiChg)}>{eok(opt.callOiChg)}{tag(opt.callOiChg > 0 ? "상승 쪽 새 계약" : opt.callOiChg < 0 ? "상승 쪽 청산" : "")}</b>
          <span className="text-gray-500">풋 미결제 증감</span><b className={up(opt.putOiChg)}>{eok(opt.putOiChg)}{tag(opt.putOiChg > 0 ? "하락 대비 새 계약" : opt.putOiChg < 0 ? "하락 대비 청산" : "")}</b>
          <span className="text-gray-500">콜 미결제 최대</span><b className="text-gray-800">{opt.maxCallOi ?? "-"}{tag("위 저항")}</b>
          <span className="text-gray-500">풋 미결제 최대</span><b className="text-gray-800">{opt.maxPutOi ?? "-"}{tag("아래 지지")}</b>
          <span className="text-gray-500">V-KOSPI</span><b className={vk ? up(vk.pct) : "text-gray-300"}>{vk ? `${vk.price.toFixed(2)} (${sgn(vk.pct)}%)` : "-"}{vk ? tag(vk.price >= 30 ? "공포" : vk.price >= 20 ? "경계" : "안정") : null}</b>
        </div>
      )}
      {opt && <div className="mt-auto text-[10px] text-gray-400 truncate">행사가 {opt.range[0]}~{opt.range[1]} 합계(현재가 근처)</div>}
      {guide && (
        <div className="absolute inset-x-0 top-7 bottom-0 z-10 bg-white rounded-b-lg px-2 pb-2 overflow-auto text-[11px] leading-snug border-t">
          {OPTION_GUIDE.map(([k, v]) => (
            <div key={k} className="mt-1"><b className="text-gray-800">{k}</b> <span className="text-gray-600">{v}</span></div>
          ))}
        </div>
      )}
    </div>
  );
}

function StockFlowTable({ rows, fLast, markets }: {
  rows: { code: string; name: string; hist: Investor[]; price?: number }[];
  fLast?: IntradayFlow["points"][number];
  // 시장 줄(코스피·코스닥) — 오늘은 1분 단위 누적(네이버), 5·20일·연속은 일별
  markets: { name: string; last?: IntradayFlow["points"][number]; daily: { foreigners: number }[] }[];
}) {
  const calc = (hist: Investor[], price?: number) => {
    const won = (r: Investor, v: number) => (v * (r.종가 || price || 0)) / 1e8;
    const today = hist[0];
    const sum = (n: number) => hist.slice(0, n).reduce((a, r) => a + won(r, r.외국인), 0);
    let streak = 0;
    for (const r of hist) { const sg = Math.sign(r.외국인); if (!sg || (streak && Math.sign(streak) !== sg)) break; streak += sg; }
    return { f: today ? won(today, today.외국인) : undefined, i: today ? won(today, today.기관 - today.금융투자) : undefined, f5: sum(5), f20: sum(20), streak };
  };
  const dsum = (daily: { foreigners: number }[], n: number) => daily.slice(-n).reduce((a, p) => a + p.foreigners, 0);
  const dstreak = (daily: { foreigners: number }[]) => {   // 최신부터 외국인 같은 방향 연속 일수
    let st = 0;
    for (const p of [...daily].reverse()) { const sg = Math.sign(p.foreigners); if (!sg || (st && Math.sign(st) !== sg)) break; st += sg; }
    return st;
  };
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-2 flex flex-col min-h-0">
      <div className="flex items-baseline gap-2">
        <span className="font-bold text-gray-800">종목 수급</span>
        <span className="text-[11px] text-gray-400">억원 · 오늘은 KRX 잠정치(하루 몇 번 갱신)</span>
      </div>
      <table className="w-full tabular-nums mt-1">
        <thead><tr className="text-gray-500 text-[11px] border-b">
          <th className="text-left font-normal"></th><th className="text-right font-normal">외국인</th><th className="text-right font-normal">기관</th>
          <th className="text-right font-normal">외인5일</th><th className="text-right font-normal">외인20일</th><th className="text-right font-normal">연속</th>
        </tr></thead>
        <tbody>
          {rows.map(r => {
            const c = calc(r.hist, r.price);
            return (
              <tr key={r.code} className="border-b border-gray-100">
                <td className="py-1 font-bold">{r.name}</td><N v={c.f} /><N v={c.i} /><N v={c.f5} /><N v={c.f20} />
                <td className={`text-right ${up(c.streak)}`}>{c.streak ? `${Math.abs(c.streak)}일${c.streak > 0 ? "↑" : "↓"}` : "-"}</td>
              </tr>
            );
          })}
          {markets.map(m => {
            const st = m.daily.length ? dstreak(m.daily) : 0;
            return (
              <tr key={m.name} className="border-b border-gray-100">
                <td className="py-1 font-bold">{m.name}</td><N v={m.last?.foreigners} /><N v={m.last ? m.last.institutions - m.last.financialInvestment : undefined} />
                <N v={m.daily.length ? dsum(m.daily, 5) : undefined} /><N v={m.daily.length ? dsum(m.daily, 20) : undefined} />
                <td className={`text-right ${up(st)}`}>{st ? `${Math.abs(st)}일${st > 0 ? "↑" : "↓"}` : "-"}</td>
              </tr>
            );
          })}
          <tr>
            <td className="py-1 font-bold">선물<span className="text-[10px] font-normal text-gray-400"> 계약·20분</span></td><N v={fLast?.foreigners} /><N v={fLast?.institutions} /><td /><td /><td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}
function N({ v }: { v?: number }) {
  return <td className={`text-right ${v == null ? "text-gray-300" : up(v)}`}>{v == null ? "-" : eok(v)}</td>;
}

function ChipBox({ title, items }: { title: string; items: { k: string; name: string; pct?: number }[] }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-2 py-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
      <span className="font-bold text-gray-800">{title}</span>
      {items.map(x => (
        <span key={x.k} className="tabular-nums whitespace-nowrap">
          <span className="text-gray-600">{x.name}</span> <b className={x.pct == null ? "text-gray-300" : up(x.pct)}>{x.pct == null ? "-" : `${sgn(x.pct)}%`}</b>
        </span>
      ))}
    </div>
  );
}
