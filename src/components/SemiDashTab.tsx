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
  fetchKrFuturesLive, fetchKrFuturesMinute, fetchTossPrices, fetchYasunNightFutures, fetchDaumIndexToday, fetchDashboardChart, fetchTossDayStrength, fetchKospi200OptionSummary, fetchHlXyzPerps,
  type UsIndex, type IntradayFlow, type HlPerp, type DayStrength, type DaySeries,
} from "../lib/api";
import type { Investor } from "../types";
import { INTRADAY_SERIES, type IntradayKey } from "../lib/intradayInvestor";
import { allYahooSymbols } from "../lib/usMarketData";
import { useAdaptiveRefreshMs } from "../lib/proxyStatus";
import { openStockInfo } from "../lib/tickPopup";
import { OrderBookBox, BrokerBox, ProgramInvestorBox, FeedBox, CommunityPane, useStockLiveSignals } from "./StockPopupRow";
import { useTickFlow, strength, netAmt, bigThreshold, wonStep, type TickFlow } from "../lib/useTickFlow";
import { Sparkline } from "./Sparkline";
import { KrDaySparkline } from "./KrDaySparkline";
import { HypothesisBox } from "./HypothesisBox";
import { BuySellBars, joEok } from "./BuySellBars";

const STOCKS = [{ code: "005930", name: "삼성전자" }, { code: "000660", name: "SK하이닉스" }] as const;
const SPARK = ["^KS11", "^KQ11", "KRW=X", "NQ=F", "SOX=F"];   // 야후 spark 1콜(어제+오늘 5분봉) — 뒤 셋은 종목정보 팝업 위 줄
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

// stocks — 종목 칸. 기본 삼성전자·SK하이닉스. ⚡ 종목 체결 팝업은 같은 화면을 **한 종목**으로 띄운다(사용자 요청 2026-10-22)
export function SemiDashTab({ stocks = STOCKS, popup }: { stocks?: readonly { code: string; name: string }[]; popup?: boolean } = {}) {
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
    queries: stocks.map(s => ({
      queryKey: ["semi-dash-inv", s.code], queryFn: () => fetchInvestorHistory(s.code, 20),
      refetchInterval: 5 * 60_000, staleTime: 60_000,
    })),
  });
  // 훅 개수는 고정(2) — 한 종목이면 두 번째는 꺼 둔다
  const ticks = [useTickFlow(stocks[0].code), useTickFlow(stocks[1]?.code ?? stocks[0].code, !!stocks[1])].slice(0, stocks.length);
  // 종목 시세 — 야후 배치에 없는 종목(팝업으로 연 아무 종목)은 토스 현재가로
  const { data: tossPx } = useQuery({
    queryKey: ["semi-dash-toss-px", stocks.map(s => s.code).join(",")],
    queryFn: () => fetchTossPrices(stocks.map(s => s.code)),
    enabled: !!popup, refetchInterval: 5_000, staleTime: 3_000,
  });
  const sq = (code: string): { price?: number; pct?: number } | undefined => {
    const t = tossPx?.find(p => p.ticker === code);
    if (t && t.prevClose > 0) return { price: t.price, pct: ((t.price - t.prevClose) / t.prevClose) * 100 };
    return q(`${code}.KS`);
  };
  const [rightTab, setRightTab] = useState<"sig" | "hyp">("sig");
  // 프리장(NXT 08:00~09:00) 결과 — 정규장이 열리면 현물 수급은 KRX 로 바뀌어 프리장이 안 보인다 → 따로 한 줄(사용자 요청)
  const [{ data: kospiNxt }, { data: kosdaqNxt }] = useQueries({
    queries: (["kospi", "kosdaq"] as const).map(m => ({
      queryKey: ["semi-dash-nxt", m], queryFn: () => fetchKrIntradayInvestorFlow(m, true),
      refetchInterval: 5 * 60_000, staleTime: 60_000, refetchOnWindowFocus: false,
    })),
  });
  // 야간선물(18:00~05:00) — 지수 탭과 같은 쿼리키(캐시 공유)
  // 야간선물이 **실제로 열린 시간**(18:00~05:00)에만 — isKrNightSession 은 주간장 직전(09:00)까지라
  //   야간장이 끝난 뒤에도 08시에 야간 카드가 남아 있었다(사용자 지적 2026-10-22). 그 사이엔 주간 선물(전날 종가) 카드.
  const night = (() => { const h = new Date(Date.now() + 9 * 3600_000).getUTCHours(); return h >= 18 || h < 5; })();
  // 거래 중인가(한국 시각·주말 제외) — 아니면 카드 흐림. 휴장일은 고려하지 않는다
  const kstNow = new Date(Date.now() + 9 * 3600_000);
  const mm = kstNow.getUTCHours() * 60 + kstNow.getUTCMinutes(), wd = kstNow.getUTCDay();
  const weekday = wd >= 1 && wd <= 5;
  const openStock = weekday && mm >= 8 * 60 && mm < 20 * 60;              // 삼성·하이닉스 — NXT 08:00~20:00
  const openIndex = weekday && mm >= 9 * 60 && mm < 15 * 60 + 30;         // 코스피·코스닥·V-KOSPI — 정규장
  // 수급 칸(현물·선물) — 15:30 에 같이 흐림(사용자 요청 2026-10-22). 현물 수급은 NXT 프리장(08:00~) 결과를 보여 주므로 08:00 부터.
  //   선물 정규장은 15:45 까지지만 칸은 현물과 맞춰 15:30 에 흐린다(사용자 결정)
  const openFlow = weekday && mm >= 8 * 60 && mm < 15 * 60 + 30;
  const openFut = weekday && mm >= 8 * 60 + 45 && mm < 15 * 60 + 45;      // 주간 선물 08:45~15:45
  const openNight = night && (mm >= 18 * 60 ? weekday : (wd >= 2 && wd <= 6));   // 야간 — 월~금 저녁에 열려 다음 날 새벽까지
  const nightQs = useQueries({
    queries: (["^KS200N", "^KQ150N"] as const).map(sym => ({
      queryKey: ["yasun-night", sym], queryFn: () => fetchYasunNightFutures(sym),
      enabled: night, refetchInterval: night ? REFRESH_MS : (false as const), staleTime: 60_000,
    })),
  });
  const [flowHover, setFlowHover] = useState<number | null>(null);
  const [flowKeys, setFlowKeysState] = useState<IntradayKey[]>(loadFlowKeys);
  const toggleFlowKey = (k: IntradayKey) => setFlowKeysState(v => {
    const n = v.includes(k) ? v.filter(x => x !== k) : [...v, k];
    try { localStorage.setItem(FLOW_KEYS_KEY, JSON.stringify(n)); } catch { /* 이번 화면만 */ }
    return n;
  });
  const flowLines: FlowLine[] = INTRADAY_SERIES.filter(x => flowKeys.includes(x.key)).map(x => ({ k: x.key, label: x.label, color: x.color }));
  // 수급 그래프 배경 가격 — 지수는 야후 오늘 5분봉, 선물은 한경 1분봉(오늘 구간)
  // 배경 지수 — 다음 금융 1분(실시간). 야후는 한국 지수가 20분 늦어 장 초반 배경이 몇 점뿐이었다
  const [{ data: ksToday }, { data: kqToday }] = useQueries({
    queries: (["KOSPI", "KOSDAQ"] as const).map(m => ({
      queryKey: ["daum-index-today", m], queryFn: () => fetchDaumIndexToday(m), refetchInterval: FLOW_MS, staleTime: 30_000,
    })),
  });
  const { data: dayStr } = useQuery({
    queryKey: ["toss-day-strength", stocks.map(s => s.code).join(",")],
    queryFn: () => fetchTossDayStrength(stocks.map(s => s.code)),
    refetchInterval: 10_000, staleTime: 5_000,
  });

  // 현물 = KRX(정규장 전엔 NXT 프리장). 프리장을 정규장 그래프에 합치는 건 해 보고 뺐다(사용자 결정 2026-10-22) — 프리장은 노란 '결과' 상자로만
  const kf = kospiFlow.data, ff = futFlow.data;
  const kqFlow = kosdaqFlow.data;
  const futToday = futMin?.todayTimes && futMin.date === new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)   // 오늘 것만(장 전엔 어제)
    ? futMin.todayTimes.map((t, i) => ({ t, v: futMin.closes[(futMin.breakIdx ?? 0) + i] })).filter(p => p.v > 0) : undefined;
  const kLast = kf?.points[kf.points.length - 1], fLast = ff?.points[ff.points.length - 1];
  // 코스피 외국인 최근 5분 변화(속도) — 1분 단위 누적이라 5행 전과의 차
  const k5 = kf && kf.points.length > 5 ? kLast!.foreigners - kf.points[kf.points.length - 6].foreigners : undefined;
  const vk = q("VKOSPI");

  // ── 신호(숫자로 확인되는 것만) ──
  // d = 그 줄 아래 회색 설명(사용자 요청 — 숫자만으론 뜻을 모른다)
  const sig: { t: string; c: string; d?: string }[] = [];
  // 오늘 자료인가 — 장 시작 전엔 수급(네이버)이 어제 행을, 한경 선물은 미결제 0 을 준다. 그런 건 신호에 안 쓴다(사용자 지적 2026-10-22)
  const todayIso = kstNow.toISOString().slice(0, 10);
  const kfToday = kf?.date === todayIso, ffToday = ff?.date === todayIso;
  // 수급 세 칸 공통 시간 축 — 오늘 자료만 모아 가장 이른 첫 시각 ~ 가장 늦은 마지막 시각
  const flowAxis = (() => {
    const fl = [kfToday ? kf : undefined, kqFlow?.date === todayIso ? kqFlow : undefined, ffToday ? ff : undefined]
      .filter((f): f is IntradayFlow => !!f && f.points.length > 0);
    if (!fl.length) return undefined;
    const firsts = fl.map(f => f.points[0].time), lasts = fl.map(f => f.points[f.points.length - 1].time);
    const start = firsts.reduce((a, b) => (a < b ? a : b)), end = lasts.reduce((a, b) => (a > b ? a : b));
    // 정규장 자료(09:00~)가 하나라도 있으면 09:00 부터 — 선물 08:45 때문에 현물 칸 앞이 비던 것(사용자 지적). 정규장 전엔 이른 시각부터
    const anyRegular = firsts.some(t => t >= "09:00");
    return { start: anyRegular ? "09:00" : start.slice(0, 4) + "0", end };
  })();
  // 팝업(한 종목)이면 호가·거래원·프로그램 줄을 체결 줄 뒤에(쿼리키가 칸과 같아 추가 호출 없음)
  const liveSig = useStockLiveSignals(stocks[0].code, !!popup, sq(stocks[0].code)?.price);
  stocks.forEach((s, i) => {
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
  if (popup) sig.push(...liveSig);
  if (k5 != null && kfToday) sig.push({ t: `코스피 외국인 5분간 ${eok(k5)}억 (누적 ${eok(kLast!.foreigners)}억)`, c: up(k5),
    d: Math.sign(k5) === Math.sign(kLast!.foreigners) || k5 === 0
      ? `외국인이 지금도 ${kLast!.foreigners >= 0 ? "사는" : "파는"} 중 — 오늘 누적 ${kLast!.foreigners >= 0 ? "매수" : "매도"}세가 최근 5분에도 이어진다.`
      : `오늘 누적은 ${kLast!.foreigners >= 0 ? "매수" : "매도"}인데 최근 5분은 ${k5 > 0 ? "매수" : "매도"} — 외국인이 방향을 트는지 지켜볼 구간.` });
  if (fut && fut.oi > 0 && fut.volume > 0) {   // 미결제·거래량 0 = 장 시작 전(한경이 0 으로 초기화)
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
  // 외국인 선물 당일 회전 — 총 매수·매도 중 작은 쪽 = 같은 날 사고판 최대치(데이트레이딩 추정)
  const fg = fLast?.gross;
  if (fg && fg.fBuy + fg.fSell > 0 && ffToday) {
    const turn = Math.min(fg.fBuy, fg.fSell), net = fg.fBuy - fg.fSell, rate = turn / ((fg.fBuy + fg.fSell) / 2) * 100;
    sig.push({
      t: `외국인 선물 당일 회전 ≈${turn.toLocaleString()}계약(${rate.toFixed(0)}%) · 남긴 건 ${net >= 0 ? "순매수" : "순매도"} ${Math.abs(net).toLocaleString()}`,
      c: up(net),
      d: `외국인이 오늘 선물을 ${fg.fBuy.toLocaleString()}계약 사고 ${fg.fSell.toLocaleString()}계약 팔았다. 그중 ≈${turn.toLocaleString()}계약은 같은 날 사고판 물량(단타·당일 청산 추정 — 어제 포지션 정리와는 구분 안 됨)이고, `
        + `실제로 남긴 방향은 ${net >= 0 ? "매수" : "매도"} ${Math.abs(net).toLocaleString()}계약 — ${rate >= 90 ? "거의 다 당일 안에서 돌린 물량이라 남긴 방향이 더 중요하다." : "당일 회전보다 방향을 실은 비중이 크다."} (20분 지연)`,
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

  // 시장 카드(코스피·코스닥·선물(야간엔 야간선물)·V-KOSPI) — 반도체 탭 첫 줄과 종목정보 팝업이 같이 쓴다
  const marketCards = (<>
        <Card title="코스피" price={q("^KS11")?.price} pct={q("^KS11")?.pct} dim={!openIndex}
              chart={spark?.get("^KS11") && <SparkBg sp={spark.get("^KS11")!} base={q("^KS11")?.prevClose} />} />
        {/* 코스닥 — 사용자 요청(2026-10-21). 기준선은 카드 전일 종가(야후 ^KQ11 previousClose 가 그저께 값일 때가 있다) */}
        <Card title="코스닥" price={q("^KQ11")?.price} pct={q("^KQ11")?.pct} dim={!openIndex}
              chart={spark?.get("^KQ11") && <SparkBg sp={spark.get("^KQ11")!} base={q("^KQ11")?.prevClose} />} />
        {/* 야간(18:00~05:00)엔 야간선물(야선) — 사용자 요청. 주간 선물 카드와 자리를 바꾼다 */}
        {night ? (["^KS200N", "^KQ150N"] as const).map((sym, i) => {
          const d = nightQs[i]?.data;
          return <Card key={sym} title={`${i ? "코스닥150" : "코스피200"} 야간선물`} price={d?.index.price} pct={d?.index.pct} dim={!openNight}
                       sub={`주간 종가 ${i ? (futQ ? fmtP(futQ.price) : "-") : (fut ? fmtP(fut.price) : "-")} · 18:00~05:00`}
                       chart={d && d.closes.length > 1 && <Sparkline data={d.closes} width={300} height={70} className="w-full h-full" strokeWidth={1.2} baseline={d.index.prevClose} />} />;
        }) : <>
        <Card title={`코스피200 선물${fut?.month ? ` ${fut.month}` : ""}`} price={fut?.price} pct={fut?.pct} dim={!openFut}
              sub={fut ? `미결제 ${fut.oi.toLocaleString()}(${eok(fut.oiChg)}) · 베이시스 ${fut.basis.toFixed(2)}` : "한경 실시간"}
              chart={futMin && futMin.closes.length > 1 && <FutSpark s={futMin} live={fut?.price} />} />
        <Card title={`코스닥150 선물${futQ?.month ? ` ${futQ.month}` : ""}`} price={futQ?.price} pct={futQ?.pct} dim={!openFut}
              sub={futQ ? `미결제 ${futQ.oi.toLocaleString()}(${eok(futQ.oiChg)})` : "한경 실시간"}
              chart={futQMin && futQMin.closes.length > 1 && <FutSpark s={futQMin} live={futQ?.price} />} />
        </>}
        <Card title="V-KOSPI" price={vk?.price} pct={vk?.pct} dim={!openIndex}
              sub={vk ? `${vk.price >= 30 ? "공포" : vk.price >= 20 ? "경계" : "안정"} · 20↑ 경계 30↑ 공포 · 그래프 일봉` : undefined}
              chart={vkChart && vkChart.length > 1 && <Sparkline data={vkChart.slice(-60)} width={300} height={70} className="w-full h-full" strokeWidth={1.2}
                                                               color={vk && vk.pct > 0 ? "#dc2626" : "#2563eb"} />} />
  </>);

  // 지금 신호 / 가설 검증 칸 — 반도체 탭과 팝업이 같은 칸을 쓴다
  const signalBox = (
        <div className="pg-card rounded-lg border border-gray-200 bg-white p-2 flex flex-col min-h-0 overflow-hidden">
          {/* 지금 신호 / 가설 검증 — 탭(사용자 요청) */}
          <div className="flex items-baseline gap-1 mb-1 border-b">
            {(["sig", "hyp"] as const).map(k => (
              <button key={k} onClick={() => setRightTab(k)}
                      className={`px-2 pb-1 -mb-px border-b-2 font-bold ${rightTab === k ? "border-blue-500 text-gray-900" : "border-transparent text-gray-400 hover:text-gray-600"}`}>
                {k === "sig" ? "지금 신호" : "가설 검증"}
              </button>
            ))}
            <span className="ml-1 text-[11px] text-gray-400">{rightTab === "sig" ? "숫자로 확인되는 것만" : "같이 일어났는지만(인과 아님)"}</span>
          </div>
          {rightTab === "hyp" ? <HypothesisBox ff={ff} futMin={futMin ?? undefined} embedded /> : <>
          <div className="space-y-1 overflow-auto">
            {sig.length ? sig.map((n, i) => (
              <div key={i} className="leading-snug">
                <div className={`font-semibold ${n.c}`}>• {n.t}</div>
                {n.d && <div className="pl-2.5 text-[11px] text-gray-500">{n.d}</div>}
              </div>))
              : <div className="text-gray-400">체결을 모으는 중… (1~2분)</div>}
          </div>
          <div className="mt-auto pt-2 border-t text-[11px] text-gray-500 leading-snug">
            체결강도 = 매수 체결량 ÷ 매도 체결량 × 100 (100 위 = 사는 쪽 우위). 큰 체결 = 1억 원 이상(5건이 안 되면 5천만 · 3천만 · 1천만으로 낮춤).
          </div>
          </>}
        </div>
  );

  // ⚡ 종목정보 실시간 탭(한 종목) — 시장 수급 칸 대신 **이 종목** 것만(사용자 요청 2026-10-23 재설계):
  //   ① 종목 카드 + 시장 맥락 칩 ② 체결(크게) + 신호 ③ 호가 | 거래원 | 프로그램·투자자 ④ 새 소식 | 커뮤니티
  if (popup) {
    const s0 = stocks[0], qq = sq(s0.code);
    return (
      <div className="flex flex-col gap-1.5 p-2 text-[12px] bg-gray-50 pg-bg">
        {/* 종목 카드 + 시장 카드(반도체 탭과 같은 그래프 카드 — 칩 한 줄보다 낫다, 사용자 요청 2026-10-23) */}
        {/* 종목 1.4칸 + 시장 카드 8장(지수·선물·V-KOSPI + 환율·나스닥 선물·반도체 선물, 사용자 요청 2026-10-23) */}
        <div className="grid grid-cols-3 lg:grid-cols-[1.4fr_repeat(8,minmax(0,1fr))] gap-1.5 auto-rows-[118px] shrink-0">
          <Card title={s0.name} price={qq?.price} pct={qq?.pct} unit="원" dim={!openStock}
                chart={<KrDaySparkline code={s0.code} fallback={[]} live={qq?.price} width={300} height={70} className="w-full h-full" volume />} />
          {marketCards}
          {([["KRW=X", "원달러 환율"], ["NQ=F", "나스닥 선물"], ["SOX=F", "반도체 선물(SOX)"]] as const).map(([sym, t]) => (
            <Card key={sym} title={t} price={q(sym)?.price} pct={q(sym)?.pct}
                  chart={spark?.get(sym) && <SparkBg sp={spark.get(sym)!} base={q(sym)?.prevClose} />} />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-1.5 min-h-0 auto-rows-[360px]">   {/* 체결 · 신호 반반(사용자 요청) */}
          <TickPanel name={s0.name} flow={ticks[0]} day={dayStr?.get(s0.code)} />
          {signalBox}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-1.5 auto-rows-[430px] shrink-0">
          <OrderBookBox code={s0.code} />
          <BrokerBox code={s0.code} />
          <ProgramInvestorBox code={s0.code} price={qq?.price} />
          {/* 공시 — 이 줄 맨 오른쪽(사용자 요청 2026-10-23: 호가 · 거래원 · 프로그램 · 공시 4칸) */}
          <FeedBox code={s0.code} name={s0.name} kind="disc" />
        </div>
        {/* 뉴스 · 토스 · 네이버 3등분(공시는 위 거래원 아래로) */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-1.5 auto-rows-[400px] shrink-0">
          <FeedBox code={s0.code} name={s0.name} kind="news" />
          <CommunityPane code={s0.code} kind="toss" />
          <CommunityPane code={s0.code} kind="naver" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 p-2 lg:min-h-[calc(100vh-150px)] text-[12px] bg-gray-50 pg-bg">
      {/* ① 시세 */}
      <div className="grid grid-cols-2 lg:grid-cols-7 gap-1.5 auto-rows-[118px] shrink-0">
        {stocks.map(s => {
          const qq = sq(s.code);
          return <Card key={s.code} title={s.name} price={qq?.price} pct={qq?.pct} unit="원" dim={!openStock}
                       chart={<KrDaySparkline code={s.code} fallback={[]} live={qq?.price} width={300} height={70} className="w-full h-full" volume />} />;
        })}
        {marketCards}
        {/* 필라델피아 반도체(지수) 카드는 뺐다 — 한국 장중엔 간밤 미국 종가라 안 움직인다(사용자 요청). SOX 선물은 아래 해외 선물 줄 */}
      </div>

      {/* ② 실시간 체결 + 신호 */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_600px] gap-1.5 min-h-0 auto-rows-[320px] lg:auto-rows-[330px]">
        {stocks.map((s, i) => <TickPanel key={s.code} name={s.name} flow={ticks[i]} day={dayStr?.get(s.code)} onTitle={popup ? undefined : () => openStockInfo(s.code, s.name)} />)}
        {signalBox}
      </div>

      {/* 수급 칸 투자자 선택 — 증시 탭과 같은 체크박스(세 칸 공통) */}
      <div className="pg-card rounded-lg border border-gray-200 bg-white px-2 py-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 shrink-0">
        <span className="font-bold text-gray-700">수급</span>
        {INTRADAY_SERIES.map(x => (
          <label key={x.key} className="inline-flex items-center gap-1 cursor-pointer select-none">
            <input type="checkbox" checked={flowKeys.includes(x.key)} onChange={() => toggleFlowKey(x.key)} className="w-3.5 h-3.5" style={{ accentColor: x.color }} />
            <span style={{ color: flowKeys.includes(x.key) ? x.color : "#9ca3af" }} className="font-medium">{x.label}</span>
          </label>
        ))}
      </div>
      {/* ③ 현물·선물·옵션 수급 */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_1fr_1fr_1.1fr] gap-1.5 auto-rows-[400px] shrink-0">
        {/* 코스피·코스닥 현물을 나란히(전환 버튼 없이 바로 — 사용자 요청) */}
        <FlowBox title="현물 · 코스피" note="1분" axis={flowAxis} flow={kf} unit="억" preFlow={kospiNxt} dim={!(kfToday && openFlow)} hoverM={flowHover} onHover={setFlowHover} lines={flowLines} bg={ksToday?.points.map(p => ({ t: p.t, v: p.c }))} bgBase={q("^KS11")?.prevClose} />
        <FlowBox title="선물 · 코스피200" axis={flowAxis} note="20분 지연(코스닥150 선물 수급은 소스 없음)" flow={ff} unit="계약" dim={!(ffToday && openFlow)} hoverM={flowHover} onHover={setFlowHover} lines={flowLines}
                 bg={futToday} bgBase={fut ? fut.price - fut.chg : undefined} endHM="15:45" />
        <FlowBox title="현물 · 코스닥" note="1분" axis={flowAxis} flow={kqFlow} unit="억" preFlow={kosdaqNxt} dim={!(kqFlow?.date === todayIso && openFlow)} hoverM={flowHover} onHover={setFlowHover} lines={flowLines} bg={kqToday?.points.map(p => ({ t: p.t, v: p.c }))} bgBase={q("^KQ11")?.prevClose} />
        <OptionBox opt={opt} vk={vk} dim={!openFut} />
        <StockFlowTable rows={stocks.map((s, i) => ({ ...s, hist: stockInv[i].data ?? [], price: sq(s.code)?.price }))}
                        fLast={fLast}
                        markets={[
                          { name: "코스피", last: kLast, daily: kospiDaily?.points ?? [] },
                          { name: "코스닥", last: kqFlow?.points[kqFlow.points.length - 1], daily: kosdaqDaily?.points ?? [] },
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

function Card({ title, price, pct, sub, chart, unit, dim }: {
  title: string; price?: number; pct?: number; sub?: string; chart?: React.ReactNode; unit?: string;
  dim?: boolean;   // 거래 시간이 아니면 흐리게(지수 탭 카드와 같은 '쉬는 중' 표시, 사용자 요청)
}) {
  return (
    <div className={`pg-card relative rounded-lg border border-gray-200 overflow-hidden ${dim ? "bg-gray-50 opacity-60 grayscale-[60%]" : "bg-white"}`}
         title={dim ? "지금은 거래 시간이 아닙니다" : undefined}>
      <div className="absolute inset-x-0 bottom-0 top-[40%] pointer-events-none">{chart}</div>
      <div className="relative px-2 pt-1.5">
        <div className="font-bold text-gray-800 truncate">{dim && <span className="mr-1 text-[11px] font-normal text-gray-400">zZ</span>}{title}</div>
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
  return <Sparkline data={on ? [...s.closes, live!] : s.closes} xs={on ? [...s.xs!, s.rolling ? 1 : s.xs![s.xs!.length - 1] + 0.001] : s.xs}
                    width={300} height={70} className="w-full h-full" strokeWidth={1.2}
                    baseline={s.base} prevBaseline={s.prevBase} markIndex={s.openIdx} closeIndex={s.closeIdx} extraMarks={[s.prevOpenIdx, s.prevCloseIdx]} breakIndex={s.breakIdx} />;
}

// base = 카드의 전일 종가(한국 지수는 야후 previousClose 가 틀릴 때가 있어 카드 값을 우선)
function SparkBg({ sp, base }: { sp: { closes: number[]; xs?: number[]; openIdx?: number; closeIdx?: number; prevOpenIdx?: number; prevCloseIdx?: number; prevClose?: number; breakIdx?: number; prevBase?: number }; base?: number }) {
  return <Sparkline data={sp.closes} xs={sp.xs} width={300} height={70} className="w-full h-full" strokeWidth={1.2}
                    baseline={base && base > 0 ? base : sp.prevClose} markIndex={sp.openIdx} closeIndex={sp.closeIdx} extraMarks={[sp.prevOpenIdx, sp.prevCloseIdx]} breakIndex={sp.breakIdx} prevBaseline={sp.prevBase} />;
}

// 종목 실시간 체결 — 1분 막대(순매수 체결 금액, 위 빨강·아래 파랑) + 가격 선(회색) + 누적 순매수 선(주황)
//   onTitle — 제목을 누르면 ⚡ 종목 체결 팝업(같은 화면을 이 종목 하나로)
function TickPanel({ name, flow, day, onTitle }: { name: string; flow: TickFlow; day?: DayStrength; onTitle?: () => void }) {
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
  const bigThr = bigThreshold(flow.big);
  return (
    <div className="pg-card rounded-lg border border-gray-200 bg-white p-2 flex flex-col min-h-0">
      <div className="flex items-baseline gap-2">
        {onTitle
          ? <button onClick={onTitle} title="크게 보기(팝업)" className="font-bold text-gray-800 hover:text-blue-700 hover:underline">{name} 실시간 체결 ⤢</button>
          : <span className="font-bold text-gray-800">{name} 실시간 체결</span>}
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

            </svg>
            {/* 시각 글자 — svg 는 칸 크기로 늘어나(preserveAspectRatio none) 글자가 찌그러진다 → HTML 로(팝업에서 크게 깨졌다) */}
            {ms.map((m, i) => (m.t.endsWith("0") ? (
              <span key={m.t} className="absolute bottom-0 -translate-x-1/2 text-[10px] text-gray-400 pointer-events-none" style={{ left: `${(xOf(i) / W) * 100}%` }}>{m.t}</span>
            ) : null))}
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
          <div className="text-gray-500 mb-0.5">큰 체결 ({wonStep(bigThr)}↑)</div>
          {flow.big.filter(b => b.amt >= bigThr).slice(0, 12).map((b, i) => (
            <div key={i} className={`flex justify-between ${b.side === "BUY" ? "text-rose-600" : "text-blue-600"}`}>
              <span>{b.time}</span><b>{b.side === "BUY" ? "+" : "-"}{b.amt >= 1e8 ? `${(b.amt / 1e8).toFixed(1)}억` : `${Math.round(b.amt / 1e6).toLocaleString()}백만`}</b>
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

// 시장 투자자 시간별 누적 — 외국인·개인 두 줄만(사용자 결정 2026-10-21).
//   기관은 금융투자(ETF·차익 헤지)가 섞여 방향이 흐려지고, 대신 넣어 본 연기금은 금액이 작아 0선에 붙어 있었다.
// 투자자 선택 — 증시 탭과 같은 목록·색(INTRADAY_SERIES). 기본 개인·외국인, 세 칸 공통·기억(사용자 요청 2026-10-23)
type FlowLine = { k: IntradayKey; label: string; color: string };
const FLOW_KEYS_KEY = "semi_flow_keys";
function loadFlowKeys(): IntradayKey[] {
  try {
    const v = JSON.parse(localStorage.getItem(FLOW_KEYS_KEY) ?? "null") as IntradayKey[] | null;
    if (Array.isArray(v) && v.length) return v.filter(k => INTRADAY_SERIES.some(x => x.key === k));
  } catch { /* 기본값 */ }
  return ["individuals", "foreigners"];
}
function FlowBox({ title, note, flow, unit, tabs, tab, onTab, bg, bgBase, endHM = "15:30", hoverM, onHover, dim, preFlow, axis, lines }: {
  title: string; note: string; flow?: IntradayFlow; unit: string;
  tabs?: [string, string][]; tab?: string; onTab?: (k: string) => void;   // 코스피/코스닥 전환(현물 칸)
  bg?: { t: string; v: number }[];   // 배경 가격(지수·선물) — 증시 탭처럼 연한 면으로, 축은 따로(사용자 요청)
  bgBase?: number;                   // 배경 색 기준 = 어제 종가(카드와 같은 기준). 없으면 오늘 첫 봉
  endHM?: string;                    // 시간 축 끝(선물은 15:45)
  dim?: boolean;                     // 거래 시간이 아니거나 어제 자료면 흐리게(사용자 요청 2026-10-22)
  preFlow?: IntradayFlow;            // 넥스트레이드 수급 — 정규장 시작 뒤 '프리장 결과' 한 줄용
  axis?: { start: string; end: string };   // 세 칸 공통 시간 축(시작 = 가장 이른 첫 자료, 끝 = 가장 늦은 마지막 자료)
  hoverM?: number | null;            // 마우스가 가리키는 시각(분) — 세 칸이 같이 따라간다(사용자 요청)
  onHover?: (m: number | null) => void;
  lines: FlowLine[];                 // 그릴 투자자(위 선택 줄)
}) {
  const LINES = lines;
  const pts = flow?.points ?? [];
  const val = (p: IntradayFlow["points"][number], k: IntradayKey) => p[k];
  const W = 400, H = 140, PX = 2, PY = 6;
  const tmin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const mx = Math.max(1, ...pts.flatMap(p => LINES.map(l => Math.abs(val(p, l.k)))));
  // 축 시작 — 프리장(NXT 08:00~) 자료가 있으면 08:00 부터. 09:00 고정이면 프리장 점이 왼쪽 끝 한 점에 몰려
  //   세로선처럼 보였다(사용자 지적 2026-10-22, 증시 탭과 모양이 달랐다)
  // 공통 축(axis)이 오면 그걸 — 세 칸(현물 코스피·코스닥·선물)이 같은 시각을 같은 가로 위치에(사용자 지적 2026-10-22)
  const startHM = axis?.start ?? (pts.length && pts[0].time < "09:00" ? "08:00" : "09:00");
  const T0 = tmin(startHM);
  // 축 끝 = 지금(마지막 자료) — 장 초반엔 자료가 가로를 꽉 채우고, 시간이 갈수록 장 마감까지 늘며 좁아진다(사용자 요청).
  //   최소 30분 폭 — 자료 몇 개를 너무 크게 늘리지 않게. 장 마감(endHM)을 넘지 않는다.
  const lastHM = axis?.end ?? (pts.length ? pts[pts.length - 1].time : startHM);
  const T1 = Math.min(tmin(endHM), Math.max(tmin(lastHM) + 2, T0 + 30));
  const axisEnd = `${String(Math.floor(T1 / 60)).padStart(2, "0")}:${String(T1 % 60).padStart(2, "0")}`;
  const span = T1 - T0;
  const x = (t: string) => PX + Math.min(1, Math.max(0, (tmin(t) - T0) / span)) * (W - PX * 2);
  // 배경 가격 면
  // 배경은 이 칸 수급 선이 끝나는 시각까지만 — 배경(실시간)이 늦은 수급 선(선물 20분 지연)보다 길게 나가 어긋나 보였다
  const flowEnd = pts.length ? pts[pts.length - 1].time : axisEnd;
  const bgp = (bg ?? []).filter(b => b.t >= startHM && b.t <= (flowEnd < axisEnd ? flowEnd : axisEnd));
  const hasBgBase = !!bgBase && bgBase > 0;
  const bVals = [...bgp.map(b => b.v), ...(hasBgBase ? [bgBase!] : [])];   // 기준선(전일 종가)도 범위에 — 위·아래로 나눠 칠하려고
  const bMin = Math.min(...bVals), bMax = Math.max(...bVals), bR = bMax - bMin || 1;
  const by = (v: number) => PY + (1 - (v - bMin) / bR) * (H - PY * 2);
  // 마감 동시호가(일괄 체결) 구간 — 현물 15:20~15:30, 선물 15:35~15:45. 음영만 칠한다(글자는 그래프를 가려 뺐다)
  const aucFrom = endHM === "15:45" ? "15:35" : "15:20";   // 선물 칸 = 축 끝 15:45
  const y = (v: number) => H / 2 - (v / mx) * (H / 2 - PY);
  const lastPt = pts[pts.length - 1];
  // 마우스 시각의 값(그 시각 이하 마지막 점) — 숫자 줄이 그 값으로 바뀐다
  const hovPt = hoverM != null ? [...pts].reverse().find(p => tmin(p.time) <= hoverM) : undefined;
  const last = hovPt ?? lastPt;
  const xToM = (px: number) => T0 + ((px - PX) / (W - PX * 2)) * span;
  const onMove = onHover ? (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const m = Math.round(xToM(((e.clientX - r.left) / r.width) * W));
    onHover(m < T0 || m > T1 ? null : m);
  } : undefined;
  const hoverX = hoverM != null && hoverM >= T0 && hoverM <= T1 ? PX + ((hoverM - T0) / span) * (W - PX * 2) : null;
  // 배경 지수 캔들 — 묶음 폭은 아래 매수·매도 막대와 같은 규칙(자료 1시간↓ 1분·3시간↓ 5분·그 위 10분), 증시 탭과 같은 모양(사용자 요청 2026-10-23)
  const bgCandles = (() => {
    if (bgp.length < 2) return [];
    const ds = pts.length > 1 ? tmin(pts[pts.length - 1].time) - tmin(pts[0].time) : 999;
    const B = ds <= 60 ? 1 : ds <= 180 ? 5 : 10;
    const out: { m: number; B: number; o: number; h: number; l: number; c: number }[] = [];
    for (const p of bgp) {
      const m = T0 + Math.floor((tmin(p.t) - T0) / B) * B, last = out[out.length - 1];
      if (!last || last.m !== m) out.push({ m, B, o: p.v, h: p.v, l: p.v, c: p.v });
      else { last.h = Math.max(last.h, p.v); last.l = Math.min(last.l, p.v); last.c = p.v; }
    }
    return out;
  })();
  return (
    <div className={`pg-card rounded-lg border border-gray-200 p-2 flex flex-col min-h-0 min-w-0 ${dim ? "bg-gray-50 opacity-60 grayscale-[60%]" : "bg-white"}`}
         title={dim ? "지금은 거래 시간이 아니거나 지난 거래일 자료입니다" : undefined}>
      <div className="flex items-baseline gap-2">
        <span className="font-bold text-gray-800 shrink-0">{dim && <span className="mr-1 text-[11px] font-normal text-gray-400">zZ</span>}{title}</span>
        <span className="text-[11px] text-gray-400 truncate">{note}{last ? ` · ${last.time}` : ""}{hovPt ? "(마우스)" : ""}{unit === "계약" ? " · 계약" : ""}</span>
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
          <span key={l.k}><i className="inline-block w-2 h-0.5 mr-0.5 align-middle" style={{ background: l.color }} />{l.label} <b className={last ? up(val(last, l.k)) : "text-gray-300"}>{last ? (unit === "억" ? `${val(last, l.k) > 0 ? "+" : val(last, l.k) < 0 ? "−" : ""}${joEok(val(last, l.k))}` : eok(val(last, l.k))) : "-"}{last && unit === "계약" ? "계약" : ""}</b></span>
        ))}
      </div>
      {/* 그래프 높이 고정 — 세 칸(현물·선물)이 같은 높이·같은 가로 위치 */}
      <div className="h-[190px] shrink-0">
        {pts.length < 2 ? <div className="h-full flex items-center justify-center text-gray-400">{flow ? "장 시작 전" : "불러오는 중…"}</div> : (
          <div className="relative w-full h-full">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-full" onMouseMove={onMove} onMouseLeave={onHover ? () => onHover(null) : undefined}>
            {/* 배경 지수 = 캔들(빨강 오름·파랑 내림, 반투명, 꼬리는 몸통 밖만) + 전일 종가 점선 — 증시 탭과 같게 */}
            {hasBgBase && <line x1={0} x2={W} y1={by(bgBase!)} y2={by(bgBase!)} stroke="#64748b" strokeOpacity={0.5} strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />}
            {bgCandles.map(k => {
              const sw = ((W - PX * 2) * k.B) / span, gap = sw * 0.15;
              const x0 = PX + ((k.m - T0) / span) * (W - PX * 2) + gap / 2, w = Math.max(0.6, sw - gap), cx = x0 + w / 2;
              const upK = k.c >= k.o, top = by(Math.max(k.o, k.c)), bot = by(Math.min(k.o, k.c));
              const line = upK ? "rgba(220,38,38,0.35)" : "rgba(37,99,235,0.35)", fill = upK ? "rgba(220,38,38,0.13)" : "rgba(37,99,235,0.13)";   // 투명하게(사용자 요청)
              return (
                <g key={k.m}>
                  {by(k.h) < top && <line x1={cx} x2={cx} y1={by(k.h)} y2={top} stroke={line} vectorEffect="non-scaling-stroke" />}
                  {by(k.l) > bot && <line x1={cx} x2={cx} y1={bot} y2={by(k.l)} stroke={line} vectorEffect="non-scaling-stroke" />}
                  <rect x={x0} width={w} y={top} height={Math.max(0.6, bot - top)} fill={fill} stroke={line} strokeWidth={1} vectorEffect="non-scaling-stroke" />
                </g>
              );
            })}
            {/* 배경 지수 선 — 캔들 위에 같이(사용자 요청 2026-10-23) */}
            {bgp.length > 1 && <path d={bgp.map((b, i) => `${i ? "L" : "M"} ${x(b.t).toFixed(1)} ${by(b.v).toFixed(1)}`).join(" ")} fill="none" stroke="#475569" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
            <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="#94a3b8" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
            {/* 마감 동시호가 구간 음영 */}
            <rect x={x(aucFrom)} width={Math.max(0, x(axisEnd) - x(aucFrom))} y={0} height={H} fill="#fde68a" fillOpacity={0.35} />
            {["10:00", "12:00", "14:00"].map(t => <line key={t} x1={x(t)} x2={x(t)} y1={0} y2={H} stroke="#eef2f7" vectorEffect="non-scaling-stroke" />)}
            {LINES.map(l => (
              <path key={l.k} d={pts.map((p, i) => `${i ? "L" : "M"} ${x(p.time).toFixed(1)} ${y(val(p, l.k)).toFixed(1)}`).join(" ")}
                    fill="none" stroke={l.color} strokeWidth={1.8} vectorEffect="non-scaling-stroke" />
            ))}
            {hoverX != null && <line x1={hoverX} x2={hoverX} y1={0} y2={H} stroke="#475569" strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />}
          </svg>
          </div>
        )}
      </div>
      {/* 외국인·개인 매수·매도 막대 — 그래프 바로 아래, 같은 시간 축. 증시 탭과 같은 모양(사용자 요청 2026-10-23) */}
      {flow && pts.length > 1 && (
        <BuySellBars points={flow.points} keys={LINES.map(l => l.k)} unit={unit === "계약" ? "계약" : "억"} start={startHM} end={axisEnd}
          rowH={36} compact
          geom={{
            width: W, hoverT: hoverM ?? null, toT: tmin, hover: onHover,
            xOfT: m => (m < T0 || m > T1 ? null : x(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`)),
          }} />
      )}
      {/* 프리장(NXT 08:00~09:00) 결과 — 정규장이 열려 본 그래프가 KRX 로 바뀐 뒤에만(그 전엔 본 그래프가 곧 프리장).
          막대 아래(그래프 밖)에 둔다 — 그래프 위에 있으면 그만큼 그래프가 낮아져 선물 칸과 높이가 달랐다(사용자 지적) */}
      {(() => {
        if (!preFlow || flow?.pre || !flow?.points.length || preFlow.date !== flow.date) return null;
        const p9 = [...preFlow.points].reverse().find(p => p.time <= "09:00");
        if (!p9) return null;
        const g = p9.gs ?? {};
        const item = (k: "individuals" | "foreigners", label: string, color: string) => {
          const [b, sl] = g[k] ?? [0, 0];
          const n = p9[k];
          // 개인 순(크게) (+산 금액 −판 금액) — 사용자 요청 2026-10-23
          return (
            <div key={k} className="flex items-baseline gap-1.5 min-w-0" title={`프리장 ${label} 매수 ${joEok(b)} · 매도 ${joEok(sl)}`}>
              <span className="shrink-0 w-8" style={{ color }}>{label}</span>
              <b className={`shrink-0 text-[12.5px] ${up(n)}`}>{n > 0 ? "+" : n < 0 ? "−" : ""}{joEok(n)}</b>
              <span className="truncate">(<b className="text-rose-600">+{joEok(b)}</b> <b className="text-blue-600">−{joEok(sl)}</b>)</span>
            </div>
          );
        };
        return (
          <div className="mt-1 px-1 py-0.5 rounded bg-amber-50/70 border border-amber-200 text-[10.5px] text-gray-500 tabular-nums min-w-0">
            <div className="text-amber-700 font-bold leading-tight">프리장(NXT 08:00~09:00) 결과</div>
            {item("individuals", "개인", "#7c3aed")}
            {item("foreigners", "외국인", "#ea580c")}
          </div>
        );
      })()}
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
function OptionBox({ opt, vk, dim }: { opt?: Awaited<ReturnType<typeof fetchKospi200OptionSummary>>; vk?: UsIndex; dim?: boolean }) {
  const [guide, setGuide] = useState(false);
  const pcr = opt && opt.callVol > 0 ? opt.putVol / opt.callVol : undefined;
  const pcrOi = opt && opt.callOi > 0 ? opt.putOi / opt.callOi : undefined;
  const tag = (t: string) => <span className="font-normal text-[10px] text-gray-400 ml-1">{t}</span>;
  return (
    <div className={`pg-card relative rounded-lg border border-gray-200 p-2 flex flex-col min-h-0 tabular-nums ${dim ? "bg-gray-50 opacity-60 grayscale-[60%]" : "bg-white"}`}>
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
    return { f: today ? won(today, today.외국인) : undefined, f5: sum(5), f20: sum(20), streak };
  };
  const dsum = (daily: { foreigners: number }[], n: number) => daily.slice(-n).reduce((a, p) => a + p.foreigners, 0);
  const dstreak = (daily: { foreigners: number }[]) => {   // 최신부터 외국인 같은 방향 연속 일수
    let st = 0;
    for (const p of [...daily].reverse()) { const sg = Math.sign(p.foreigners); if (!sg || (st && Math.sign(st) !== sg)) break; st += sg; }
    return st;
  };
  return (
    <div className="pg-card rounded-lg border border-gray-200 bg-white p-2 flex flex-col min-h-0">
      <div className="flex items-baseline gap-2">
        <span className="font-bold text-gray-800">종목 수급</span>
        <span className="text-[11px] text-gray-400">억원 · 오늘은 KRX 잠정치(하루 몇 번 갱신)</span>
      </div>
      <table className="w-full tabular-nums mt-1">
        <thead><tr className="text-gray-500 text-[11px] border-b">
          <th className="text-left font-normal"></th><th className="text-right font-normal">외국인</th>
          <th className="text-right font-normal">외인5일</th><th className="text-right font-normal">외인20일</th><th className="text-right font-normal">연속</th>
        </tr></thead>
        <tbody>
          {rows.map(r => {
            const c = calc(r.hist, r.price);
            return (
              <tr key={r.code} className="border-b border-gray-100">
                <td className="py-1 font-bold">{r.name}</td><N v={c.f} /><N v={c.f5} /><N v={c.f20} />
                <td className={`text-right ${up(c.streak)}`}>{c.streak ? `${Math.abs(c.streak)}일${c.streak > 0 ? "↑" : "↓"}` : "-"}</td>
              </tr>
            );
          })}
          {markets.map(m => {
            const st = m.daily.length ? dstreak(m.daily) : 0;
            return (
              <tr key={m.name} className="border-b border-gray-100">
                <td className="py-1 font-bold">{m.name}</td><N v={m.last?.foreigners} />
                <N v={m.daily.length ? dsum(m.daily, 5) : undefined} /><N v={m.daily.length ? dsum(m.daily, 20) : undefined} />
                <td className={`text-right ${up(st)}`}>{st ? `${Math.abs(st)}일${st > 0 ? "↑" : "↓"}` : "-"}</td>
              </tr>
            );
          })}
          <tr>
            <td className="py-1 font-bold">선물<span className="text-[10px] font-normal text-gray-400"> 계약·20분</span></td><N v={fLast?.foreigners} /><td /><td /><td />
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
    <div className="pg-card rounded-lg border border-gray-200 bg-white px-2 py-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
      <span className="font-bold text-gray-800">{title}</span>
      {items.map(x => (
        <span key={x.k} className="tabular-nums whitespace-nowrap">
          <span className="text-gray-600">{x.name}</span> <b className={x.pct == null ? "text-gray-300" : up(x.pct)}>{x.pct == null ? "-" : `${sgn(x.pct)}%`}</b>
        </span>
      ))}
    </div>
  );
}
