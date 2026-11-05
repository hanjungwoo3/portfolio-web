// 종목 신용잔고 일별 — 개인이 빚내서 사는 정도(사용자 2026-11-05 "개인이 신용으로 사는지 확인 가능?" → "다 넣자").
//   출처: 한국투자 국내주식 신용잔고 일별추이 FHPST04760000 — 실전 키 실측 2026-11-05(삼성전자).
//   ★ 실시간 아님 — 결제 뒤 집계라 2거래일쯤 늦다(11/05 조회 → 최신 11/02 거래분). 앱 + 한국투자 연동일 때만.
//   금액은 천원 단위로 온다(잔고 409,808,380 = 4,098억, 잔고 주식 수 × 주가로 확인).
import { kisGet } from "./broker";

export interface CreditDay {
  date: string;      // 거래일 "YYYYMMDD"
  gvrt: number;      // 신용 비중(공여율, %) — 그날 거래량 중 신용 매수 몫
  newAmt: number;    // 그날 새로 신용으로 산 금액(원)
  rdmpAmt: number;   // 그날 갚은 금액(원)
  rmndAmt: number;   // 남은 신용 잔고(원)
  rmndRate: number;  // 잔고율(상장 주식 중 %)
}
interface Row { deal_date?: string; whol_loan_gvrt?: string; whol_loan_new_amt?: string; whol_loan_rdmp_amt?: string; whol_loan_rmnd_amt?: string; whol_loan_rmnd_rate?: string }

export async function fetchKisCredit(code: string): Promise<CreditDay[]> {
  const kst = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10).replace(/-/g, "");
  const { body } = await kisGet<{ rt_cd?: string; output?: Row[] }>("/uapi/domestic-stock/v1/quotations/daily-credit-balance", "FHPST04760000", {
    fid_cond_mrkt_div_code: "J", fid_cond_scr_div_code: "20476", fid_input_iscd: code, fid_input_date_1: kst,
  });
  return (body.output ?? []).filter(r => r.deal_date).map(r => ({
    date: r.deal_date!, gvrt: Number(r.whol_loan_gvrt) || 0,
    newAmt: (Number(r.whol_loan_new_amt) || 0) * 1000, rdmpAmt: (Number(r.whol_loan_rdmp_amt) || 0) * 1000,
    rmndAmt: (Number(r.whol_loan_rmnd_amt) || 0) * 1000, rmndRate: Number(r.whol_loan_rmnd_rate) || 0,
  }));   // 최신이 앞
}
