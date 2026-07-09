import { lazy, Suspense, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCrosshairSync } from "../lib/useCrosshairSync";
import { useEscClose } from "../lib/useEscClose";
import { maColor, parseMaPeriods, MA_DEFAULT_PERIODS, MA_MAX_LINES, MA_MAX_PERIOD } from "../lib/indicators";
import type { SyncRegistrar } from "../lib/useCrosshairSync";

// 무거운 차트 라이브러리는 lazy — 모달 열릴 때만 로드 (~50KB gzip)
const CandleChartLight = lazy(() => import("./CandleChartLight"));
const InvestorChartLight = lazy(() => import("./InvestorChartLight"));
const ShortSellingChart = lazy(() => import("./ShortSellingChart"));
const BalanceTrendChart = lazy(() => import("./BalanceTrendChart"));
import type { BalanceTrendPoint } from "./BalanceTrendChart";
import {
  fetchFullValuation, fetchWisereportSeries, matchBrokerToShareholder,
  INDICATOR_SECTIONS, INDICATOR_LABELS, INDICATOR_DESCRIPTIONS,
  formatIndicator, judgeIndicator,
} from "../lib/fundamentals";
import type { FundamentalData, ConsensusReport, Shareholder } from "../lib/fundamentals";
import { FinancialCharts } from "./FinancialCharts";
import { ConsensusCharts } from "./ConsensusCharts";
import { PriceMultiSparks } from "./PriceMultiSparks";
import { signColor, nowKstDateStr } from "../lib/format";
import { handleTossLinkClick } from "../lib/toss";
import { fetchInvestorHistorySafe, fetchKrPriceHistoryWithEvents, fetchKrDisclosures, fetchKrShortSelling, fetchKrLendingTrading, fetchKrCreditLoan, fetchKrProgramTrading, fetchKrCfd, fetchNaverInfo, fetchTossEstimate, fetchNaverNews, fetchTossPrices, fetchNaverPrices } from "../lib/api";
import type { DividendEvent, SplitEvent, DartDisclosure } from "../lib/api";
import type { PricePoint } from "../lib/api";
import type { Investor } from "../types";
import { useTossMaintenance, getTossMaintenance } from "../lib/tossMaintenance";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  ticker: string;
  name: string;
  curPrice?: number;
  todayBar?: TodayBar;       // 오늘 실시간 OHLC (일봉 오늘 캔들 보강용)
  myAvgPrice?: number;       // 보유 시 평단가 (차트 가로선)
  entryPrice?: number;       // 메모의 기대가 (차트 가로선)
}

// 오늘(당일) 실시간 시/고/저 — 부모 Price 객체에서 추출. 일봉 마지막 캔들 꼬리용.
export interface TodayBar { open?: number; high?: number; low?: number }

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

// "YYYYMMDDHHmm" → "MM/DD HH:mm"
function fmtNewsTime(s?: string): string {
  if (!s || s.length < 12) return "";
  return `${s.slice(4, 6)}/${s.slice(6, 8)} ${s.slice(8, 10)}:${s.slice(10, 12)}`;
}

function NewsSection({ ticker }: { ticker: string }) {
  const { data: news, isLoading } = useQuery({
    queryKey: ["naver-news", ticker],
    queryFn: () => fetchNaverNews(ticker, 12),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  return (
    <section className="bg-gray-50 rounded p-3 border border-gray-200">
      <header className="mb-2">
        <h3 className="font-bold text-gray-700">📰 뉴스</h3>
        <p className="text-xs text-gray-400">네이버 증권 — 최신순</p>
      </header>
      {isLoading ? (
        <div className="text-xs text-gray-400 py-2">불러오는 중…</div>
      ) : !news || news.length === 0 ? (
        <div className="text-xs text-gray-400 py-2">관련 뉴스 없음</div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {news.map(n => (
            <li key={n.id}>
              <a href={n.url} target="_blank" rel="noopener noreferrer"
                 className="flex gap-2 py-1.5 group">
                {n.image && (
                  <img src={n.image} alt="" loading="lazy"
                       className="w-14 h-10 object-cover rounded shrink-0 bg-gray-100" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-gray-800 leading-snug line-clamp-2 group-hover:text-blue-600">
                    {n.title}
                  </div>
                  <div className="mt-0.5 text-[10px] text-gray-400">
                    {n.press}{n.press && n.datetime ? " · " : ""}{fmtNewsTime(n.datetime)}
                  </div>
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DisclosureSection({ ticker }: { ticker: string }) {
  // 차트 마커와 동일 쿼리키 — 캐시 공유(중복 fetch 방지)
  const { data: disc, isLoading } = useQuery({
    queryKey: ["disclosures-modal", ticker],
    queryFn: () => fetchKrDisclosures(ticker, 12),
    enabled: /^\d{6}$/.test(ticker),
    staleTime: 30 * 60_000,
  });
  return (
    <section className="bg-gray-50 rounded p-3 border border-gray-200">
      <header className="mb-2">
        <h3 className="font-bold text-gray-700">📋 공시</h3>
        <p className="text-xs text-gray-400">DART — 최신순</p>
      </header>
      {isLoading ? (
        <div className="text-xs text-gray-400 py-2">불러오는 중…</div>
      ) : !disc || disc.length === 0 ? (
        <div className="text-xs text-gray-400 py-2">최근 공시 없음</div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {[...disc].reverse().map((d, i) => (
            <li key={`${d.url}-${i}`}>
              <a href={d.url} target="_blank" rel="noopener noreferrer"
                 className="block py-1.5 group">
                <div className="text-xs text-gray-800 leading-snug line-clamp-2 group-hover:text-blue-600">
                  {d.title}
                </div>
                <div className="mt-0.5 text-[10px] text-gray-400">{d.date}</div>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ValuationModal({
  isOpen, onClose, ticker, name, curPrice, todayBar, myAvgPrice, entryPrice,
}: Props) {
  useEscClose(isOpen, onClose);
  const { data, isLoading, error } = useQuery({
    queryKey: ["valuation", ticker],
    queryFn: () => fetchFullValuation(ticker),
    enabled: isOpen && /^[\dA-Za-z]{6}$/.test(ticker),
    staleTime: 24 * 3600_000,  // 24시간 캐시
  });
  // 네이버 기업개요 — App.tsx 와 동일 queryKey 라 캐시 공유
  const { data: naverInfo } = useQuery({
    queryKey: ["naver", ticker],
    queryFn: () => fetchNaverInfo(ticker),
    enabled: isOpen && /^[\dA-Za-z]{6}$/.test(ticker),
    staleTime: 24 * 3600_000,
  });
  // 재무 시계열 (Wisereport cF1001 같은 페이지의 다년치 파싱) — 24시간 캐시
  const { data: finSeries } = useQuery({
    queryKey: ["wise-series", ticker],
    queryFn: () => fetchWisereportSeries(ticker),
    enabled: isOpen && /^[\dA-Za-z]{6}$/.test(ticker),
    staleTime: 24 * 3600_000,
  });
  // 컨센서스 예상치 — 분기별 발표치 vs 애널리스트 예상 (매출/영업이익/EPS)
  const estEnabled = isOpen && /^\d{6}$/.test(ticker);
  const { data: estRevenue } = useQuery({
    queryKey: ["est", ticker, "revenue"],
    queryFn: () => fetchTossEstimate(ticker, "revenue"),
    enabled: estEnabled,
    staleTime: 24 * 3600_000,
  });
  const { data: estOpIncome } = useQuery({
    queryKey: ["est", ticker, "operating-income"],
    queryFn: () => fetchTossEstimate(ticker, "operating-income"),
    enabled: estEnabled,
    staleTime: 24 * 3600_000,
  });
  const { data: estEps } = useQuery({
    queryKey: ["est", ticker, "eps"],
    queryFn: () => fetchTossEstimate(ticker, "eps"),
    enabled: estEnabled,
    staleTime: 24 * 3600_000,
  });
  // 현재가 — 부모가 안 넘기면(예: 컨센서스 탭) 직접 조회 (토스→점검 시 네이버)
  const { data: livePrices } = useQuery({
    queryKey: ["valuation-price", ticker],
    queryFn: async () => {
      try { return await fetchTossPrices([ticker]); }
      catch (e) {
        if (getTossMaintenance().active) return await fetchNaverPrices([ticker]);
        throw e;
      }
    },
    enabled: isOpen && curPrice == null && /^\d{6}$/.test(ticker),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const effCurPrice = curPrice ?? livePrices?.[0]?.price;
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
              {effCurPrice && (
                <span className="text-base font-bold ml-3">
                  {effCurPrice.toLocaleString()}원
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
            {effCurPrice && (
              <span className="text-base font-bold ml-auto">
                {effCurPrice.toLocaleString()}원
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
          {/* 기업개요 — 네이버 main.naver 의 #summary_info 파싱 (출처: 에프앤가이드) */}
          {naverInfo?.description && naverInfo.description.length > 0 && (
            <section className="mb-3 p-3 bg-slate-50 border border-slate-200 rounded">
              <header className="flex items-baseline gap-2 mb-1.5">
                <h3 className="text-sm font-bold text-gray-700">🏢 기업개요</h3>
                <span className="text-[10px] text-gray-400">출처: 네이버 금융 / 에프앤가이드</span>
              </header>
              <ul className="space-y-1 text-[13px] text-gray-700 leading-relaxed">
                {naverInfo.description.map((line, i) => (
                  <li key={i} className="flex gap-1.5">
                    <span className="text-slate-400 shrink-0">·</span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {/* 재무 추이 — Wisereport 시계열 5개 차트 */}
          {finSeries && (
            <div className="mb-3">
              <FinancialCharts series={finSeries} />
            </div>
          )}
          {/* 컨센서스 예상치 — 분기별 발표 vs 예상 (매출/영업이익/EPS).
              데이터 모두 null 이라도 ConsensusCharts 가 워커 구버전 안내를 자체 표시. */}
          {estEnabled && (
            <div className="mb-3">
              <ConsensusCharts revenue={estRevenue} operatingIncome={estOpIncome} eps={estEps} />
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
                                 curPrice={effCurPrice}
                                 fundamental={fund} />
              <ShareholderSection shareholders={shareholders} />
            </div>
          </div>

          {/* 투자자별 순매수 (최근 60일) */}
          <InvestorHistorySection ticker={ticker}
                                  targetPrice={targetPrice}
                                  myAvgPrice={myAvgPrice}
                                  entryPrice={entryPrice}
                                  curPrice={effCurPrice}
                                  todayBar={todayBar} />

          {/* 뉴스(좌) + 공시(우) */}
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
            <NewsSection ticker={ticker} />
            <DisclosureSection ticker={ticker} />
          </div>

          {/* 외부 링크 */}
          <section className="mt-4 flex flex-wrap gap-2 text-xs">
            <a href={`https://tossinvest.com/stocks/A${ticker}`}
               target="_blank" rel="noopener noreferrer"
               onClick={e => handleTossLinkClick(e, `https://tossinvest.com/stocks/A${ticker}`)}
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
  entryPrice?: number;
  curPrice?: number;
  todayBar?: TodayBar;
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
  ticker, targetPrice, myAvgPrice, entryPrice, curPrice, todayBar,
}: InvestorHistoryProps) {
  const { data: history, isLoading } = useQuery({
    queryKey: ["investor-history-modal", ticker],
    queryFn: () => fetchInvestorHistorySafe(ticker, [200, 120, 60]),
    enabled: /^[\dA-Za-z]{6}$/.test(ticker),
    staleTime: 5 * 60_000,  // 5분 (App 의 5초 폴링과 별도, 모달 캐시)
  });

  const maint = useTossMaintenance();

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
      {!isLoading && (!history || history.length === 0) && !maint.active && (
        <div className="text-xs text-gray-400 py-2">데이터 없음</div>
      )}

      {/* 수급 차트 — 주가+거래량 + 외국인/기관/연기금. 점검 중엔 가격차트만 */}
      {((history && history.length > 0) || maint.active) && (
        <InvestorChartsSection ticker={ticker} history={history ?? []}
                               targetPrice={targetPrice}
                               myAvgPrice={myAvgPrice}
                               entryPrice={entryPrice}
                               curPrice={curPrice}
                               todayBar={todayBar} />
      )}

      {history && history.length > 0 && (
        <div className="hidden lg:block border border-gray-200 rounded mt-3 overflow-x-auto">
          {/* 컬럼 폭 통일 (table-layout: fixed) — colgroup 양쪽 테이블 동일하게 적용 */}
          {(() => {
            const colgroup = (
              <colgroup>
                <col style={{ width: 130 }} />
                {INVESTOR_COLS.map(c => (
                  <col key={c.key} style={{ width: 86 }} />
                ))}
                <col style={{ width: 78 }} />
              </colgroup>
            );
            return (
              <>
                {/* 고정 영역 — 컬럼 헤더 + 5/20/60/120/200일 합계 + ▼ 일별 상세 */}
                <table className="text-[11px] tabular-nums whitespace-nowrap w-full"
                       style={{ tableLayout: "fixed" }}>
                  {colgroup}
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
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
                    {summaries.map(s => (
                      <tr key={s.label}
                          className="border-b border-gray-200 bg-blue-50 font-bold">
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
                    <tr className="border-b-2 border-gray-300 bg-gray-100">
                      <td colSpan={INVESTOR_COLS.length + 2}
                          className="px-2 py-0.5 text-[10px] text-gray-500">
                        ▼ 일별 상세
                      </td>
                    </tr>
                  </thead>
                </table>

                {/* 스크롤 영역 — 일별 상세 행만 (스크롤바 여기에만 표시됨) */}
                <div className="max-h-[50vh] overflow-y-auto">
                  <table className="text-[11px] tabular-nums whitespace-nowrap w-full"
                         style={{ tableLayout: "fixed" }}>
                    {colgroup}
                    <tbody>
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
              </>
            );
          })()}
        </div>
      )}
    </section>
  );
}

// ─── 수급 차트 모음 — 주가+거래량 (full) + 외국인/기관/연기금 (3분할) ───
// 4개 차트 모두 lightweight-charts 기반, 한 hook 으로 crosshair 동기화.
function InvestorChartsSection({
  ticker, history, targetPrice, myAvgPrice, entryPrice, curPrice, todayBar,
}: {
  ticker: string; history: Investor[];
  targetPrice?: number; myAvgPrice?: number;
  entryPrice?: number;
  curPrice?: number;
  todayBar?: TodayBar;
}) {
  // 가격 + 거래량 + 배당 + 액면분할 (Yahoo 1y, KOSPI→KOSDAQ 자동 폴백)
  const { data: priceData, isLoading: pricesLoading } = useQuery({
    queryKey: ["price-history-modal-with-events", ticker],
    queryFn: () => fetchKrPriceHistoryWithEvents(ticker, "1y"),
    enabled: /^[\dA-Za-z]{6}$/.test(ticker),
    staleTime: 5 * 60_000,
  });
  const prices = priceData?.prices;
  const dividends = priceData?.dividends ?? [];
  const splits = priceData?.splits ?? [];

  // 공시 (Naver m.stock API, 인증 불필요)
  const { data: disclosures } = useQuery({
    queryKey: ["disclosures-modal", ticker],
    queryFn: () => fetchKrDisclosures(ticker, 12),
    enabled: /^\d{6}$/.test(ticker),
    staleTime: 30 * 60_000,    // 30분 — 공시 변동 빈도 적음
  });

  // 공매도 (토스 API, 인증 불필요) — 일별 비율 + 비중
  const { data: shortSelling } = useQuery({
    queryKey: ["short-selling-modal", ticker],
    queryFn: () => fetchKrShortSelling(ticker, 12),
    enabled: /^\d{6}$/.test(ticker),
    staleTime: 30 * 60_000,
  });

  // 대차거래(securities lending) — 잠재 공매도 물량(대차잔고)
  const { data: lending } = useQuery({
    queryKey: ["lending-trading-modal", ticker],
    queryFn: () => fetchKrLendingTrading(ticker, 12),
    enabled: /^\d{6}$/.test(ticker),
    staleTime: 30 * 60_000,
  });
  // 신용거래(신용융자) 잔고 — 개인 빚투 과열/반대매매 지표
  const { data: credit } = useQuery({
    queryKey: ["credit-loan-modal", ticker],
    queryFn: () => fetchKrCreditLoan(ticker, 12),
    enabled: /^\d{6}$/.test(ticker),
    staleTime: 30 * 60_000,
  });
  // 프로그램매매 — 차익+비차익 순매수 (기관·외인 대량 수급)
  const { data: program } = useQuery({
    queryKey: ["program-trading-modal", ticker],
    queryFn: () => fetchKrProgramTrading(ticker, 12),
    enabled: /^\d{6}$/.test(ticker),
    staleTime: 30 * 60_000,
  });
  // CFD — 개인 레버리지(매수/매도잔고). 종목 따라 데이터 없을 수 있음 → 있을 때만 표시.
  const { data: cfd } = useQuery({
    queryKey: ["cfd-modal", ticker],
    queryFn: () => fetchKrCfd(ticker, 12),
    enabled: /^\d{6}$/.test(ticker),
    staleTime: 30 * 60_000,
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

  // 프로그램매매 — dates 정렬 일별/누적 순매수 (InvestorChartLight 용)
  const programByDate = useMemo(() => new Map((program ?? []).map(p => [p.date, p.totalNet])), [program]);
  const dailyProgram = useMemo(() => dates.map(d => programByDate.get(d) ?? 0), [dates, programByDate]);
  const cumProgram = useMemo(() => { let s = 0; return dailyProgram.map(v => (s += v)); }, [dailyProgram]);
  const hasProgram = useMemo(() => (program ?? []).some(p => p.totalNet !== 0), [program]);

  // 잔고 차트(BalanceTrendChart) 변환 — 대차/신용/CFD
  const lendingPoints = useMemo<BalanceTrendPoint[]>(() => (lending ?? []).map(l => ({
    date: l.date, volume: l.balanceVolume, amount: l.balanceAmount, fluctuation: l.fluctuation,
    detail: `신규 ${l.newVolume.toLocaleString()} · 상환 ${l.repayVolume.toLocaleString()}`,
  })), [lending]);
  const creditPoints = useMemo<BalanceTrendPoint[]>(() => (credit ?? []).map(c => ({
    date: c.date, volume: c.balanceVolume, rate: c.rate, fluctuation: c.fluctuation,
  })), [credit]);
  const cfdPoints = useMemo<BalanceTrendPoint[]>(() => (cfd ?? []).map(c => ({
    date: c.date, volume: c.buyBalance, rate: c.buyRate, volume2: c.sellBalance,
  })), [cfd]);

  // 가격을 history 날짜에 정렬 (4개 차트 X축 통일) — useMemo
  // 투자자 데이터 없음(토스 점검 등) → Yahoo 가격 전체 그대로 사용 (가격차트만이라도 표시)
  const alignedPrices = useMemo(() => {
    if (dates.length === 0) return prices ?? [];
    const byDate = new Map((prices ?? []).map(p => [p.date, p]));
    return dates
      .map(d => byDate.get(d))
      .filter((p): p is PricePoint => p != null);
  }, [prices, dates]);

  // 가격 차트 전용 — 오늘 캔들 보강.
  // 투자자 데이터는 하루 지연이라 alignedPrices 가 어제까지만 → 오늘 봉이 안 나옴.
  // 가격 차트는 별도 전체폭 차트이므로, 실제 OHLC(시/고/저 + 현재가=종가)로 오늘 봉을 덧붙인다.
  // OHLC 출처: Toss 실시간(todayBar) 우선 → Yahoo 오늘봉 → (둘 다 없으면) 전일종가 기반.
  const livePrices = useMemo(() => {
    const base = alignedPrices;
    if (base.length === 0 || !curPrice || curPrice <= 0) return base;
    const today = nowKstDateStr();
    const last = base[base.length - 1];
    const yToday = (priceData?.prices ?? []).find(p => p.date === today);
    const open = todayBar?.open ?? yToday?.open ?? last.close;
    const hiSrc = todayBar?.high ?? yToday?.high;
    const loSrc = todayBar?.low ?? yToday?.low;
    const high = Math.max(hiSrc ?? curPrice, curPrice, open);
    const low = Math.min(loSrc ?? curPrice, curPrice, open);
    const todayCandle: PricePoint = {
      date: today, open, high, low, close: curPrice, volume: yToday?.volume ?? 0,
    };
    // 이미 오늘 봉이 정렬에 포함(투자자 데이터 따라잡음)이면 교체, 아니면 덧붙임
    return last.date === today
      ? [...base.slice(0, -1), todayCandle]
      : [...base, todayCandle];
  }, [alignedPrices, curPrice, todayBar, priceData?.prices]);

  // 4 차트 crosshair sync
  const registerSync = useCrosshairSync();

  const hasInvestor = history.length >= 2;
  if (!hasInvestor && alignedPrices.length < 2) return null;

  return (
    <div className="space-y-2 mt-2">
      {/* 0. 기간별 추이 멀티 sparkline — 1주~MAX (상장 짧으면 자동 숨김) */}
      <PriceMultiSparks ticker={ticker} />
      {/* 1. 주가 — 전체 폭 (외국인비율 % + 목표가/평단가 가로선) */}
      {livePrices.length > 1 ? (
        <PriceVolumeChart prices={livePrices} investors={data}
                          targetPrice={targetPrice} myAvgPrice={myAvgPrice} entryPrice={entryPrice}
                          dividends={dividends} splits={splits}
                          disclosures={disclosures} ticker={ticker}
                          onReady={registerSync} />
      ) : (
        <div className="text-xs text-gray-400 p-2 border border-gray-200 rounded">
          {pricesLoading ? "주가 로딩 중..." : "주가 데이터 없음 (Yahoo 미수록)"}
        </div>
      )}
      {/* 투자 유형별 — ① 순매수 행(외국인/기관계/연기금/프로그램) ② 잔고·압력 행(공매도/대차/신용/CFD) */}
      {hasInvestor ? (
        <Suspense fallback={<div className="h-[220px]" />}>
          {/* ① 순매수 (일별+누적) */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
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
            {hasProgram && (
              <InvestorChartLight
                label="프로그램"
                daily={dailyProgram} cumulative={cumProgram} dates={dates}
                barColor="#bae6fd" cumColor="#0369a1"
                onReady={registerSync}
              />
            )}
          </div>
          {/* ② 잔고·압력 (공매도 비율 / 대차·신용·CFD 잔고 추세) */}
          {((shortSelling && shortSelling.length > 0) || lendingPoints.length > 0
            || creditPoints.length > 0 || cfdPoints.length > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2 mt-2">
              {shortSelling && shortSelling.length > 0 && (
                <ShortSellingChart
                  shortSelling={shortSelling}
                  dates={dates}
                  desc={<>일별 공매도 수량(주)과 20일 평균. <b style={{ color: "#2563eb" }}>평균 우상향 = 공매도 증가(하락 베팅 강화)</b>.</>}
                  onReady={registerSync}
                />
              )}
              {lendingPoints.length > 0 && (
                <BalanceTrendChart title="대차잔고" color="#7c3aed" upIsBad
                  desc={<>빌려간 주식 잔고 = 잠재적 공매도 물량. <b style={{ color: "#2563eb" }}>증가=숏 빌드업(경계)</b>, <b style={{ color: "#dc2626" }}>감소=상환·숏커버(반등)</b>.</>}
                  points={lendingPoints} dates={dates} onReady={registerSync} />
              )}
              {creditPoints.length > 0 && (
                <BalanceTrendChart title="신용잔고" color="#ea580c" upIsBad
                  desc={<>개인이 빚내서 산 신용융자 잔고. <b style={{ color: "#d97706" }}>증가=과열(반대매매 리스크)</b>, <b style={{ color: "#2563eb" }}>급감=반대매매(투매)</b>.</>}
                  points={creditPoints} dates={dates} onReady={registerSync} />
              )}
              {cfdPoints.length > 0 && (
                <BalanceTrendChart title="CFD 매수" color="#0d9488" title2="매도" color2="#e11d48"
                  desc={<>개인 레버리지(CFD) 잔고. <b style={{ color: "#0d9488" }}>매수=롱</b>, <b style={{ color: "#e11d48" }}>매도=숏</b> 포지션. 한쪽이 급증하면 방향성 베팅 쏠림.</>}
                  points={cfdPoints} dates={dates} onReady={registerSync} />
              )}
            </div>
          )}
        </Suspense>
      ) : (
        <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
          🚧 토스 점검 중 — 투자자 수급(외국인/기관/연기금)·공매도는 복구 후 표시됩니다. 가격 차트만 우선 표시.
        </div>
      )}
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

const DISC_TOGGLE_KEY = "price_chart_disclosures";
function loadDiscToggle(): boolean {
  try { return localStorage.getItem(DISC_TOGGLE_KEY) === "on"; }    // 기본 OFF
  catch { return false; }
}
function saveDiscToggle(on: boolean): void {
  try { localStorage.setItem(DISC_TOGGLE_KEY, on ? "on" : "off"); } catch { /* noop */ }
}

// 보조지표 토글 — 이평선 / 볼린저밴드(20, 2σ). 둘 다 기본 OFF.
function loadOnOff(key: string): boolean {
  try { return localStorage.getItem(key) === "on"; }
  catch { return false; }
}
function saveOnOff(key: string, on: boolean): void {
  try { localStorage.setItem(key, on ? "on" : "off"); } catch { /* noop */ }
}
const MA_TOGGLE_KEY = "price_chart_ma";
const BB_TOGGLE_KEY = "price_chart_bb";

// 이평선 기간 — 사용자가 직접 입력. 원문 문자열을 저장해 편집 중 커서/중간상태를 보존한다.
const MA_PERIODS_KEY = "price_chart_ma_periods";
const MA_DEFAULT_INPUT = MA_DEFAULT_PERIODS.join(", ");
function loadMaInput(): string {
  try { return localStorage.getItem(MA_PERIODS_KEY) ?? MA_DEFAULT_INPUT; }
  catch { return MA_DEFAULT_INPUT; }
}
function saveMaInput(raw: string): void {
  try { localStorage.setItem(MA_PERIODS_KEY, raw); } catch { /* noop */ }
}


function PriceVolumeChart({
  prices, investors, targetPrice, myAvgPrice, entryPrice, dividends, splits, disclosures, ticker, onReady,
}: {
  prices: PricePoint[]; investors: Investor[];
  targetPrice?: number; myAvgPrice?: number;
  entryPrice?: number;
  dividends?: DividendEvent[];
  splits?: SplitEvent[];
  disclosures?: DartDisclosure[];
  ticker?: string;
  onReady?: SyncRegistrar;
}) {
  const [mode, setMode] = useState<ChartMode>(loadChartMode);
  const setModePersist = (m: ChartMode) => { setMode(m); saveChartMode(m); };
  const [showDisc, setShowDisc] = useState<boolean>(loadDiscToggle);
  const toggleDisc = () => { const v = !showDisc; setShowDisc(v); saveDiscToggle(v); };
  const [showMA, setShowMA] = useState<boolean>(() => loadOnOff(MA_TOGGLE_KEY));
  const toggleMA = () => { const v = !showMA; setShowMA(v); saveOnOff(MA_TOGGLE_KEY, v); };
  const [showBB, setShowBB] = useState<boolean>(() => loadOnOff(BB_TOGGLE_KEY));
  const toggleBB = () => { const v = !showBB; setShowBB(v); saveOnOff(BB_TOGGLE_KEY, v); };
  const [maInput, setMaInput] = useState<string>(loadMaInput);
  const setMaInputPersist = (raw: string) => { setMaInput(raw); saveMaInput(raw); };
  // 차트 effect 의 dep — 파싱 결과가 같으면 같은 배열 identity 를 유지해야 재생성이 안 일어난다.
  const maKey = showMA ? parseMaPeriods(maInput).join(",") : "";
  const maPeriods = useMemo(
    () => (maKey ? maKey.split(",").map(Number) : []),
    [maKey],
  );
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
        {showMA && (
          <span className="flex items-center gap-1.5">
            {maPeriods.map((p, i) => (
              <span key={p} className="flex items-center gap-0.5">
                <span className="inline-block w-3 h-0.5" style={{ background: maColor(i) }}></span>
                <span style={{ color: maColor(i) }} className="font-medium">MA{p}</span>
              </span>
            ))}
            <input value={maInput}
                   onChange={e => setMaInputPersist(e.target.value)}
                   onBlur={() => setMaInputPersist(
                     parseMaPeriods(maInput).join(", ") || MA_DEFAULT_INPUT)}
                   placeholder={MA_DEFAULT_INPUT}
                   title={`쉼표로 구분해 입력 (1~${MA_MAX_PERIOD}일, 최대 ${MA_MAX_LINES}개)`}
                   className="w-20 px-1 py-0 rounded border border-gray-200 text-[10px] tabular-nums
                              text-gray-600 focus:outline-none focus:border-cyan-400" />
          </span>
        )}
        <span className="ml-auto inline-flex items-center gap-1">
          {/* 이동평균선 토글 — 기간은 켰을 때 나오는 입력칸에서 조정 */}
          <button onClick={toggleMA}
                  title={showMA ? "이평선 숨기기" : `이평선 보이기 (${MA_DEFAULT_INPUT}일)`}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                    showMA
                      ? "bg-cyan-100 text-cyan-700 border-cyan-300"
                      : "text-gray-400 border-gray-200 hover:bg-gray-100"
                  }`}>
            📈 이평 {showMA ? "ON" : "OFF"}
          </button>
          {/* 볼린저밴드 (20, 2σ) 토글 */}
          <button onClick={toggleBB}
                  title={showBB ? "볼린저밴드 숨기기" : "볼린저밴드 보이기 (20일, 2σ)"}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                    showBB
                      ? "bg-slate-200 text-slate-700 border-slate-400"
                      : "text-gray-400 border-gray-200 hover:bg-gray-100"
                  }`}>
            〰 볼린저 {showBB ? "ON" : "OFF"}
          </button>
          {/* 공시 마커 표시 토글 */}
          <button onClick={toggleDisc}
                  title={showDisc ? "공시 마커 숨기기" : "공시 마커 보이기"}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                    showDisc
                      ? "bg-orange-100 text-orange-700 border-orange-300"
                      : "text-gray-400 border-gray-200 hover:bg-gray-100"
                  }`}>
            📋 공시 {showDisc ? "ON" : "OFF"}
          </button>
          {/* 캔들 모드 토글 — OFF=라인, ON=캔들 */}
          <button onClick={() => setModePersist(mode === "candle" ? "line" : "candle")}
                  title={mode === "candle" ? "라인 차트로" : "캔들 차트로"}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                    mode === "candle"
                      ? "bg-amber-100 text-amber-700 border-amber-300"
                      : "text-gray-400 border-gray-200 hover:bg-gray-100"
                  }`}>
            🕯 캔들 {mode === "candle" ? "ON" : "OFF"}
          </button>
        </span>
      </div>
      <Suspense fallback={
        <div className="w-full h-[220px] lg:h-[360px] flex items-center justify-center text-xs text-gray-400">
          차트 로딩 중...
        </div>
      }>
        <CandleChartLight prices={prices} investors={investors} mode={mode}
                          maPeriods={maPeriods} showBB={showBB}
                          targetPrice={targetPrice} myAvgPrice={myAvgPrice} entryPrice={entryPrice}
                          dividends={dividends} splits={splits}
                          disclosures={showDisc ? disclosures : []}
                          ticker={ticker}
                          onReady={onReady} />
      </Suspense>
    </div>
  );
}

