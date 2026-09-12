// 차트·그리기 공용 타입 — 사양서 §6/§7 기준.
//
// 원칙: **저장 원본은 시간과 가격**이다. 픽셀도, 배열 인덱스도 저장하지 않는다.
//   과거 데이터가 앞에 덧붙어도 앵커가 가리키는 봉이 바뀌면 안 되기 때문이다.

export type Interval =
  | "1m" | "3m" | "5m" | "10m" | "30m" | "45m" | "60m"
  | "1d" | "1w" | "1mo" | "1y";

export const INTRADAY_INTERVALS: Interval[] = ["1m", "3m", "5m", "10m", "30m", "45m", "60m"];
export const LONG_INTERVALS: Interval[] = ["1d", "1w", "1mo", "1y"];

export const INTERVAL_LABEL: Record<Interval, string> = {
  "1m": "1분", "3m": "3분", "5m": "5분", "10m": "10분",
  "30m": "30분", "45m": "45분", "60m": "60분",
  "1d": "일봉", "1w": "주봉", "1mo": "월봉", "1y": "년봉",
};

// 일봉 이상은 날짜(YYYY-MM-DD), 분봉은 UTC 초.
//   일봉을 UTC 초로 저장하면 시간대 변환에서 하루 밀린다 — 그래서 종류를 나눈다.
export type BarTime =
  | { kind: "date"; value: string }
  | { kind: "unix"; value: number };

export interface Anchor { time: BarTime; price: number }
export interface Style { color: string; width: number; line: "solid" | "dashed" }

export type DrawingKind = "trend" | "horizontal" | "price" | "fibonacci";

export type Drawing = {
  id: string;
  schemaVersion: 1;
  symbol: string;
  interval: Interval;
  style: Style;
} & (
  | { type: "trend"; a: Anchor; b: Anchor }
  | { type: "horizontal"; price: number }
  | { type: "price"; price: number }
  | { type: "fibonacci"; a: Anchor; b: Anchor; levels: number[] }
);

export interface Candle {
  time: BarTime;
  open: number; high: number; low: number; close: number;
  volume: number;
}

export type DataMode = "mock" | "delayed" | "live";

export interface Instrument {
  symbol: string;
  name: string;
  currency: "KRW";
  timezone: "Asia/Seoul";
  priceDecimals: number;
}

export interface CandleResponse {
  candles: Candle[];
  hasMore: boolean;
  asOf: string;
  mode: DataMode;
  supportedIntervals: Interval[];
  instrument: Instrument;
}

export interface MarketDataProvider {
  getCandles(input: {
    symbol: string;
    interval: Interval;
    before?: BarTime;
    limit: number;
    signal?: AbortSignal;
  }): Promise<CandleResponse>;
}

// 사양서 §5.5 권장 기본 비율.
export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

// 사양서 §3 권장 디자인 값.
export const DRAW_COLOR: Record<DrawingKind, string> = {
  trend: "#D9A441",
  horizontal: "#D9A441",
  price: "#6A9B66",
  fibonacci: "#8B6BCB",
};

export function defaultStyle(kind: DrawingKind): Style {
  return { color: DRAW_COLOR[kind], width: 2, line: kind === "price" ? "dashed" : "solid" };
}

export const barTimeKey = (t: BarTime): string =>
  t.kind === "date" ? `d:${t.value}` : `u:${t.value}`;

export const barTimeEquals = (a: BarTime, b: BarTime): boolean =>
  a.kind === b.kind && a.value === b.value;

// 정렬·비교용 숫자. 날짜는 KST 정오로 환산해 시간대 경계에서 흔들리지 않게 한다.
export function barTimeToSortable(t: BarTime): number {
  if (t.kind === "unix") return t.value;
  const [y, m, d] = t.value.split("-").map(Number);
  return Date.UTC(y, (m ?? 1) - 1, d ?? 1, 3, 0, 0) / 1000;   // 12:00 KST = 03:00 UTC
}
