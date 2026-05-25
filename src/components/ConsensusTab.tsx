// 컨센서스 상승여력 탭 — 내가 추가한 종목 중, 증권사 리포트별 목표가 기준 상승여력.
// 데이터: 기업가치 팝업과 동일한 wisereport 최근리포트 (리포트별 목표가·투자의견).
// 상승여력/정렬 기준 = 가장 최근(목표가 있는) 리포트. 같은 날 여러 건도 모두 표시.
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { fetchTossPrices, fetchNaverPrices, fetchNaverInfo, fetchInvestorHistorySafe, fetchKrPriceHistory } from "../lib/api";
import { getTossMaintenance } from "../lib/tossMaintenance";
import { fetchConsensusReports, fetchMajorShareholders, type Shareholder } from "../lib/fundamentals";
import { openTossStock } from "../lib/toss";
import { Tooltip } from "./Tooltip";
import type { Investor } from "../types";

// 일 변동성 — 종가 일별 수익률(%) 표준편차 (AuxIndicators 동일)
function dailyVol(closes?: number[]): number | null {
  if (!closes || closes.length < 6) return null;
  const r: number[] = [];
  for (let i = 1; i < closes.length; i++) if (closes[i - 1] > 0) r.push(((closes[i] - closes[i - 1]) / closes[i - 1]) * 100);
  if (r.length < 5) return null;
  const m = r.reduce((s, v) => s + v, 0) / r.length;
  return Math.sqrt(r.reduce((s, v) => s + (v - m) ** 2, 0) / r.length);
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

export function ConsensusTab({ items, onOpenValuation, onSelectGroup, onEdit }: Props) {
  const [view, setView] = useState<View>("consensus");   // 책갈피 sub탭
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [period, setPeriod] = useState<Period>("1w");
  // sub탭 전환 시 기본 정렬 리셋
  useEffect(() => {
    setSortKey(DEFAULT_SORT[view]);
    if (view === "consensus") setPeriod("1w");
  }, [view]);

  const tickers = useMemo(() => items.map(i => i.ticker), [items]);
  const nameByTicker = useMemo(() => new Map(items.map(i => [i.ticker, i.name])), [items]);
  const groupsByTicker = useMemo(() => new Map(items.map(i => [i.ticker, i.groups ?? []])), [items]);

  const { data: prices } = useQuery({
    queryKey: ["consensus-prices", tickers],
    queryFn: async () => {
      try { return await fetchTossPrices(tickers); }
      catch (e) {
        if (getTossMaintenance().active) return await fetchNaverPrices(tickers);
        throw e;
      }
    },
    enabled: tickers.length > 0,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const priceByTicker = useMemo(
    () => new Map((prices ?? []).map(p => [p.ticker, p.price])),
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
  // 변동성용 3개월 차트 + 수급 60일 (카드에 항상 표시 — 앱과 캐시 공유)
  const chartQs = useQueries({
    queries: tickers.map(t => ({
      queryKey: ["kr-price-history", t, "3mo"],
      queryFn: () => fetchKrPriceHistory(t, "3mo"),
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
  const anyLoading = naverQs.some(q => q.isLoading) || reportQs.some(q => q.isLoading)
                  || shQs.some(q => q.isLoading);

  const displayed = useMemo(() => {
    const now = Date.now();
    const cutoff = period === "1w" ? now - 8 * 864e5
                 : period === "1m" ? now - 31 * 864e5 : 0;
    const rows = tickers.map((t, i) => {
      const con = naverQs[i]?.data?.consensus;
      const reps = reportQs[i]?.data ?? [];
      const loading = (naverQs[i]?.isLoading ?? false) || (reportQs[i]?.isLoading ?? false);
      const price = priceByTicker.get(t);
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
      // 변동성 + 수급 60일
      const vol = dailyVol((chartQs[i]?.data ?? []).map(p => p.close));
      const inv = invQs[i]?.data ?? null;
      const foreign60 = sumLast(inv, "외국인", 60);
      const inst60 = sumLast(inv, "기관", 60);
      const pension60 = sumLast(inv, "연기금", 60);
      return {
        ticker: t, name: nameByTicker.get(t) ?? t, groups: groupsByTicker.get(t) ?? [],
        price, reps, repsShown, avgTarget, upside, repTime, loading,
        opinion: con?.opinion, score: con?.score,
        holders, npsPct, npsAmount,
        vol, foreign60, inst60, pension60,
      };
    });
    // 모든 종목 표시 — 검색기준 정렬만 적용 (값 없는 종목은 아래로)
    return rows.sort((a, b) => {
      switch (sortKey) {
        case "date": return b.repTime - a.repTime;
        case "upside": return (b.upside ?? -1e9) - (a.upside ?? -1e9);
        case "npsPct": return (b.npsPct ?? -1) - (a.npsPct ?? -1);
        case "npsAmount": return b.npsAmount - a.npsAmount;
        case "vol": return (b.vol ?? -1) - (a.vol ?? -1);
        case "foreign60": return b.foreign60 - a.foreign60;
        case "inst60": return b.inst60 - a.inst60;
        case "pension60": return b.pension60 - a.pension60;
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
      priceByTicker, nameByTicker, groupsByTicker, period, sortKey]);

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

  return (
    <div className="space-y-2">
      {/* 책갈피 — 검색기준 (왼쪽 상단) */}
      <div className="flex items-end gap-1 border-b border-gray-300 px-1">
        {subTab("consensus", "🎯 컨센서스")}
        {subTab("pension", "🏦 연기금")}
        {subTab("screener", "📊 변동율")}
        <span className="ml-2 mb-1 text-xs text-gray-500">{displayed.length}종목</span>
        {anyLoading && <span className="mb-1 text-xs text-gray-400">불러오는 중…</span>}
        <div className="ml-auto mb-1 flex items-center gap-1 flex-wrap">
          {view === "consensus" && <>
            <button className={btn(sortKey === "upside")} onClick={() => setSortKey("upside")}>상승여력순</button>
            <button className={btn(sortKey === "date")} onClick={() => setSortKey("date")}>최신순</button>
          </>}
          {view === "pension" && <>
            <button className={btn(sortKey === "npsPct")} onClick={() => setSortKey("npsPct")}>비율순</button>
            <button className={btn(sortKey === "npsAmount")} onClick={() => setSortKey("npsAmount")}>금액순</button>
          </>}
          {view === "screener" && <>
            <button className={btn(sortKey === "vol")} onClick={() => setSortKey("vol")}>일변동율(%)</button>
            <span className="text-[10px] text-gray-400 ml-1">60일 순매수</span>
            <button className={btn(sortKey === "foreign60")} onClick={() => setSortKey("foreign60")}>외국인</button>
            <button className={btn(sortKey === "inst60")} onClick={() => setSortKey("inst60")}>기관</button>
            <button className={btn(sortKey === "pension60")} onClick={() => setSortKey("pension60")}>연기금</button>
          </>}
        </div>
      </div>

      {displayed.length === 0 ? (
        <div className="h-32 flex items-center justify-center text-gray-400 text-sm">
          {anyLoading ? "불러오는 중…" : "표시할 종목이 없습니다."}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {displayed.map((it, i) => {
            const up = it.upside;
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
                                                  ${isNps ? "bg-amber-50 rounded px-1 font-bold text-amber-800" : "text-gray-600"}`}>
                          <span className="truncate">{isNps ? "🏦 " : ""}{h.name}</span>
                          <span className="ml-auto text-gray-500">{fmtKrw((h.shares ?? 0) * (it.price ?? 0))}</span>
                          <span className="w-14 text-right">{(h.pct ?? 0).toFixed(2)}%</span>
                        </div>
                      );
                    })}
                  </div>
                ) : <div className="text-[11px] text-gray-300">주요주주 정보 없음</div>}
              </div>
            );
            // 변동율·수급 섹션
            const volSection = (() => {
              const box = (active: boolean) =>
                `rounded border px-1.5 py-0.5 ${active
                  ? "bg-blue-50 border-blue-400"
                  : "bg-gray-50/60 border-gray-200"}`;
              const flowCls = (v: number) => v >= 0 ? "text-rose-600" : "text-blue-600";
              const lblCls = (active: boolean) => `text-[10px] ${active ? "text-gray-900 font-bold" : "text-gray-400"}`;
              const aVol = view === "screener" && sortKey === "vol";
              const aFor = view === "screener" && sortKey === "foreign60";
              const aIns = view === "screener" && sortKey === "inst60";
              const aPen = view === "screener" && sortKey === "pension60";
              return (
                <div className="mt-1 grid grid-cols-4 gap-1 text-[11px] tabular-nums">
                  <div className={`text-center ${box(aVol)}`}>
                    <div className={lblCls(aVol)}>일변동율</div>
                    <b className={`text-fuchsia-600 ${aVol ? "text-base" : ""}`}>{it.vol != null ? `±${it.vol.toFixed(2)}%` : "—"}</b>
                    {it.vol != null && it.price ? (
                      <div className="text-[9px] leading-tight">
                        <span className="text-blue-600">{Math.round(it.price * (1 - it.vol / 100)).toLocaleString()}</span>
                        {"~"}<span className="text-rose-600">{Math.round(it.price * (1 + it.vol / 100)).toLocaleString()}</span>
                      </div>
                    ) : null}
                  </div>
                  <div className={`text-center ${box(aFor)}`}>
                    <div className={lblCls(aFor)}>외국인 60일</div>
                    <b className={`${flowCls(it.foreign60)} ${aFor ? "text-base" : ""}`}>{fmtSharesK(it.foreign60)}</b>
                  </div>
                  <div className={`text-center ${box(aIns)}`}>
                    <div className={lblCls(aIns)}>기관 60일</div>
                    <b className={`${flowCls(it.inst60)} ${aIns ? "text-base" : ""}`}>{fmtSharesK(it.inst60)}</b>
                  </div>
                  <div className={`text-center ${box(aPen)}`}>
                    <div className={lblCls(aPen)}>연기금 60일</div>
                    <b className={`${flowCls(it.pension60)} ${aPen ? "text-base" : ""}`}>{fmtSharesK(it.pension60)}</b>
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
                    {it.reps.map((r, ri) => {
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
                {/* 헤더 */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs text-gray-400 w-5 text-right tabular-nums">{i + 1}</span>
                  <button onClick={() => openTossStock(it.ticker)} className="font-bold text-gray-900 hover:underline">{it.name}</button>
                  {onOpenValuation && (
                    <button onClick={() => onOpenValuation(it.ticker)} title="기업가치 보기"
                            className="text-xs leading-none opacity-60 hover:opacity-100">📊</button>
                  )}
                  {onEdit && (
                    <button onClick={() => onEdit(it.ticker)} title="보유 수정"
                            className="text-xs leading-none opacity-60 hover:opacity-100">✏️</button>
                  )}
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
                </div>
                <div className="text-[13px] tabular-nums text-gray-600 mt-0.5">
                  현재 <b className="text-blue-600">{it.price ? Math.round(it.price).toLocaleString() : "—"}</b>원
                </div>

                {/* 검색기준 섹션이 맨 위 (순서는 view 별) */}
                {ordered[0]}{ordered[1]}{ordered[2]}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default ConsensusTab;
