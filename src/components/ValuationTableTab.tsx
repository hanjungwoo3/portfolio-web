// 성적표 탭 — 섹터(반도체·반도체 소부장·대장주 페이지 섹터들)를 골라 그 안의 종목을 한 표로 비교.
//   컬럼은 기업가치 팝업의 '가치평가 + 수익성' 지표와 동일. 각 열 클릭으로 정렬.
//   데이터: 종목당 네이버 메인 1콜 + 와이즈리포트 1콜 (fetchValuationRow, 동시 3개 제한).
//   지표는 분기 단위로만 바뀌므로 6시간 캐시 — 탭을 다시 열어도 다시 받지 않는다.
import { useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { fetchValuationRow, fetchEarningsEstimates, fetchNaverConsensusFields, type ValuationRow, type EarningsRow } from "../lib/fundamentals";
import { fetchInvestorHistorySafe, fetchKrPriceHistory, fetchTossKrCandles, fetchTossPrices, type PricePoint } from "../lib/api";
import { sectorPresets } from "../lib/sectorPresets";
import { Sparkline } from "./Sparkline";
import {
  computeValueBurst, dateToNum, toEok, burstThresholdWon,
  loadBurstLevel, BURST_BARS,
  type BurstStat, type BurstLevel,
} from "../lib/valueBurst";
import {
  computeMaTrend, maTrendTooltip, MA_TREND_PERIODS, MA_TREND_LABEL, MA_TREND_CLASS,
  type MaTrend,
} from "../lib/maTrend";
import { openTossStock } from "../lib/toss";
import { signColor } from "../lib/format";
import type { Investor } from "../types";
import type { ConsensusItem } from "./ConsensusTab";

const VALUATION_STALE_MS = 6 * 60 * 60 * 1000;
const INVESTOR_STALE_MS = 60 * 60 * 1000;   // 수급은 하루 1회 확정 — 1시간 캐시(컨센서스 탭과 공유)
// 이평 배열 판정용 캔들 — 일봉은 장중에도 마지막 봉이 움직여 1시간, 월봉은 한 달에 한 번
// 확정되므로 12시간. 종목당 2콜이 더 들어가는 만큼 캐시를 길게 잡는다.
const CANDLE_DAY_STALE_MS = 60 * 60 * 1000;
const CANDLE_MONTH_STALE_MS = 12 * 60 * 60 * 1000;
// 월봉 MA120 = 120개월(10년). 300개면 25년치라 상장이 오래된 종목은 넉넉히 채워진다.
const MONTH_CANDLE_COUNT = 300;

// 최근 순매수 기간 — 기업가치 팝업의 "5일/20일/60일" 과 동일
type FlowDays = 5 | 20 | 60;   // 수급 열(표에선 숨김) 기간

// 거래대금 급증일 기준(BURST_BARS/BURST_LEVELS)은 valueBurst.ts 에서 공유 —
// 여기서 고른 기준이 기업가치 차트의 거래량 강조에도 그대로 적용된다.

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
  | "name" | "market" | "sub" | "spark" | "price" | "chg" | "ret_1m" | "ret_3m" | "ret_1y"
  | "from_52h" | "pos_52" | "from_ath" | "fwd_per" | "op_next" | "op_growth" | "target" | "target_up" | "opinion"
  | "trend_d" | "trend_m"
  | "market_cap" | "per" | "pbr" | "eps" | "bps" | "industry_per"
  | "revenue" | "operating_income" | "operating_margin" | "net_margin" | "roe"
  | "flow_foreign" | "flow_inst" | "flow_pension" | "flow_indiv"
  | "burst_days" | "burst_max" | "burst_last" | "burst_turnover";

interface Col {
  key: ColKey;
  label: string;
  unit?: string;
  hint: string;
  digits?: number;      // 소수점 자리 (미지정 = 정수)
  goodHigh?: boolean;   // true = 클수록 좋음(초록), false = 작을수록 좋음
  flow?: boolean;       // 순매수 열 — 주식수 축약 + 매수/매도 색
  burst?: boolean;      // 거래대금 급증 열 — 0/없음을 흐리게 표시
  date?: boolean;       // YYYYMMDD 숫자를 날짜로 표시
  trend?: "day" | "month";   // 이평 배열 열 — 숫자 대신 정배열/역배열 배지
  pct?: boolean;        // 등락·수익률 열 — 부호 붙이고 상승 빨강/하락 파랑
}

const [P20, P60, P120] = MA_TREND_PERIODS;
const TREND_HINT = (unit: string, extra: string) =>
  `MA${P20} > MA${P60} > MA${P120} 이면 정배열(빨강), 반대면 역배열(파랑), 그 외는 혼조.\n`
  + `화살표는 종가가 MA${P20} 위(↑)/아래(↓)라는 뜻 — 배열이 더 확실한 상태.\n`
  + `${unit} 기준. ${extra}\n셀에 마우스를 올리면 이평값·이격도·기울기·교차 시점.`;

const COLS: Col[] = [
  { key: "name",             label: "종목명",       hint: "클릭하면 토스 종목 페이지" },
  { key: "market",           label: "시장",         hint: "코스피(유가증권시장) / 코스닥. 정렬하면 코스피 먼저." },
  { key: "sub",              label: "분류",         hint: "섹터 안 세부 분류(반도체 소부장: 장비·부품·소재·후공정 서비스)." },
  // ── 얼마나 올랐나 · 지금 어디쯤인가 (토스 일봉 450·월봉 300, 현재가는 토스 실시간)
  { key: "spark",     label: "추세(6개월)", hint: "최근 약 120거래일 종가 추이. 정렬은 6개월 수익률 기준." },
  { key: "price",     label: "현재가",   unit: "원", hint: "토스 현재가(시간외 포함)." },
  { key: "chg",       label: "오늘",     unit: "%", digits: 2, pct: true, hint: "직전 거래일 종가 대비." },
  { key: "ret_1m",    label: "1개월",    unit: "%", digits: 1, pct: true, hint: "약 21거래일 전 종가 대비." },
  { key: "ret_3m",    label: "3개월",    unit: "%", digits: 1, pct: true, hint: "약 63거래일 전 종가 대비." },
  { key: "ret_1y",    label: "1년",      unit: "%", digits: 1, pct: true, hint: "약 250거래일 전 종가 대비." },
  { key: "from_52h",  label: "52주고점比", unit: "%", digits: 1, pct: true, hint: "52주(약 250거래일) 최고가 대비 현재 위치. 0 이면 신고가." },
  { key: "pos_52",    label: "52주위치", unit: "%", hint: "52주 최저(0)~최고(100) 사이 어디인가. 80 이상 = 고점권, 20 이하 = 저점권." },
  { key: "from_ath",  label: "전고점比", unit: "%", digits: 1, pct: true, hint: "월봉 최대 25년 최고가 대비. 0 에 가까우면 역사적 고점권." },
  // 이평 배열 — 장기(월봉) 추세 안에서 단기(일봉)가 어디 있는지 한눈에 보려고 나란히 둔다.
  //   예) 월 정배열 + 일 역배열 = 장기 추세는 살아있는 눌림목
  { key: "trend_d", label: "일추세", trend: "day",
    hint: TREND_HINT(`일봉 MA${P20}/${P60}/${P120}일`, `약 ${P120}거래일(6개월)치가 필요합니다.`) },
  { key: "trend_m", label: "월추세", trend: "month",
    hint: TREND_HINT(`월봉 MA${P20}/${P60}/${P120}개월`,
                     `MA${P120} 이 ${P120}개월 = 10년치라 상장 10년 미만 종목·신형 ETF 는 "—" 로 나옵니다.`) },
  { key: "market_cap",       label: "시가총액",     unit: "억원", hint: "발행주식수 × 주가. 회사 규모." },
  { key: "per",              label: "PER",          unit: "배", digits: 2, goodHigh: false, hint: "주가 ÷ EPS. 낮을수록 저평가(시장 평균 약 15배)." },
  { key: "fwd_per",          label: "선행PER",      unit: "배", digits: 2, goodHigh: false, hint: "내년 추정(E) 실적 기준 PER(와이즈리포트 컨센서스). 현재 PER 보다 낮으면 이익이 늘 거란 뜻." },
  // 동일업종 PER 열은 뺐다 — 네이버 상세 API 가 sameIndustryPer 를 null 로 준다(2026-10-06 확인, 전 종목 '—').
  { key: "pbr",              label: "PBR",          unit: "배", digits: 2, goodHigh: false, hint: "주가 ÷ BPS. 1 미만이면 청산가치보다 싸게 거래." },
  { key: "eps",              label: "EPS",          unit: "원", hint: "1주당 순이익." },
  { key: "bps",              label: "BPS",          unit: "원", hint: "1주당 순자산(청산가치 기준)." },
  { key: "revenue",          label: "매출액",       unit: "억원", hint: "연간 총 판매액. 회사 외형." },
  { key: "operating_income", label: "영업이익",     unit: "억원", hint: "본업으로 번 이익(연간)." },
  { key: "operating_margin", label: "영업이익률",   unit: "%", digits: 2, goodHigh: true, hint: "영업이익 ÷ 매출액. 높을수록 경쟁력." },
  { key: "net_margin",       label: "순이익률",     unit: "%", digits: 2, goodHigh: true, hint: "순이익 ÷ 매출액." },
  // ── 전망 (와이즈리포트 추정치 · 네이버 공식 컨센서스)
  { key: "op_next",          label: "내년 영업이익(E)", unit: "억원", hint: "컨센서스 추정 영업이익(가장 가까운 추정 연도)." },
  { key: "op_growth",        label: "이익성장(E)", unit: "%", digits: 1, pct: true, hint: "추정 영업이익 ÷ 최근 실적 영업이익 − 1. 적자→흑자 전환은 —." },
  { key: "target",           label: "목표주가",   unit: "원", hint: "증권사 평균 목표주가." },
  { key: "target_up",        label: "목표가괴리", unit: "%", digits: 1, pct: true, hint: "증권사 평균 목표주가 ÷ 현재가 − 1. 클수록 증권사가 더 오를 여지를 본다." },
  { key: "opinion",          label: "투자의견", hint: "증권사 평균 의견(5 적극매수 ~ 1 적극매도). 정렬은 점수 기준." },
  { key: "roe",              label: "ROE",          unit: "%", digits: 2, goodHigh: true, hint: "자기자본수익률. 15% 이상이면 우수." },
  // 최근 수급 — 선택한 기간(5/20/60일) 누적 순매수 주식수
  { key: "flow_foreign",     label: "외국인",       unit: "주", flow: true, hint: "선택 기간 외국인 누적 순매수(주식수). +매수 / −매도." },
  { key: "flow_inst",        label: "기관계",       unit: "주", flow: true, hint: "선택 기간 기관 누적 순매수(주식수)." },
  { key: "flow_pension",     label: "연기금",       unit: "주", flow: true, hint: "선택 기간 연기금 누적 순매수(주식수). 국민연금 등." },
  { key: "flow_indiv",       label: "개인",         unit: "주", flow: true, hint: "선택 기간 개인 누적 순매수(주식수)." },
  // 거래대금 급증 — 최근 30거래일 중 양봉이면서 기준금액을 넘긴 날
  { key: "burst_days",     label: "터진일수",   unit: "일",   burst: true, hint: `최근 ${BURST_BARS}거래일 중 양봉 + 거래대금이 기준을 넘은 날의 수. 셀에 마우스를 올리면 날짜별 상세.` },
  { key: "burst_max",      label: "최대대금",   unit: "억원", burst: true, hint: "그 날들 중 가장 큰 거래대금. 종가 × 거래량 근사." },
  { key: "burst_turnover", label: "시총대비",   unit: "%", digits: 1, burst: true, hint: "최대대금 ÷ 시가총액. 소형주가 크게 나오면 손바뀜이 격했다는 뜻 — 테마주 판별에 유용." },
  { key: "burst_last",     label: "최근터진날", burst: true, date: true, hint: "가장 최근에 조건을 충족한 날." },
];

// 표에 보이는 열 — **초보가 바로 읽히는 값만**(사용자 결정 2026-10-06). 나머지 열 정의(수급·급증·이평 배열·
//   EPS/BPS/ROE 등)는 다시 쓸 수 있게 남겨 두되 표에는 안 나온다. 이름·설명도 쉬운 말로 덮어쓴다.
const SIMPLE: { key: ColKey; label?: string; hint?: string; unit?: string }[] = [
  { key: "name" },
  { key: "market" },
  { key: "sub" },
  { key: "spark",            label: "6개월 추세", hint: "최근 6개월 주가 흐름. 정렬은 6개월 수익률." },
  { key: "price" },
  { key: "target",           label: "평균 목표주가", hint: "증권사들이 제시한 목표주가의 평균. 현재가와 바로 비교하게 옆에 둔다." },
  { key: "target_up",        label: "목표주가까지", hint: "평균 목표주가가 지금 주가보다 몇 % 위인가. 클수록 더 오를 여지를 본다는 뜻." },
  { key: "chg",              label: "오늘", hint: "어제 종가보다 오늘 몇 % 올랐나(내렸나)." },
  { key: "ret_1m",           label: "1개월", hint: "한 달 전보다 몇 % 올랐나." },
  { key: "ret_3m",           label: "3개월", hint: "석 달 전보다 몇 % 올랐나." },
  { key: "ret_1y",           label: "1년", hint: "1년 전보다 몇 % 올랐나." },
  { key: "from_52h",         label: "1년 고점 대비", hint: "지난 1년 중 가장 비쌌던 가격보다 지금 몇 % 아래인가. 0 이면 지금이 1년 중 최고가." },
  { key: "market_cap",       hint: "회사 전체의 몸값(주가 × 주식 수). 클수록 큰 회사." },
  { key: "revenue",          hint: "1년 동안 판 금액(최근 연간)." },
  { key: "operating_income", hint: "본업으로 번 돈(최근 연간)." },
  { key: "operating_margin", hint: "100원 팔아 본업으로 몇 원 남기나." },
  { key: "op_next",          label: "내년 영업이익", unit: "예상·억원", hint: "증권사들이 예상하는 내년 영업이익. 올해보다 크면 이익이 늘 거란 뜻." },
  { key: "per",              hint: "주가가 1년 이익의 몇 배인가. 낮을수록 이익에 비해 싸다(보통 10~15배)." },
  { key: "pbr",              hint: "주가가 회사 순자산의 몇 배인가. 1 보다 낮으면 가진 재산보다 싸게 거래되는 셈." },
  // 투자의견(대부분 '매수'라 변별력이 없다) 대신 평균 목표주가 금액 — 사용자 결정 2026-10-06
];
// 세부 분류 배지 색 — 분류마다 다르게(장비 보라 · 부품 주황 · 소재 자주 · 후공정 하늘)
const SUB_TONE: Record<string, string> = {
  "장비":   "text-violet-700 bg-violet-50 border-violet-200",
  "부품":   "text-orange-700 bg-orange-50 border-orange-200",
  "소재":   "text-fuchsia-700 bg-fuchsia-50 border-fuchsia-200",   // 초록은 코스닥 배지와 겹쳐 피한다
  "후공정": "text-sky-700 bg-sky-50 border-sky-200",
};
const VIEW_COLS: Col[] = SIMPLE.map(v => {
  const c = COLS.find(x => x.key === v.key)!;
  return { ...c, label: v.label ?? c.label, hint: v.hint ?? c.hint, unit: v.unit ?? c.unit };
});

interface Row extends ValuationRow {
  ticker: string;
  sub?: string; subRank?: number;
  spark?: number | null;          // 정렬값 = 6개월 수익률
  sparkData?: number[];
  price?: number;
  chg?: number | null;
  ret_1m?: number | null; ret_3m?: number | null; ret_1y?: number | null;
  from_52h?: number | null; pos_52?: number | null; from_ath?: number | null;
  fwd_per?: number | null; op_next?: number | null; op_growth?: number | null;
  target?: number | null; target_up?: number | null; opinion?: number | null; opinionText?: string;
  label: string;                 // 표시용 종목명 (보유 목록 기준, 없으면 네이버 이름)
  market?: "KOSPI" | "KOSDAQ";
  loading: boolean;
  flow_foreign?: number | null;
  flow_inst?: number | null;
  flow_pension?: number | null;
  flow_indiv?: number | null;
  burst_days?: number | null;
  burst_max?: number | null;
  burst_turnover?: number | null;
  burst_last?: number | null;     // YYYYMMDD (정렬 가능하도록 숫자)
  burst?: BurstStat;              // 툴팁용 원본
  // 이평 배열 — 정렬은 점수(정배열 +3~ 역배열 −3)로, 표시는 원본(trendD/trendM)으로.
  trend_d?: number | null;
  trend_m?: number | null;
  trendD?: MaTrend | null;
  trendM?: MaTrend | null;
  trendLoading?: boolean;         // 캔들 로딩 중 — "—"(데이터 없음)과 구분
}

function numOf(r: Row, key: ColKey): number | null {
  if (key === "name") return null;
  if (key === "market") return r.market === "KOSPI" ? 0 : r.market === "KOSDAQ" ? 1 : null;
  if (key === "sub") return r.subRank ?? null;
  const v = r[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function fmtCell(v: number | null, col: Col): string {
  if (v == null) return "—";
  if (col.date) {                      // 20260807 → 08-07
    const s = String(v);
    return s.length === 8 ? `${s.slice(4, 6)}-${s.slice(6, 8)}` : s;
  }
  if (col.key === "burst_days" && v === 0) return "—";   // 0일은 '없음'으로 읽히게
  if (col.flow) return fmtShares(v);
  if (col.pct) return `${v > 0 ? "+" : ""}${v.toFixed(col.digits ?? 1)}`;
  if (col.digits) return v.toLocaleString("ko-KR", { minimumFractionDigits: col.digits, maximumFractionDigits: col.digits });
  return Math.round(v).toLocaleString("ko-KR");
}

// 값 색 — 손익 색과 헷갈리지 않게 회색 기본, 판단 기준이 뚜렷한 열만 강조.
function cellColor(v: number | null, col: Col): string {
  if (col.burst) {
    // 조건 충족이 있는 종목만 눈에 띄게 — 없는 종목은 흐리게 깔아둔다.
    if (v == null || v === 0) return "text-gray-300";
    if (col.key === "burst_days") {
      // 터진일수 = 이 표의 핵심 열 — 빈도에 따라 배경까지 단계적으로 진해진다.
      if (v >= 5) return "text-white font-bold bg-rose-600 rounded";
      if (v >= 3) return "text-rose-700 font-bold bg-rose-100 rounded";
      return "text-rose-600 font-bold bg-rose-50 rounded";
    }
    if (col.key === "burst_turnover") return v >= 20 ? "text-rose-600 font-bold" : "text-gray-800";
    return "text-gray-800";
  }
  if (col.flow) return v == null ? "text-gray-800" : signColor(v);   // 순매수 = 매수 빨강 / 매도 파랑
  if (col.pct) return v == null ? "text-gray-800" : signColor(v);
  if (col.key === "pos_52" && v != null) return v >= 80 ? "text-rose-600 font-bold" : v <= 20 ? "text-blue-600 font-bold" : "text-gray-800";
  if (v == null || col.goodHigh === undefined) return "text-gray-800";
  if (col.key === "roe") return v >= 15 ? "text-emerald-600 font-bold" : v < 0 ? "text-rose-600" : "text-gray-800";
  if (col.key === "per") return v > 0 && v < 10 ? "text-emerald-600 font-bold" : "text-gray-800";
  if (col.key === "pbr") return v > 0 && v < 1 ? "text-emerald-600 font-bold" : "text-gray-800";
  if (col.goodHigh) return v < 0 ? "text-rose-600" : "text-gray-800";
  return "text-gray-800";
}

// 이평 배열 셀 — 배지 텍스트/색/툴팁. 숫자 열과 달리 라벨을 그대로 보여준다.
function trendOf(r: Row, col: Col): MaTrend | null {
  return (col.trend === "month" ? r.trendM : r.trendD) ?? null;
}
function trendTooltip(r: Row, col: Col): string {
  const month = col.trend === "month";
  return maTrendTooltip(
    trendOf(r, col),
    `${r.label} — ${month ? "월봉" : "일봉"} 이평 배열`,
    month ? "개월" : "일",
  );
}

// 급증일 셀 호버 — 날짜별 거래대금/등락을 한 번에 (표 밖으로 안 나가게 최대 8줄)
function burstTooltip(r: Row): string | undefined {
  const hits = r.burst?.hits;
  if (!hits || hits.length === 0) return undefined;
  const lines = hits.slice(0, 8).map(h =>
    `${h.date}  ${toEok(h.value).toLocaleString()}억  ` +
    `${h.open.toLocaleString()}→${h.close.toLocaleString()} (+${h.pct.toFixed(2)}%)`);
  if (hits.length > 8) lines.push(`… 외 ${hits.length - 8}일`);
  return `${r.label} — 조건 충족 ${hits.length}일\n${lines.join("\n")}`;
}

// 캔들에서 '얼마나 올랐나 · 어디쯤인가' — 현재가는 실시간(없으면 마지막 종가).
function priceStats(day: PricePoint[] | undefined, month: PricePoint[] | undefined, now?: number) {
  const closes = (day ?? []).map(c => c.close).filter(v => v > 0);
  const last = now && now > 0 ? now : closes[closes.length - 1];
  if (!last || closes.length < 2) return {};
  const back = (n: number) => closes.length > n ? (last / closes[closes.length - 1 - n] - 1) * 100 : null;
  const yr = (day ?? []).slice(-250);
  const hi = Math.max(last, ...yr.map(c => c.high ?? c.close));
  const lo = Math.min(last, ...yr.map(c => c.low ?? c.close).filter(v => v > 0));
  const ath = Math.max(hi, ...(month ?? []).map(c => c.high ?? c.close));
  return {
    sparkData: closes.slice(-120),
    spark: back(Math.min(119, closes.length - 1)),
    ret_1m: back(21), ret_3m: back(63), ret_1y: back(250),
    from_52h: (last / hi - 1) * 100,
    pos_52: hi > lo ? ((last - lo) / (hi - lo)) * 100 : null,
    from_ath: (last / ath - 1) * 100,
  };
}
// 추정치 — 가장 가까운 (E) 연도와 그 직전 실적(A).
function estimateStats(rows: EarningsRow[] | undefined) {
  if (!rows?.length) return {};
  const ei = rows.findIndex(r => r.estimate);
  if (ei < 0) return {};
  const e = rows[ei], a = rows.slice(0, ei).reverse().find(r => !r.estimate && r.op_income != null);
  const growth = e.op_income != null && a?.op_income != null && a.op_income > 0 ? (e.op_income / a.op_income - 1) * 100 : null;
  return { fwd_per: e.per, op_next: e.op_income, op_growth: growth };
}


interface ValuationTableTabProps {
  items?: ConsensusItem[];   // 예전 '관심종목' 묶음용 — 지금은 안 쓴다(호출부 호환용)
  onOpenValuation?: (ticker: string) => void;
}

export function ValuationTableTab({ onOpenValuation }: ValuationTableTabProps) {
  // 섹터 선택(반도체·반도체 소부장·대장주 페이지 섹터들) — 섹터 안에서 비교한다.
  //   '관심종목'(내가 추가한 종목 전체) 묶음은 뺐다(사용자 결정 2026-10-06). 예전에 고른 값이면 첫 섹터로.
  const presets = useMemo(() => sectorPresets(), []);
  // 열 때마다 반도체부터(마지막 섹터를 기억하던 건 뺐다 — 사용자 결정 2026-10-06)
  const [presetKey, setPresetKey] = useState("semi");
  const preset = presets.find(p => p.key === presetKey) ?? presets[0];
  const pickPreset = (k: string) => { setPresetKey(k); setSub("all"); };
  // 시장 필터 — 전체 / 코스피 / 코스닥 (시장은 네이버 상세로 알아낸다 — 아직 모르는 종목은 '전체' 에만)
  const [mkt, setMkt] = useState<"all" | "KOSPI" | "KOSDAQ">("all");
  const [sub, setSub] = useState<string>("all");   // 세부 분류 필터(분류가 있는 섹터만)
  const viewCols = preset.subs ? VIEW_COLS : VIEW_COLS.filter(c => c.key !== "sub");
  const items: ConsensusItem[] = useMemo(
    () => preset.tickers.map(t => ({ ticker: t, name: preset.names[t] ?? "" })),
    [preset],
  );
  const tickers = useMemo(
    () => Array.from(new Set(items.map(i => i.ticker).filter(t => /^[\dA-Za-z]{6}$/.test(t)))),
    [items],
  );
  const [sortKey, setSortKey] = useState<ColKey>("market_cap");
  const [asc, setAsc] = useState(false);
  const flowDays: FlowDays = 20;
  const burstLevel: BurstLevel = loadBurstLevel();

  const qs = useQueries({
    queries: tickers.map(t => ({
      queryKey: ["valuation-row", t],
      queryFn: () => fetchValuationRow(t),
      staleTime: VALUATION_STALE_MS,
      gcTime: VALUATION_STALE_MS,
      refetchOnWindowFocus: false,
      retry: 3, retryDelay: (n: number) => 2000 * (n + 1),   // 일시 실패는 조금 쉬었다 다시(빈 결과는 캐시 안 함)
    })),
  });

  // 최근 수급(외국인·기관·연기금·개인) — 종목당 1콜. 컨센서스 탭과 같은 쿼리키라 캐시를 공유한다.
  const invQs = useQueries({
    queries: tickers.map(t => ({
      queryKey: ["investor-history-long", t],
      queryFn: () => fetchInvestorHistorySafe(t, [200, 120, 60]),
      enabled: false,   // 수급 열은 표에서 뺐다(초보용 정리) — 호출 안 함
      staleTime: INVESTOR_STALE_MS,
      refetchOnWindowFocus: false,
    })),
  });

  // 일봉(3개월) — 대시보드 카드 sparkline 과 같은 쿼리키라 캐시를 그대로 쓴다(추가 호출 없음).
  const priceQs = useQueries({
    queries: tickers.map(t => ({
      queryKey: ["kr-price-history", t, "3mo"],
      queryFn: () => fetchKrPriceHistory(t, "3mo"),
      enabled: false,   // 거래대금 급증 열은 표에서 뺐다
      staleTime: 60 * 60 * 1000,
      refetchOnWindowFocus: false,
    })),
  });

  // 이평 배열용 캔들 — 위 3mo(약 62봉)로는 MA120 이 안 나오고, 그 쿼리키는 대시보드
  //   sparkline 과 공유라 기간을 늘릴 수 없다. 토스 c-chart 로 따로 받는다(종목당 2콜).
  //   일봉 450 = 약 21개월 → MA120 이 330봉 넘게 채워진다.
  const dayCandleQs = useQueries({
    queries: tickers.map(t => ({
      queryKey: ["toss-candles", t, "day"],
      queryFn: () => fetchTossKrCandles(t, "day"),
      staleTime: CANDLE_DAY_STALE_MS,
      gcTime: CANDLE_DAY_STALE_MS,
      refetchOnWindowFocus: false,
      retry: 1,
    })),
  });
  const monthCandleQs = useQueries({
    queries: tickers.map(t => ({
      queryKey: ["toss-candles", t, "month"],
      queryFn: () => fetchTossKrCandles(t, "month", MONTH_CANDLE_COUNT),
      enabled: false,   // 월추세·전고점 열은 표에서 뺐다
      staleTime: CANDLE_MONTH_STALE_MS,
      gcTime: CANDLE_MONTH_STALE_MS,
      refetchOnWindowFocus: false,
      retry: 1,
    })),
  });

  // 현재가 — 200종목까지 1콜. 1분마다.
  const liveQ = useQuery({
    queryKey: ["valuation-live", tickers.join(",")],
    queryFn: () => fetchTossPrices(tickers),
    enabled: tickers.length > 0, staleTime: 30_000, refetchInterval: 60_000,
  });
  const live = useMemo(() => new Map((liveQ.data ?? []).map(p => [p.ticker, p])), [liveQ.data]);
  // 전망 — 추정 실적(와이즈리포트 cF1002) + 공식 컨센서스(목표주가·의견). 분기 단위로 바뀌어 12시간 캐시.
  const extraQs = useQueries({
    queries: tickers.map(t => ({
      queryKey: ["valuation-extra", t],
      queryFn: async () => {
        const [est, cons] = await Promise.all([fetchEarningsEstimates(t), fetchNaverConsensusFields(t)]);
        return { est, cons };
      },
      staleTime: 2 * VALUATION_STALE_MS, gcTime: 2 * VALUATION_STALE_MS,
      refetchOnWindowFocus: false, retry: 1,
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
    const burst = computeValueBurst(
      priceQs[i]?.data, BURST_BARS, burstThresholdWon(burstLevel));
    // 시총(억원) 대비 최대대금(억원) — 소형주 손바뀜 강도
    const mcap = typeof d?.market_cap === "number" ? d.market_cap : null;
    const maxEok = burst.maxValue != null ? toEok(burst.maxValue) : null;
    const trendD = computeMaTrend(dayCandleQs[i]?.data);
    const trendM = computeMaTrend(monthCandleQs[i]?.data);
    const lp = live.get(t);
    const now = lp?.price ?? d?.price;
    const ex = extraQs[i]?.data;
    const target = ex?.cons.consensus_target_official;
    return {
      ...(d ?? { ticker: t }),
      ...priceStats(dayCandleQs[i]?.data, monthCandleQs[i]?.data, lp?.price),
      ...estimateStats(ex?.est),
      price: now,
      sub: preset.subs?.[t], subRank: preset.subs?.[t] ? preset.subOrder?.indexOf(preset.subs[t]) : undefined,
      chg: lp && lp.prevClose > 0 ? (lp.price / lp.prevClose - 1) * 100 : null,
      target: target ?? null,
      target_up: target && now ? (target / now - 1) * 100 : null,
      opinion: ex?.cons.consensus_score ?? null,
      opinionText: ex?.cons.consensus_opinion,
      ticker: t,
      label: meta?.name || d?.name || t,
      market: meta?.market ?? d?.market,   // 섹터 목록엔 시장 구분이 없어 네이버 상세(sosok)로
      loading: !!q?.isLoading,
      flow_foreign: sumLast(inv, "외국인", flowDays),
      flow_inst:    sumLast(inv, "기관", flowDays),
      flow_pension: sumLast(inv, "연기금", flowDays),
      flow_indiv:   sumLast(inv, "개인", flowDays),
      burst,
      burst_days: priceQs[i]?.data ? burst.days : null,
      burst_max: maxEok,
      burst_turnover: maxEok != null && mcap != null && mcap > 0 ? (maxEok / mcap) * 100 : null,
      burst_last: dateToNum(burst.lastDate),
      trendD, trendM,
      trend_d: trendD?.score ?? null,
      trend_m: trendM?.score ?? null,
      trendLoading: !!(dayCandleQs[i]?.isLoading || monthCandleQs[i]?.isLoading),
    };
  });

  const loaded = qs.filter(q => q.isSuccess).length;

  // 종목 수십 개 규모라 매 렌더 정렬해도 부담 없다(메모 키를 만드는 비용이 오히려 큼).
  const sorted = rows.filter(r => (mkt === "all" || r.market === mkt) && (sub === "all" || r.sub === sub)).sort((a, b) => {
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
      {/* 묶음 선택 — 관심종목 / 섹터. 섹터는 반도체·소부장 + 지수(대장주) 페이지의 섹터 줄 */}
      <div className="flex flex-wrap items-center gap-1 px-1" data-noswipe>
        {presets.map(p => {
          const on = preset.key === p.key;
          return (
            <button key={p.key} onClick={() => pickPreset(p.key)}
                    className={`px-2.5 py-0.5 rounded-full text-[12px] transition
                                ${on ? "bg-blue-600 text-white font-bold" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
              {p.label}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2 px-1">
        <span className="text-sm font-bold text-gray-800">📊 {preset.label} 섹터 비교</span>
        <span className="inline-flex rounded border border-gray-300 overflow-hidden text-[12px] font-bold">
          {([["all", "전체"], ["KOSPI", "코스피"], ["KOSDAQ", "코스닥"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setMkt(k)}
                    className={`px-2 py-0.5 ${mkt === k ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-100"}`}>
              {l}
            </button>
          ))}
        </span>
        {preset.subOrder && (
          <span className="inline-flex rounded border border-gray-300 overflow-hidden text-[12px] font-bold">
            {["all", ...preset.subOrder].map(k => (
              <button key={k} onClick={() => setSub(k)}
                      className={`px-2 py-0.5 ${sub === k ? "bg-indigo-600 text-white" : "bg-white text-gray-600 hover:bg-gray-100"}`}>
                {k === "all" ? "전체 분류" : k}
              </button>
            ))}
          </span>
        )}
        <span className="text-[11px] text-gray-500">
          {loaded < tickers.length ? `불러오는 중 ${loaded}/${tickers.length}` : `${sorted.length}종목`}
          {" · 열 제목을 누르면 정렬"}
        </span>

      </div>


      {/* 표 자체를 스크롤 영역으로 — 그래야 헤더 행이 위에 고정된 채로 세로 스크롤된다.
          (페이지 스크롤에 맡기면 가로 스크롤 컨테이너 안이라 헤더가 같이 밀려 올라간다) */}
      <div className="overflow-auto border border-gray-200 rounded bg-white
                      max-h-[calc(100vh-150px)] overscroll-contain">
        <table className="min-w-full text-[13px] border-collapse">   {/* 11px 은 너무 작다는 피드백(2026-10-06) */}
          <thead className="sticky top-0 z-20 bg-gray-50 shadow-[0_1px_0_rgba(0,0,0,0.08)]">
            <tr>
              {viewCols.map(col => {
                const active = col.key === sortKey;
                return (
                  <th key={col.key}
                      onClick={() => clickCol(col.key)}
                      title={`${col.hint}\n(클릭: 정렬)`}
                      className={`px-2 py-1.5 whitespace-nowrap cursor-pointer select-none border-b border-gray-200
                                  text-[12px] ${col.key === "name" ? "text-left sticky left-0 bg-gray-50 z-30" : "text-right"}
                                  ${active ? "text-blue-700 font-bold" : "text-gray-600 hover:text-gray-900"}`}>
                    {/* 열 제목은 전부 두 줄 — 윗줄 이름, 아랫줄 (단위) + 정렬 화살표. 폭을 아끼고 줄 높이를 맞춘다. */}
                    <span className="block">{col.label}</span>
                    <span className="block text-[10px] text-gray-400">
                      {col.flow ? `${flowDays}일` : col.unit ? `(${col.unit})` : "\u00a0"}
                      {active && <span className="ml-0.5 text-blue-700">{asc ? "▲" : "▼"}</span>}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map(r => (
              <tr key={r.ticker} className="odd:bg-white even:bg-gray-50/60 hover:bg-blue-50/50">
                {viewCols.map(col => {
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
                                className="ml-1 text-[11px] text-gray-400 hover:text-blue-600">
                          {r.ticker}
                        </button>

                      </td>
                    );
                  }
                  if (col.key === "sub") {
                    return (
                      <td key={col.key} className="px-2 py-1 text-center whitespace-nowrap">
                        {r.sub ? <span className={`px-1.5 rounded text-[11px] font-bold border ${SUB_TONE[r.sub] ?? "text-gray-700 bg-gray-50 border-gray-200"}`}>{r.sub}</span>
                               : <span className="text-gray-300">—</span>}
                      </td>
                    );
                  }
                  if (col.key === "market") {
                    return (
                      <td key={col.key} className="px-2 py-1 text-center whitespace-nowrap">
                        {r.market
                          ? <span className={`px-1.5 rounded text-[11px] font-bold border
                                              ${r.market === "KOSDAQ" ? "text-emerald-700 bg-emerald-50 border-emerald-200" : "text-blue-700 bg-blue-50 border-blue-200"}`}>
                              {r.market === "KOSDAQ" ? "코스닥" : "코스피"}
                            </span>
                          : <span className="text-gray-300">{r.loading ? "…" : "—"}</span>}
                      </td>
                    );
                  }
                  if (col.key === "spark") {
                    return (
                      <td key={col.key} className="px-1 py-0.5">
                        {r.sparkData && r.sparkData.length > 1
                          ? <Sparkline data={r.sparkData} width={100} height={26} strokeWidth={1.3} />
                          : <span className="text-gray-300">{r.trendLoading ? "…" : "—"}</span>}
                      </td>
                    );
                  }
                  if (col.key === "opinion") {
                    return (
                      <td key={col.key} className="px-2 py-1 text-right whitespace-nowrap"
                          title={r.opinion != null ? `평균 점수 ${r.opinion.toFixed(2)} / 5` : undefined}>
                        {r.opinionText
                          ? <span className={r.opinion != null && r.opinion >= 3.5 ? "text-rose-600 font-bold" : "text-gray-700"}>{r.opinionText}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                    );
                  }
                  if (col.trend) {
                    const t = trendOf(r, col);
                    return (
                      <td key={col.key}
                          title={trendTooltip(r, col)}
                          className="px-2 py-1 text-right whitespace-nowrap">
                        {t
                          ? <span className={`px-1 py-0.5 ${MA_TREND_CLASS[t.state]}`}>
                              {MA_TREND_LABEL[t.state]}
                            </span>
                          : <span className="text-gray-300">{r.trendLoading ? "…" : "—"}</span>}
                      </td>
                    );
                  }
                  const v = numOf(r, col.key);
                  return (
                    <td key={col.key}
                        title={col.burst ? burstTooltip(r) : undefined}
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

      <div className="text-[11px] text-gray-400 px-1 leading-relaxed">
        열 제목에 마우스를 올리면 뜻이 나옵니다. 값이 <span className="text-gray-500">—</span> 이면 공시·전망 자료가 없는 종목입니다.
        <br />
        출처: 토스(현재가·주가 흐름) · 네이버 금융(시가총액·PER·PBR·평균 목표주가) · 와이즈리포트(매출·영업이익·내년 예상).
      </div>
    </div>
  );
}
