// 컨센서스 상승여력 탭 — 내가 추가한 종목 중, 증권사 리포트별 목표가 기준 상승여력.
// 데이터: 기업가치 팝업과 동일한 wisereport 최근리포트 (리포트별 목표가·투자의견).
// 상승여력/정렬 기준 = 가장 최근(목표가 있는) 리포트. 같은 날 여러 건도 모두 표시.
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueries, keepPreviousData } from "@tanstack/react-query";
import { fetchTossPrices, fetchNaverPrices, fetchNaverInfo, fetchInvestorHistorySafe, fetchKrPriceHistory, fetchNaverNews, fetchKrDisclosures } from "../lib/api";
import { getTossMaintenance } from "../lib/tossMaintenance";
import { fetchConsensusReports, fetchMajorShareholders, type Shareholder, type ConsensusReport } from "../lib/fundamentals";
import { openTossStock } from "../lib/toss";
import { openGoogleAi, STOCK_ANALYSIS_PROMPT, aiNowStamp } from "../lib/googleAi";
import { signColor, formatSigned, isKrHoldingClosed } from "../lib/format";
import { getDimSleepingEnabled } from "../lib/proxyConfig";
import { Tooltip } from "./Tooltip";
import type { Investor } from "../types";

// 뉴스 시각 "YYYYMMDDHHmm" → "MM/DD HH:mm"
function fmtNewsTime(s?: string): string {
  if (!s || s.length < 12) return "";
  return `${s.slice(4, 6)}/${s.slice(6, 8)} ${s.slice(8, 10)}:${s.slice(10, 12)}`;
}
// 최근 N일 누적 순매수 (외국인/기관/연기금)
function sumLast(arr: Investor[] | null | undefined, key: "외국인" | "기관" | "연기금", n: number): number {
  if (!arr || arr.length === 0) return 0;
  return arr.slice(0, n).reduce((s, d) => s + (Number(d[key]) || 0), 0);
}
// 주식수 표기
function fmtSharesK(v: number): string {
  const a = Math.abs(v), sign = v < 0 ? "-" : v > 0 ? "+" : "";
  if (a >= 1e8) return `${sign}${(a / 1e8).toFixed(1)}억`;
  if (a >= 1e4) return `${sign}${Math.round(a / 1e4).toLocaleString()}만`;
  return `${sign}${a.toLocaleString()}`;
}
// 금액(원) 부호 표기 — 조/억/만
function fmtAmtK(won: number): string {
  const a = Math.abs(won), sign = won < 0 ? "-" : won > 0 ? "+" : "";
  if (a >= 1e12) return `${sign}${(a / 1e12).toFixed(1)}조`;
  if (a >= 1e8) return `${sign}${Math.round(a / 1e8).toLocaleString()}억`;
  if (a >= 1e4) return `${sign}${Math.round(a / 1e4).toLocaleString()}만`;
  return `${sign}${Math.round(a).toLocaleString()}`;
}

// 주요주주에서 국민연금/연기금 추출
function npsHolderOf(sh?: Shareholder[]): Shareholder | null {
  return sh?.find(s => /국민연금|연기금/.test(s.name)) ?? null;
}
// 금액(원) → 조/억
function fmtKrw(won: number): string {
  if (!won || won <= 0) return "—";
  if (won >= 1e12) return `${(won / 1e12).toFixed(1)}조`;
  if (won >= 1e8) return `${Math.round(won / 1e8).toLocaleString()}억`;
  return Math.round(won).toLocaleString();
}

export interface ConsensusItem {
  ticker: string;
  name: string;
  groups?: string[];   // 이 종목이 포함된 그룹(계좌) 이름들
  market?: "KOSPI" | "KOSDAQ";   // 거래소 구분 (코스피/코스닥 2열 분리용)
}

interface Props {
  items: ConsensusItem[];
  onOpenValuation?: (ticker: string) => void;
  onSelectGroup?: (group: string) => void;   // 그룹 칩 클릭 → 해당 그룹 탭 이동
  onEdit?: (ticker: string) => void;          // ✏️ 보유 수정 (그룹 추가/제외)
}

type View = "consensus" | "pension" | "screener";
type SortKey = "upside" | "date" | "npsPct" | "npsAmount"
             | "vol" | "foreign60" | "inst60" | "pension60";
type Period = "all" | "1w" | "1m";
const DEFAULT_SORT: Record<View, SortKey> = { consensus: "date", pension: "npsPct", screener: "vol" };

// "YY.MM.DD" / "YY/MM/DD" → epoch ms
function parseRepDate(d?: string): number {
  if (!d) return 0;
  const m = /(\d{2})[./](\d{2})[./](\d{2})/.exec(d);
  if (!m) return 0;
  return new Date(2000 + +m[1], +m[2] - 1, +m[3]).getTime();
}

// 컨센서스 리포트 필터 — 사업현황/탐방/실적코멘트 등은 제외.
// 목표가(금액)가 있고 + 매수 계열 투자의견이 달린 리포트만 "최신순서"에 반영.
const BUY_OPINION_RE = /매수|buy|적극|비중\s*확대|overweight|outperform|시장수익률\s*상회/i;
function isActionableReport(r: ConsensusReport): boolean {
  return r.target != null && r.target > 0 && BUY_OPINION_RE.test(r.opinion ?? "");
}

export function ConsensusTab({ items, onOpenValuation, onSelectGroup, onEdit }: Props) {
  const [view, setView] = useState<View>("consensus");   // 책갈피 sub탭
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [period, setPeriod] = useState<Period>("1w");
  const [volDays, setVolDays] = useState(7);   // 변동율·수급 공통 기간(거래일)
  const [flowMode, setFlowMode] = useState<"shares" | "amount">("shares");  // 수급 정렬·표시 단위
  // sub탭 전환 시 기본 정렬 리셋
  useEffect(() => {
    setSortKey(DEFAULT_SORT[view]);
    if (view === "consensus") setPeriod("1w");
  }, [view]);

  const tickers = useMemo(() => items.map(i => i.ticker), [items]);
  const nameByTicker = useMemo(() => new Map(items.map(i => [i.ticker, i.name])), [items]);
  const groupsByTicker = useMemo(() => new Map(items.map(i => [i.ticker, i.groups ?? []])), [items]);
  const marketByTicker = useMemo(() => new Map(items.map(i => [i.ticker, i.market])), [items]);

  // 토스(KR) 가격조회 대상 — KR 6자리 코드만. 미국 등 비KR 티커가 섞이면(예 NVDA→ANVDA)
  // 토스 배치 호출이 통째로 실패해 전 종목 현재가가 "—" 가 되므로 App 과 동일하게 선필터.
  const krxTickers = useMemo(
    () => tickers.filter(t => /^[\dA-Za-z]{6}$/.test(t)),
    [tickers],
  );

  const { data: prices } = useQuery({
    queryKey: ["consensus-prices", krxTickers],
    queryFn: async () => {
      try { return await fetchTossPrices(krxTickers); }
      catch (e) {
        if (getTossMaintenance().active) return await fetchNaverPrices(krxTickers);
        throw e;
      }
    },
    enabled: krxTickers.length > 0,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,   // 갱신 중 이전 가격 유지(깜빡임 방지)
  });
  const priceByTicker = useMemo(
    () => new Map((prices ?? []).map(p => [p.ticker, p.price])),
    [prices],
  );
  // 현재가 등락(전일종가 대비) — 색·% 표시용. 전체 Price 객체 보관.
  const priceObjByTicker = useMemo(
    () => new Map((prices ?? []).map(p => [p.ticker, p])),
    [prices],
  );

  // 평균 목표주가·투자의견 — naver 컨센서스 (제공사 정의 평균가). 앱과 캐시 공유.
  const naverQs = useQueries({
    queries: tickers.map(t => ({
      queryKey: ["naver", t],
      queryFn: () => fetchNaverInfo(t),
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    })),
  });
  // 리포트별 목표가 — 기업가치 팝업과 동일 (wisereport 최근리포트)
  const reportQs = useQueries({
    queries: tickers.map(t => ({
      queryKey: ["consensus-reports", t],
      queryFn: () => fetchConsensusReports(t, 15),
      staleTime: 30 * 60 * 1000,
      refetchOnWindowFocus: false,
    })),
  });
  // 주요주주 — wisereport (24h 캐시, 토스 무관). 연기금 비중용.
  const shQs = useQueries({
    queries: tickers.map(t => ({
      queryKey: ["major-shareholders", t],
      queryFn: () => fetchMajorShareholders(t),
      staleTime: 24 * 3600_000,
      refetchOnWindowFocus: false,
    })),
  });
  // 변동성용 6개월 차트 (최대 90거래일 σ 계산) — 카드에 항상 표시
  const chartQs = useQueries({
    queries: tickers.map(t => ({
      queryKey: ["kr-price-history", t, "6mo"],
      queryFn: () => fetchKrPriceHistory(t, "6mo"),
      staleTime: 60 * 60 * 1000,
      refetchOnWindowFocus: false,
    })),
  });
  const invQs = useQueries({
    queries: tickers.map(t => ({
      queryKey: ["investor-history-long", t],
      queryFn: () => fetchInvestorHistorySafe(t, [200, 120, 60]),
      staleTime: 60 * 60 * 1000,
      refetchOnWindowFocus: false,
    })),
  });
  // 종목 뉴스 (네이버) — 카드 하단 표시. ValuationModal 과 캐시 공유.
  const newsQs = useQueries({
    queries: tickers.map(t => ({
      queryKey: ["naver-news", t],
      queryFn: () => fetchNaverNews(t, 10),
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    })),
  });
  const newsByTicker = useMemo(
    () => new Map(tickers.map((t, i) => [t, newsQs[i]?.data ?? []])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tickers, newsQs.map(q => `${q.status}:${q.dataUpdatedAt}`).join(",")],
  );
  // 종목 공시 (DART) — 카드 하단 뉴스 옆 표시. ValuationModal 과 캐시 공유.
  const discQs = useQueries({
    queries: tickers.map(t => ({
      queryKey: ["disclosures-modal", t],
      queryFn: () => fetchKrDisclosures(t, 12),
      staleTime: 30 * 60 * 1000,
      refetchOnWindowFocus: false,
    })),
  });
  const discByTicker = useMemo(
    () => new Map(tickers.map((t, i) => [t, discQs[i]?.data ?? []])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tickers, discQs.map(q => `${q.status}:${q.dataUpdatedAt}`).join(",")],
  );
  const anyLoading = naverQs.some(q => q.isLoading) || reportQs.some(q => q.isLoading)
                  || shQs.some(q => q.isLoading);

  const displayed = useMemo(() => {
    const now = Date.now();
    const cutoff = period === "1w" ? now - 8 * 864e5
                 : period === "1m" ? now - 31 * 864e5 : 0;
    const rows = tickers.map((t, i) => {
      const con = naverQs[i]?.data?.consensus;
      const sector = naverQs[i]?.data?.sector ?? "";
      // 사업현황 등 제외 — 목표가+매수의견 리포트만 (최신순서·목록에 반영)
      const reps = (reportQs[i]?.data ?? []).filter(isActionableReport);
      const loading = (naverQs[i]?.isLoading ?? false) || (reportQs[i]?.isLoading ?? false);
      const price = priceByTicker.get(t);
      // 현재가 등락 — 직전 거래일 종가 대비 (비거래일에도 마지막 거래 변화 반영)
      const pObj = priceObjByTicker.get(t);
      const priceDiff = pObj && pObj.prevClose > 0 ? pObj.price - pObj.prevClose : 0;
      const pricePct = pObj && pObj.prevClose > 0 ? (priceDiff / pObj.prevClose) * 100 : 0;
      const avgTarget = con?.target;
      const upside = avgTarget && avgTarget > 0 && price && price > 0
        ? (avgTarget / price - 1) * 100 : null;
      const repTime = parseRepDate(reps[0]?.date);
      const repsShown = cutoff === 0 ? reps : reps.filter(r => parseRepDate(r.date) >= cutoff);
      const holders = (shQs[i]?.data ?? []).filter(s => s.pct != null)
                        .sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));
      const nps = npsHolderOf(shQs[i]?.data);
      const npsPct = nps?.pct ?? null;
      const npsAmount = (nps?.shares ?? 0) * (price ?? 0);
      // 변동폭(스윙) — 변동폭% = 일별 저가/고가 평균 기준 (평균고가-평균저가)/평균저가.
      // 밴드 = 기간 내 실제 최저가~최고가.
      const chart = chartQs[i]?.data ?? [];
      let lowSum = 0, highSum = 0, cnt = 0;
      let rangeLow: number | null = null, rangeHigh: number | null = null;
      for (const p of chart.slice(-volDays)) {
        if (p.low != null && p.high != null && p.low > 0) {
          lowSum += p.low; highSum += p.high; cnt++;
          if (rangeLow == null || p.low < rangeLow) rangeLow = p.low;
          if (rangeHigh == null || p.high > rangeHigh) rangeHigh = p.high;
        }
      }
      const avgLow = cnt > 0 ? lowSum / cnt : null;
      const avgHigh = cnt > 0 ? highSum / cnt : null;
      const vol = (avgLow != null && avgHigh != null && avgLow > 0)
        ? (avgHigh - avgLow) / avgLow * 100 : null;
      const inv = invQs[i]?.data ?? null;
      const foreign60 = sumLast(inv, "외국인", volDays);
      const inst60 = sumLast(inv, "기관", volDays);
      const pension60 = sumLast(inv, "연기금", volDays);
      // 금액 = 순매수 수량 × 현재가
      const p0 = price ?? 0;
      const forAmt = foreign60 * p0, insAmt = inst60 * p0, penAmt = pension60 * p0;
      return {
        ticker: t, name: nameByTicker.get(t) ?? t, groups: groupsByTicker.get(t) ?? [],
        sector,
        price, priceDiff, pricePct, reps, repsShown, avgTarget, upside, repTime, loading,
        opinion: con?.opinion, score: con?.score,
        holders, npsPct, npsAmount,
        vol, foreign60, inst60, pension60, forAmt, insAmt, penAmt, rangeLow, rangeHigh,
      };
    });
    // 모든 종목 표시 — 검색기준 정렬만 적용 (값 없는 종목은 아래로)
    return rows.sort((a, b) => {
      switch (sortKey) {
        case "date": {   // 최신순 — 동일 날짜는 상승여력순 2차 정렬
          const d = b.repTime - a.repTime;
          return d !== 0 ? d : (b.upside ?? -1e9) - (a.upside ?? -1e9);
        }
        case "upside": return (b.upside ?? -1e9) - (a.upside ?? -1e9);
        case "npsPct": return (b.npsPct ?? -1) - (a.npsPct ?? -1);
        case "npsAmount": return b.npsAmount - a.npsAmount;
        case "vol": return (b.vol ?? -1) - (a.vol ?? -1);   // 변동폭 큰 순
        case "foreign60": return flowMode === "amount" ? b.forAmt - a.forAmt : b.foreign60 - a.foreign60;
        case "inst60": return flowMode === "amount" ? b.insAmt - a.insAmt : b.inst60 - a.inst60;
        case "pension60": return flowMode === "amount" ? b.penAmt - a.penAmt : b.pension60 - a.pension60;
        default: return 0;
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickers,
      naverQs.map(q => `${q.status}:${q.dataUpdatedAt}`).join(","),
      reportQs.map(q => `${q.status}:${q.dataUpdatedAt}`).join(","),
      shQs.map(q => `${q.status}:${q.dataUpdatedAt}`).join(","),
      chartQs.map(q => `${q.status}:${q.dataUpdatedAt}`).join(","),
      invQs.map(q => `${q.status}:${q.dataUpdatedAt}`).join(","),
      priceByTicker, nameByTicker, groupsByTicker, period, sortKey, volDays, flowMode]);

  const btn = (active: boolean) =>
    `px-2.5 py-1 rounded-full text-xs font-bold border transition ${
      active ? "bg-gray-800 text-white border-gray-800"
             : "bg-white text-gray-500 border-gray-300 hover:bg-gray-50"}`;

  // 검색기준 sub탭 (책갈피)
  const subTab = (v: View, label: string) => (
    <button onClick={() => setView(v)}
            className={`px-3 py-1 text-xs font-bold rounded-t-md border-t border-l border-r -mb-px transition ${
              view === v ? "bg-white text-gray-900 border-gray-300"
                         : "bg-gray-100 text-gray-500 border-transparent hover:bg-gray-200"}`}>
      {label}
    </button>
  );
  // 섹션 강조 — 현재 검색기준 섹션
  const emph = (active: boolean) =>
    active ? "ring-1 ring-blue-300 bg-blue-50/40 rounded" : "";

  // 정렬/기간 컨트롤 — 데스크톱은 책갈피 우측 인라인, 모바일은 책갈피 아래 줄
  const sortControls = (<>
    {view === "consensus" && <>
      <button className={btn(sortKey === "upside")} onClick={() => setSortKey("upside")}>상승여력순</button>
      <button className={btn(sortKey === "date")} onClick={() => setSortKey("date")}>최신순</button>
    </>}
    {view === "pension" && <>
      <button className={btn(sortKey === "npsPct")} onClick={() => setSortKey("npsPct")}>비율순</button>
      <button className={btn(sortKey === "npsAmount")} onClick={() => setSortKey("npsAmount")}>금액순</button>
    </>}
    {view === "screener" && <>
      <span className="text-[10px] text-gray-400">기간</span>
      {[1, 7, 30, 90].map(d => (
        <button key={d} className={btn(volDays === d)} onClick={() => setVolDays(d)}>{d}일</button>
      ))}
      {/* 모바일 — 기간 아래로 정렬 줄바꿈 */}
      <div className="basis-full sm:hidden" />
      <span className="text-[10px] text-gray-400 ml-1">정렬</span>
      <button className={btn(sortKey === "vol")} onClick={() => setSortKey("vol")}>변동폭(%)</button>
      <span className="text-[10px] text-gray-400 ml-1">순매수</span>
      <button className={btn(flowMode === "shares")} onClick={() => setFlowMode("shares")}>수량</button>
      <button className={btn(flowMode === "amount")} onClick={() => setFlowMode("amount")}>금액</button>
      <button className={btn(sortKey === "foreign60")} onClick={() => setSortKey("foreign60")}>외국인</button>
      <button className={btn(sortKey === "inst60")} onClick={() => setSortKey("inst60")}>기관</button>
      <button className={btn(sortKey === "pension60")} onClick={() => setSortKey("pension60")}>연기금</button>
    </>}
  </>);

  // 선택한 정렬 기준 설명 — 우측 상단
  const sortDesc = (() => {
    if (view === "consensus")
      return sortKey === "upside" ? "현재가 대비 평균 목표주가 상승여력(%)" : "최근 리포트 발행일 순";
    if (view === "pension")
      return sortKey === "npsAmount" ? "국민연금 보유 평가금액(주식수×현재가)" : "국민연금 보유 지분율(%)";
    const unit = flowMode === "amount" ? "금액(수량×현재가)" : "수량";
    if (sortKey === "foreign60") return `최근 ${volDays}일 외국인 순매수 ${unit} 합`;
    if (sortKey === "inst60") return `최근 ${volDays}일 기관 순매수 ${unit} 합`;
    if (sortKey === "pension60") return `최근 ${volDays}일 연기금 순매수 ${unit} 합`;
    return volDays === 1
      ? "어제 저가~고가 변동폭(%)"
      : `최근 ${volDays}일 일별 저가/고가 평균 기준 변동폭(%)`;
  })();

  return (
    <div className="space-y-2">
      {/* 책갈피 — 검색기준 (왼쪽 상단) */}
      <div className="flex items-end gap-1 border-b border-gray-300 px-1">
        {subTab("consensus", "🎯 컨센서스")}
        {subTab("pension", "🏦 연기금")}
        {subTab("screener", "📊 변동폭")}
        <span className="ml-2 mb-1 text-xs text-gray-500">{displayed.length}종목</span>
        {anyLoading && <span className="mb-1 text-xs text-gray-400">불러오는 중…</span>}
        {/* 데스크톱 — 인라인 우측 */}
        <div className="ml-auto mb-1 hidden sm:flex items-center gap-1 flex-wrap">
          {sortControls}
        </div>
      </div>
      {/* 모바일 — 책갈피 아래 줄, 오른쪽 정렬 */}
      <div className="flex sm:hidden items-center justify-end gap-1 flex-wrap px-1 -mt-1">
        {sortControls}
      </div>
      {/* 선택 기준 설명 — 우측 상단 */}
      <div className="text-right text-[10px] text-gray-400 px-1 -mt-1">{sortDesc}</div>

      {displayed.length === 0 ? (
        <div className="h-32 flex flex-col items-center justify-center text-gray-400 text-sm gap-1">
          {anyLoading ? "불러오는 중…" : <>
            <span>표시할 종목이 없습니다.</span>
            <span className="text-xs text-gray-300">관심·보유 종목(한국)을 추가하면 컨센서스가 표시됩니다.</span>
          </>}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-start">
          {(["KOSPI", "KOSDAQ"] as const).map(mkt => {
            // 거래소 미확인 종목은 코스피 쪽으로 (대부분 코스피 + 검증 지연 대비)
            const colItems = displayed.filter(it =>
              (marketByTicker.get(it.ticker) === "KOSDAQ" ? "KOSDAQ" : "KOSPI") === mkt);
            const mktColor = mkt === "KOSPI" ? "#dc2626" : "#2563eb";
            return (
            <div key={mkt} className="space-y-2">
              <div className="flex items-baseline gap-1.5 px-1 pb-0.5 border-b-2 text-sm font-bold"
                   style={{ borderColor: mktColor, color: mktColor }}>
                {mkt === "KOSPI" ? "코스피" : "코스닥"}
                <span className="text-[11px] text-gray-400 font-normal">{colItems.length}종목</span>
              </div>
              {colItems.map((it) => {
            const up = it.upside;
            // 장마감 흐림 — 일반 카드와 동일 조건(시간외/프리장은 열림, 완전 마감만). 종목명·가격만.
            const dimCls = (getDimSleepingEnabled() && isKrHoldingClosed()) ? "opacity-60" : "";
            const chip = "text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 "
                       + "border border-emerald-200 hover:bg-emerald-100";
            const gs = it.groups ?? [];
            const shown = gs.length > 3 ? gs.slice(0, 3) : gs;
            const more = gs.length - shown.length;
            // 연금(국민연금) 섹션 — 연기금 탭에선 맨 위, 그 외엔 맨 아래
            const pensionSection = (
              <div className={`mt-1 px-1.5 py-1 border border-gray-200 rounded ${emph(view === "pension")}`}>
                {view !== "pension" && <div className="text-[10px] text-gray-400">주요주주</div>}
                {it.holders.length > 0 ? (
                  <div className="space-y-0.5">
                    {it.holders.slice(0, 5).map((h, hi) => {
                      const isNps = /국민연금|연기금/.test(h.name);
                      return (
                        <div key={hi} className={`flex items-baseline gap-2 text-[11px] tabular-nums
                                                  ${isNps ? "bg-amber-50 rounded px-1 text-amber-800" : "text-gray-600"}`}>
                          <span className="truncate">{isNps ? "🏦 " : ""}{h.name}</span>
                          <span className={`ml-auto ${isNps && view === "pension" && sortKey === "npsAmount" ? "text-sm font-bold text-amber-800" : "text-gray-500"}`}>{fmtKrw((h.shares ?? 0) * (it.price ?? 0))}</span>
                          <span className={`w-14 text-right ${isNps && view === "pension" && sortKey === "npsPct" ? "text-sm font-bold text-amber-800" : "text-gray-500"}`}>{(h.pct ?? 0).toFixed(2)}%</span>
                        </div>
                      );
                    })}
                  </div>
                ) : <div className="text-[11px] text-gray-300">주요주주 정보 없음</div>}
              </div>
            );
            // 변동폭·수급 섹션
            const volSection = (() => {
              const box = (active: boolean) =>
                `rounded border px-1.5 py-0.5 ${active
                  ? "bg-blue-50 border-blue-400"
                  : "bg-gray-50/60 border-gray-200"}`;
              const flowCls = (v: number) => v >= 0 ? "text-rose-600" : "text-blue-600";
              const lblCls = (active: boolean) => `text-[10px] ${active ? "text-gray-900" : "text-gray-400"}`;
              const aVol = view === "screener" && sortKey === "vol";
              const aFor = view === "screener" && sortKey === "foreign60";
              const aIns = view === "screener" && sortKey === "inst60";
              const aPen = view === "screener" && sortKey === "pension60";
              const isAmt = flowMode === "amount";
              return (
                <div className="mt-1 grid grid-cols-4 gap-1 text-[11px] tabular-nums">
                  <div className={`text-center ${box(aVol)}`}>
                    <div className={lblCls(aVol)}>변동폭({volDays === 1 ? "1일" : `${volDays}일평균`})</div>
                    <b className={`text-fuchsia-600 ${aVol ? "text-base" : ""}`}>{it.vol != null ? `${it.vol.toFixed(2)}%` : "—"}</b>
                    {it.rangeLow && it.rangeHigh ? (
                      <div className="text-[9px] leading-tight">
                        <span className="text-blue-600">{Math.round(it.rangeLow).toLocaleString()}</span>
                        {"~"}<span className="text-rose-600">{Math.round(it.rangeHigh).toLocaleString()}</span>
                      </div>
                    ) : null}
                  </div>
                  <div className={`text-center ${box(aFor)}`}>
                    <div className={lblCls(aFor)}>외국인</div>
                    <b className={`${flowCls(it.foreign60)} ${aFor ? "text-base" : ""}`}>{isAmt ? fmtAmtK(it.forAmt) : <>{fmtSharesK(it.foreign60)}<span className="text-[9px] font-normal text-gray-400">주</span></>}</b>
                  </div>
                  <div className={`text-center ${box(aIns)}`}>
                    <div className={lblCls(aIns)}>기관</div>
                    <b className={`${flowCls(it.inst60)} ${aIns ? "text-base" : ""}`}>{isAmt ? fmtAmtK(it.insAmt) : <>{fmtSharesK(it.inst60)}<span className="text-[9px] font-normal text-gray-400">주</span></>}</b>
                  </div>
                  <div className={`text-center ${box(aPen)}`}>
                    <div className={lblCls(aPen)}>연기금</div>
                    <b className={`${flowCls(it.pension60)} ${aPen ? "text-base" : ""}`}>{isAmt ? fmtAmtK(it.penAmt) : <>{fmtSharesK(it.pension60)}<span className="text-[9px] font-normal text-gray-400">주</span></>}</b>
                  </div>
                </div>
              );
            })();
            // 컨센서스 섹션
            const aCons = view === "consensus";
            const consensusSection = (
              <div className={`mt-1 px-1.5 py-1 border border-gray-200 rounded ${emph(view === "consensus")}`}>
                {/* 평균 목표주가 / 투자의견 — 컨센서스 탭은 강조, 그 외는 단순 */}
                <div className={`flex items-baseline gap-1 ${aCons ? "text-[12px]" : "text-[11px]"}`}>
                  <span className="text-gray-500">평균 목표주가</span>
                  {it.avgTarget != null ? (
                    <>
                      <b className={aCons ? "text-gray-900 tabular-nums" : "text-gray-600 font-normal tabular-nums"}>{Math.round(it.avgTarget).toLocaleString()}원</b>
                      {up != null && <b className={`ml-auto tabular-nums ${aCons ? `text-base ${up >= 0 ? "text-rose-600" : "text-blue-600"}` : "font-normal text-gray-500"}`}>{up >= 0 ? "+" : ""}{up.toFixed(1)}%</b>}
                    </>
                  ) : <span className="ml-auto text-gray-300">—</span>}
                </div>
                <div className={`flex items-baseline ${aCons ? "text-[12px]" : "text-[11px]"}`}>
                  <span className="text-gray-500">투자의견</span>
                  <span className={`ml-auto ${aCons ? "font-bold text-rose-600" : "font-normal text-gray-500"}`}>
                    {it.opinion ?? "—"}{it.score ? ` (${it.score.toFixed(2)}점)` : ""}
                  </span>
                </div>
                {it.reps.length > 0 && (
                  <div className="mt-0.5 space-y-0.5">
                    {it.reps.slice(0, 5).map((r, ri) => {
                      const rt = parseRepDate(r.date);
                      const recent = rt > 0 && Date.now() - rt < 2 * 24 * 3600 * 1000;
                      const withinWeek = rt > 0 && Date.now() - rt <= 7 * 24 * 3600 * 1000;
                      return (
                        <div key={ri} className={`flex items-baseline gap-1.5 tabular-nums rounded px-1 text-[11px]
                                                  ${!aCons ? "text-gray-500"
                                                    : ri === 0 ? "font-bold bg-yellow-50"
                                                    : recent ? "bg-yellow-100/60 font-bold"
                                                    : withinWeek ? "font-bold" : "text-gray-400"}`}>
                          <span className="text-gray-400 shrink-0">{r.date.slice(3)}</span>
                          <span className="text-gray-500 shrink-0">{r.broker}</span>
                          {r.opinion && <span className="text-violet-600 shrink-0">{r.opinion}</span>}
                          <span className="text-gray-500 truncate">{r.title}</span>
                          {r.target ? <span className="ml-auto text-gray-700 shrink-0">{r.target.toLocaleString()}</span> : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
            // 검색기준 섹션이 맨 위 — consensus/pension/screener
            const ordered = view === "pension" ? [pensionSection, volSection, consensusSection]
              : view === "consensus" ? [consensusSection, volSection, pensionSection]
              : [volSection, consensusSection, pensionSection];
            return (
              <div key={it.ticker}
                   className="border border-gray-200 rounded-lg px-3 py-2 hover:bg-gray-50 bg-white">
                {/* 헤더 — 한 줄: 순번·종목명·현재가/등락·그룹칩 (좌) / 📊·⚙️·섹터·🔍AI (우) */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button onClick={() => openTossStock(it.ticker)} className={`font-bold text-gray-900 hover:underline ${dimCls}`}>{it.name}</button>
                  <span className={`text-[13px] tabular-nums text-gray-600 ${dimCls}`}>
                    <b className={it.price && it.pricePct !== 0 ? signColor(it.pricePct) : "text-gray-600"}>{it.price ? Math.round(it.price).toLocaleString() : "—"}</b>원
                    {it.price && it.pricePct !== 0 ? (
                      <span className={`ml-1 font-bold ${signColor(it.pricePct)}`}>
                        {it.pricePct >= 0 ? "+" : ""}{it.pricePct.toFixed(2)}%
                        <span className="ml-1 font-normal">({formatSigned(Math.round(it.priceDiff))})</span>
                      </span>
                    ) : null}
                  </span>
                  {shown.map(g => (
                    <button key={g} onClick={() => onSelectGroup?.(g)} title={`${g} 그룹으로 이동`} className={chip}>{g}</button>
                  ))}
                  {more > 0 && (
                    <Tooltip content={
                      <div className="flex flex-wrap gap-1 max-w-[200px]">
                        {gs.slice(shown.length).map(g => (
                          <button key={g} onClick={() => onSelectGroup?.(g)} className={chip}>{g}</button>
                        ))}
                      </div>
                    }>
                      <span className="text-[10px] text-emerald-700 cursor-help">외 {more}개</span>
                    </Tooltip>
                  )}
                  <span className="ml-auto flex items-center gap-1.5 shrink-0">
                    {onOpenValuation && (
                      <button onClick={() => onOpenValuation(it.ticker)} title="기업가치 보기"
                              className="text-xs leading-none opacity-60 hover:opacity-100">📊</button>
                    )}
                    {onEdit && (
                      <button onClick={() => onEdit(it.ticker)} title="보유 수정"
                              className="text-xs leading-none opacity-60 hover:opacity-100">⚙️</button>
                    )}
                    {it.sector && (
                      <span className="text-[11px] text-gray-500 whitespace-nowrap">{it.sector}</span>
                    )}
                    <button title="구글 AI 종목 분석 (팝업)"
                            onClick={() => {
                              const ctx: string[] = [`${it.name}(${it.ticker})`];
                              if (it.price) ctx.push(`현재가 ${Math.round(it.price).toLocaleString()}원`
                                + `(${it.pricePct >= 0 ? "+" : ""}${it.pricePct.toFixed(1)}%)`);
                              if (it.sector) ctx.push(`섹터 ${it.sector}`);
                              if (it.opinion || it.avgTarget) ctx.push(`컨센서스 ${it.opinion ?? ""}`
                                + (it.avgTarget ? `/목표가 ${Math.round(it.avgTarget).toLocaleString()}원` : ""));
                              openGoogleAi(`${STOCK_ANALYSIS_PROMPT}\n\n[기준시각] ${aiNowStamp()}\n[분석 대상] ${ctx.join(", ")}`);
                            }}
                            className="inline-flex items-center px-1 py-0.5 rounded text-[10px] font-bold leading-none
                                       border border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100">
                      🔍AI
                    </button>
                  </span>
                </div>

                {/* 검색기준 섹션이 맨 위 (순서는 view 별) */}
                {ordered[0]}{ordered[1]}{ordered[2]}

                {/* 뉴스(좌) + 공시(우) */}
                {(() => {
                  const news = newsByTicker.get(it.ticker) ?? [];
                  const disc = [...(discByTicker.get(it.ticker) ?? [])].reverse();   // 최신순
                  if (news.length === 0 && disc.length === 0) return null;
                  return (
                    <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {news.length > 0 && (
                        <div className="px-1.5 py-1 border border-gray-200 rounded">
                          <div className="text-[10px] text-gray-400 mb-0.5">📰 뉴스</div>
                          <ul className="divide-y divide-gray-100">
                            {news.slice(0, 5).map(n => (
                              <li key={n.id}>
                                <a href={n.url} target="_blank" rel="noopener noreferrer"
                                   className="block py-0.5 group">
                                  <div className="text-[11px] text-gray-700 leading-snug line-clamp-1 group-hover:text-blue-600">
                                    {n.title}
                                  </div>
                                  <div className="text-[9px] text-gray-400">
                                    {n.press}{n.press && n.datetime ? " · " : ""}{fmtNewsTime(n.datetime)}
                                  </div>
                                </a>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {disc.length > 0 && (
                        <div className="px-1.5 py-1 border border-gray-200 rounded">
                          <div className="text-[10px] text-gray-400 mb-0.5">📋 공시</div>
                          <ul className="divide-y divide-gray-100">
                            {disc.slice(0, 5).map((d, i) => (
                              <li key={`${d.url}-${i}`}>
                                <a href={d.url} target="_blank" rel="noopener noreferrer"
                                   className="block py-0.5 group">
                                  <div className="text-[11px] text-gray-700 leading-snug line-clamp-1 group-hover:text-blue-600">
                                    {d.title}
                                  </div>
                                  <div className="text-[9px] text-gray-400">{d.date}</div>
                                </a>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            );
          })}
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default ConsensusTab;
