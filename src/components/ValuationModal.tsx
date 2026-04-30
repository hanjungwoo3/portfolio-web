import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchFullValuation, matchBrokerToShareholder,
  INDICATOR_SECTIONS, INDICATOR_LABELS, INDICATOR_DESCRIPTIONS,
  formatIndicator, judgeIndicator,
} from "../lib/fundamentals";
import type { FundamentalData, ConsensusReport, Shareholder } from "../lib/fundamentals";
import { signColor } from "../lib/format";
import { fetchInvestorHistory } from "../lib/api";
import type { Investor } from "../types";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  ticker: string;
  name: string;
  curPrice?: number;
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
  isOpen, onClose, ticker, name, curPrice,
}: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["valuation", ticker],
    queryFn: () => fetchFullValuation(ticker),
    enabled: isOpen && /^\d{6}$/.test(ticker),
    staleTime: 24 * 3600_000,  // 24시간 캐시
  });
  const downOnBackdropRef = useRef(false);

  if (!isOpen) return null;

  const fund = data?.fundamental ?? {};
  const reports = data?.reports ?? [];
  const shareholders = data?.shareholders ?? [];

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
          <div className="flex items-baseline gap-3">
            <h2 className="text-xl font-bold">📊 기업가치</h2>
            <span className="text-base font-bold">{name}</span>
            <span className="text-sm text-gray-500">({ticker})</span>
            {curPrice && (
              <span className="text-base font-bold ml-3">
                {curPrice.toLocaleString()}원
              </span>
            )}
            <button onClick={onClose}
                    className="ml-auto text-gray-400 hover:text-gray-600 text-xl">
              ✕
            </button>
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
          <InvestorHistorySection ticker={ticker} />

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
interface InvestorHistoryProps { ticker: string; }

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

// 누적 합계 기간 정의
const SUMMARY_PERIODS: { label: string; days: number }[] = [
  { label: "5일",          days: 5 },
  { label: "20일 (1개월)",  days: 20 },
  { label: "60일 (3개월)",  days: 60 },
  { label: "120일 (6개월)", days: 120 },
  { label: "250일 (1년)",   days: 250 },
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

function InvestorHistorySection({ ticker }: InvestorHistoryProps) {
  const { data: history, isLoading } = useQuery({
    queryKey: ["investor-history-modal", ticker],
    queryFn: () => fetchInvestorHistory(ticker, 120),
    enabled: /^\d{6}$/.test(ticker),
    staleTime: 5 * 60_000,  // 5분 (App 의 5초 폴링과 별도, 모달 캐시)
  });

  if (!/^\d{6}$/.test(ticker)) return null;

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
      {history && history.length > 0 && (
        <div className="overflow-x-auto border border-gray-200 rounded">
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
