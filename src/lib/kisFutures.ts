// 국내 주식선물(삼성전자·SK하이닉스) — 한국투자 Open API(앱 전용, 본인 키). 무료 공개 출처엔 주식선물 시세가 없다
//   (토스·네이버·다음·한경 실측 2026-10-30, 사용자 "한국투자 연결했어" 2026-11-02).
//   종목 코드 = "A" + 기초자산 2자리 + 연도 끝자리 + 월(MM) — 한투 종목마스터 fo_stk_code_mts.mst 실측(삼성전자 A11611, SK하이닉스 A50611).
//   근월물 = 만기(그 달 둘째 목요일)가 오늘 이후인 가장 가까운 달. 시장 분류 JF(주식선물).
//   현재가 FHMIF10000000(inquire-price) · 분봉 FHKIF03020200(inquire-time-fuopchartprice), 공식 예제 examples_llm/domestic_futureoption.
import { kisGet, isKisLinkOn } from "./broker";
import type { DaySeries, MarkX } from "./api";

export const KIS_STOCK_FUT: Record<string, { under: string; name: string }> = {
  "SMSN-KF": { under: "11", name: "삼성전자 선물" },
  "SKHY-KF": { under: "50", name: "SK하이닉스 선물" },
};
export function isKisFutSymbol(sym: string): boolean { return sym in KIS_STOCK_FUT; }
export function kisFutAvailable(): boolean { return isKisLinkOn(); }

/** 그 달 둘째 목요일(만기일) — KST 날짜 YYYY-MM-DD */
function secondThursday(y: number, m: number): string {
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();          // 0=일
  const day = 1 + ((4 - first + 7) % 7) + 7;
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
/** 근월물 코드. 내보내는 건 테스트용 */
export function frontMonthCode(under: string, todayKst = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)): string {
  let y = Number(todayKst.slice(0, 4)), m = Number(todayKst.slice(5, 7));
  if (todayKst > secondThursday(y, m)) { m += 1; if (m > 12) { m = 1; y += 1; } }
  return `A${under}${y % 10}${String(m).padStart(2, "0")}`;
}

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };

export interface KisFutQuote { code: string; price: number; pct: number; base: number }
export async function fetchKisFutQuote(sym: string): Promise<KisFutQuote | null> {
  const def = KIS_STOCK_FUT[sym];
  if (!def) return null;
  const code = frontMonthCode(def.under);
  const { body } = await kisGet<{ rt_cd?: string; output1?: Record<string, string> }>(
    "/uapi/domestic-futureoption/v1/quotations/inquire-price", "FHMIF10000000",
    { FID_COND_MRKT_DIV_CODE: "JF", FID_INPUT_ISCD: code });
  const o = body.output1 ?? {};
  const price = num(o.futs_prpr), pct = num(o.futs_prdy_ctrt);
  if (!(price > 0)) return null;
  const base = num(o.futs_prdy_clpr) > 0 ? num(o.futs_prdy_clpr) : (Number.isFinite(pct) ? price / (1 + pct / 100) : price);
  return { code, price, pct: Number.isFinite(pct) ? pct : (price / base - 1) * 100, base };
}

/** 오늘 1분봉 — 축 08:45~15:45(주식선물 정규장), 세로선 09:00 시가·15:45 종가. 기준선 = 전일 종가(카드 % 기준) */
export async function fetchKisFutDay(sym: string): Promise<DaySeries | null> {
  const def = KIS_STOCK_FUT[sym];
  if (!def) return null;
  const code = frontMonthCode(def.under);
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10).replace(/-/g, "");
  const { body } = await kisGet<{ rt_cd?: string; output1?: Record<string, string>; output2?: Record<string, string>[] }>(
    "/uapi/domestic-futureoption/v1/quotations/inquire-time-fuopchartprice", "FHKIF03020200",
    { FID_COND_MRKT_DIV_CODE: "JF", FID_INPUT_ISCD: code, FID_HOUR_CLS_CODE: "60", FID_PW_DATA_INCU_YN: "N",
      FID_FAKE_TICK_INCU_YN: "N", FID_INPUT_DATE_1: today, FID_INPUT_HOUR_1: "160000" });
  const START = 8 * 60 + 45, SPAN = 7 * 60;
  const rows = (body.output2 ?? [])
    .map(r => ({ hm: String(r.stck_cntg_hour ?? ""), c: num(r.futs_prpr ?? r.stck_prpr) }))
    .filter(r => r.hm.length >= 4 && r.c > 0)
    .map(r => ({ f: (Number(r.hm.slice(0, 2)) * 60 + Number(r.hm.slice(2, 4)) - START) / SPAN, c: r.c }))
    .filter(r => r.f >= 0 && r.f <= 1)
    .sort((a, b) => a.f - b.f);
  if (rows.length < 2) return null;
  const prevClose = num(body.output1?.futs_prdy_clpr);
  const markXs: MarkX[] = [{ x: 15 / SPAN }, { x: 1, close: true }];
  return { closes: rows.map(r => r.c), xs: rows.map(r => r.f), markXs, ...(prevClose > 0 ? { base: prevClose } : {}) };
}
