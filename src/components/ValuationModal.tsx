import { lazy, Suspense, useCallback, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  IChartApi, ISeriesApi, SeriesType, MouseEventParams, LogicalRange,
} from "lightweight-charts";

// 무거운 차트 라이브러리는 lazy — 모달 열릴 때만 로드 (~50KB gzip)
const CandleChartLight = lazy(() => import("./CandleChartLight"));
const InvestorChartLight = lazy(() => import("./InvestorChartLight"));

// 4개 차트 동기화 — crosshair (hover) + 줌/팬 (visible range)
// 각 차트가 onSyncedHover 콜백 등록 → 다른 차트 hover 시 자체 데이터로 crosshair + 툴팁 갱신
import type { Time } from "lightweight-charts";

type SyncRegistrar = (
  chart: IChartApi,
  anchor: ISeriesApi<SeriesType>,
  onSyncedHover?: (time: Time | null) => void,
) => () => void;

function useCrosshairSync(): SyncRegistrar {
  const entriesRef = useRef<Array<{
    chart: IChartApi;
    anchor: ISeriesApi<SeriesType>;
    onSyncedHover?: (time: Time | null) => void;
  }>>([]);
  const isSyncingRangeRef = useRef(false);

  return useCallback((chart, anchor, onSyncedHover) => {
    const entry = { chart, anchor, onSyncedHover };
    entriesRef.current.push(entry);

    // ─── 1) Crosshair sync (hover) ────────────────────────────
    const moveHandler = (param: MouseEventParams) => {
      const time = param.time ?? null;
      for (const other of entriesRef.current) {
        if (other.chart === chart) continue;
        try {
          if (other.onSyncedHover) {
            // 차트가 자체 처리 (cross + 툴팁)
            other.onSyncedHover(time);
          } else {
            // fallback — vertical line 만
            if (time != null) {
              other.chart.setCrosshairPosition(NaN, time, other.anchor);
            } else {
              other.chart.clearCrosshairPosition();
            }
          }
        } catch { /* 차트 제거됨 — 무시 */ }
      }
    };
    chart.subscribeCrosshairMove(moveHandler);

    // ─── 2) Time scale sync (줌/팬) ───────────────────────────
    const rangeHandler = (range: LogicalRange | null) => {
      if (isSyncingRangeRef.current || !range) return;
      isSyncingRangeRef.current = true;
      try {
        for (const other of entriesRef.current) {
          if (other.chart === chart) continue;
          try { other.chart.timeScale().setVisibleLogicalRange(range); }
          catch { /* 차트 제거됨 */ }
        }
      } finally {
        isSyncingRangeRef.current = false;
      }
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(rangeHandler);

    return () => {
      entriesRef.current = entriesRef.current.filter(e => e !== entry);
      try { chart.unsubscribeCrosshairMove(moveHandler); } catch { /* noop */ }
      try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(rangeHandler); }
      catch { /* noop */ }
    };
  }, []);
}
import {
  fetchFullValuation, matchBrokerToShareholder,
  INDICATOR_SECTIONS, INDICATOR_LABELS, INDICATOR_DESCRIPTIONS,
  formatIndicator, judgeIndicator,
} from "../lib/fundamentals";
import type { FundamentalData, ConsensusReport, Shareholder } from "../lib/fundamentals";
import { signColor } from "../lib/format";
import { fetchInvestorHistorySafe, fetchKrPriceHistory } from "../lib/api";
import type { PricePoint } from "../lib/api";
import type { Investor } from "../types";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  ticker: string;
  name: string;
  curPrice?: number;
  myAvgPrice?: number;       // 보유 시 평단가 (차트 가로선)
}

function IndicatorRow({ ikey, val, data }: {
  ikey: string; val: unknown; data: FundamentalData;
}) {
  const label = INDICATOR_LABELS[ikey] ?? ikey;
  const desc = INDICATOR_DESCRIPTIONS[ikey] ?? "";
  const formatted = formatIndicator(ikey, val);
  const isMissing = val == null || val === "";
  const j = judgeIndicator(ikey, val, data);
  const valColor = isMissing ? "text-gray-400"
                  : j === "good" ? "text-rose-600"
                  : j === "bad" ? "text-blue-600"
                  : "text-gray-900";
  return (
    <div className="py-1.5 border-b border-gray-100 last:border-b-0">
      <div className="flex justify-between items-baseline">
        <span className="text-sm text-gray-700">{label}</span>
        <span className={`text-sm font-bold tabular-nums ${valColor}`}>
          {formatted}
        </span>
      </div>
      {desc && (
        <p className="text-[10.5px] text-gray-500 mt-0.5 leading-snug">
          {desc}
        </p>
      )}
    </div>
  );
}

function Section({ title, sub, ikeys, data }: {
  title: string; sub: string; ikeys: string[]; data: FundamentalData;
}) {
  return (
    <section className="bg-gray-50 rounded p-3 border border-gray-200">
      <header className="mb-2">
        <h3 className="font-bold text-gray-700">{title}</h3>
        <p className="text-xs text-gray-400">{sub}</p>
      </header>
      <div>
        {ikeys.map(k => (
          <IndicatorRow key={k} ikey={k}
                        val={(data as Record<string, unknown>)[k]}
                        data={data} />
        ))}
      </div>
    </section>
  );
}

function ConsensusSection({ reports, shareholders, curPrice, fundamental }: {
  reports: ConsensusReport[]; shareholders: Shareholder[]; curPrice?: number;
  fundamental: FundamentalData;
}) {
  const targets = reports.map(r => r.target).filter((t): t is number => typeof t === "number");
  const simpleAvg = targets.length > 0
    ? Math.round(targets.reduce((a, b) => a + b, 0) / targets.length)
    : undefined;
  const officialTarget = fundamental.consensus_target_official;
  const opinion = fundamental.consensus_opinion ?? "";
  const opScore = fundamental.consensus_score;
  // 공식 컨센서스 우선, 없으면 단순평균
  const headlineTarget = officialTarget ?? simpleAvg;
  const headlineGap = headlineTarget && curPrice && curPrice > 0
    ? ((headlineTarget - curPrice) / curPrice) * 100 : undefined;
  // 투자의견 색상 (v2 동일)
  const opLc = opinion.toLowerCase();
  const opColor = /buy|매수|strong/.test(opLc) ? "text-rose-600"
                : /sell|매도|감량|축소/.test(opLc) ? "text-blue-700"
                : "text-gray-700";
  return (
    <section className="bg-gray-50 rounded p-3 border border-gray-200">
      <header className="mb-2">
        <h3 className="font-bold text-gray-700">🎯 컨센서스</h3>
        <p className="text-xs text-gray-400">증권사들이 본 적정 주가</p>
      </header>

      {/* 1줄: 평균 목표주가 (네이버 공식 우선) */}
      {headlineTarget != null ? (
        <div className="flex items-baseline justify-between mb-1">
          <span className="text-sm font-bold text-gray-700">평균 목표주가</span>
          <span className="text-sm font-bold tabular-nums text-gray-900">
            {headlineTarget.toLocaleString()}원
            {headlineGap !== undefined && (
              <span className={`ml-1 ${signColor(headlineGap)}`}>
                ({headlineGap >= 0 ? "+" : ""}{headlineGap.toFixed(1)}%)
              </span>
            )}
          </span>
        </div>
      ) : (
        <div className="text-xs text-gray-400 mb-1">컨센서스 데이터 없음</div>
      )}

      {/* 2줄: 투자의견 + 점수 */}
      {(opinion || opScore != null) && (
        <div className="flex items-baseline justify-between mb-1">
          <span className="text-sm text-gray-700">투자의견</span>
          <span className={`text-sm font-bold ${opColor}`}>
            {opinion}{opScore != null ? ` (${opScore.toFixed(2)}점)` : ""}
          </span>
        </div>
      )}

      {/* 3줄: 단순평균 (참고) — 공식과 다를 때만 */}
      {simpleAvg != null && (officialTarget == null || simpleAvg !== officialTarget) && (
        <div className="text-[11px] text-gray-500 mb-2">
          참고: 최근 {targets.length}건 단순평균 {simpleAvg.toLocaleString()}원
        </div>
      )}

      <div className="text-xs text-gray-400 mb-1.5">
        최근 리포트 ({reports.length}건)
      </div>

      {reports.length === 0 ? (
        <div className="text-xs text-gray-400 py-2">최근 리포트 없음</div>
      ) : (
        <div className="space-y-1.5">
          {reports.map((r, i) => {
            const sh = matchBrokerToShareholder(r.broker, shareholders);
            const gap = r.target && curPrice && curPrice > 0
              ? ((r.target - curPrice) / curPrice) * 100 : undefined;
            return (
              <div key={i} className="text-xs border-b border-gray-100 pb-1.5 last:border-b-0">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-gray-500">{r.date}</span>
                  <span className="font-bold text-gray-800">{r.broker}</span>
                  {sh?.pct != null && (
                    <span className="text-[10px] bg-amber-100 text-amber-800 rounded px-1">
                      주주 {sh.pct.toFixed(2)}%
                    </span>
                  )}
                  {r.opinion && (
                    <span className="text-rose-700">{r.opinion}</span>
                  )}
                  {r.target && (
                    <span className="ml-auto tabular-nums">
                      <span className="font-bold">{r.target.toLocaleString()}</span>
                      {gap !== undefined && (
                        <span className={`ml-1 ${signColor(gap)}`}>
                          ({gap >= 0 ? "+" : ""}{gap.toFixed(2)}%)
                        </span>
                      )}
                    </span>
                  )}
                </div>
                {r.title && (
                  <div className="text-gray-600 mt-0.5 truncate">{r.title}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ShareholderSection({ shareholders }: { shareholders: Shareholder[] }) {
  return (
    <section className="bg-gray-50 rounded p-3 border border-gray-200">
      <header className="mb-2">
        <h3 className="font-bold text-gray-700">👥 주요주주</h3>
        <p className="text-xs text-gray-400">5% 이상 보유 대주주 / 국민연금 등</p>
      </header>
      {shareholders.length === 0 ? (
        <div className="text-xs text-gray-400 py-2">주주 정보 없음</div>
      ) : (
        <div className="space-y-1 text-xs">
          {shareholders.slice(0, 10).map((s, i) => (
            <div key={i} className="flex justify-between border-b border-gray-100 pb-1 last:border-b-0">
              <span className="text-gray-700 truncate mr-2">{s.name}</span>
              <span className="tabular-nums text-gray-700 shrink-0">
                {s.shares != null && (
                  <span>{s.shares.toLocaleString()}주</span>
                )}
                {s.pct != null && (
                  <span className="ml-2 font-bold text-gray-900">
                    {s.pct.toFixed(2)}%
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function ValuationModal({
  isOpen, onClose, ticker, name, curPrice, myAvgPrice,
}: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["valuation", ticker],
    queryFn: () => fetchFullValuation(ticker),
    enabled: isOpen && /^[\dA-Za-z]{6}$/.test(ticker),
    staleTime: 24 * 3600_000,  // 24시간 캐시
  });
  const downOnBackdropRef = useRef(false);

  if (!isOpen) return null;

  const fund = data?.fundamental ?? {};
  const reports = data?.reports ?? [];
  const shareholders = data?.shareholders ?? [];
  // 컨센서스 목표가 (공식 우선, 없으면 리포트 단순평균)
  const reportTargets = reports
    .map(r => r.target)
    .filter((t): t is number => typeof t === "number");
  const targetPrice =
    fund.consensus_target_official ??
    (reportTargets.length > 0
      ? Math.round(reportTargets.reduce((a, b) => a + b, 0) / reportTargets.length)
      : undefined);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center
                     bg-black/40 p-4"
         onMouseDown={e => { downOnBackdropRef.current = e.target === e.currentTarget; }}
         onClick={e => {
           if (e.target === e.currentTarget && downOnBackdropRef.current) onClose();
         }}>
      <div className="bg-white rounded-lg shadow-xl max-w-7xl w-full
                       max-h-[92vh] flex flex-col">
        <header className="px-5 py-3 border-b bg-gray-50">
          {/* 첫 줄: 기업가치 타이틀 + 닫기 (모바일은 종목명 다음 줄로) */}
          <div className="flex items-baseline gap-3">
            <h2 className="text-xl font-bold">📊 기업가치</h2>
            {/* PC: inline 으로 종목명·가격 같이 / 모바일: 다음 줄로 */}
            <span className="hidden sm:inline-flex items-baseline gap-3">
              <span className="text-base font-bold">{name}</span>
              <span className="text-sm text-gray-500">({ticker})</span>
              {curPrice && (
                <span className="text-base font-bold ml-3">
                  {curPrice.toLocaleString()}원
                </span>
              )}
            </span>
            <button onClick={onClose}
                    className="ml-auto text-gray-400 hover:text-gray-600 text-xl">
              ✕
            </button>
          </div>
          {/* 모바일 — 종목명·가격을 두 번째 줄에 */}
          <div className="sm:hidden flex items-baseline gap-2 mt-1 flex-wrap">
            <span className="text-base font-bold">{name}</span>
            <span className="text-sm text-gray-500">({ticker})</span>
            {curPrice && (
              <span className="text-base font-bold ml-auto">
                {curPrice.toLocaleString()}원
              </span>
            )}
          </div>
          <div className="text-xs text-gray-400 mt-1">
            출처: 네이버 금융 / Wisereport · 24시간 캐시
            {isLoading && " · 불러오는 중…"}
          </div>
        </header>

        <div className="px-5 py-4 overflow-y-auto">
          {error instanceof Error && (
            <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
              fetch 실패: {error.message}
            </div>
          )}
          {/* 3 컬럼 레이아웃 */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {/* Col 1: 가치평가 / 수익성 */}
            <div className="space-y-3">
              <Section title={INDICATOR_SECTIONS[0].title}
                       sub={INDICATOR_SECTIONS[0].sub}
                       ikeys={INDICATOR_SECTIONS[0].keys} data={fund} />
              <Section title={INDICATOR_SECTIONS[1].title}
                       sub={INDICATOR_SECTIONS[1].sub}
                       ikeys={INDICATOR_SECTIONS[1].keys} data={fund} />
            </div>
            {/* Col 2: 주주환원 / 재무건전성 / 가격 통계 */}
            <div className="space-y-3">
              <Section title={INDICATOR_SECTIONS[2].title}
                       sub={INDICATOR_SECTIONS[2].sub}
                       ikeys={INDICATOR_SECTIONS[2].keys} data={fund} />
              <Section title={INDICATOR_SECTIONS[3].title}
                       sub={INDICATOR_SECTIONS[3].sub}
                       ikeys={INDICATOR_SECTIONS[3].keys} data={fund} />
              <Section title={INDICATOR_SECTIONS[4].title}
                       sub={INDICATOR_SECTIONS[4].sub}
                       ikeys={INDICATOR_SECTIONS[4].keys} data={fund} />
            </div>
            {/* Col 3: 컨센서스 + 주주 */}
            <div className="space-y-3">
              <ConsensusSection reports={reports}
                                 shareholders={shareholders}
                                 curPrice={curPrice}
                                 fundamental={fund} />
              <ShareholderSection shareholders={shareholders} />
            </div>
          </div>

          {/* 투자자별 순매수 (최근 60일) */}
          <InvestorHistorySection ticker={ticker}
                                  targetPrice={targetPrice}
                                  myAvgPrice={myAvgPrice} />

          {/* 외부 링크 */}
          <section className="mt-4 flex flex-wrap gap-2 text-xs">
            <a href={`https://tossinvest.com/stocks/A${ticker}`}
               className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded">
              🔗 토스
            </a>
            <a href={`https://finance.naver.com/item/main.naver?code=${ticker}`}
               className="px-2.5 py-1 bg-green-600 hover:bg-green-700 text-white rounded">
              🔗 네이버 금융
            </a>
            <a href={`https://navercomp.wisereport.co.kr/v2/company/c1010001.aspx?cmp_cd=${ticker}`}
               className="px-2.5 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded">
              🔗 Wisereport
            </a>
          </section>
        </div>
      </div>
    </div>
  );
}

// ─── 투자자별 순매수 60일 표 ──────────────────────────────
interface InvestorHistoryProps {
  ticker: string;
  targetPrice?: number;
  myAvgPrice?: number;
}

const INVESTOR_COLS: { label: string; key: keyof Investor }[] = [
  { label: "개인",       key: "개인" },
  { label: "외국인",     key: "외국인" },
  { label: "기관계",     key: "기관" },
  { label: "금융투자",   key: "금융투자" },
  { label: "연기금",     key: "연기금" },
  { label: "투신",       key: "투신" },
  { label: "사모",       key: "사모" },
  { label: "보험",       key: "보험" },
  { label: "은행",       key: "은행" },
  { label: "기타금융",   key: "기타금융" },
  { label: "기타법인",   key: "기타법인" },
];

function fmtVolume(v: number): string {
  if (v === 0) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toLocaleString()}`;
}
function volColor(v: number): string {
  if (v > 0) return "text-rose-600";
  if (v < 0) return "text-blue-600";
  return "text-gray-300";
}

// 누적 합계 기간 정의 — 토스 API 가 size=200 (~10개월) 까지만 반환
const SUMMARY_PERIODS: { label: string; days: number }[] = [
  { label: "5일",            days: 5 },
  { label: "20일 (1개월)",    days: 20 },
  { label: "60일 (3개월)",    days: 60 },
  { label: "120일 (6개월)",   days: 120 },
  { label: "200일 (~10개월)", days: 200 },
];

interface PeriodSummary {
  label: string;
  actualDays: number;
  sums: Record<string, number>;
  rateDelta: number;
}
function computePeriodSummary(
  history: Investor[], label: string, days: number,
): PeriodSummary | null {
  if (history.length === 0) return null;
  const slice = history.slice(0, Math.min(days, history.length));
  if (slice.length === 0) return null;
  const sums: Record<string, number> = {};
  for (const c of INVESTOR_COLS) sums[c.key] = 0;
  for (const d of slice) {
    for (const c of INVESTOR_COLS) {
      sums[c.key] += d[c.key] as number;
    }
  }
  // 외인비율 변화 (첫 날 vs 마지막 날)
  const rateDelta = slice.length >= 2
    ? slice[0].외국인비율 - slice[slice.length - 1].외국인비율
    : 0;
  return { label, actualDays: slice.length, sums, rateDelta };
}

function InvestorHistorySection({
  ticker, targetPrice, myAvgPrice,
}: InvestorHistoryProps) {
  const { data: history, isLoading } = useQuery({
    queryKey: ["investor-history-modal", ticker],
    queryFn: () => fetchInvestorHistorySafe(ticker, [200, 120, 60]),
    enabled: /^[\dA-Za-z]{6}$/.test(ticker),
    staleTime: 5 * 60_000,  // 5분 (App 의 5초 폴링과 별도, 모달 캐시)
  });

  if (!/^[\dA-Za-z]{6}$/.test(ticker)) return null;

  const summaries = history
    ? SUMMARY_PERIODS.map(p => computePeriodSummary(history, p.label, p.days))
                     .filter((s): s is PeriodSummary => s !== null)
    : [];

  return (
    <section className="mt-5">
      <h3 className="text-sm font-bold text-gray-800 mb-1.5">
        📊 투자자별 순매수 (최근 {history?.length ?? 0}일)
        <span className="ml-2 text-[11px] font-normal text-gray-400">
          단위: 주 · 양수 매수 / 음수 매도 · 외인비율은 기간 시작 대비 변화
        </span>
      </h3>
      {isLoading && (
        <div className="text-xs text-gray-400 py-2">불러오는 중...</div>
      )}
      {!isLoading && (!history || history.length === 0) && (
        <div className="text-xs text-gray-400 py-2">데이터 없음</div>
      )}

      {/* 수급 차트 — 주가+거래량 + 외국인 / 기관 / 연기금 */}
      {history && history.length > 0 && (
        <InvestorChartsSection ticker={ticker} history={history}
                               targetPrice={targetPrice}
                               myAvgPrice={myAvgPrice} />
      )}

      {history && history.length > 0 && (
        <div className="hidden lg:block overflow-x-auto border border-gray-200 rounded mt-3">
          <table className="text-[11px] tabular-nums whitespace-nowrap min-w-full">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr className="border-b border-gray-200">
                <th className="px-2 py-1.5 text-left text-gray-600 font-medium">
                  일자 / 기간
                </th>
                {INVESTOR_COLS.map(c => (
                  <th key={c.key} className="px-2 py-1.5 text-right text-gray-600 font-medium">
                    {c.label}
                  </th>
                ))}
                <th className="px-2 py-1.5 text-right text-gray-600 font-medium">
                  외인비율(%)
                </th>
              </tr>
            </thead>
            <tbody>
              {/* 합계 행 — 5/20/60/120/250 거래일 */}
              {summaries.map(s => (
                <tr key={s.label}
                    className="border-b border-gray-200 bg-blue-50/40 font-bold">
                  <td className="px-2 py-1.5 text-left text-gray-800">
                    {s.label}
                    {s.actualDays < SUMMARY_PERIODS.find(p => p.label === s.label)!.days && (
                      <span className="ml-1 text-[10px] font-normal text-gray-400">
                        (실제 {s.actualDays}일)
                      </span>
                    )}
                  </td>
                  {INVESTOR_COLS.map(c => {
                    const v = s.sums[c.key];
                    return (
                      <td key={c.key} className={`px-2 py-1.5 text-right ${volColor(v)}`}>
                        {fmtVolume(v)}
                      </td>
                    );
                  })}
                  <td className={`px-2 py-1.5 text-right
                                  ${s.rateDelta > 0 ? "text-rose-600"
                                    : s.rateDelta < 0 ? "text-blue-600"
                                    : "text-gray-400"}`}>
                    {s.rateDelta === 0
                      ? "—"
                      : `${s.rateDelta > 0 ? "+" : ""}${s.rateDelta.toFixed(2)}%p`}
                  </td>
                </tr>
              ))}
              {/* 일별 데이터 — 합계 아래 회색 구분선 */}
              <tr className="border-b-2 border-gray-300">
                <td colSpan={INVESTOR_COLS.length + 2}
                    className="px-2 py-0.5 bg-gray-100 text-[10px] text-gray-500">
                  ▼ 일별 상세
                </td>
              </tr>
              {history.map(d => (
                <tr key={d.date} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-2 py-1 text-left text-gray-700">{d.date}</td>
                  {INVESTOR_COLS.map(c => {
                    const v = d[c.key] as number;
                    return (
                      <td key={c.key} className={`px-2 py-1 text-right ${volColor(v)}`}>
                        {fmtVolume(v)}
                      </td>
                    );
                  })}
                  <td className="px-2 py-1 text-right text-gray-700">
                    {d.외국인비율.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ─── 수급 차트 모음 — 주가+거래량 (full) + 외국인/기관/연기금 (3분할) ───
// 4개 차트 모두 lightweight-charts 기반, 한 hook 으로 crosshair 동기화.
function InvestorChartsSection({
  ticker, history, targetPrice, myAvgPrice,
}: {
  ticker: string; history: Investor[];
  targetPrice?: number; myAvgPrice?: number;
}) {
  // 가격 + 거래량 history (Yahoo 1y, KOSPI→KOSDAQ 자동 폴백)
  const { data: prices, isLoading: pricesLoading } = useQuery({
    queryKey: ["price-history-modal", ticker],
    queryFn: () => fetchKrPriceHistory(ticker, "1y"),
    enabled: /^[\dA-Za-z]{6}$/.test(ticker),
    staleTime: 5 * 60_000,
  });

  // 시간순 정렬 + 누적 합 — useMemo 로 ref 안정화 (재렌더 시 차트 재생성 방지)
  const data = useMemo(() => [...history].reverse(), [history]);
  const dates = useMemo(() => data.map(d => d.date ?? ""), [data]);
  const dailyForeign = useMemo(() => data.map(d => d.외국인), [data]);
  const dailyInst = useMemo(() => data.map(d => d.기관), [data]);
  const dailyPension = useMemo(() => data.map(d => d.연기금), [data]);
  const cumForeign = useMemo(() => {
    let s = 0; return data.map(d => { s += d.외국인; return s; });
  }, [data]);
  const cumInst = useMemo(() => {
    let s = 0; return data.map(d => { s += d.기관; return s; });
  }, [data]);
  const cumPension = useMemo(() => {
    let s = 0; return data.map(d => { s += d.연기금; return s; });
  }, [data]);

  // 가격을 history 날짜에 정렬 (4개 차트 X축 통일) — useMemo
  const alignedPrices = useMemo(() => {
    const byDate = new Map((prices ?? []).map(p => [p.date, p]));
    return dates
      .map(d => byDate.get(d))
      .filter((p): p is PricePoint => p != null);
  }, [prices, dates]);

  // 4 차트 crosshair sync
  const registerSync = useCrosshairSync();

  if (history.length < 2) return null;

  return (
    <div className="space-y-2 mt-2">
      {/* 1. 주가 — 전체 폭 (외국인비율 % + 목표가/평단가 가로선) */}
      {alignedPrices.length > 1 ? (
        <PriceVolumeChart prices={alignedPrices} investors={data}
                          targetPrice={targetPrice} myAvgPrice={myAvgPrice}
                          onReady={registerSync} />
      ) : (
        <div className="text-xs text-gray-400 p-2 border border-gray-200 rounded">
          {pricesLoading ? "주가 로딩 중..." : "주가 데이터 없음 (Yahoo 미수록)"}
        </div>
      )}
      {/* 2~4. 수급 3개 — 한 줄 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <Suspense fallback={<div className="h-[220px]" />}>
          <InvestorChartLight
            label="외국인"
            daily={dailyForeign} cumulative={cumForeign} dates={dates}
            barColor="#ddd6fe" cumColor="#6d28d9"
            onReady={registerSync}
          />
          <InvestorChartLight
            label="기관계"
            daily={dailyInst} cumulative={cumInst} dates={dates}
            barColor="#bbf7d0" cumColor="#047857"
            onReady={registerSync}
          />
          <InvestorChartLight
            label="연기금"
            daily={dailyPension} cumulative={cumPension} dates={dates}
            barColor="#fed7aa" cumColor="#c2410c"
            onReady={registerSync}
          />
        </Suspense>
      </div>
    </div>
  );
}

// ─── 1) 주가 + 거래량 + 외국인비율(%) + 목표가/평단가 가로선 ─────
type ChartMode = "line" | "candle";
const CHART_MODE_KEY = "price_chart_mode";
function loadChartMode(): ChartMode {
  try { return localStorage.getItem(CHART_MODE_KEY) === "candle" ? "candle" : "line"; }
  catch { return "line"; }
}
function saveChartMode(m: ChartMode): void {
  try { localStorage.setItem(CHART_MODE_KEY, m); } catch { /* noop */ }
}

function PriceVolumeChart({
  prices, investors, targetPrice, myAvgPrice, onReady,
}: {
  prices: PricePoint[]; investors: Investor[];
  targetPrice?: number; myAvgPrice?: number;
  onReady?: SyncRegistrar;
}) {
  const [mode, setMode] = useState<ChartMode>(loadChartMode);
  const setModePersist = (m: ChartMode) => { setMode(m); saveChartMode(m); };
  const N = prices.length;
  if (N < 2) return null;

  // 헤더용 — 마지막 가격, 기간 추세 색, 마지막 외인비율
  const last = prices[N - 1];
  const first = prices[0];
  const color = last.close >= first.close ? "#dc2626" : "#2563eb";
  const ratioColor = "#7c3aed";
  const lastRatio = [...investors]
    .reverse()
    .find(inv => inv.외국인비율 > 0)?.외국인비율;

  const togglePill = (m: ChartMode, label: string) => (
    <button onClick={() => setModePersist(m)}
            className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
              mode === m
                ? "bg-amber-400 text-amber-950 shadow-[0_0_6px_rgba(251,191,36,0.5)]"
                : "text-gray-500 hover:bg-gray-100"
            }`}>
      {label}
    </button>
  );

  return (
    <div className="border border-gray-200 rounded p-2 bg-white">
      <div className="flex items-baseline gap-2 text-xs mb-1 flex-wrap">
        <span className="font-bold" style={{ color }}>주가</span>
        <span className="tabular-nums font-bold" style={{ color }}>
          {last.close.toLocaleString()}원
        </span>
        {lastRatio !== undefined && (
          <span className="flex items-center gap-1 ml-2">
            <span className="inline-block w-3 h-0.5"
                  style={{ background: ratioColor }}></span>
            <span style={{ color: ratioColor }} className="font-medium">외국인 지분율</span>
            <span className="tabular-nums" style={{ color: ratioColor }}>
              {lastRatio.toFixed(2)}%
            </span>
          </span>
        )}
        {targetPrice && targetPrice > 0 && (() => {
          // 목표까지 % — 컨센서스 섹션과 동일 공식: (target - current) / current
          // 양수: 목표가 위 (남음), 음수: 목표 초과
          const pct = ((targetPrice - last.close) / last.close) * 100;
          return (
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 border-t border-dashed border-amber-500"></span>
              <span className="text-amber-600 font-medium">목표</span>
              <span className="tabular-nums text-gray-700">
                {targetPrice.toLocaleString()}
              </span>
              <span className={`tabular-nums ${signColor(pct)}`}>
                ({pct >= 0 ? "+" : ""}{pct.toFixed(2)}%)
              </span>
            </span>
          );
        })()}
        {myAvgPrice && myAvgPrice > 0 && (() => {
          // 평단가 대비 수익률 — (current - myAvg) / myAvg
          // 양수: 수익, 음수: 손실 (한국식 빨강=수익 / 파랑=손실)
          const pct = ((last.close - myAvgPrice) / myAvgPrice) * 100;
          return (
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 border-t border-dashed border-emerald-500"></span>
              <span className="text-emerald-600 font-medium">내평단</span>
              <span className="tabular-nums text-gray-700">
                {Math.round(myAvgPrice).toLocaleString()}
              </span>
              <span className={`tabular-nums ${signColor(pct)}`}>
                ({pct >= 0 ? "+" : ""}{pct.toFixed(2)}%)
              </span>
            </span>
          );
        })()}
        <span className="ml-auto inline-flex items-center gap-0.5 rounded border border-gray-200 p-0.5">
          {togglePill("line",   "📈 라인")}
          {togglePill("candle", "🕯 캔들")}
        </span>
      </div>
      <Suspense fallback={
        <div className="w-full h-[220px] lg:h-[360px] flex items-center justify-center text-xs text-gray-400">
          차트 로딩 중...
        </div>
      }>
        <CandleChartLight prices={prices} investors={investors} mode={mode}
                          targetPrice={targetPrice} myAvgPrice={myAvgPrice}
                          onReady={onReady} />
      </Suspense>
    </div>
  );
}

