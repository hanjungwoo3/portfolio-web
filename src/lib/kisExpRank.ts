// 동시호가 예상체결 상승·하락 상위 — 한국투자 Open API(앱 전용, 사용자 2026-11-02 "지수 탭에 별도로").
//   FHPST01820000 /uapi/domestic-stock/v1/ranking/exp-trans-updown (공식 예제 examples_llm/domestic_stock/exp_trans_updown).
//   장 시작 전(08:30~09:00) = FID_MKOP_CLS_CODE 0, 장 마감 전(15:20~15:30) = 1. 정렬 0 상승률 / 3 하락률.
//   응답 필드 이름은 예제 COLUMN_MAPPING — stck_prpr 가 동시호가 중엔 예상 체결가, antc_tr_pbmn 이 예상 거래대금(원).
import { kisGet, isKisLinkOn } from "./broker";

export interface ExpRankRow { code: string; name: string; price: number; pct: number; diff: number; vol: number; amt: number }
export type ExpPhase = "open" | "close";

/** 지금이 동시호가(예상체결) 구간인가 — 평일 KST 08:25~09:03(장전), 15:15~15:33(장마감). 앞뒤 몇 분 여유 */
export function expPhaseNow(now = new Date()): ExpPhase | null {
  const k = new Date(now.getTime() + 9 * 3600_000);
  const dow = k.getUTCDay();
  if (dow === 0 || dow === 6) return null;
  const m = k.getUTCHours() * 60 + k.getUTCMinutes();
  if (m >= 8 * 60 + 25 && m < 9 * 60 + 3) return "open";
  if (m >= 15 * 60 + 15 && m < 15 * 60 + 33) return "close";
  return null;
}
export function expRankAvailable(): boolean { return isKisLinkOn(); }

const num = (v: unknown) => { const n = Number(String(v ?? "").replace(/,/g, "")); return Number.isFinite(n) ? n : 0; };

export async function fetchKisExpRank(dir: "up" | "down", phase: ExpPhase, market: "0000" | "0001" | "1001" = "0000"): Promise<ExpRankRow[]> {
  const { body } = await kisGet<{ rt_cd?: string; output?: Record<string, string>[] }>(
    "/uapi/domestic-stock/v1/ranking/exp-trans-updown", "FHPST01820000",
    { FID_RANK_SORT_CLS_CODE: dir === "up" ? "0" : "3", FID_COND_MRKT_DIV_CODE: "J", FID_COND_SCR_DIV_CODE: "20182",
      FID_INPUT_ISCD: market, FID_DIV_CLS_CODE: "1", FID_APLY_RANG_PRC_1: "", FID_VOL_CNT: "", FID_PBMN: "",
      FID_BLNG_CLS_CODE: "0", FID_MKOP_CLS_CODE: phase === "open" ? "0" : "1" });
  const sign = (r: Record<string, string>) => (r.prdy_vrss_sign === "4" || r.prdy_vrss_sign === "5" ? -1 : 1);
  return (body.output ?? []).flatMap(r => {
    const code = (r.stck_shrn_iscd ?? "").trim(), price = num(r.stck_prpr);
    if (!/^[\dA-Za-z]{6}$/.test(code) || !(price > 0)) return [];
    // 등락률·대비는 부호가 따로 오는 API 가 있다 — 값에 부호가 없으면 부호 코드(4·5 = 하락)로
    const pctRaw = num(r.prdy_ctrt), diffRaw = num(r.prdy_vrss);
    return [{ code, name: (r.hts_kor_isnm ?? "").trim(), price,
      pct: pctRaw < 0 ? pctRaw : pctRaw * sign(r), diff: diffRaw < 0 ? diffRaw : diffRaw * sign(r),
      vol: num(r.cntg_vol), amt: num(r.antc_tr_pbmn) }];
  });
}
