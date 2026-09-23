// 미국 종목·ETF 기간 수익률 랭킹 — TradingView scanner 한 콜.
//
// 한국 ETF 랭킹(etfRanking.ts)과 대비:
//   한국은 전 종목 시세를 6콜로 받아 '오늘' 만 실시간이고, 기간 수익률은 크롤러가 하루 한 번
//   계산해 둔 값(1주·1개월·3개월)을 읽는다 — 과거 일봉이 종목당 1콜이라 프론트에서 못 한다.
//   미국은 scanner 가 change/Perf.W/1M/3M/6M/Y 를 **전부 컬럼으로** 준다. 그래서 1콜이면 되고
//   1년 수익률까지 실시간에 가깝게 볼 수 있다(한국은 크롤러에 1년이 없어 아직 못 준다).
//
// scanner 는 CORS 를 허용하지만 우리 프록시를 거친다 — 워커 화이트리스트에 이미 있다(히트맵과 동일).

import { fetchProxied } from "./api";

export type UsPeriod = "today" | "w1" | "m1" | "m3" | "m6" | "y1";

export const US_PERIOD_LABEL: Record<UsPeriod, string> = {
  today: "오늘", w1: "1주", m1: "1개월", m3: "3개월", m6: "6개월", y1: "1년",
};

// 기간 → scanner 컬럼. 'today' 만 change(당일 등락률), 나머지는 Perf.*.
const PERIOD_COL: Record<UsPeriod, string> = {
  today: "change", w1: "Perf.W", m1: "Perf.1M", m3: "Perf.3M", m6: "Perf.6M", y1: "Perf.Y",
};

export type UsKind = "stock" | "fund" | "dr" | "other";

export interface UsRankRow {
  ticker: string;
  name: string;          // 영문 정식명 (description)
  price: number;
  pct: number;           // 선택한 기간 수익률(%)
  kind: UsKind;
  valueTraded: number;   // 당일 거래대금($) — 유동성 거르기용
  leveraged: boolean;
}

export interface UsRanking {
  rows: UsRankRow[];
  fetchedAt: number;
  total: number;         // 필터를 통과한 전체 종목 수
  period: UsPeriod;
  side: "top" | "bottom";
}

// 레버리지·인버스 판별 — 미국은 이름에 배수가 박혀 있다.
//   "Direxion Daily MU Bull 2X" / "GraniteShares 2x Long MU" / "ProShares UltraShort" /
//   "-1x Short" / "Leveraged". 이걸 안 빼면 1년 상위가 전부 2배 상품이 된다(실측).
const LEVERAGE_RE =
  /(\b[123](\.\d)?\s*x\b|\bx[123]\b|\bbull\b|\bbear\b|\bultra(short|pro)?\b|\bleveraged?\b|\binverse\b|\bshort\b)/i;

export function isUsLeveraged(name: string): boolean {
  return LEVERAGE_RE.test(name || "");
}

function kindOf(t: unknown): UsKind {
  return t === "stock" || t === "fund" || t === "dr" ? t : "other";
}

/**
 * @param minValueTraded 당일 거래대금 하한($). 낮추면 껍데기 종목이 상위를 덮는다.
 */
export async function fetchUsRanking(
  period: UsPeriod, side: "top" | "bottom" = "top",
  limit = 60, minValueTraded = 3_000_000,
): Promise<UsRanking> {
  const col = PERIOD_COL[period];
  const body = {
    filter: [
      { left: col, operation: "nempty" },
      { left: "Value.Traded", operation: "egreater", right: minValueTraded },
    ],
    columns: ["name", "description", "close", col, "type", "Value.Traded"],
    sort: { sortBy: col, sortOrder: side === "top" ? "desc" : "asc" },
    range: [0, limit],
  };
  const resp = await fetchProxied("https://scanner.tradingview.com/america/scan", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const text = await resp.text();
  let j: { error?: string; totalCount?: number; data?: { d: unknown[] }[] };
  try { j = JSON.parse(text); } catch { throw new Error("미국 랭킹 응답 파싱 실패"); }
  if (typeof j.error === "string") throw new Error(j.error);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const rows: UsRankRow[] = (j.data ?? []).map(r => {
    const [name, desc, close, pct, type, val] = r.d;
    const label = str(desc) || str(name);
    return {
      ticker: str(name), name: label, price: num(close), pct: num(pct),
      kind: kindOf(type), valueTraded: num(val), leveraged: isUsLeveraged(label),
    };
  }).filter(x => x.ticker);
  return { rows, fetchedAt: Date.now(), total: j.totalCount ?? rows.length, period, side };
}
