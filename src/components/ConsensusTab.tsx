// 컨센서스 상승여력 탭 — 내가 추가한 종목 중, 증권사 리포트별 목표가 기준 상승여력.
// 데이터: 기업가치 팝업과 동일한 wisereport 최근리포트 (리포트별 목표가·투자의견).
// 상승여력/정렬 기준 = 가장 최근(목표가 있는) 리포트. 같은 날 여러 건도 모두 표시.
import { useMemo, useState } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { fetchTossPrices, fetchNaverInfo } from "../lib/api";
import { fetchConsensusReports } from "../lib/fundamentals";
import { openTossStock } from "../lib/toss";
import { Tooltip } from "./Tooltip";

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

type SortKey = "upside" | "date";
type Period = "all" | "1w" | "1m";

// "YY.MM.DD" / "YY/MM/DD" → epoch ms
function parseRepDate(d?: string): number {
  if (!d) return 0;
  const m = /(\d{2})[./](\d{2})[./](\d{2})/.exec(d);
  if (!m) return 0;
  return new Date(2000 + +m[1], +m[2] - 1, +m[3]).getTime();
}

export function ConsensusTab({ items, onOpenValuation, onSelectGroup, onEdit }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [period, setPeriod] = useState<Period>("1w");

  const tickers = useMemo(() => items.map(i => i.ticker), [items]);
  const nameByTicker = useMemo(() => new Map(items.map(i => [i.ticker, i.name])), [items]);
  const groupsByTicker = useMemo(() => new Map(items.map(i => [i.ticker, i.groups ?? []])), [items]);

  const { data: prices } = useQuery({
    queryKey: ["consensus-prices", tickers],
    queryFn: () => fetchTossPrices(tickers),
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
      queryFn: () => fetchConsensusReports(t),
      staleTime: 30 * 60 * 1000,
      refetchOnWindowFocus: false,
    })),
  });
  const anyLoading = naverQs.some(q => q.isLoading) || reportQs.some(q => q.isLoading);

  const displayed = useMemo(() => {
    const now = Date.now();
    const cutoff = period === "1w" ? now - 8 * 864e5
                 : period === "1m" ? now - 31 * 864e5 : 0;
    const rows = tickers.map((t, i) => {
      const con = naverQs[i]?.data?.consensus;
      const reps = reportQs[i]?.data ?? [];
      const loading = (naverQs[i]?.isLoading ?? false) || (reportQs[i]?.isLoading ?? false);
      const price = priceByTicker.get(t);
      // 상승여력 = 제공사 평균 목표주가(naver 컨센서스) 기준
      const avgTarget = con?.target;
      const upside = avgTarget && avgTarget > 0 && price && price > 0
        ? (avgTarget / price - 1) * 100 : null;
      const repTime = parseRepDate(reps[0]?.date);
      const repsShown = cutoff === 0
        ? reps.slice(0, 5)
        : reps.filter(r => parseRepDate(r.date) >= cutoff);
      return {
        ticker: t, name: nameByTicker.get(t) ?? t, groups: groupsByTicker.get(t) ?? [],
        price, reps, repsShown, avgTarget, upside, repTime, loading,
        opinion: con?.opinion, score: con?.score,
      };
    });
    const filtered = rows
      .filter(it => it.upside != null)   // 평균 목표가 있는 종목만
      .filter(it => cutoff === 0 || it.loading || it.repTime >= cutoff);
    return filtered.sort((a, b) =>
      sortKey === "date" ? b.repTime - a.repTime : (b.upside! - a.upside!)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickers,
      naverQs.map(q => `${q.status}:${q.dataUpdatedAt}`).join(","),
      reportQs.map(q => `${q.status}:${q.dataUpdatedAt}`).join(","),
      priceByTicker, nameByTicker, groupsByTicker, period, sortKey]);

  const btn = (active: boolean) =>
    `px-2.5 py-1 rounded-full text-xs font-bold border transition ${
      active ? "bg-gray-800 text-white border-gray-800"
             : "bg-white text-gray-500 border-gray-300 hover:bg-gray-50"}`;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap px-1">
        <h2 className="text-base font-bold text-gray-800">📈 컨센서스 상승여력</h2>
        <span className="text-xs text-gray-500">{displayed.length}종목</span>
        <div className="ml-auto flex items-center gap-1.5">
          <button className={btn(sortKey === "upside")} onClick={() => setSortKey("upside")}>상승여력순</button>
          <button className={btn(sortKey === "date")} onClick={() => setSortKey("date")}>최신순</button>
          <span className="w-px h-4 bg-gray-300 mx-0.5" />
          <button className={btn(period === "1w")} onClick={() => setPeriod("1w")}>1주일</button>
          <button className={btn(period === "1m")} onClick={() => setPeriod("1m")}>1개월</button>
          <button className={btn(period === "all")} onClick={() => setPeriod("all")}>전체</button>
        </div>
      </div>

      {displayed.length === 0 ? (
        <div className="h-32 flex items-center justify-center text-gray-400 text-sm">
          {anyLoading ? "컨센서스 불러오는 중…" : "조건에 맞는 종목이 없습니다."}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {displayed.map((it, i) => {
            const up = it.upside!;
            const upColor = up >= 0 ? "text-rose-600" : "text-blue-600";
            return (
              <div key={it.ticker}
                   className="border border-gray-200 rounded-lg px-3 py-2 hover:bg-gray-50 bg-white">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs text-gray-400 w-5 text-right tabular-nums">{i + 1}</span>
                  <button onClick={() => openTossStock(it.ticker)}
                          className="font-bold text-gray-900 hover:underline">
                    {it.name}
                  </button>
                  {onOpenValuation && (
                    <button onClick={() => onOpenValuation(it.ticker)}
                            title="기업가치 보기"
                            className="text-xs leading-none opacity-60 hover:opacity-100 transition-opacity">
                      📊
                    </button>
                  )}
                  {onEdit && (
                    <button onClick={() => onEdit(it.ticker)}
                            title="보유 수정 (그룹 추가/제외)"
                            className="text-xs leading-none opacity-60 hover:opacity-100 transition-opacity">
                      ✏️
                    </button>
                  )}
                  {it.opinion && (
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-200">
                      {it.opinion}{it.score ? ` ${it.score.toFixed(1)}` : ""}
                    </span>
                  )}
                  {(() => {
                    const gs = it.groups ?? [];
                    const shown = gs.length > 3 ? gs.slice(0, 3) : gs;
                    const more = gs.length - shown.length;
                    const chip = "text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 "
                               + "border border-emerald-200 hover:bg-emerald-100";
                    return (
                      <>
                        {shown.map(g => (
                          <button key={g} onClick={() => onSelectGroup?.(g)}
                                  title={`${g} 그룹으로 이동`} className={chip}>
                            {g}
                          </button>
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
                      </>
                    );
                  })()}
                  <span className={`ml-auto text-lg font-bold tabular-nums ${upColor}`}>
                    {up >= 0 ? "+" : ""}{up.toFixed(1)}%
                  </span>
                </div>
                <div className="flex items-baseline gap-2 mt-1 text-[13px] tabular-nums text-gray-600">
                  <span>현재 <b className="text-blue-600">{it.price ? Math.round(it.price).toLocaleString() : "—"}</b>원</span>
                  <span className="text-gray-400">→</span>
                  <span>평균목표 <b className="text-rose-600">{Math.round(it.avgTarget!).toLocaleString()}</b>원</span>
                  {it.reps[0]?.date && (
                    <span className="ml-auto text-[11px] text-gray-400">
                      📅 {it.reps[0].date}{it.repsShown.length > 1 ? ` · ${it.repsShown.length}건` : ""}
                    </span>
                  )}
                </div>
                {/* 리포트별 목표가 (각각 가격) */}
                {it.repsShown.length > 0 && (
                  <div className="mt-1 space-y-0.5 border-t border-gray-100 pt-1">
                    {it.repsShown.map((r, ri) => {
                      const rt = parseRepDate(r.date);
                      const recent = rt > 0 && Date.now() - rt < 2 * 24 * 3600 * 1000;   // 최근 1~2일
                      return (
                      <div key={ri} className={`flex items-baseline gap-1.5 text-[11px] tabular-nums
                                                ${recent ? "bg-yellow-100/60 rounded font-bold" : ""}`}>
                        <span className="text-gray-400 shrink-0">{r.date.slice(3)}</span>
                        <span className="text-gray-500 shrink-0">{r.broker}</span>
                        {r.opinion && <span className="text-violet-600 shrink-0">{r.opinion}</span>}
                        <span className="text-gray-500 truncate">{r.title}</span>
                        {r.target ? (
                          <span className="ml-auto font-bold text-gray-700 shrink-0">{r.target.toLocaleString()}</span>
                        ) : null}
                      </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default ConsensusTab;
