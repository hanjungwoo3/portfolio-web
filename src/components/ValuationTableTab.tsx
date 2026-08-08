// 가치표 탭 — 관심종목(내가 추가한 국내 종목) 전체의 기업가치 지표를 한 표로.
//   컬럼은 기업가치 팝업의 '가치평가 + 수익성' 지표와 동일. 각 열 클릭으로 정렬.
//   데이터: 종목당 네이버 메인 1콜 + 와이즈리포트 1콜 (fetchValuationRow, 동시 3개 제한).
//   지표는 분기 단위로만 바뀌므로 6시간 캐시 — 탭을 다시 열어도 다시 받지 않는다.
import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { fetchValuationRow, type ValuationRow } from "../lib/fundamentals";
import { fetchInvestorHistorySafe } from "../lib/api";
import { openTossStock } from "../lib/toss";
import { signColor } from "../lib/format";
import type { Investor } from "../types";
import type { ConsensusItem } from "./ConsensusTab";

const VALUATION_STALE_MS = 6 * 60 * 60 * 1000;
const INVESTOR_STALE_MS = 60 * 60 * 1000;   // 수급은 하루 1회 확정 — 1시간 캐시(컨센서스 탭과 공유)

// 최근 순매수 기간 — 기업가치 팝업의 "5일/20일/60일" 과 동일
const FLOW_DAYS = [5, 20, 60] as const;
type FlowDays = typeof FLOW_DAYS[number];
const FLOW_LABEL: Record<FlowDays, string> = { 5: "5일", 20: "20일(1개월)", 60: "60일(3개월)" };

// 최근 n일 누적 순매수(주식수) — 배열은 최신순
function sumLast(arr: Investor[] | undefined, key: "개인" | "외국인" | "기관" | "연기금", n: number): number | null {
  if (!arr || arr.length === 0) return null;
  return arr.slice(0, n).reduce((s, d) => s + (Number(d[key]) || 0), 0);
}
// 주식수 — 억/만 단위 축약(부호 포함)
function fmtShares(v: number): string {
  const a = Math.abs(v), sign = v < 0 ? "-" : v > 0 ? "+" : "";
  if (a >= 1e8) return `${sign}${(a / 1e8).toFixed(1)}억`;
  if (a >= 1e4) return `${sign}${Math.round(a / 1e4).toLocaleString()}만`;
  return `${sign}${a.toLocaleString()}`;
}

type ColKey =
  | "name" | "market_cap" | "per" | "pbr" | "eps" | "bps" | "industry_per"
  | "revenue" | "operating_income" | "operating_margin" | "net_margin" | "roe"
  | "flow_foreign" | "flow_inst" | "flow_pension" | "flow_indiv";

interface Col {
  key: ColKey;
  label: string;
  unit?: string;
  hint: string;
  digits?: number;      // 소수점 자리 (미지정 = 정수)
  goodHigh?: boolean;   // true = 클수록 좋음(초록), false = 작을수록 좋음
  flow?: boolean;       // 순매수 열 — 주식수 축약 + 매수/매도 색
}

const COLS: Col[] = [
  { key: "name",             label: "종목명",       hint: "클릭하면 토스 종목 페이지" },
  { key: "market_cap",       label: "시가총액",     unit: "억원", hint: "발행주식수 × 주가. 회사 규모." },
  { key: "per",              label: "PER",          unit: "배", digits: 2, goodHigh: false, hint: "주가 ÷ EPS. 낮을수록 저평가(시장 평균 약 15배)." },
  { key: "industry_per",     label: "동일업종 PER", unit: "배", digits: 2, hint: "같은 업종 평균 PER. 종목 PER 이 이보다 낮으면 업종 대비 저평가." },
  { key: "pbr",              label: "PBR",          unit: "배", digits: 2, goodHigh: false, hint: "주가 ÷ BPS. 1 미만이면 청산가치보다 싸게 거래." },
  { key: "eps",              label: "EPS",          unit: "원", hint: "1주당 순이익." },
  { key: "bps",              label: "BPS",          unit: "원", hint: "1주당 순자산(청산가치 기준)." },
  { key: "revenue",          label: "매출액",       unit: "억원", hint: "연간 총 판매액. 회사 외형." },
  { key: "operating_income", label: "영업이익",     unit: "억원", hint: "본업으로 번 이익(연간)." },
  { key: "operating_margin", label: "영업이익률",   unit: "%", digits: 2, goodHigh: true, hint: "영업이익 ÷ 매출액. 높을수록 경쟁력." },
  { key: "net_margin",       label: "순이익률",     unit: "%", digits: 2, goodHigh: true, hint: "순이익 ÷ 매출액." },
  { key: "roe",              label: "ROE",          unit: "%", digits: 2, goodHigh: true, hint: "자기자본수익률. 15% 이상이면 우수." },
  // 최근 수급 — 선택한 기간(5/20/60일) 누적 순매수 주식수
  { key: "flow_foreign",     label: "외국인",       unit: "주", flow: true, hint: "선택 기간 외국인 누적 순매수(주식수). +매수 / −매도." },
  { key: "flow_inst",        label: "기관계",       unit: "주", flow: true, hint: "선택 기간 기관 누적 순매수(주식수)." },
  { key: "flow_pension",     label: "연기금",       unit: "주", flow: true, hint: "선택 기간 연기금 누적 순매수(주식수). 국민연금 등." },
  { key: "flow_indiv",       label: "개인",         unit: "주", flow: true, hint: "선택 기간 개인 누적 순매수(주식수)." },
];

interface Row extends ValuationRow {
  ticker: string;
  label: string;                 // 표시용 종목명 (보유 목록 기준, 없으면 네이버 이름)
  market?: "KOSPI" | "KOSDAQ";
  loading: boolean;
  flow_foreign?: number | null;
  flow_inst?: number | null;
  flow_pension?: number | null;
  flow_indiv?: number | null;
}

function numOf(r: Row, key: ColKey): number | null {
  if (key === "name") return null;
  const v = r[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function fmtCell(v: number | null, col: Col): string {
  if (v == null) return "—";
  if (col.flow) return fmtShares(v);
  if (col.digits) return v.toLocaleString("ko-KR", { minimumFractionDigits: col.digits, maximumFractionDigits: col.digits });
  return Math.round(v).toLocaleString("ko-KR");
}

// 값 색 — 손익 색과 헷갈리지 않게 회색 기본, 판단 기준이 뚜렷한 열만 강조.
function cellColor(v: number | null, col: Col): string {
  if (col.flow) return v == null ? "text-gray-800" : signColor(v);   // 순매수 = 매수 빨강 / 매도 파랑
  if (v == null || col.goodHigh === undefined) return "text-gray-800";
  if (col.key === "roe") return v >= 15 ? "text-emerald-600 font-bold" : v < 0 ? "text-rose-600" : "text-gray-800";
  if (col.key === "per") return v > 0 && v < 10 ? "text-emerald-600 font-bold" : "text-gray-800";
  if (col.key === "pbr") return v > 0 && v < 1 ? "text-emerald-600 font-bold" : "text-gray-800";
  if (col.goodHigh) return v < 0 ? "text-rose-600" : "text-gray-800";
  return "text-gray-800";
}

interface ValuationTableTabProps {
  items: ConsensusItem[];
  onOpenValuation?: (ticker: string) => void;
}

export function ValuationTableTab({ items, onOpenValuation }: ValuationTableTabProps) {
  const tickers = useMemo(
    () => Array.from(new Set(items.map(i => i.ticker).filter(t => /^\d{6}$/.test(t)))),
    [items],
  );
  const [sortKey, setSortKey] = useState<ColKey>("market_cap");
  const [asc, setAsc] = useState(false);
  const [flowDays, setFlowDays] = useState<FlowDays>(20);

  const qs = useQueries({
    queries: tickers.map(t => ({
      queryKey: ["valuation-row", t],
      queryFn: () => fetchValuationRow(t),
      staleTime: VALUATION_STALE_MS,
      gcTime: VALUATION_STALE_MS,
      refetchOnWindowFocus: false,
      retry: 1,
    })),
  });

  // 최근 수급(외국인·기관·연기금·개인) — 종목당 1콜. 컨센서스 탭과 같은 쿼리키라 캐시를 공유한다.
  const invQs = useQueries({
    queries: tickers.map(t => ({
      queryKey: ["investor-history-long", t],
      queryFn: () => fetchInvestorHistorySafe(t, [200, 120, 60]),
      staleTime: INVESTOR_STALE_MS,
      refetchOnWindowFocus: false,
    })),
  });

  const metaByTicker = useMemo(() => {
    const m = new Map<string, ConsensusItem>();
    for (const i of items) if (!m.has(i.ticker)) m.set(i.ticker, i);
    return m;
  }, [items]);

  const rows: Row[] = tickers.map((t, i) => {
    const q = qs[i];
    const d = q?.data;
    const meta = metaByTicker.get(t);
    const inv = invQs[i]?.data;
    return {
      ...(d ?? { ticker: t }),
      ticker: t,
      label: meta?.name || d?.name || t,
      market: meta?.market,
      loading: !!q?.isLoading,
      flow_foreign: sumLast(inv, "외국인", flowDays),
      flow_inst:    sumLast(inv, "기관", flowDays),
      flow_pension: sumLast(inv, "연기금", flowDays),
      flow_indiv:   sumLast(inv, "개인", flowDays),
    };
  });

  const loaded = qs.filter(q => q.isSuccess).length;

  // 종목 수십 개 규모라 매 렌더 정렬해도 부담 없다(메모 키를 만드는 비용이 오히려 큼).
  const sorted = [...rows].sort((a, b) => {
    if (sortKey === "name") {
      return asc ? a.label.localeCompare(b.label, "ko") : b.label.localeCompare(a.label, "ko");
    }
    const av = numOf(a, sortKey), bv = numOf(b, sortKey);
    if (av == null && bv == null) return a.label.localeCompare(b.label, "ko");
    if (av == null) return 1;    // 값 없는 종목은 항상 아래로
    if (bv == null) return -1;
    return asc ? av - bv : bv - av;
  });

  const clickCol = (key: ColKey) => {
    if (key === sortKey) { setAsc(a => !a); return; }
    setSortKey(key);
    setAsc(key === "name");   // 이름은 가나다순, 숫자는 큰 값부터
  };

  if (tickers.length === 0) {
    return (
      <div className="text-center py-16 text-gray-500 text-sm">
        표에 넣을 국내 종목이 없습니다. 검색으로 관심종목을 추가하세요.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-1">
        <span className="text-sm font-bold text-gray-800">🧮 관심종목 가치표</span>
        <span className="text-[11px] text-gray-500">
          {loaded < tickers.length ? `불러오는 중 ${loaded}/${tickers.length}` : `${tickers.length}종목`}
          {" · 열 제목을 누르면 정렬"}
        </span>
        {/* 수급 기간 — 외국인·기관계·연기금·개인 열에 적용 */}
        <div className="ml-auto flex items-center gap-1">
          <span className="text-[10px] text-gray-500">수급 기간</span>
          {FLOW_DAYS.map(d => (
            <button key={d} onClick={() => setFlowDays(d)}
                    title={`최근 ${FLOW_LABEL[d]} 누적 순매수로 보기`}
                    className={`px-1.5 py-0.5 rounded text-[11px] transition
                                ${flowDays === d
                                  ? "bg-gray-900 text-white font-bold"
                                  : "text-gray-500 hover:bg-gray-100"}`}>
              {d}일
            </button>
          ))}
        </div>
      </div>

      {/* 표 자체를 스크롤 영역으로 — 그래야 헤더 행이 위에 고정된 채로 세로 스크롤된다.
          (페이지 스크롤에 맡기면 가로 스크롤 컨테이너 안이라 헤더가 같이 밀려 올라간다) */}
      <div className="overflow-auto border border-gray-200 rounded bg-white
                      max-h-[calc(100vh-150px)] overscroll-contain">
        <table className="min-w-full text-[11px] border-collapse">
          <thead className="sticky top-0 z-20 bg-gray-50 shadow-[0_1px_0_rgba(0,0,0,0.08)]">
            <tr>
              {COLS.map(col => {
                const active = col.key === sortKey;
                return (
                  <th key={col.key}
                      onClick={() => clickCol(col.key)}
                      title={`${col.hint}\n(클릭: 정렬)`}
                      className={`px-2 py-1.5 whitespace-nowrap cursor-pointer select-none border-b border-gray-200
                                  ${col.key === "name" ? "text-left sticky left-0 bg-gray-50 z-30" : "text-right"}
                                  ${active ? "text-blue-700 font-bold" : "text-gray-600 hover:text-gray-900"}`}>
                    {col.label}
                    {col.flow
                      ? <span className="text-[10px] text-gray-400">{` ${flowDays}일`}</span>
                      : col.unit && <span className="text-[10px] text-gray-400">{` (${col.unit})`}</span>}
                    {active && <span className="ml-0.5">{asc ? "▲" : "▼"}</span>}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map(r => (
              <tr key={r.ticker} className="odd:bg-white even:bg-gray-50/60 hover:bg-blue-50/50">
                {COLS.map(col => {
                  if (col.key === "name") {
                    return (
                      <td key={col.key}
                          className="px-2 py-1 whitespace-nowrap sticky left-0 bg-inherit border-r border-gray-100">
                        <button onClick={() => onOpenValuation?.(r.ticker)}
                                title={`${r.label} 기업가치 자세히 보기`}
                                className="font-bold text-gray-900 hover:text-blue-600">
                          {r.label}
                        </button>
                        <button onClick={() => openTossStock(r.ticker)}
                                title="토스 종목 페이지"
                                className="ml-1 text-[10px] text-gray-400 hover:text-blue-600">
                          {r.ticker}
                        </button>
                        {r.market && (
                          <span className="ml-1 text-[9px] text-gray-400">
                            {r.market === "KOSDAQ" ? "코스닥" : "코스피"}
                          </span>
                        )}
                      </td>
                    );
                  }
                  const v = numOf(r, col.key);
                  return (
                    <td key={col.key}
                        className={`px-2 py-1 text-right whitespace-nowrap tabular-nums ${cellColor(v, col)}`}>
                      {r.loading && v == null ? <span className="text-gray-300">…</span> : fmtCell(v, col)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-[10px] text-gray-400 px-1 leading-relaxed">
        출처: 네이버 금융(시총·PER·PBR·EPS·BPS·동일업종 PER, 일별 투자자 순매수) · 와이즈리포트(매출액·영업이익·이익률·ROE, 최근 연간).
        수급은 선택 기간 누적 <span className="text-rose-600">순매수(+)</span>/<span className="text-blue-600">순매도(−)</span> 주식수입니다.
        값이 <span className="text-gray-500">—</span> 인 항목은 해당 종목에 공시 데이터가 없는 경우입니다(ETF·리츠 등).
      </div>
    </div>
  );
}
