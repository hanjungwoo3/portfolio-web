// 💾 반도체 한눈에 — 현물·선물·옵션 수급과 삼성전자·SK하이닉스 실시간 체결을 **스크롤 없이 한 화면**에(2026-10-21 사용자 요청).
//   "실시간으로 어떻게 들어오는지 보면서 매수/매도 타이밍을 잡고 싶다" — 그래서 가운데가 **종목 체결 흐름**(5초)이다.
//   갱신 주기·지연이 소스마다 달라 칸마다 적어 둔다:
//     · 종목 체결(토스 ticks) 5초 — 화면을 켠 동안만 쌓인다(과거 체결 API 없음)
//     · 코스피 투자자(네이버) 1분 / 선물 투자자(네이버) **20분 지연** / 선물 시세·옵션(한경) 실시간
//   시세 카드는 지수 탭과 같은 쿼리키(yahoo-batch)라 캐시를 나눠 쓴다.
//   신호 줄은 **숫자로 확인되는 사실만** — 매수·매도 추천 문장은 쓰지 않는다.
import { fetchKisFutQuote, fetchKisFutDay, hasStockFutures, kisFutAvailable, fetchKisViToday, fetchKisKospi200Options, type KisOptionSummary } from "../lib/kisFutures";
import { ForeignFuturesPanel } from "./ForeignFuturesPanel";
import { loadProgTape, PROG_CODES, TAPE_EVENT, type ProgPt } from "../lib/futuresTape";
import { ValueupTags } from "./ValueupTags";
import { kisWsAvailable, kisWsLive, kisWsStatus } from "../lib/kisWs";
import { useValueupTags } from "../lib/valueupTags";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { Investor } from "../types";
import { getDimSleepingEnabled } from "../lib/proxyConfig";
import { useQuery, useQueries } from "@tanstack/react-query";
import {
  fetchYahooBatch, fetchYahooSparkDay, fetchKrIntradayInvestorFlow, fetchInvestorHistory,
  fetchKrFuturesLive, fetchKrFuturesMinute, fetchTossPrices, fetchYasunNightFutures, fetchDaumIndexToday, fetchDashboardChart, fetchTossDayStrength, fetchKospi200OptionSummary, fetchHlXyzPerps,
  type UsIndex, type IntradayFlow, type HlPerp, type DayStrength, type DaySeries,
} from "../lib/api";
import { INTRADAY_SERIES, type IntradayKey } from "../lib/intradayInvestor";
import { allYahooSymbols } from "../lib/usMarketData";
import { useAdaptiveRefreshMs } from "../lib/proxyStatus";
import { openStockInfo } from "../lib/tickPopup";
import { OrderBookBox, BrokerBox, ProgramInvestorBox, FeedBox, CommunityPane, useStockLiveSignals } from "./StockPopupRow";
import { useTickFlow, strength, netAmt, bigThreshold, wonStep, type TickFlow } from "../lib/useTickFlow";
import { Sparkline } from "./Sparkline";
import { KrDaySparkline } from "./KrDaySparkline";
import { BuySellBars, joEok } from "./BuySellBars";

const STOCKS = [{ code: "005930", name: "삼성전자" }, { code: "000660", name: "SK하이닉스" }] as const;
// 시장 대표 ETF 카드(반도체 탭 첫 줄, 사용자 요청 2026-10-23) — 현물 지수 옆에서 ETF 수급·괴리를 같이 본다
const ETFS = [{ code: "069500", name: "KODEX 200" }, { code: "229200", name: "KODEX 코스닥150" }] as const;
const SPARK = ["^KS11", "^KQ11", "KRW=X"];   // 야후 spark 1콜(어제+오늘 5분봉) — 환율은 종목정보 팝업 위 줄
const FLOW_MS = 60_000;
const US_ROW = ["MU", "NVDA", "SKHY", "SNDK", "AMD", "DRAM"];
const MEM_ROW = ["DRAMIDX=ML", "DDR5=ML", "DDR4=ML", "NAND=ML"];
const PERPS = [["SKHY", "하이닉스"], ["SMSN", "삼성"], ["MU", "마이크론"], ["NVDA", "엔비디아"], ["TSM", "TSMC"], ["KR200", "코스피200"]] as const;

const upColor = (v: number) => (v > 0 ? "text-rose-600" : v < 0 ? "text-blue-600" : "text-gray-500");
const up = upColor;
const sgn = (v: number, d = 2) => `${v > 0 ? "+" : ""}${v.toFixed(d)}`;
const fmtP = (v: number) => (v >= 1000 ? Math.round(v).toLocaleString() : v >= 100 ? v.toFixed(1) : v.toFixed(2));
// 축 눈금 — 1·2·5 단위로 n 개쯤
const niceTicks = (lo: number, hi: number, n: number) => {
  if (!(hi > lo)) return [];
  const raw = (hi - lo) / n, p = 10 ** Math.floor(Math.log10(raw)), f = raw / p;
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v / step) * step);
  return out;
};
const AX_L = 38, AX_R = 38;   // 수급 칸 왼쪽(순매수)·오른쪽(지수) 축 폭(px) — 증시 탭과 같은 배치(사용자 2026-10-29)
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
    refetchInterval: 5 * 60_000, staleTime: 4 * 60_000, refetchOnWindowFocus: true,   // 다시 띄우면 새로(숨긴 동안 갱신이 멈췄다)
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
  const { data: hkOpt } = useQuery({
    queryKey: ["hk-option-summary", Math.round(ks200 / 2.5)], queryFn: () => fetchKospi200OptionSummary(ks200),
    enabled: ks200 > 0, refetchInterval: FLOW_MS, staleTime: 30_000, placeholderData: p => p,
  });
  // 한국투자 연동(앱)이면 근월물 전 행사가 전광판으로 대체 — 실패하면 한경 그대로(사용자 2026-11-02)
  const { data: kisOpt } = useQuery({
    queryKey: ["kis-option-board"], queryFn: fetchKisKospi200Options,
    enabled: kisFutAvailable(), refetchInterval: 60_000, staleTime: 30_000, retry: 1,
  });
  const opt = kisOpt ?? hkOpt;
  const { data: perps } = useQuery({
    queryKey: ["hl-xyz-perps"], queryFn: fetchHlXyzPerps, refetchInterval: useAdaptiveRefreshMs(15_000), staleTime: 5_000,
  });
  const [kospiFlow, futFlow, kosdaqFlow] = useQueries({
    queries: (["kospi", "futures", "kosdaq"] as const).map(m => ({
      queryKey: ["semi-dash-flow", m], queryFn: () => fetchKrIntradayInvestorFlow(m),
      refetchInterval: FLOW_MS, staleTime: 30_000,
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
  const { data: etfPx } = useQuery({
    queryKey: ["semi-dash-etf-px"], queryFn: () => fetchTossPrices(ETFS.map(e => e.code)),
    refetchInterval: 5_000, staleTime: 3_000,   // 팝업 위 줄에도 KODEX 200·코스닥150(사용자 2026-10-27 — 반도체 수급 탭 첫 줄처럼)
  });
  const eq = (code: string) => {
    const t = etfPx?.find(p => p.ticker === code);
    return t && t.prevClose > 0 ? { price: t.price, pct: ((t.price - t.prevClose) / t.prevClose) * 100 } : undefined;
  };
  const sq = (code: string): { price?: number; pct?: number } | undefined => {
    const t = tossPx?.find(p => p.ticker === code);
    if (t && t.prevClose > 0) return { price: t.price, pct: ((t.price - t.prevClose) / t.prevClose) * 100 };
    return q(`${code}.KS`);
  };
  // 어제 종가 = 지금 가격 ÷ (1 + 등락률) — 실시간 체결 가격 글자 옆 % 용
  const [tickVis, setTickVis] = useState<number | null>(null);   // 두 체결 칸 공통 확대 상태
  const [tickHovT, setTickHovT] = useState<string | null>(null);   // 두 체결 칸 공통 마우스 분
  const tickLink = { vis: tickVis, setVis: setTickVis, hovT: tickHovT, setHovT: setTickHovT };
  // 종목 수급 오늘 잠정치(토스 — KRX 장중 잠정, 외국인·기관·연기금. 개인은 장 마감 뒤) — 실시간 체결 칸 한 줄(사용자 2026-11-04)
  const todayInv = useQueries({
    queries: stocks.map(s => ({
      queryKey: ["semi-today-inv", s.code], queryFn: () => fetchInvestorHistory(s.code, 2),
      refetchInterval: 60_000, staleTime: 30_000, retry: 1,
    })),
  });
  const invOf = (i: number) => { const r = todayInv[i]?.data?.[0]; return r && r.date === new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10) ? r : undefined; };
  // 프로그램 누적 기록(한투, lib/futuresTape — 삼성·하이닉스만) — 기록기가 1분마다 새로 쓰면 다시 읽는다
  const [progTick, setProgTick] = useState(0);
  useEffect(() => { const on = () => setProgTick(t => t + 1); window.addEventListener(TAPE_EVENT, on); return () => window.removeEventListener(TAPE_EVENT, on); }, []);
  const progOf = (code: string) => { void progTick; return kisFutAvailable() && PROG_CODES.some(([c]) => c === code) ? loadProgTape(code) : undefined; };
  const baseOf = (code: string) => { const x = sq(code); return x?.price && x.pct != null ? x.price / (1 + x.pct / 100) : undefined; };
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
  const sig: { t: string; c: string; d?: string; code?: string }[] = [];   // code = 그 종목 신호(없으면 시장 공통)
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
      sig.push({ code: s.code, t: `${s.name} 5분 ${sideWord(st5)} — 체결강도 ${st5.toFixed(0)} · ${netWord(n5)}`, c: st5 >= 120 ? "text-rose-600" : st5 <= 80 ? "text-blue-600" : "text-gray-700",
        d: `최근 5분 시장가로 사고 들어온 양이 팔고 나간 양의 ${(st5 / 100).toFixed(1)}배${st5 >= 100 ? " — 사는 쪽이 급하다" : " — 파는 쪽이 급하다"}. 120↑ 매수 우위 · 80↓ 매도 우위.` });
      const p0 = ms[Math.max(0, ms.length - 6)].close, p1 = ms[ms.length - 1].close;
      if (p1 > p0 && n5 < 0) sig.push({ code: s.code, t: `${s.name} 가격↑ 인데 체결은 매도 우위 (엇갈림)`, c: "text-amber-600", d: "오르는데 파는 체결이 더 많다 — 오름세 힘이 빠지는 신호일 수 있다." });
      if (p1 < p0 && n5 > 0) sig.push({ code: s.code, t: `${s.name} 가격↓ 인데 체결은 매수 우위 (엇갈림)`, c: "text-amber-600", d: "내리는데 사는 체결이 더 많다 — 저가 매수가 받치는 중일 수 있다." });
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
  // 시장 대표 ETF 카드 — 팝업엔 넣지 않는다. 순서: 코스피 · 코스피200(KODEX 200) · 코스닥 · 코스닥150(사용자 요청 2026-10-23)
  const etfCard = (i: 0 | 1) => {
    const e = ETFS[i], qq = eq(e.code);
    // ETF 는 NXT(넥스트레이드)에 없다 — 정규장(15:30) 마감에 지수 카드와 같이 흐리게(사용자 지적 2026-10-23)
    return <Card title={e.name} price={qq?.price} pct={qq?.pct} unit="원" dim={!openIndex}
                 chart={<KrDaySparkline code={e.code} fallback={[]} live={qq?.price} width={300} height={70} className="w-full h-full" volume />} />;
  };
  const marketCards = (<>
        <Card title="코스피" price={q("^KS11")?.price} pct={q("^KS11")?.pct} dim={!openIndex}
              chart={spark?.get("^KS11") && <SparkBg sp={spark.get("^KS11")!} base={q("^KS11")?.prevClose} />} />
        {etfCard(0)}
        {/* 코스닥 — 사용자 요청(2026-10-21). 기준선은 카드 전일 종가(야후 ^KQ11 previousClose 가 그저께 값일 때가 있다) */}
        <Card title="코스닥" price={q("^KQ11")?.price} pct={q("^KQ11")?.pct} dim={!openIndex}
              chart={spark?.get("^KQ11") && <SparkBg sp={spark.get("^KQ11")!} base={q("^KQ11")?.prevClose} />} />
        {etfCard(1)}
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
              chart={vkChart && vkChart.length > 1 && <Sparkline data={vkChart} width={300} height={70} className="w-full h-full" strokeWidth={1.2}
                                                               color={vk && vk.pct > 0 ? "#dc2626" : "#2563eb"} />} />
  </>);

  // 지금 신호 칸 — 팝업은 한 칸에 전부, 반도체 탭은 종목별 칸(그 종목 체결 아래)과 시장 공통(옵션 칸 아래)으로 나눈다(사용자 2026-11-04)
  const sigList = (items: typeof sig, empty: string) => (
    <div className="space-y-1 overflow-auto min-h-0">
      {items.length ? items.map((n, i) => (
        <div key={i} className="leading-snug">
          <div className={`font-semibold ${n.c}`}>• {n.t}</div>
          {n.d && <div className="pl-2.5 text-[11px] text-gray-500">{n.d}</div>}
        </div>))
        : <div className="text-gray-400 text-[11.5px]">{empty}</div>}
    </div>
  );
  const sigBox = (title: string, items: typeof sig, empty: string, foot?: boolean, cls = "") => (
        <div className={`pg-card rounded-lg border border-gray-200 bg-white p-2 flex flex-col min-h-0 overflow-hidden w-full ${cls}`}>
          {/* 지금 신호 — 가설 검증 탭은 뺐다(사용자 2026-11-04 "가설검증은 삭제") */}
          <div className="flex items-baseline gap-1 mb-1 border-b">
            <span className="px-2 pb-1 -mb-px border-b-2 border-blue-500 font-bold text-gray-900">{title}</span>
            <span className="ml-1 text-[11px] text-gray-400">숫자로 확인되는 것만</span>
          </div>
          {sigList(items, empty)}
          {foot && (
            <div className="mt-auto pt-2 border-t text-[11px] text-gray-500 leading-snug">
              체결강도 = 매수 체결량 ÷ 매도 체결량 × 100 (100 위 = 사는 쪽 우위). 큰 체결 = 1억 원 이상(5건이 안 되면 5천만 · 3천만 · 1천만으로 낮춤).
            </div>
          )}
        </div>
  );
  const signalBox = sigBox("지금 신호", sig, "체결을 모으는 중… (1~2분)", true);

  // ⚡ 종목정보 실시간 탭(한 종목) — 시장 수급 칸 대신 **이 종목** 것만(사용자 요청 2026-10-23 재설계):
  //   ① 종목 카드 + 시장 맥락 칩 ② 체결(크게) + 신호 ③ 호가 | 거래원 | 프로그램·투자자 ④ 새 소식 | 커뮤니티
  if (popup) {
    const s0 = stocks[0], qq = sq(s0.code);
    const futOn = kisFutAvailable() && hasStockFutures(s0.code);
    return (
      <div className="flex flex-col gap-1.5 p-2 text-[12px] bg-gray-50 pg-bg">
        {/* 종목 카드 + 시장 카드(반도체 탭과 같은 그래프 카드 — 칩 한 줄보다 낫다, 사용자 요청 2026-10-23) */}
        {/* 종목 1.4칸 + 시장 카드 8장 — 반도체 수급 탭 첫 줄(코스피·KODEX 200·코스닥·KODEX 코스닥150·선물 둘·V-KOSPI) + 환율.
            나스닥 선물·반도체 선물은 뺐다(사용자 2026-10-27) */}
        {/* 원달러 환율 카드는 뺐다 — 선물 칸이 좁아 가격이 줄넘김(사용자 2026-11-02 "좁으면 원달러 환율 삭제") */}
        {/* 선물 칸 — 주식선물이 걸린 종목(201개)이고 앱에서 한국투자 연동이 켜졌을 때만, 종목 카드 바로 옆(사용자 2026-11-02) */}
        <div className={`grid grid-cols-3 gap-1.5 auto-rows-[118px] shrink-0 ${futOn ? "lg:grid-cols-[1.4fr_repeat(8,minmax(0,1fr))]" : "lg:grid-cols-[1.4fr_repeat(7,minmax(0,1fr))]"}`}>
          <Card title={s0.name} price={qq?.price} pct={qq?.pct} unit="원" dim={!openStock}
                chart={<KrDaySparkline code={s0.code} fallback={[]} live={qq?.price} width={300} height={70} className="w-full h-full" volume />} />
          {futOn && <StockFutCard code={s0.code} spot={qq?.price} dim={!openStock} />}
          {marketCards}
        </div>
        <ValueupStrip code={s0.code} />
        {kisFutAvailable() && <KisViStrip code={s0.code} />}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-1.5 min-h-0 auto-rows-[360px]">   {/* 체결 · 신호 반반(사용자 요청) */}
          <TickPanel name={s0.name} flow={ticks[0]} day={dayStr?.get(s0.code)} base={baseOf(s0.code)} prog={progOf(s0.code)} inv={invOf(0)} price={sq(s0.code)?.price} kospi={ksToday?.points.map(p => ({ t: p.t, v: p.c }))} kospiBase={q("^KS11")?.prevClose} />
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
      {/* 해외 선물·메모리 현물·미국 반도체 — 맨 위(사용자 2026-11-04) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-1.5 shrink-0">
        <ChipBox title="해외 선물 (24h)" items={[
          ...(["SOX=F", "NQ=F"].map(s => q(s)).filter((x): x is UsIndex => !!x).map(x => ({ k: x.symbol, name: x.symbol === "SOX=F" ? "SOX선물" : "나스닥선물", pct: x.pct }))),
          ...PERPS.map(([c, n]) => ({ k: c, name: n, pct: (perps?.get(c) as HlPerp | undefined)?.changePct })),
        ]} />
        <ChipBox title="메모리 현물" items={MEM_ROW.map(s => q(s)).filter((x): x is UsIndex => !!x).map(x => ({ k: x.symbol, name: x.name.replace(/\(.*\)/, ""), pct: x.pct }))} />
        <ChipBox title="미국 반도체 (간밤)" items={US_ROW.map(s => q(s)).filter((x): x is UsIndex => !!x).map(x => ({ k: x.symbol, name: x.name.replace(/\(.*\)/, ""), pct: x.regularPct ?? x.pct }))} />
      </div>
      {/* ① 시세 */}
      <div className="grid grid-cols-2 lg:grid-cols-9 gap-1.5 auto-rows-[118px] shrink-0">
        {stocks.map(s => {
          const qq = sq(s.code);
          return <Card key={s.code} title={s.name} price={qq?.price} pct={qq?.pct} unit="원" dim={!openStock}
                       chart={<KrDaySparkline code={s.code} fallback={[]} live={qq?.price} width={300} height={70} className="w-full h-full" volume />} />;
        })}
        {marketCards}
        {/* 필라델피아 반도체(지수) 카드는 뺐다 — 한국 장중엔 간밤 미국 종가라 안 움직인다(사용자 요청). SOX 선물은 아래 해외 선물 줄 */}
      </div>

      {/* ② 종목별 묶음 — 왼쪽 삼성·오른쪽 하이닉스: 실시간 체결(프로그램 보라 선 포함) → 그 종목 신호(사용자 2026-11-04). 따로 있던 프로그램 매매 그래프는 뺐다("실시간 체결에 들어가서 삭제해도") */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-1.5 shrink-0">
        {stocks.map((s, i) => (
          <div key={s.code} className="flex flex-col gap-1.5 min-w-0">
            <div className="h-[440px] lg:h-[470px] grid min-h-0">   {/* + 아래 1분 띠 둘(체결·프로그램) */}
              <TickPanel name={s.name} flow={ticks[i]} day={dayStr?.get(s.code)} base={baseOf(s.code)} prog={progOf(s.code)} inv={invOf(i)} price={sq(s.code)?.price} link={tickLink} kospi={ksToday?.points.map(p => ({ t: p.t, v: p.c }))} kospiBase={q("^KS11")?.prevClose} onTitle={popup ? undefined : () => openStockInfo(s.code, s.name)} />
            </div>
            {sigBox(`${s.name} 신호`, sig.filter(n => n.code === s.code), "체결을 모으는 중… (1~2분)", false, "max-h-[150px]")}   {/* 내용만큼 — 신호가 한두 줄이면 빈 칸이 컸다(사용자 2026-11-04) */}
          </div>
        ))}
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
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_1fr_1.1fr] gap-1.5 lg:auto-rows-[minmax(400px,auto)] shrink-0">   {/* 최소 400 — 투자자를 많이 켜면 막대 줄만큼 늘어난다(고정 400 이면 아래 줄 위로 넘쳤다, 사용자 지적) */}
        {/* 코스피·코스닥 현물을 나란히(전환 버튼 없이 바로 — 사용자 요청) */}
        <FlowBox title="현물 · 코스피" note="1분" axis={flowAxis} flow={kf} unit="억" preFlow={kospiNxt} dim={!(kfToday && openFlow)} hoverM={flowHover} onHover={setFlowHover} lines={flowLines} bg={ksToday?.points.map(p => ({ t: p.t, v: p.c }))} bgBase={q("^KS11")?.prevClose} />
        <FlowBox title="선물 · 코스피200" axis={flowAxis} note="20분 지연(코스닥150 선물 수급은 소스 없음)" flow={ff} unit="계약" dim={!(ffToday && openFlow)} hoverM={flowHover} onHover={setFlowHover} lines={flowLines}
                 bg={futToday} bgBase={fut ? fut.price - fut.chg : undefined} endHM="15:45" />
        <FlowBox title="현물 · 코스닥" note="1분" axis={flowAxis} flow={kqFlow} unit="억" preFlow={kosdaqNxt} dim={!(kqFlow?.date === todayIso && openFlow)} hoverM={flowHover} onHover={setFlowHover} lines={flowLines} bg={kqToday?.points.map(p => ({ t: p.t, v: p.c }))} bgBase={q("^KQ11")?.prevClose} />
        {/* 옵션·종목 수급은 한 칸에 세로로 — 남는 폭을 수급 그래프 세 칸에(사용자 요청 2026-10-23) */}
        <div className="grid grid-rows-[auto_1fr] gap-1.5 min-h-0">   {/* 위 = 옵션, 아래 = 시장 공통 신호(사용자 2026-11-04) */}
        {/* 종목 수급 표는 뺐다(사용자 2026-11-04 "삭제") */}
        <OptionBox opt={opt} vk={vk} dim={!openFut} />
        {sigBox("시장 신호", sig.filter(n => !n.code), "아직 없음 — 코스피 외국인·선물·옵션 신호가 여기에", false, "max-h-[300px]")}   {/* 길어지면 안에서 스크롤 — 줄 높이를 밀어 올리지 않게 */}
        </div>
      </div>

      {/* 외국인 K200 선물 — 누적 순매수·정리율·15분 변화 + 시장 미결제약정(사용자 2026-11-03) */}
      <ForeignFuturesPanel flow={ff} fut={fut} spotFlow={kf} price={futToday} kospi={ksToday?.points.map(p => ({ t: p.t, v: p.c }))} kospiBase={q("^KS11")?.prevClose} />

    </div>
  );
}

// VI 발동(오늘, 한국투자) — 있을 때만 한 줄(사용자 2026-11-02). 1분마다
function KisViStrip({ code }: { code: string }) {
  const q = useQuery({ queryKey: ["kis-vi", code], queryFn: () => fetchKisViToday(code), refetchInterval: 60_000, staleTime: 30_000, retry: 1 });
  const ev = q.data ?? [];
  if (!ev.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-[11.5px]">
      <b className="text-amber-800">⚡ VI 발동 {ev.length}회</b>
      {ev.map((e, i) => (
        <span key={i} className={`px-1.5 rounded tabular-nums ${e.dir === "상승" ? "bg-rose-100 text-rose-700" : e.dir === "하락" ? "bg-blue-100 text-blue-700" : "bg-white text-gray-700"}`}>
          {e.time} {e.kind}{e.dir ? `·${e.dir}` : ""}{e.price ? ` ${e.price.toLocaleString()}` : ""}
        </span>
      ))}
      <span className="text-[10px] text-gray-400 ml-auto">변동성 완화장치 — 2분간 단일가 · 한투</span>
    </div>
  );
}

// 주식선물 근월물 카드(종목정보 창) — 한국투자 Open API(lib/kisFutures). 현물과 등락이 거의 같아 현물에 없는 것을 아래 줄에:
//   베이시스(선물 − 현물, 현물 대비 %) · 미결제약정(증감). % = 선물 전일 종가 대비.
function StockFutCard({ code, spot, dim }: { code: string; spot?: number; dim?: boolean }) {
  const q = useQuery({ queryKey: ["kis-fut-quote", code], queryFn: () => fetchKisFutQuote(code), refetchInterval: 10_000, staleTime: 5_000, retry: 1 });
  const d = useQuery({ queryKey: ["kis-fut-day", code], queryFn: () => fetchKisFutDay(code), refetchInterval: 60_000, staleTime: 30_000, retry: 1 });
  const f = q.data;
  const basis = f && spot && spot > 0 ? (f.price / spot - 1) * 100 : undefined;
  const sub = q.error ? `⚠️ ${(q.error as Error).message}`
    : f ? [basis != null ? `베이시스 ${basis >= 0 ? "+" : ""}${basis.toFixed(2)}%` : "",
           f.oi != null ? `미결제 ${f.oi.toLocaleString()}${f.oiChg ? `(${f.oiChg > 0 ? "+" : ""}${f.oiChg.toLocaleString()})` : ""}` : ""].filter(Boolean).join(" · ")
    : undefined;
  const s = d.data;
  // 제목 = "선물 11월물"(코드 끝 두 자리 = 만기 월) — 코드(A50611)만으론 무엇인지 몰랐다. (사용자 2026-11-02)
  const month = f?.code ? `${Number(f.code.slice(-2))}월물` : "";
  return <Card title={`선물 ${month}`} price={f?.price} pct={f?.pct} unit="원" sub={sub} dim={dim}
               chart={s && s.closes.length > 1 && <Sparkline data={s.closes} xs={s.xs} baseline={s.base ?? f?.base} markXs={s.markXs}
                                                            width={300} height={70} className="w-full h-full" strokeWidth={1.2} />} />;
}

function Card({ title, price, pct, sub, chart, unit, dim: dimIn }: {
  title: string; price?: number; pct?: number; sub?: string; chart?: React.ReactNode; unit?: string;
  dim?: boolean;   // 거래 시간이 아니면 흐리게(지수 탭 카드와 같은 '쉬는 중' 표시, 사용자 요청)
}) {
  const dim = dimIn && getDimSleepingEnabled();   // 설정 "장 마감 시 종목 흐리게" 를 따른다(사용자 지적 2026-10-23)
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
                    baseline={s.base} prevBaseline={s.prevBase} markIndex={s.openIdx} closeIndex={s.closeIdx} extraMarks={[s.prevOpenIdx, s.prevCloseIdx]} markXs={s.markXs} breakIndex={s.breakIdx} />;
}

// base = 카드의 전일 종가(한국 지수는 야후 previousClose 가 틀릴 때가 있어 카드 값을 우선)
function SparkBg({ sp, base }: { sp: { nextBase?: number; markXs?: { x: number; close?: boolean }[]; closes: number[]; xs?: number[]; openIdx?: number; closeIdx?: number; prevOpenIdx?: number; prevCloseIdx?: number; prevClose?: number; breakIdx?: number; prevBase?: number }; base?: number }) {
  return <Sparkline data={sp.closes} xs={sp.xs} width={300} height={70} className="w-full h-full" strokeWidth={1.2}
                    baseline={base && base > 0 ? base : sp.prevClose} markIndex={sp.openIdx} closeIndex={sp.closeIdx} extraMarks={[sp.prevOpenIdx, sp.prevCloseIdx]} markXs={sp.markXs} breakIndex={sp.breakIdx} prevBaseline={sp.prevBase} nextBaseline={sp.nextBase} />;
}

const TICK_SCROLL = "semi-tick-scroll";   // 종목 칸끼리 좌우 위치 맞추기
interface TickLink { vis: number | null; setVis: React.Dispatch<React.SetStateAction<number | null>>; hovT: string | null; setHovT: (t: string | null) => void }

// 종목 실시간 체결 — 1분 막대(순매수 체결 금액, 위 빨강·아래 파랑) + 가격 선(회색) + 누적 순매수 선(주황)
//   onTitle — 제목을 누르면 ⚡ 종목 체결 팝업(같은 화면을 이 종목 하나로)
function TickPanel({ name, flow, day, onTitle, base, prog, inv, price, link, kospi, kospiBase }: { name: string; flow: TickFlow; day?: DayStrength; onTitle?: () => void; base?: number; prog?: ProgPt[]; inv?: Investor; price?: number; link?: TickLink; kospi?: { t: string; v: number }[]; kospiBase?: number }) {   // kospi = 배경 코스피 1분   // inv = 오늘 투자자 잠정치(토스)   // prog = 오늘 프로그램 누적(억원, 한투)   // base = 어제 종가(가격 글자 옆 등락률)
  // 최근 1시간만 한 화면 폭에, 그 전은 왼쪽으로 스크롤(사용자 2026-11-04 "1시간으로, 지난 건 스크롤로") — 오늘 켠 뒤 전부 그린다
  const ms = flow.minutes;
  // 한 화면 분 수 — 기본 1시간, 마우스 휠로 확대(10분까지)·축소(켠 뒤 전부까지)(사용자 2026-11-04 "휠로 확대 축소")
  //   기본 = 켠 뒤 전부 한 화면(사용자 2026-11-04 "전체를 보여주는 걸 기본으로") — null 이면 전체
  //   두 종목 칸은 확대·축소와 좌우 위치가 같이 움직인다(사용자 2026-11-04 "두 개가 같이 연동") — 부모가 vis 를 쥐면 그걸 쓴다
  const [visLocal, setVisLocal] = useState<number | null>(null);
  const vis = link ? link.vis : visLocal;
  const setVis = link ? link.setVis : setVisLocal;
  const ALL = Math.max(10, ms.length);   // 전체 = 켠 뒤 분 수 그대로 폭을 채운다(처음엔 넓게, 쌓이면서 좁아짐 — 사용자 2026-11-05)
  const VIS = vis == null ? ALL : Math.min(vis, ALL);
  const sc = Math.max(1, ms.length / VIS);              // 그래프 폭 배율(1 = 한 화면)
  const W = 600 * sc, H = 220, PAD = 4;
  const scRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const drag = useRef<{ x: number; left: number } | null>(null);
  // 마우스 분 — 두 종목 칸이 같은 시각으로 같이 움직인다(사용자 2026-11-05 "삼전 하닉 같이"). 분 시각(HH:MM)으로 나눠 쓴다
  const [hovLocal, setHovLocal] = useState<string | null>(null);
  const hovT = link ? link.hovT : hovLocal;
  const setHovT = link ? link.setHovT : setHovLocal;
  const hovI = hovT ? ms.findIndex(m => m.t === hovT) : -1;
  const hov = hovI >= 0 ? { i: hovI } : null;   // 마우스로 끌기 시작점                           // 오른쪽 끝(지금)에 붙어 있나 — 사용자가 지난 쪽을 보는 중이면 새 분이 와도 안 끌고 간다
  useEffect(() => { const el = scRef.current; if (el && stick.current) el.scrollLeft = el.scrollWidth; }, [ms.length]);
  // 휠 — 마우스 자리를 기준점으로 확대·축소(오른쪽 끝에 붙어 있었으면 계속 끝에). 가로 휠(트랙패드 좌우)은 그대로 스크롤.
  //   React onWheel 은 passive 라 페이지 스크롤을 못 막는다 → 직접 등록
  const zoomAt = useRef<{ fx: number; px: number } | null>(null);
  const syncing = useRef(false);
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ from: string; gap: number }>).detail, el = scRef.current;
      if (!el || d.from === name) return;
      const left = Math.max(0, el.scrollWidth - el.clientWidth - d.gap * el.scrollWidth);
      if (Math.abs(el.scrollLeft - left) < 1) return;
      syncing.current = true;
      el.scrollLeft = left;
    };
    window.addEventListener(TICK_SCROLL, on);
    return () => window.removeEventListener(TICK_SCROLL, on);
  }, [name]);
  const msLen = useRef(ms.length); msLen.current = ms.length;
  const hasChart = ms.length > 0;
  useEffect(() => {
    const el = scRef.current;
    if (!el) return;
    const on = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      const r = el.getBoundingClientRect(), px = e.clientX - r.left;
      zoomAt.current = { fx: (px + el.scrollLeft) / el.scrollWidth, px };
      setVis(v => {
        const all = Math.max(10, msLen.current);
        const n = Math.max(10, Math.round((v ?? all) * (e.deltaY > 0 ? 1.2 : 1 / 1.2)));
        return n >= all ? null : n;   // 끝까지 줄이면 다시 '전체'(새 분이 와도 계속 전체)
      });
    };
    el.addEventListener("wheel", on, { passive: false });
    return () => el.removeEventListener("wheel", on);
  }, [hasChart]);
  useLayoutEffect(() => {
    const el = scRef.current, z = zoomAt.current;
    if (el && !z && stick.current) { el.scrollLeft = el.scrollWidth; return; }   // 옆 칸이 확대했을 때 — 끝에 붙어 있었으면 계속 끝
    if (!el || !z) return;
    zoomAt.current = null;
    el.scrollLeft = stick.current ? el.scrollWidth : z.fx * el.scrollWidth - z.px;
  }, [vis]);
  const nets = ms.map(m => m.buyAmt - m.sellAmt);
  let acc = 0;
  const cum = nets.map(v => (acc += v));
  // 프로그램 순매수(한투, 사용자 2026-11-04 "실시간 체결 그래프에 프로그램 매매도") — 그래프 왼쪽 끝 분을 0으로 맞춰 주황 누적(켠 뒤 합계)과 **같은 축**(원)에.
  //   둘이 같이 가면 프로그램이 끄는 흐름, 엇갈리면 다른 주체(개인·일반 외국인)가 반대로 사는 흐름
  const progAt = (t: string) => { if (!prog?.length) return null; let v: number | null = null; for (const p of prog) { if (p.t <= t) v = p.v; else break; } return v; };
  const p0 = ms.length ? (progAt(ms[0].t) ?? prog?.[0]?.v ?? null) : null;
  const progLine = p0 == null ? [] : ms.map(m => { const v = progAt(m.t); return v == null ? null : (v - p0) * 1e8; });
  // 누적(주황)·프로그램(보라)은 **축 따로** — 프로그램이 수천억이라 같은 축이면 켠 뒤 누적(수백억)이 0선에 붙어 안 움직였다(사용자 2026-11-04)
  const mxCum = Math.max(1, ...cum.map(Math.abs));
  // 프로그램 매수(위)·매도(아래) — 화면 시작 시각부터 늘어난 양(원). 순매수(보라)와 같은 축(사용자 2026-11-05 "매수/매도 같이")
  const progBS = (k: "b" | "s") => {
    if (!prog?.some(p => p[k] != null)) return [] as (number | null)[];
    const at = (t: string) => { let v: number | null = null; for (const p of prog) { if (p.t <= t) v = p[k] ?? v; else break; } return v; };
    const z = ms.length ? (at(ms[0].t) ?? prog.find(p => p[k] != null)?.[k] ?? null) : null;
    return z == null ? [] : ms.map(m => { const v = at(m.t); return v == null ? null : (v - z) * 1e8; });
  };
  const progBuy = progBS("b"), progSell = progBS("s");
  // 프로그램 1분 막대 — 분마다 늘어난 매수·매도(원)(사용자 2026-11-05 "프로그램 매도/매수도 1분봉으로"). 앞 분 값이 없으면 비운다
  const progMin = ms.map((_, i) => {
    if (i === 0) return null;
    const b1 = progBuy[i], b0 = progBuy[i - 1], s1 = progSell[i], s0 = progSell[i - 1];
    if (b1 == null || b0 == null || s1 == null || s0 == null) return null;
    return { b: Math.max(0, b1 - b0), s: Math.max(0, s1 - s0) };
  });
  const hasProgMin = progMin.some(x => x && (x.b || x.s));

  const mxProg = Math.max(1, ...progLine.map(v => Math.abs(v ?? 0)));
  const prices = ms.map(m => m.close);
  // 가격 축은 최소 ±0.2% 폭 — 켠 직후 한 호가(0.1%)만 움직여도 위아래 끝까지 그어져 세로선처럼 보였다
  const pMid = (Math.min(...prices) + Math.max(...prices)) / 2;
  const pR = Math.max(Math.max(...prices) - Math.min(...prices), pMid * 0.004) * 1.45, pMin = pMid - pR / 2;
  // 오른쪽 여백 — 선 끝 글자(지금 가격·누적)가 선 **오른쪽**에 붙을 자리(사용자 2026-11-04 "금액이 선 오른쪽에, 오른쪽을 여유 있게")
  const RP = 150;   // 한 화면(600) 기준 25%
  const bw = (W - PAD - RP) / Math.max(VIS * sc, ms.length);
  const xOf = (i: number) => PAD + i * bw + bw / 2;
  // 선 끝 글자 셋(지금 가격·누적·프로그램) — 각자 선 높이를 따르되 겹치면 순서대로 쌓는다(사용자 2026-11-04 "안 겹치게 순서대로")
  const endTop = (() => {
    const out: Record<"price" | "cum" | "prog", number | null> = { price: null, cum: null, prog: null };
    const want: { k: keyof typeof out; y: number }[] = [];
    if (prices.length) want.push({ k: "price", y: ((PAD + (1 - (prices[prices.length - 1] - pMin) / pR) * (H - PAD * 2)) / H) * 100 });
    if (cum.length) want.push({ k: "cum", y: (((H / 2) - (cum[cum.length - 1] / mxCum) * ((H / 2) - PAD)) / H) * 100 });
    const pl = [...progLine].reverse().find(v => v != null);
    if (pl != null) want.push({ k: "prog", y: (((H / 2) - (pl / mxProg) * ((H / 2) - PAD)) / H) * 100 });
    const GAP = 9, LO = 5, HI = 93;
    want.sort((a, b) => a.y - b.y);
    const ys = want.map(w => Math.max(LO, Math.min(HI, w.y)));
    for (let i = 1; i < ys.length; i++) ys[i] = Math.max(ys[i], ys[i - 1] + GAP);           // 아래로 밀고
    for (let i = ys.length - 1; i >= 0; i--) { if (ys[i] > HI) ys[i] = HI; if (i > 0 && ys[i - 1] > ys[i] - GAP) ys[i - 1] = ys[i] - GAP; }   // 바닥을 넘으면 위로
    want.forEach((w, i) => { out[w.k] = ys[i]; });
    return out;
  })();
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
        {vis != null && <button onClick={() => { stick.current = true; setVis(null); }} title="켠 뒤 전부를 한 화면으로 되돌리기" className="text-[10.5px] text-gray-500 border border-gray-300 rounded px-1 hover:bg-gray-50">{vis}분 보기 · 전체로</button>}
        <KisWsBadge />
      </div>
      <div className="flex gap-3 tabular-nums my-1">
        <Stat label="체결강도 1분" v={st1} />
        <Stat label="5분" v={st5} />
        <Stat label="켠 뒤 전체" v={stAll} />
        <span className="ml-auto">5분 <b className={up(netAmt(ms, 5))}>{netWord(netAmt(ms, 5))}</b> · 켠 뒤 <b className={up(netAmt(ms))}>{netWord(netAmt(ms))}</b>
          {(() => { const pl = prog?.[prog.length - 1]; return pl ? <> · <span className="text-violet-700">프로그램</span> <b className={up(pl.v)} title="오늘 프로그램 누적 순매수(한투) — 그래프의 보라 점선은 화면 시작 시각부터">{netWord(pl.v * 1e8)}</b>
            {pl.b != null && pl.s != null && <span className="text-[10.5px] text-gray-500" title="오늘 프로그램 누적 매수·매도(한투)"> (매수 <b className="text-rose-600">{Math.round(pl.b).toLocaleString()}</b> · 매도 <b className="text-blue-600">{Math.round(pl.s).toLocaleString()}</b>억)</span>}</> : null; })()}
        </span>
      </div>
      {/* 오늘 하루 전체 — 토스 체결강도(장 시작부터 누적)로 역산. 켜기 전 구간까지 포함된 유일한 값 */}
      {day && (
        <div className="flex gap-3 tabular-nums -mt-0.5 mb-1 text-[11.5px]">
          <span className="text-gray-500">오늘 전체 체결강도 <b className={day.strength >= 100 ? "text-rose-600" : "text-blue-600"}>{day.strength.toFixed(0)}</b></span>
          <span className="text-gray-500">오늘 전체 <b className={up(day.netAmt)}>{netWord(day.netAmt)}</b> <span className="text-[10px] text-gray-400">(체결강도·거래대금 {Math.round(day.value / 1e8).toLocaleString()}억 역산)</span></span>
        </div>
      )}
      {/* 투자자 수급(오늘) — 토스 KRX 잠정치: 외국인·기관·연기금. 개인은 장중엔 안 나와 −(외국인+기관)으로 추정(사용자 2026-11-04) */}
      {inv && (inv.외국인 || inv.기관) ? (() => {
        const px = price ?? inv.종가 ?? 0;
        // 억원(주 × 지금 가격)으로 — 한 줄에 들어가게. 주 수는 마우스를 올리면
        const cell = (label: string, q: number, est?: boolean) => {
          const e = px > 0 ? (q * px) / 1e8 : null;
          return (
            <span className="whitespace-nowrap" title={`${label}${est ? "(추정)" : ""} ${q > 0 ? "+" : ""}${Math.round(q).toLocaleString()}주`}>
              <span className="text-gray-500">{label}{est ? "(추정)" : ""}</span>{" "}
              <b className={up(q)}>{e != null ? `${e > 0 ? "+" : e < 0 ? "−" : ""}${Math.abs(Math.round(e)).toLocaleString()}억` : `${q > 0 ? "+" : ""}${Math.round(q / 1000).toLocaleString()}천주`}</b>
            </span>
          );
        };
        const est = !inv.개인있음;
        const indiv = est ? -(inv.외국인 + inv.기관) : inv.개인;
        return (
          <div className="flex flex-wrap gap-x-3 tabular-nums -mt-0.5 mb-1 text-[11.5px]"
               title={`토스(KRX 잠정치) ${inv.갱신 ? inv.갱신.slice(11, 16) + " 갱신" : ""} — 장중엔 하루 몇 번 갱신되는 잠정치. 개인은 장 마감 뒤에 나와 그 전엔 −(외국인+기관)으로 추정. 억원 = 주 × 지금 가격`}>
            <span className="text-gray-500">수급{inv.갱신 ? ` ${inv.갱신.slice(11, 16)}` : ""}</span>
            {cell("외국인", inv.외국인)}{cell("기관", inv.기관)}{cell("연기금", inv.연기금)}{cell("개인", indiv, est)}
          </div>
        );
      })() : null}
      <div className="flex-1 min-h-0 flex gap-2">
        <div className="flex-1 min-w-0">
          {ms.length < 1 ? <div className="h-full flex items-center justify-center text-gray-400">체결을 모으는 중…</div> : (<div ref={scRef}
                 // 스크롤바는 숨기고 마우스로 끌어서 옮긴다(사용자 2026-11-04 "스크롤바가 아니라 마우스로 클릭해서 이동") — 터치는 그냥 밀면 된다
                 className={`w-full h-full overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden select-none ${sc > 1 ? "cursor-grab active:cursor-grabbing" : ""}`}
                 onScroll={e => {
                   const el = e.currentTarget;
                   stick.current = el.scrollLeft + el.clientWidth >= el.scrollWidth - 8;
                   // 남이 옮겨 준 스크롤이면 다시 알리지 않는다(되먹임 방지). 오른쪽 끝에서 몇 % 떨어졌나로 맞춘다 — 두 칸 길이가 조금 달라도 같은 시각대
                   if (syncing.current) { syncing.current = false; return; }
                   window.dispatchEvent(new CustomEvent(TICK_SCROLL, { detail: { from: name, gap: (el.scrollWidth - el.clientWidth - el.scrollLeft) / el.scrollWidth } }));
                 }}
                 onPointerDown={e => { if (sc <= 1 || e.pointerType !== "mouse") return; drag.current = { x: e.clientX, left: e.currentTarget.scrollLeft }; e.currentTarget.setPointerCapture(e.pointerId); }}
                 onPointerMove={e => {
                   const el = e.currentTarget;
                   if (drag.current) { el.scrollLeft = drag.current.left - (e.clientX - drag.current.x); setHovT(null); return; }
                   if (e.pointerType !== "mouse") return;
                   // 마우스 x → 그래프 내부 좌표 → 가장 가까운 분
                   const r = el.getBoundingClientRect();
                   const gx = ((e.clientX - r.left + el.scrollLeft) / el.scrollWidth) * W;
                   const i = Math.round((gx - PAD - bw / 2) / bw);
                   setHovT(i >= 0 && i < ms.length ? ms[i].t : null);
                 }}
                 onPointerLeave={() => setHovT(null)}
                 onPointerUp={e => { drag.current = null; e.currentTarget.releasePointerCapture(e.pointerId); }}>
            <div className="h-full flex flex-col relative" style={{ width: `${sc * 100}%` }}>
            {/* 마우스 분 세로선 + 정보 상자 */}
            {hov && <div className="absolute top-0 bottom-0 w-px bg-gray-500/60 pointer-events-none z-20" style={{ left: `${(xOf(hov.i) / W) * 100}%` }} />}
            {/* 마우스 분 — 세로선 위에 시각·가격 */}
            {hov && (() => { const m = ms[hov.i]; return (
              <div className="absolute top-0 z-30 pointer-events-none text-[10.5px] tabular-nums px-1 rounded bg-gray-800 text-white whitespace-nowrap"
                   style={{ left: `${(xOf(hov.i) / W) * 100}%`, transform: "translateX(-50%)" }}>
                {m.t} · {m.close.toLocaleString()}{base && base > 0 ? ` (${m.close >= base ? "+" : ""}${((m.close / base - 1) * 100).toFixed(2)}%)` : ""}
              </div>); })()}
            <div className="relative flex-1 min-h-0">
            {ms.length < 5 && <div className="absolute inset-x-0 bottom-1 text-center text-[11px] text-gray-400">켠 뒤 {ms.length}분째 — 10분쯤 지나면 흐름이 보입니다</div>}
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-full">
              {/* 배경 코스피 — 같은 분에 맞춰 연한 면(전일 종가 위 빨강·아래 파랑, 축 따로)(사용자 2026-11-05) */}
              {(() => {
                if (!kospi?.length) return null;
                const km = new Map(kospi.map(p => [p.t.slice(0, 5), p.v]));
                const pts = ms.map((m, i) => ({ i, v: km.get(m.t) })).filter((p): p is { i: number; v: number } => p.v != null && p.v > 0);
                if (pts.length < 2) return null;
                const vals = [...pts.map(p => p.v), ...(kospiBase && kospiBase > 0 ? [kospiBase] : [])];
                const lo = Math.min(...vals), hi = Math.max(...vals), r = hi - lo || 1;
                const ky = (v: number) => H * 0.08 + (1 - (v - lo) / r) * H * 0.84;
                const baseY = ky(kospiBase && kospiBase > 0 ? kospiBase : pts[0].v);
                const line = pts.map((p, k) => `${k ? "L" : "M"} ${xOf(p.i)} ${ky(p.v)}`).join(" ");
                const band = `${line} L ${xOf(pts[pts.length - 1].i)} ${baseY} L ${xOf(pts[0].i)} ${baseY} Z`;
                const cid = `tk-${name}`;
                return (<>
                  <defs>
                    <clipPath id={`${cid}u`}><rect x={0} y={0} width={W} height={baseY} /></clipPath>
                    <clipPath id={`${cid}d`}><rect x={0} y={baseY} width={W} height={Math.max(0, H - baseY)} /></clipPath>
                  </defs>
                  <path d={band} clipPath={`url(#${cid}u)`} fill="#fecdd3" fillOpacity={0.35} />
                  <path d={band} clipPath={`url(#${cid}d)`} fill="#bfdbfe" fillOpacity={0.35} />
                  {/* 테두리 선 — 현물 칸 배경과 같게(사용자 2026-11-05 "배경 그래프 아래처럼 라인도") */}
                  <path d={line} clipPath={`url(#${cid}u)`} fill="none" stroke="#fb7185" strokeOpacity={0.6} strokeWidth={1} vectorEffect="non-scaling-stroke" />
                  <path d={line} clipPath={`url(#${cid}d)`} fill="none" stroke="#60a5fa" strokeOpacity={0.6} strokeWidth={1} vectorEffect="non-scaling-stroke" />
                </>);
              })()}
              <line x1={0} x2={W} y1={mid} y2={mid} stroke="#cbd5e1" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
              <path d={prices.map((p, i) => `${i ? "L" : "M"} ${xOf(i)} ${PAD + (1 - (p - pMin) / pR) * (H - PAD * 2)}`).join(" ")}
                    fill="none" stroke="#334155" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
              <path d={cum.map((c, i) => `${i ? "L" : "M"} ${xOf(i)} ${mid - (c / mxCum) * (mid - PAD)}`).join(" ")}
                    fill="none" stroke="#ea580c" strokeWidth={1.2} strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
              {progLine.some(v => v != null) && (
                <path d={progLine.map((v, i) => v == null ? "" : `${progLine.slice(0, i).some(x => x != null) ? "L" : "M"} ${xOf(i)} ${mid - (v / mxProg) * (mid - PAD)}`).join(" ")}
                      fill="none" stroke="#7c3aed" strokeWidth={1.2} strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
              )}

            </svg>
            {/* 시각 글자 — svg 는 칸 크기로 늘어나(preserveAspectRatio none) 글자가 찌그러진다 → HTML 로(팝업에서 크게 깨졌다) */}
            {ms.map((m, i) => (Number(m.t.slice(3, 5)) % (VIS > 150 ? 60 : VIS > 90 ? 30 : VIS < 25 ? 5 : 10) === 0 ? (   /* 시각 글자 간격 — 확대·축소에 맞춰 */
              <span key={m.t} className="absolute bottom-0 -translate-x-1/2 text-[10px] text-gray-400 pointer-events-none" style={{ left: `${(xOf(i) / W) * 100}%` }}>{m.t}</span>
            ) : null))}
            {/* 프로그램 끝값 — 보라 */}
            {(() => {
              const li = progLine.length - 1 - [...progLine].reverse().findIndex(v => v != null);
              if (li < 0 || li >= progLine.length || progLine[li] == null) return null;
              const v = progLine[li]!, lx = (xOf(li) / W) * 100, ly = ((mid - (v / mxProg) * (mid - PAD)) / H) * 100;
              const cl = cum.length ? ((mid - (cum[cum.length - 1] / mxCum) * (mid - PAD)) / H) * 100 : -99;
              const dy = Math.abs(cl - ly) < 7 ? (ly < cl ? -7 : 7) : 0;   // 주황 누적 글자와 붙으면 벌린다
              // 지금 가격 글자(선 끝)와도 붙으면 반대쪽으로 더 벌린다
              const lp = prices.length ? ((PAD + (1 - (prices[prices.length - 1] - pMin) / pR) * (H - PAD * 2)) / H) * 100 : -99;
              // 실제로 놓일 자리(위·아래 끝에서 잘리는 값)로 비교 — 둘 다 바닥에 붙으면 위로 올린다
              void lp; void dy;
              return (<>
                {/* 점은 선 끝 그대로, 글자는 쌓인 자리(endTop) — 프로그램 값도 선 끝에(사용자 2026-11-04 "프로그램도 가격 있지 않아?") */}
                <span className="absolute w-2 h-2 rounded-full bg-violet-600 pointer-events-none" style={{ left: `${lx}%`, top: `${Math.max(2, Math.min(96, ly))}%`, transform: "translate(-50%, -50%)" }} />
                <span className="absolute pointer-events-none text-[11px] font-bold bg-white/80 px-0.5 rounded whitespace-nowrap text-violet-700"
                      style={{ left: `${lx}%`, top: `${endTop.prog ?? ly}%`, transform: "translate(8px, -50%)" }}>프로그램(오늘) {netWord((prog?.[prog.length - 1]?.v ?? 0) * 1e8)}</span>
              </>);
            })()}
            {/* 가격 글자(사용자 2026-11-04 "가격 그래프에 금액") — 최고·최저는 그 높이 왼쪽에, 지금 가격은 선 끝에. svg 가 늘어나므로 HTML 로 */}
            {prices.length > 1 && (() => {
              const yp = (p: number) => ((PAD + (1 - (p - pMin) / pR) * (H - PAD * 2)) / H) * 100;
              const hi = Math.max(...prices), lo = Math.min(...prices), last = prices[prices.length - 1];
              const hiI = prices.indexOf(hi), loI = prices.indexOf(lo);
              const lab = "absolute pointer-events-none text-[10px] tabular-nums px-0.5 rounded bg-white/80 whitespace-nowrap";
              const lx = (xOf(prices.length - 1) / W) * 100;
              const pc = (p: number) => base && base > 0 ? ` ${p >= base ? "+" : ""}${((p / base - 1) * 100).toFixed(2)}%` : "";   // 어제 종가 대비(사용자 2026-11-04 "%등락율도 같이")
              return (<>
                {/* 최고·최저는 그 자리에 — 고: 점 위 ▼ 위에 글자, 저: 점 아래 ▲ 아래 글자(현물 그래프와 같은 모양, 사용자 2026-11-04).
                    화살표는 점에 정확히, 글자는 화면 끝에서 안 잘리게(왼쪽 끝이면 오른쪽으로, 끝 쪽이면 왼쪽으로) */}
                {hi > lo && [{ i: hiI, v: hi, up: true }, { i: loI, v: lo, up: false }].map(({ i, v, up: isHi }) => {
                  const xp = (xOf(i) / W) * 100, y = yp(v);
                  const tx = xp < 12 / sc ? "-6px" : i >= prices.length - 8 ? "calc(-100% + 6px)" : "-50%";
                  const col = isHi ? "text-rose-600" : "text-blue-600";
                  return (
                    <span key={isHi ? "hi" : "lo"}>
                      <span className={`absolute pointer-events-none text-[8px] leading-none ${col}`} style={{ left: `${xp}%`, top: `${y}%`, transform: isHi ? "translate(-50%, -115%)" : "translate(-50%, 15%)" }}>{isHi ? "▼" : "▲"}</span>
                      <span className={`${lab} ${col}`} style={{ left: `${xp}%`, top: `${y}%`, transform: `translate(${tx}, ${isHi ? "calc(-100% - 9px)" : "9px"})` }}>{isHi ? "최고" : "최저"} {v.toLocaleString()}{pc(v)}</span>
                    </span>
                  );
                })}
                <span className={`${lab} font-bold text-slate-800 border border-slate-300`} style={{ left: `${lx}%`, top: `${endTop.price ?? 50}%`, transform: "translate(6px, -50%)" }}>{last.toLocaleString()}<span className={base && last > base ? "text-rose-600" : base && last < base ? "text-blue-600" : ""}>{pc(last)}</span>
                </span>
              </>);
            })()}
            {/* 누적 끝값 — 막대(1분)와 축이 달라 선만으론 크기를 모른다. svg 가 늘어나므로 글자는 HTML 로 */}
            {cum.length > 0 && (() => {
              const lx = (xOf(cum.length - 1) / W) * 100, ly0 = ((mid - (cum[cum.length - 1] / mxCum) * (mid - PAD)) / H) * 100;
              // 지금 가격 글자와 붙으면(세로 9% 안) 비켜 선다 — 위쪽이 넓으면 위로, 아니면 아래로(사용자 2026-11-04 "현재가가 겹치는데")
              const lpC = prices.length ? Math.max(6, Math.min(90, ((PAD + (1 - (prices[prices.length - 1] - pMin) / pR) * (H - PAD * 2)) / H) * 100)) : -99;
              const ly = Math.abs(Math.max(4, Math.min(92, ly0)) - lpC) < 9 ? (lpC >= 50 ? lpC - 11 : lpC + 11) : ly0;
              return (
                <div className="absolute pointer-events-none flex items-center gap-1" style={{ left: `${lx}%`, top: `${endTop.cum ?? ly}%`, transform: "translateY(-50%)" }}>
                  {/* 글자 색 = 선과 같은 주황(사용자 2026-11-04 "그래프처럼 오렌지색으로") — 방향은 '순매수/순매도' 글자로 */}
                  <span className="w-2 h-2 rounded-full bg-orange-600 shrink-0" style={{ marginLeft: -4 }} />
                  <span className="text-[11px] font-bold bg-white/80 px-0.5 rounded whitespace-nowrap text-orange-600">누적 {netWord(cum[cum.length - 1])}</span>
                </div>
              );
            })()}
          </div>
            {/* 1분 막대 띠 — 체결·프로그램을 증시 탭 투자자 줄처럼 한 번에: 이름 · (+매수 −매도) 순 + 막대(매수 위·매도 아래 연하게, 순 진하게)
                (사용자 2026-11-05 "1분 매도/매수, 프로그램 매도/매수를 다 1분봉으로, 이런 식으로 한 번에") */}
            {[
              { k: "tick", label: "체결", col: "#e11d48", colDn: "#2563eb",
                rows: ms.map(m => ({ b: m.buyAmt, s: m.sellAmt })) as ({ b: number; s: number } | null)[] },
              ...(hasProgMin ? [{ k: "prog", label: "프로그램", col: "#e11d48", colDn: "#2563eb", rows: progMin }] : []),
            ].map(st => {
              // 기본 = 누적(띠 구간 합), 마우스를 올리면 그 분 값(사용자 2026-11-05 "기본은 누적, hover 시 각 분봉 값")
              const hx = hov ? st.rows[hov.i] : null;
              // 프로그램 기본값 = 오늘 장 시작부터(한투 하루 누적) — 띠 구간 합으로 하면 위 '프로그램(오늘)'과 숫자가 달라 헷갈렸다(사용자 2026-11-05)
              const pl = st.k === "prog" ? prog?.[prog.length - 1] : undefined;
              const progDay = !hx && pl?.b != null && pl?.s != null;
              const tb = hx ? hx.b : progDay ? pl!.b! * 1e8 : st.rows.reduce((a, x) => a + (x?.b ?? 0), 0);
              const ts = hx ? hx.s : progDay ? pl!.s! * 1e8 : st.rows.reduce((a, x) => a + (x?.s ?? 0), 0);
              const mx = Math.max(1, ...st.rows.map(x => (x ? Math.max(x.b, x.s) : 0)));
              const SH = 46, SM = SH / 2;
              return (
                <div key={st.k} className="relative shrink-0 border-t border-gray-100" style={{ height: SH + 6 }}>
                  {/* 제목·합계는 오른쪽 빈칸(선 끝 글자 자리)에 — 사용자 2026-11-05 */}
                  <div className="absolute right-1 top-[2px] text-right tabular-nums leading-tight pointer-events-none z-10">
                    {/* 띠 합계 = 막대가 있는 구간만(언제부터인지 같이) — 위 '프로그램(오늘)'은 장 시작부터라 다를 수 있다(사용자 2026-11-05) */}
                    <div className="text-[10.5px] font-bold" style={{ color: st.k === "prog" ? "#6d28d9" : "#374151" }}>{st.label} <span className="font-normal text-gray-400">{hov ? (hx ? `${ms[hov.i].t} 1분` : `${ms[hov.i].t} 기록 없음`) : (progDay ? "오늘 누적" : (() => { const fi = st.rows.findIndex(x => x); return fi >= 0 ? `${ms[fi].t}~ 누적` : ""; })())}</span></div>
                    <div className={`text-[11px] font-bold ${up(tb - ts)}`}>{netWord(tb - ts)}</div>
                    <div className="text-[10px] text-gray-500"><span className="text-rose-500">+{(tb / 1e8).toLocaleString(undefined, { maximumFractionDigits: hx ? 1 : 0 })}</span> <span className="text-blue-500">−{(ts / 1e8).toLocaleString(undefined, { maximumFractionDigits: hx ? 1 : 0 })}억</span></div>
                  </div>
                  <svg viewBox={`0 0 ${W} ${SH}`} preserveAspectRatio="none" className="w-full mt-[3px]" style={{ height: SH }}>
                    <line x1={0} x2={W} y1={SM} y2={SM} stroke="#e5e7eb" vectorEffect="non-scaling-stroke" />
                    {st.rows.map((x, i) => {
                      if (!x) return null;
                      const hb = (x.b / mx) * (SM - 1), hs = (x.s / mx) * (SM - 1);
                      return (
                        <g key={i}>
                          {/* 매수 = 빨강(위) · 매도 = 파랑(아래) 그대로 — 순은 머리 줄 숫자로(사용자 2026-11-05) */}
                          {/* 그 분에 더 큰 쪽만 진하게, 작은 쪽은 연하게 — 증시 탭 투자자 막대와 같은 규칙(사용자 2026-11-05) */}
                          <rect x={xOf(i) - bw * 0.4} width={bw * 0.8} y={SM - hb} height={hb} fill="#e11d48" opacity={x.b >= x.s ? 0.9 : 0.28} />
                          <rect x={xOf(i) - bw * 0.4} width={bw * 0.8} y={SM} height={hs} fill="#2563eb" opacity={x.s > x.b ? 0.9 : 0.28} />
                        </g>
                      );
                    })}
                  </svg>
                </div>
              );
            })}
          </div>
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
      <div className="flex flex-wrap gap-x-3 gap-y-0 text-[10.5px] text-gray-500 mt-0.5 [&>span]:whitespace-nowrap">
        <span><i className="inline-block w-2 h-2 bg-rose-500 mr-0.5" /><i className="inline-block w-2 h-2 bg-blue-500 mr-0.5" />아래 띠: 1분 매수(빨강 위)·매도(파랑 아래) — 큰 쪽만 진하게</span>
        <span><i className="inline-block w-3 h-0.5 bg-slate-700 mr-0.5 align-middle" />가격</span>
        {kospi && kospi.length > 1 && <span><i className="inline-block w-2 h-2 bg-rose-100 mr-0.5" /><i className="inline-block w-2 h-2 bg-blue-100 mr-0.5" />배경 코스피</span>}
        <span><i className="inline-block w-4 mr-0.5 align-middle border-t-2 border-dotted border-orange-600" />누적(켠 뒤, 축 따로)</span>
        {prog && prog.length > 0 && <span><i className="inline-block w-4 mr-0.5 align-middle border-t-2 border-dotted border-violet-600" />프로그램 누적(축 따로, 한투)</span>}
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
function FlowBox({ title, note, flow, unit, tabs, tab, onTab, bg, bgBase, endHM = "15:30", hoverM, onHover, dim: dimIn, preFlow, axis, lines }: {
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
  const dim = dimIn && getDimSleepingEnabled();   // 설정 "장 마감 시 종목 흐리게" 를 따른다(사용자 지적 2026-10-23)
  const uid = useId().replace(/:/g, "");
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
  // 지수는 위아래 10% 여백 — 최고·최저 화살표·글자가 칸 밖으로 안 나가게(증시 탭 지수 축과 같게)
  const BPY = H * 0.1;
  const by = (v: number) => BPY + (1 - (v - bMin) / bR) * (H - BPY * 2);
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
  // 마우스 시각의 배경 지수 값(그 시각 이하 마지막 점)
  const hovBg = hoverX != null && hoverM != null && bgp.length > 1 ? [...bgp].reverse().find(b => tmin(b.t) <= hoverM) : undefined;
  // 지수 가로 점선·오른쪽 값표 — 마우스가 있으면 그 시각, 없으면 현재(마지막) 값. 하나만 보여 겹치지 않는다(사용자 2026-10-29)
  const idxMark = hovBg ?? (bgp.length > 1 ? bgp[bgp.length - 1] : undefined);
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
          // 위 범례는 칸이 좁다 — 단위(억원·계약) 글자는 빼고 숫자만(사용자 요청 2026-10-28). 단위는 칸 제목·아래 막대 줄에 있다
          <span key={l.k} className="whitespace-nowrap"><i className="inline-block w-2 h-0.5 mr-0.5 align-middle" style={{ background: l.color }} />{l.label} <b className={last ? up(val(last, l.k)) : "text-gray-300"}>{last ? (unit === "억" ? `${val(last, l.k) > 0 ? "+" : val(last, l.k) < 0 ? "−" : ""}${joEok(val(last, l.k)).replace(/억원$|원$/, "")}` : eok(val(last, l.k))) : "-"}</b></span>
        ))}
      </div>
      {/* 그래프 높이 고정 — 세 칸(현물·선물)이 같은 높이·같은 가로 위치 */}
      {/* 축 — 왼쪽 = 순매수, 오른쪽 = 배경 지수, 아래 = 시각(증시 탭과 같게, 사용자 요청 2026-10-23·10-29 좌우 바꿈).
          아래 막대 줄도 같은 좌우 여백(AX_L·AX_R)을 둬 가로 위치가 맞는다 */}
      <div className="h-[190px] shrink-0 flex flex-col">
        {pts.length < 2 ? <div className="h-full flex items-center justify-center text-gray-400">{flow ? "장 시작 전" : "불러오는 중…"}</div> : (<>
          <div className="flex-1 min-h-0 flex">
          {/* 왼쪽 = 순매수(청록 — 지수 현재값 점선과 구분, 증시 탭과 같게) */}
          <div className="relative shrink-0 text-[9px] text-teal-700 tabular-nums" style={{ width: AX_L }}>
            {niceTicks(-mx, mx, 5).map(v => (
              <span key={v} className="absolute right-1 -translate-y-1/2" style={{ top: `${(y(v) / H) * 100}%` }}>{Math.round(v).toLocaleString()}</span>
            ))}
          </div>
          <div className="relative flex-1 min-w-0 border-x border-gray-200">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-full" onMouseMove={onMove} onMouseLeave={onHover ? () => onHover(null) : undefined}>
            {bgp.length > 1 && (() => {
              // 배경 지수 면 — 전일 종가 위 = 빨강·아래 = 파랑으로 나눠 칠한다(카드 그래프와 같은 규칙). 캔들은 되돌렸다(사용자 결정 2026-10-23)
              const baseY = by(hasBgBase ? bgBase! : bgp[0].v);   // 전일 종가 없으면 첫 값 기준
              const line = bgp.map((b, i) => `${i ? "L" : "M"} ${x(b.t).toFixed(1)} ${by(b.v).toFixed(1)}`).join(" ");
              const band = `${line} L ${x(bgp[bgp.length - 1].t).toFixed(1)} ${baseY.toFixed(1)} L ${x(bgp[0].t).toFixed(1)} ${baseY.toFixed(1)} Z`;
              return (
                <>
                  <defs>
                    <clipPath id={`${uid}u`}><rect x={0} y={0} width={W} height={baseY} /></clipPath>
                    <clipPath id={`${uid}d`}><rect x={0} y={baseY} width={W} height={Math.max(0, H - baseY)} /></clipPath>
                  </defs>
                  <g clipPath={`url(#${uid}u)`}>
                    <path d={band} fill="#fecdd3" fillOpacity={0.5} />
                    <path d={line} fill="none" stroke="#fb7185" strokeOpacity={0.6} strokeWidth={1} vectorEffect="non-scaling-stroke" />
                  </g>
                  <g clipPath={`url(#${uid}d)`}>
                    <path d={band} fill="#bfdbfe" fillOpacity={0.5} />
                    <path d={line} fill="none" stroke="#60a5fa" strokeOpacity={0.6} strokeWidth={1} vectorEffect="non-scaling-stroke" />
                  </g>
                </>
              );
            })()}
            <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="#0d9488" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
            {/* 마감 동시호가 구간 음영 */}
            <rect x={x(aucFrom)} width={Math.max(0, x(axisEnd) - x(aucFrom))} y={0} height={H} fill="#fde68a" fillOpacity={0.35} />
            {["10:00", "12:00", "14:00"].map(t => <line key={t} x1={x(t)} x2={x(t)} y1={0} y2={H} stroke="#eef2f7" vectorEffect="non-scaling-stroke" />)}
            {LINES.map(l => (
              <path key={l.k} d={pts.map((p, i) => `${i ? "L" : "M"} ${x(p.time).toFixed(1)} ${y(val(p, l.k)).toFixed(1)}`).join(" ")}
                    fill="none" stroke={l.color} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
            ))}
            {hoverX != null && <line x1={hoverX} x2={hoverX} y1={0} y2={H} stroke="#475569" strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />}
            {idxMark && <line x1={0} x2={W} y1={by(idxMark.v)} y2={by(idxMark.v)} stroke="#64748b" strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />}
          </svg>
          {/* 배경 지수 최고·최저 — 최고 = 위에서 ▼, 최저 = 아래에서 ▲ 와 값(증시 탭과 같은 모양, 사용자 2026-10-29).
              가장자리 가까이면 글자를 안쪽으로 붙여 칸 밖으로 안 나가게. 현재는 오른쪽 축 값표(idxMark) */}
          {bgp.length > 1 && (() => {
            let hi = bgp[0], lo = bgp[0];
            for (const b of bgp) { if (b.v > hi.v) hi = b; if (b.v < lo.v) lo = b; }
            if (hi.v <= lo.v) return null;
            const fmt = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            return ([["hi", hi, "최고", "#dc2626", "▼"], ["lo", lo, "최저", "#2563eb", "▲"]] as const).map(([k, b, label, color, arrow]) => {
              const px = (x(b.t) / W) * 100, py = (by(b.v) / H) * 100;
              const tx = px < 15 ? "-4px" : px > 85 ? "calc(-100% + 4px)" : "-50%";
              return (
                <span key={k} className="pointer-events-none">
                  <span className="absolute text-[8px] leading-[8px] -translate-x-1/2" style={{ left: `${px}%`, top: `${py}%`, color, transform: `translate(-50%, ${k === "hi" ? "calc(-100% - 1px)" : "1px"})` }}>{arrow}</span>
                  <span className="absolute whitespace-nowrap rounded-sm bg-white/75 px-0.5 text-[9.5px] font-semibold leading-tight tabular-nums"
                        style={{ left: `${px}%`, top: `${py}%`, transform: `translate(${tx}, ${k === "hi" ? "calc(-100% - 10px)" : "10px"})`, color }}>{label} {fmt(b.v)}</span>
                </span>
              );
            });
          })()}
          {/* 마우스 — 투자자 선마다 점(증시 탭 crosshair 점과 같은 크기). svg 가 가로세로로 늘어나 원이 찌그러지지 않게 HTML 로 */}
          {hovPt && LINES.map(l => (
            <span key={l.k} className="absolute w-2 h-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white pointer-events-none"
                  style={{ left: `${(x(hovPt.time) / W) * 100}%`, top: `${(y(val(hovPt, l.k)) / H) * 100}%`, background: l.color }} />
          ))}
          </div>
          {/* 오른쪽 = 배경 지수. 값표 = 마우스 시각의 지수, 마우스가 없으면 현재 지수(같은 모양 — 증시 탭과 같게) */}
          <div className="relative shrink-0 text-[9px] text-gray-400 tabular-nums" style={{ width: AX_R }}>
            {bgp.length > 1 && niceTicks(bMin, bMax, 5).map(v => (
              <span key={v} className="absolute left-1 -translate-y-1/2" style={{ top: `${(by(v) / H) * 100}%` }}>{Math.round(v).toLocaleString()}</span>
            ))}
            {idxMark && (
              <span className="absolute left-0 -translate-y-1/2 rounded-sm bg-gray-600 px-0.5 text-[9.5px] leading-tight text-white"
                    style={{ top: `${(by(idxMark.v) / H) * 100}%` }}>{Math.round(idxMark.v).toLocaleString()}</span>
            )}
          </div>
          </div>
          <div className="relative h-[13px] shrink-0 text-[9px] text-gray-400 tabular-nums" style={{ marginLeft: AX_L, marginRight: AX_R }}>
            {["09:00", "10:30", "12:00", "13:30", "15:00"].filter(t => tmin(t) >= T0 && tmin(t) <= T1).map(t => (
              <span key={t} className="absolute -translate-x-1/2" style={{ left: `${(x(t) / W) * 100}%` }}>{t}</span>
            ))}
            {hoverX != null && hoverM != null && (
              <span className="absolute -translate-x-1/2 rounded-sm bg-gray-600 px-1 text-[9.5px] leading-tight text-white"
                    style={{ left: `${(hoverX / W) * 100}%` }}>{`${String(Math.floor(hoverM / 60)).padStart(2, "0")}:${String(hoverM % 60).padStart(2, "0")}`}</span>
            )}
          </div>
        </>)}
      </div>
      {/* 외국인·개인 매수·매도 막대 — 그래프 바로 아래, 같은 시간 축. 증시 탭과 같은 모양(사용자 요청 2026-10-23) */}
      {flow && pts.length > 1 && (
        <div style={{ marginLeft: AX_L, marginRight: AX_R }}>
        <BuySellBars points={flow.points} keys={LINES.map(l => l.k)} unit={unit === "계약" ? "계약" : "억"} start={startHM} end={axisEnd}
          rowH={36} compact
          geom={{
            width: W, hoverT: hoverM ?? null, toT: tmin, hover: onHover,
            xOfT: m => (m < T0 || m > T1 ? null : x(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`)),
          }} />
        </div>
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
function OptionBox({ opt, vk, dim: dimIn }: { opt?: Awaited<ReturnType<typeof fetchKospi200OptionSummary>> | KisOptionSummary; vk?: UsIndex; dim?: boolean }) {
  const dim = dimIn && getDimSleepingEnabled();   // 설정 "장 마감 시 종목 흐리게" 를 따른다(사용자 지적 2026-10-23)
  const [guide, setGuide] = useState(false);
  const pcr = opt && opt.callVol > 0 ? opt.putVol / opt.callVol : undefined;
  const pcrOi = opt && opt.callOi > 0 ? opt.putOi / opt.callOi : undefined;
  const tag = (t: string) => <span className="font-normal text-[10px] text-gray-400 ml-1">{t}</span>;
  return (
    <div className={`pg-card relative rounded-lg border border-gray-200 p-2 flex flex-col min-h-0 tabular-nums ${dim ? "bg-gray-50 opacity-60 grayscale-[60%]" : "bg-white"}`}>
      <div className="flex items-baseline gap-2">
        <span className="font-bold text-gray-800 shrink-0 whitespace-nowrap">옵션 · 코스피200</span>
        <span className="text-[11px] text-gray-400 truncate">{opt ? `${opt.month.slice(4, 6)}/${opt.month.slice(6)} 만기 · ${opt.time.slice(0, 5)}${"src" in opt ? " · 한투 전 행사가" : ""}` : "한경 실시간"}</span>
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
      {opt && <div className="mt-auto text-[10px] text-gray-400 truncate">행사가 {opt.range[0]}~{opt.range[1]} 합계{"src" in opt ? "(근월물 전체 · 한국투자)" : "(현재가 근처)"}</div>}
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

// 기업 밸류업 꼬리표 줄 — 저PBR·고배당·밸류업 우수 중 해당하는 게 있을 때만(사용자 2026-11-02)
function ValueupStrip({ code }: { code: string }) {
  if (!useValueupTags(code)) return null;
  return (
    <div className="flex items-center gap-1 shrink-0 text-[11px] text-gray-500">
      <span>거래소 밸류업</span><ValueupTags code={code} />
    </div>
  );
}

// 체결 출처 표시 — 한국투자 웹소켓이 살아 있으면 "한투 실시간", 실패면 사유(토스 5초가 이어받는다). 앱+한투 연동일 때만(사용자 2026-11-02)
function KisWsBadge() {
  const [, setT] = useState(0);
  useEffect(() => { if (!kisWsAvailable()) return; const id = setInterval(() => setT(t => t + 1), 2_000); return () => clearInterval(id); }, []);
  if (!kisWsAvailable()) return null;
  const st = kisWsStatus();
  if (kisWsLive()) return <span className="ml-auto text-[10px] px-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-300" title="한국투자 웹소켓 — 체결이 나는 즉시(1초마다 화면 반영)">● 한투 실시간</span>;
  if (st.startsWith("error")) return <span className="ml-auto text-[10px] text-amber-700 truncate max-w-[50%]" title={st}>한투 실시간 실패 — 토스 5초로 · {st.slice(7)}</span>;
  return <span className="ml-auto text-[10px] text-gray-400">한투 연결 중…</span>;
}
