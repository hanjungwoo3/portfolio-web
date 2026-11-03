// 서학개미(미국 주식에 투자하는 한국 개인) — 예탁결제원 세이브로 해외주식 결제·보관 상위 50(사용자 2026-11-03 "셋다").
//   크롤러(portfolio-etf-index/scripts/seohak.js)가 매일 06:00 KST 에 받아 둔다(0콜, 프록시 화이트리스트 변경 없음).
//   금액은 모두 달러. 결제는 미국 T+1 이라 하루 이틀 늦고, 보관은 직전 영업일까지 — 장중 지표가 아니라 '지난주 무엇을 샀나'.
import { useQuery } from "@tanstack/react-query";

const URL_SEOHAK = "https://raw.githubusercontent.com/hanjungwoo3/portfolio-etf-index/main/data/seohak.json";

export type LevKind = "bull" | "bear";
export interface SeohakMeta { ko?: string; logo?: string; fn?: string }
export interface SeohakRow extends SeohakMeta { isin: string; t?: string; n: string; buy: number; sell: number; net: number; lev?: LevKind }
export interface SeohakHold extends SeohakMeta { isin: string; t?: string; n: string; amt: number; rank: number; prevRank?: number; prevAmt?: number; lev?: LevKind }
export interface SeohakLevDay {
  date: string; buy: number; sell: number; bullBuy: number; bullSell: number; bearBuy: number; bearSell: number;
  top: { t: string; net: number; kind?: LevKind }[];
}
export interface SeohakFile {
  meta: { builtAt: string; setlDate: string; weekFrom: string; holdDate: string; holdPrevDate?: string };
  day: { net: SeohakRow[]; sell: SeohakRow[] };
  week: { net: SeohakRow[]; sell: SeohakRow[] };
  hold: SeohakHold[];
  lev: SeohakLevDay[];
}

async function loadSeohak(): Promise<SeohakFile> {
  const r = await fetch(URL_SEOHAK, { cache: "no-store" });
  if (!r.ok) throw new Error(`seohak HTTP ${r.status}`);
  return await r.json() as SeohakFile;
}

export function useSeohak(): SeohakFile | undefined {
  const { data } = useQuery({ queryKey: ["seohak"], queryFn: loadSeohak, staleTime: 6 * 3600_000, gcTime: 24 * 3600_000, retry: 1 });
  return data;
}

/** 순매도 상위 — 매도 금액 상위 50 중 순매도인 것만, 많이 판 순 */
export const netSellers = (rows: SeohakRow[]) => rows.filter(r => r.net < 0).sort((a, b) => a.net - b.net);

/** '20261102' → '11/2' */
export const mdOf = (d?: string) => d ? `${Number(d.slice(4, 6))}/${Number(d.slice(6, 8))}` : "";

/** 달러 금액 — 억$ 로 통일(작은 값은 소수 둘째 자리) */
export function fmtUsdKr(v: number, sign = false): string {
  const s = sign && v > 0 ? "+" : v < 0 ? "−" : "";
  const a = Math.abs(v) / 1e8;
  return `${s}${a.toFixed(a >= 100 ? 0 : a >= 1 ? 1 : 2)}억$`;
}

export interface SeohakInfo {
  hold?: SeohakHold;
  weekNet?: { row: SeohakRow; rank: number };    // 주간 순매수 상위
  weekSell?: { row: SeohakRow; rank: number };   // 주간 순매도 상위
  dayNet?: { row: SeohakRow; rank: number };
}
/** 미국 티커 → 서학개미 순위들. 어디에도 없으면 undefined */
export function seohakOf(f: SeohakFile | undefined, symbol: string | null | undefined): SeohakInfo | undefined {
  if (!f || !symbol) return undefined;
  const sym = symbol.toUpperCase().replace(/-/g, ".");
  const find = (rows: SeohakRow[]) => { const i = rows.findIndex(r => r.t === sym); return i < 0 ? undefined : { row: rows[i], rank: i + 1 }; };
  const info: SeohakInfo = {
    hold: f.hold.find(r => r.t === sym),
    weekNet: find(f.week.net.filter(r => r.net > 0)),
    weekSell: find(netSellers(f.week.sell)),
    dayNet: find(f.day.net.filter(r => r.net > 0)),
  };
  return info.hold || info.weekNet || info.weekSell ? info : undefined;
}

/** 레버리지 쏠림 — 그날 매수+매도 상위 50 의 매수 금액 중 레버리지(상승 쪽)·인버스 비중 */
export const bullShare = (d: SeohakLevDay) => d.buy > 0 ? d.bullBuy / d.buy : 0;
export const bearShare = (d: SeohakLevDay) => d.buy > 0 ? d.bearBuy / d.buy : 0;
