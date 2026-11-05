// 기관 순매수·순매도 순위(오늘 잠정) — 한국투자 국내기관_외국인 매매종목가집계 FHPTJ04400000(실전 키 실측 2026-11-05).
//   네이버 기관 순위는 하루~이틀 늦다(11/05 19시에도 11/03 값 — 실측). 앱 + 한국투자 연동이면 이 값으로 바꾼다(사용자 2026-11-05 "바꿔줘").
//   ★ 증권사들이 장중 모은 잠정치(가집계) — 다음 날 확정치와 조금 다를 수 있다. 시장·방향마다 30종목까지.
//   금액은 백만원 단위(orgn_ntby_tr_pbmn −90,170 = −902억, SK하이닉스).
import { kisGet } from "./broker";
import type { InvestorFlowRow } from "./api";

interface Row { mksc_shrn_iscd?: string; hts_kor_isnm?: string; stck_prpr?: string; prdy_ctrt?: string; orgn_ntby_tr_pbmn?: string }

async function side(market: "KOSPI" | "KOSDAQ", sell: boolean): Promise<InvestorFlowRow[]> {
  const { body } = await kisGet<{ rt_cd?: string; output?: Row[] }>("/uapi/domestic-stock/v1/quotations/foreign-institution-total", "FHPTJ04400000", {
    FID_COND_MRKT_DIV_CODE: "V", FID_COND_SCR_DIV_CODE: "16449", FID_INPUT_ISCD: market === "KOSPI" ? "0001" : "1001",
    FID_DIV_CLS_CODE: "1",              // 금액 기준
    FID_RANK_SORT_CLS_CODE: sell ? "1" : "0",   // 0 순매수 · 1 순매도
    FID_ETC_CLS_CODE: "2",              // 기관계
  });
  return (body.output ?? []).flatMap(r => {
    const ticker = r.mksc_shrn_iscd ?? "", amt = Number(r.orgn_ntby_tr_pbmn) * 1e6;
    if (!/^[\dA-Za-z]{6}$/.test(ticker) || !Number.isFinite(amt) || amt === 0 || (sell ? amt > 0 : amt < 0)) return [];
    return [{ ticker, name: r.hts_kor_isnm ?? ticker, amount: amt, close: Number(r.stck_prpr) || 0, pct: Number(r.prdy_ctrt) || 0 }];
  }).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}

/** 오늘 기관 잠정 순위 — 순매수·순매도 */
export async function fetchKisOrgRanking(market: "KOSPI" | "KOSDAQ"): Promise<{ buy: InvestorFlowRow[]; sell: InvestorFlowRow[] }> {
  const buy = await side(market, false);
  const sell = await side(market, true);
  return { buy, sell };
}
