// 한국투자증권(KIS Developers) → 연동 그룹 보유·예수금·거래(토스 연동과 같은 틀, 2026-10-26).
//   데스크톱 앱에서만(kisGet → 네이티브 broker_fetch). 규칙은 토스와 같다: 가져온 행(source="kis")만 교체·잠금, 손으로 넣은 행은 그대로,
//   예수금 = 주문가능현금. 휴대폰은 Drive 동기화로 결과만 받는다.
//   공식 예제(examples_llm): 국내 잔고 inquire-balance TTTC8434R(output1 보유, output2 예수금), 매수가능 inquire-psbl-order TTTC8908R,
//   해외 체결기준잔고 inquire-present-balance CTRP6504R(통화·기준환율 포함), 국내 일별체결 inquire-daily-ccld TTTC0081R(3개월 이내)/CTSC9215R(이전),
//   해외 체결 inquire-ccnl TTTS3035R. 이어받기 = 응답 헤더 tr_cont F/M → 요청 tr_cont "N" + ctx_area_fk/nk.
//   ⚠️ 실제 응답으로 미검증(키 없음) — 필드 이름은 공식 예제의 COLUMN_MAPPING 기준. 이상하면 설정의 진단 패널로 raw 를 본다.
import { useEffect } from "react";
import { kisGet, getKisAccount, isKisLinkOn, isBrokerAvailable, getKisEnabled } from "./broker";
import { linkedGroupOf, setLinkedGroup, type LinkedGroupMeta } from "./linkedGroups";
import { replaceSyncedHoldingsOfGroup, loadHoldings, loadAllTrades, upsertTrades, type Trade } from "./db";
import { setDeposit } from "./deposits";
import { fetchYahooPriceHistory } from "./api";
import { getTickerNames, rememberTickerNames } from "./tickerNames";
import type { Stock } from "../types";

export const KIS_SOURCE = "kis";
export const KIS_TRADE_ID_PREFIX = "kisapi_";

const num = (s: string | number | null | undefined) => { const v = Number(String(s ?? "").replace(/,/g, "")); return Number.isFinite(v) ? v : 0; };
const todayKst = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const ymd8 = (d: string) => d.replace(/-/g, "");
const dash = (d8: string) => `${d8.slice(0, 4)}-${d8.slice(4, 6)}-${d8.slice(6, 8)}`;
const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

// ── 응답 모양(공식 예제 COLUMN_MAPPING) ──
interface KisEnv { rt_cd?: string; msg_cd?: string; msg1?: string; ctx_area_fk100?: string; ctx_area_nk100?: string; ctx_area_fk200?: string; ctx_area_nk200?: string }
export interface KisDomesticHolding { pdno: string; prdt_name: string; hldg_qty: string; pchs_avg_pric: string; pchs_amt?: string; prpr?: string }
interface KisBalanceRes extends KisEnv { output1?: KisDomesticHolding[]; output2?: Array<{ dnca_tot_amt?: string; prvs_rcdl_excc_amt?: string; tot_evlu_amt?: string }> }
interface KisPsblRes extends KisEnv { output?: { ord_psbl_cash?: string } }
export interface KisOverseasHolding { pdno: string; prdt_name?: string; cblc_qty13: string; avg_unpr3: string; buy_crcy_cd: string; bass_exrt?: string; ovrs_excg_cd?: string; natn_kor_name?: string }
interface KisPresentRes extends KisEnv { output1?: KisOverseasHolding[] }
export interface KisDomesticCcld { ord_dt: string; odno: string; pdno: string; prdt_name: string; sll_buy_dvsn_cd: string; tot_ccld_qty: string; tot_ccld_amt: string; avg_prvs?: string; cncl_yn?: string }
interface KisDailyCcldRes extends KisEnv { output1?: KisDomesticCcld[] }
export interface KisOverseasCcld { ord_dt: string; odno: string; pdno: string; prdt_name?: string; sll_buy_dvsn_cd: string; ft_ccld_qty: string; ft_ccld_unpr3?: string; ft_ccld_amt3: string; tr_crcy_cd: string; ovrs_excg_cd?: string; prcs_stat_name?: string }
interface KisOverseasCcldRes extends KisEnv { output?: KisOverseasCcld[] }

function acct(): { CANO: string; ACNT_PRDT_CD: string } {
  const a = getKisAccount();
  if (!/^\d{8}$/.test(a.cano)) throw new Error("종합계좌번호(8자리)를 설정에서 넣어 주세요");
  return { CANO: a.cano, ACNT_PRDT_CD: a.prdt };
}

// ── 순수 변환(테스트) ──
/** 국내 보유 → 행. 코드는 6자리(앞 A 제거), 수량 0 은 뺀다 */
export function mapKisDomesticHoldings(items: KisDomesticHolding[], group: string, prev: Map<string, Stock>, today: string): Stock[] {
  const rows: Stock[] = [];
  for (const it of items) {
    const ticker = (it.pdno ?? "").trim().replace(/^A/, "");
    const qty = num(it.hldg_qty);
    if (!ticker || !(qty > 0)) continue;
    const p = prev.get(ticker);
    const avg = Math.round(num(it.pchs_avg_pric));
    const buy_date = !p || qty > (p.shares ?? 0) ? today : (p.buy_date ?? "");
    rows.push({ ticker, name: it.prdt_name?.trim() || p?.name || ticker, shares: qty, avg_price: avg, invested: Math.round(qty * avg),
      buy_date, market: p?.market ?? "", account: group, source: KIS_SOURCE });
  }
  return rows;
}
/** 해외 보유 → 행. 평단은 외화 → 기준환율(bass_exrt)로 원화, 같은 외화 평단·수량이면 기억값 유지(토스와 같은 규칙) */
export function mapKisOverseasHoldings(items: KisOverseasHolding[], group: string, prev: Map<string, Stock>, today: string,
                                       usdAvg: NonNullable<LinkedGroupMeta["usdAvg"]>, fxFallback?: number): Stock[] {
  const rows: Stock[] = [];
  for (const it of items) {
    const ticker = (it.pdno ?? "").trim();
    const qty = num(it.cblc_qty13);
    if (!ticker || !(qty > 0)) continue;
    const p = prev.get(ticker);
    const usd = num(it.avg_unpr3);
    const remembered = usdAvg[ticker];
    let avg: number;
    if (remembered && remembered.usd === usd && remembered.qty === qty) avg = remembered.krw;
    else {
      const rate = num(it.bass_exrt) || fxFallback || (remembered && remembered.usd > 0 ? remembered.krw / remembered.usd : 0);
      if (!rate) continue;
      avg = Math.round(usd * rate);
      usdAvg[ticker] = { usd, qty, krw: avg };
    }
    const buy_date = !p || qty > (p.shares ?? 0) ? today : (p.buy_date ?? "");
    rows.push({ ticker, name: it.prdt_name?.trim() || p?.name || ticker, shares: qty, avg_price: avg, invested: Math.round(qty * avg),
      buy_date, market: (it.buy_crcy_cd ?? "USD") === "USD" ? "US" : (p?.market ?? ""), account: group, source: KIS_SOURCE });
  }
  return rows;
}
export interface KisTradeRow { id: string; ticker: string; name: string; date: string; type: "buy" | "sell"; qty: number; amount: number; currency: string; nativeAmount: number; fx?: number }
/** 국내 일별 체결 → 거래(체결 수량 0·취소 제외). 02 매수 / 01 매도. id = kisapi_<주문일>_<주문번호> */
export function mapKisDomesticCcld(rows: KisDomesticCcld[]): KisTradeRow[] {
  const out: KisTradeRow[] = [];
  for (const r of rows) {
    const qty = num(r.tot_ccld_qty);
    if (!(qty > 0) || !r.odno || !/^\d{8}$/.test(r.ord_dt ?? "")) continue;
    const type = r.sll_buy_dvsn_cd === "02" ? "buy" : r.sll_buy_dvsn_cd === "01" ? "sell" : null;
    if (!type) continue;
    const amount = Math.round(num(r.tot_ccld_amt) || num(r.avg_prvs) * qty);
    const ticker = (r.pdno ?? "").trim().replace(/^A/, "");
    out.push({ id: `${KIS_TRADE_ID_PREFIX}${r.ord_dt}_${r.odno}`, ticker, name: r.prdt_name?.trim() || ticker, date: dash(r.ord_dt), type, qty, amount, currency: "KRW", nativeAmount: amount });
  }
  return out;
}
/** 해외 체결 → 거래. 금액은 외화 × 체결일 환율(fxOf). 환율 없으면 건너뛴다 */
export function mapKisOverseasCcld(rows: KisOverseasCcld[], fxOf: (date: string) => number | undefined): { rows: KisTradeRow[]; noFx: number } {
  const out: KisTradeRow[] = []; let noFx = 0;
  for (const r of rows) {
    const qty = num(r.ft_ccld_qty);
    if (!(qty > 0) || !r.odno || !/^\d{8}$/.test(r.ord_dt ?? "")) continue;
    const type = r.sll_buy_dvsn_cd === "02" ? "buy" : r.sll_buy_dvsn_cd === "01" ? "sell" : null;
    if (!type) continue;
    const date = dash(r.ord_dt);
    const native = num(r.ft_ccld_amt3) || num(r.ft_ccld_unpr3) * qty;
    const cur = (r.tr_crcy_cd || "USD").trim();
    const fx = cur === "KRW" ? 1 : fxOf(date);
    if (!fx) { noFx++; continue; }
    const ticker = (r.pdno ?? "").trim();
    out.push({ id: `${KIS_TRADE_ID_PREFIX}${r.ord_dt}_${r.odno}`, ticker, name: r.prdt_name?.trim() || ticker, date, type, qty, amount: Math.round(native * fx), currency: cur, nativeAmount: native, fx });
  }
  return { rows: out, noFx };
}

// ── 호출 ──
async function pagedDomesticBalance(): Promise<{ items: KisDomesticHolding[]; summary: NonNullable<KisBalanceRes["output2"]>[number] | undefined }> {
  const a = acct();
  const items: KisDomesticHolding[] = []; let summary: NonNullable<KisBalanceRes["output2"]>[number] | undefined;
  let fk = "", nk = "", cont = "";
  for (let i = 0; i < 20; i++) {
    const { body, trCont } = await kisGet<KisBalanceRes>("/uapi/domestic-stock/v1/trading/inquire-balance", "TTTC8434R",
      { ...a, AFHR_FLPR_YN: "N", OFL_YN: "", INQR_DVSN: "02", UNPR_DVSN: "01", FUND_STTL_ICLD_YN: "N", FNCG_AMT_AUTO_RDPT_YN: "N", PRCS_DVSN: "00", CTX_AREA_FK100: fk, CTX_AREA_NK100: nk }, cont);
    items.push(...(body.output1 ?? []));
    summary = body.output2?.[0] ?? summary;
    if (trCont !== "F" && trCont !== "M") break;
    fk = body.ctx_area_fk100 ?? ""; nk = body.ctx_area_nk100 ?? ""; cont = "N";
  }
  return { items, summary };
}
async function overseasPresentBalance(): Promise<KisOverseasHolding[]> {
  const a = acct();
  const { body } = await kisGet<KisPresentRes>("/uapi/overseas-stock/v1/trading/inquire-present-balance", "CTRP6504R",
    { ...a, WCRC_FRCR_DVSN_CD: "02", NATN_CD: "000", TR_MKET_CD: "00", INQR_DVSN_CD: "00" });
  return body.output1 ?? [];
}
async function orderableCash(): Promise<number | null> {
  const a = acct();
  try {
    const { body } = await kisGet<KisPsblRes>("/uapi/domestic-stock/v1/trading/inquire-psbl-order", "TTTC8908R",
      { ...a, PDNO: "005930", ORD_UNPR: "0", ORD_DVSN: "01", CMA_EVLU_AMT_ICLD_YN: "N", OVRS_ICLD_YN: "N" });
    return Math.max(0, Math.round(num(body.output?.ord_psbl_cash)));
  } catch { return null; }
}

export interface KisSyncResult { group: string; count: number; cash: number; at: string; trades?: number }

/** 보유·예수금을 한국투자 값으로 갱신. 연동 그룹이 없거나 꺼져 있으면 null. 실패는 던진다 */
export async function syncKisHoldings(): Promise<KisSyncResult | null> {
  if (!isKisLinkOn()) return null;
  const link = linkedGroupOf("kis");
  if (!link) return null;
  const { group, meta } = link;
  const today = todayKst();
  const prev = new Map((await loadHoldings()).filter(s => (s.account ?? "") === group).map(s => [s.ticker, s]));
  const usdAvg: NonNullable<LinkedGroupMeta["usdAvg"]> = { ...(meta.usdAvg ?? {}) };

  const { items, summary } = await pagedDomesticBalance();
  const rows = mapKisDomesticHoldings(items, group, prev, today);
  // 해외 — 계좌에 해외 상품이 없으면 오류가 날 수 있어 실패해도 국내만으로 간다
  let overseas: KisOverseasHolding[] = [];
  try { overseas = await overseasPresentBalance(); } catch (e) { console.warn("[kis] 해외 잔고 실패:", e); }
  rows.push(...mapKisOverseasHoldings(overseas, group, prev, today, usdAvg));
  const keep = new Set(rows.map(r => r.ticker));
  for (const k of Object.keys(usdAvg)) if (!keep.has(k)) delete usdAvg[k];
  const count = await replaceSyncedHoldingsOfGroup(group, rows, KIS_SOURCE);

  // 예수금 = 주문가능현금(없으면 예수금총금액)
  const cash = (await orderableCash()) ?? Math.max(0, Math.round(num(summary?.dnca_tot_amt)));
  setDeposit(group, cash);

  const at = new Date().toISOString();
  setLinkedGroup(group, { ...meta, lastSyncAt: at, lastError: undefined, usdAvg });
  let trades = 0;
  try { trades = await syncKisTradesIncremental(); } catch (e) { console.warn("[kis] 거래 증분 실패:", e); }
  return { group, count, cash, at, trades };
}
export async function syncKisHoldingsSafe(): Promise<KisSyncResult | null> {
  try { return await syncKisHoldings(); }
  catch (e) {
    const link = linkedGroupOf("kis");
    if (link) setLinkedGroup(link.group, { ...link.meta, lastError: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

// ── 거래 이력 ──
async function fxTable(from: string): Promise<(date: string) => number | undefined> {
  const days = Math.max(1, (Date.parse(todayKst()) - Date.parse(from)) / 86400_000);
  const range = days <= 360 ? "1y" : days <= 720 ? "2y" : days <= 1800 ? "5y" : "max";
  const pts = (await fetchYahooPriceHistory("KRW=X", range)).filter(p => p.close > 0).sort((a, b) => a.date.localeCompare(b.date));
  return (date: string) => { let best: number | undefined; for (const p of pts) { if (p.date <= date) best = p.close; else break; } return best; };
}
async function pagedDomesticCcld(from: string, to: string, before: boolean): Promise<KisDomesticCcld[]> {
  const a = acct(); const out: KisDomesticCcld[] = [];
  let fk = "", nk = "", cont = "";
  for (let i = 0; i < 60; i++) {
    const { body, trCont } = await kisGet<KisDailyCcldRes>("/uapi/domestic-stock/v1/trading/inquire-daily-ccld", before ? "CTSC9215R" : "TTTC0081R",
      { ...a, INQR_STRT_DT: ymd8(from), INQR_END_DT: ymd8(to), SLL_BUY_DVSN_CD: "00", INQR_DVSN: "00", PDNO: "", CCLD_DVSN: "01", ORD_GNO_BRNO: "", ODNO: "", INQR_DVSN_3: "00", INQR_DVSN_1: "", CTX_AREA_FK100: fk, CTX_AREA_NK100: nk }, cont);
    out.push(...(body.output1 ?? []));
    if (trCont !== "F" && trCont !== "M") break;
    fk = body.ctx_area_fk100 ?? ""; nk = body.ctx_area_nk100 ?? ""; cont = "N";
  }
  return out;
}
async function pagedOverseasCcld(from: string, to: string): Promise<KisOverseasCcld[]> {
  const a = acct(); const out: KisOverseasCcld[] = [];
  for (const excg of ["NASD", "NYSE", "AMEX"]) {
    let fk = "", nk = "", cont = "";
    for (let i = 0; i < 30; i++) {
      let res: { body: KisOverseasCcldRes; trCont: string };
      try {
        res = await kisGet<KisOverseasCcldRes>("/uapi/overseas-stock/v1/trading/inquire-ccnl", "TTTS3035R",
          { ...a, PDNO: "%", ORD_STRT_DT: ymd8(from), ORD_END_DT: ymd8(to), SLL_BUY_DVSN: "00", CCLD_NCCS_DVSN: "01", OVRS_EXCG_CD: excg, SORT_SQN: "DS", ORD_DT: "", ORD_GNO_BRNO: "", ODNO: "", CTX_AREA_NK200: nk, CTX_AREA_FK200: fk }, cont);
      } catch (e) { console.warn(`[kis] 해외 체결(${excg}) 실패:`, e); break; }
      out.push(...(res.body.output ?? []));
      if (res.trCont !== "F" && res.trCont !== "M") break;
      fk = res.body.ctx_area_fk200 ?? ""; nk = res.body.ctx_area_nk200 ?? ""; cont = "N";
    }
  }
  return out;
}
export interface KisTradesFetch { rows: KisTradeRow[]; existingIds: Set<string>; noFx: number; group: string }
/** from~to 체결 거래 후보(저장 안 함). from 생략 = 2010-01-01 부터(전체) */
export async function fetchKisTrades(from?: string, to?: string, onProgress?: (n: number) => void): Promise<KisTradesFetch> {
  const link = linkedGroupOf("kis");
  if (!link) throw new Error("한국투자 연동 그룹이 없습니다 — 설정 → 증권사 연결에서 '연동 시작'을 먼저 해 주세요");
  const end = to ?? todayKst();
  const start = from ?? "2010-01-01";
  const threeMoAgo = addDays(end, -90);
  const dom: KisDomesticCcld[] = [];
  // 3개월 이내(TTTC0081R)·이전(CTSC9215R)은 tr_id 가 달라 구간을 나눠 받는다
  if (start < threeMoAgo) dom.push(...await pagedDomesticCcld(start, addDays(threeMoAgo, -1), true));
  dom.push(...await pagedDomesticCcld(start > threeMoAgo ? start : threeMoAgo, end, false));
  onProgress?.(dom.length);
  const rows = mapKisDomesticCcld(dom);
  let noFx = 0;
  const ovs = await pagedOverseasCcld(start, end);
  if (ovs.length) {
    const fxOf = await fxTable(start).catch(() => (() => undefined));
    const m = mapKisOverseasCcld(ovs, fxOf); rows.push(...m.rows); noFx = m.noFx;
  }
  onProgress?.(dom.length + ovs.length);
  const names = getTickerNames();
  for (const r of rows) if (!r.name || r.name === r.ticker) r.name = names[r.ticker] ?? r.ticker;
  const existing = await loadAllTrades();
  const existingIds = new Set(existing.filter((t: Trade) => t.id.startsWith(KIS_TRADE_ID_PREFIX)).map(t => t.id));
  return { rows, existingIds, noFx, group: link.group };
}
export async function saveKisTrades(rows: KisTradeRow[], group: string): Promise<number> {
  if (!rows.length) return 0;
  rememberTickerNames(rows.map(r => ({ ticker: r.ticker, name: r.name })));
  await upsertTrades(rows.map(r => ({ id: r.id, ticker: r.ticker, account: group, type: r.type, date: r.date, qty: r.qty, amount: r.amount })));
  return rows.length;
}
/** 자동 증분 — 처음이면 전체, 이후엔 마지막 가져온 날 3일 전부터 */
export async function syncKisTradesIncremental(): Promise<number> {
  const link = linkedGroupOf("kis");
  if (!link) return 0;
  const f = link.meta.lastTradeSyncAt ? await fetchKisTrades(addDays(link.meta.lastTradeSyncAt.slice(0, 10), -3)) : await fetchKisTrades();
  const fresh = f.rows.filter(r => !f.existingIds.has(r.id)).length;
  await saveKisTrades(f.rows, f.group);
  const cur = linkedGroupOf("kis");
  if (cur) setLinkedGroup(cur.group, { ...cur.meta, lastTradeSyncAt: new Date().toISOString() });
  return fresh;
}

const AUTO_MS = 5 * 60_000;
/** 앱에서만 — 켜고 4초 뒤 + 5분마다(보이는 동안) */
export function useKisAutoSync(): void {
  useEffect(() => {
    if (!isBrokerAvailable()) return;
    let stop = false;
    const run = () => {
      if (stop || document.visibilityState !== "visible" || !getKisEnabled() || !linkedGroupOf("kis")) return;
      void syncKisHoldingsSafe().catch(() => { /* 메타에 기록됨 */ });
    };
    const t0 = window.setTimeout(run, 6000);
    const id = window.setInterval(run, AUTO_MS);
    const onVis = () => { if (document.visibilityState === "visible") run(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { stop = true; window.clearTimeout(t0); window.clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, []);
}
