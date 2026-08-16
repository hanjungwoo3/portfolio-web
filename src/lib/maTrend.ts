// 이동평균 배열 판정 — 정배열/역배열.
//   MA20 > MA60 > MA120 이면 정배열, 반대면 역배열, 그 외는 혼조.
//   종가가 MA20 위/아래인지까지 보면 "완전" 배열로 한 단계 더 나눈다.
//
// 배열만 보면 하락 중 반등(정배열인데 MA120 은 계속 우하향)을 못 거른다.
// 그래서 판정과 함께 ① MA120 기울기 ② 종가-MA120 이격도 ③ 20/60 마지막 교차 시점을
// 같이 계산해 둔다 — "막 정배열 진입"과 "정배열 3년째"는 대응이 다르기 때문.
//
// 봉 주기는 호출자가 정한다(일봉이면 20/60/120일, 월봉이면 20/60/120개월).
// 월봉 MA120 은 10년치라 상장 10년 미만 종목·신형 ETF 는 아예 산출되지 않는다(null).

import { sma, type ClosePoint } from "./indicators";

export const MA_TREND_PERIODS: readonly [number, number, number] = [20, 60, 120];

// MA120 기울기를 재는 구간 — 이보다 짧으면 노이즈, 길면 전환을 늦게 잡는다.
const SLOPE_LOOKBACK = 20;

export type MaTrendState = "strongBull" | "bull" | "mixed" | "bear" | "strongBear";

export interface MaTrend {
  state: MaTrendState;
  score: number;             // 정렬용 — 정배열이 클수록 큰 값 (3 / 2 / 0 / −2 / −3)
  close: number;
  ma20: number;
  ma60: number;
  ma120: number;
  slope120: number | null;   // MA120 의 SLOPE_LOOKBACK 봉 전 대비 변화율(%) — 봉이 모자라면 null
  disparity20: number;       // 종가 ÷ MA20 × 100
  disparity120: number;      // 종가 ÷ MA120 × 100
  crossAgo: number | null;   // MA20/MA60 이 마지막으로 교차한 시점(몇 봉 전). 관측 구간에 없으면 null
  lastDate: string;          // 판정 기준 봉의 날짜
  bars: number;              // 계산에 쓴 봉 수
}

export const MA_TREND_LABEL: Record<MaTrendState, string> = {
  strongBull: "정배열↑",
  bull:       "정배열",
  mixed:      "혼조",
  bear:       "역배열",
  strongBear: "역배열↓",
};

// 상승=빨강 국내 관행. 혼조는 판단 보류라 회색으로 깔아둔다.
export const MA_TREND_CLASS: Record<MaTrendState, string> = {
  strongBull: "text-white font-bold bg-rose-600 rounded",
  bull:       "text-rose-700 font-bold bg-rose-100 rounded",
  mixed:      "text-gray-400",
  bear:       "text-blue-700 font-bold bg-blue-100 rounded",
  strongBear: "text-white font-bold bg-blue-600 rounded",
};

const SCORE: Record<MaTrendState, number> = {
  strongBull: 3, bull: 2, mixed: 0, bear: -2, strongBear: -3,
};

// prices 는 날짜 오름차순(과거→최근) 가정 — fetchTossKrCandles / fetchKrPriceHistory 가 그렇게 준다.
// 봉이 최장 기간(=120)에 못 미치면 null — 억지로 짧은 이평으로 대체하면 다른 종목과
// 같은 열에서 비교가 안 된다. 표에서는 "—" 로 비워 두고 데이터 부족임을 드러낸다.
export function computeMaTrend(
  prices: ClosePoint[] | undefined,
  periods: readonly [number, number, number] = MA_TREND_PERIODS,
): MaTrend | null {
  if (!prices || prices.length < periods[2]) return null;

  const [p20, p60, p120] = periods;
  const l20 = sma(prices, p20), l60 = sma(prices, p60), l120 = sma(prices, p120);
  if (!l20.length || !l60.length || !l120.length) return null;

  // 세 배열의 마지막 원소는 모두 같은 봉(가장 최근) — 뒤에서부터 세면 날짜를 맞출 수 있다.
  const back = (arr: { value: number }[], n: number): number | undefined => arr[arr.length - 1 - n]?.value;

  const ma20 = l20[l20.length - 1].value;
  const ma60 = l60[l60.length - 1].value;
  const ma120 = l120[l120.length - 1].value;
  const last = prices[prices.length - 1];
  const close = last.close;
  if (!(close > 0) || !(ma20 > 0) || !(ma60 > 0) || !(ma120 > 0)) return null;

  let state: MaTrendState;
  if (ma20 > ma60 && ma60 > ma120)      state = close > ma20 ? "strongBull" : "bull";
  else if (ma20 < ma60 && ma60 < ma120) state = close < ma20 ? "strongBear" : "bear";
  else                                  state = "mixed";

  const prev120 = back(l120, SLOPE_LOOKBACK);
  const slope120 = prev120 != null && prev120 > 0
    ? ((ma120 - prev120) / prev120) * 100
    : null;

  // 20/60 의 대소가 뒤집힌 지점을 뒤에서부터 찾는다 = 골든/데드크로스 시점.
  const now = Math.sign(ma20 - ma60);
  let crossAgo: number | null = null;
  const span = Math.min(l20.length, l60.length);
  for (let n = 1; n < span; n++) {
    const a = back(l20, n), b = back(l60, n);
    if (a == null || b == null) break;
    if (Math.sign(a - b) !== now) { crossAgo = n; break; }
  }

  return {
    state,
    score: SCORE[state],
    close, ma20, ma60, ma120,
    slope120,
    disparity20: (close / ma20) * 100,
    disparity120: (close / ma120) * 100,
    crossAgo,
    lastDate: last.date,
    bars: prices.length,
  };
}

// 셀 호버용 상세 — 판정 근거를 그대로 보여준다(왜 정배열인지 숫자로 확인 가능하게).
export function maTrendTooltip(
  t: MaTrend | null,
  title: string,
  unit: string,                 // "일" | "개월"
  periods: readonly [number, number, number] = MA_TREND_PERIODS,
): string {
  if (!t) {
    return `${title}\nMA${periods[2]} 산출에 필요한 봉이 모자랍니다`
         + `\n(${periods[2]}${unit} 이상 필요 — 상장 기간이 짧은 종목·신규 ETF)`;
  }
  const won = (v: number) => Math.round(v).toLocaleString("ko-KR");
  const lines = [
    `${title} — ${MA_TREND_LABEL[t.state]}`,
    `기준봉 ${t.lastDate} · 종가 ${won(t.close)}`,
    `MA${periods[0]} ${won(t.ma20)} / MA${periods[1]} ${won(t.ma60)} / MA${periods[2]} ${won(t.ma120)}`,
    `이격도  MA${periods[0]} 대비 ${t.disparity20.toFixed(1)}% · MA${periods[2]} 대비 ${t.disparity120.toFixed(1)}%`,
  ];
  if (t.slope120 != null) {
    const dir = t.slope120 > 0 ? "상승" : t.slope120 < 0 ? "하락" : "횡보";
    lines.push(`MA${periods[2]} 기울기  ${t.slope120 >= 0 ? "+" : ""}${t.slope120.toFixed(1)}% (${SLOPE_LOOKBACK}${unit} 전 대비, ${dir})`);
  }
  lines.push(t.crossAgo != null
    ? `${t.state === "bull" || t.state === "strongBull" ? "골든" : "데드"}크로스  ${t.crossAgo}${unit} 전 (MA${periods[0]}/MA${periods[1]})`
    : `MA${periods[0]}/MA${periods[1]} 교차  최근 ${t.bars - periods[1]}${unit} 내 없음`);
  return lines.join("\n");
}
