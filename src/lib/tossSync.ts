// 토스 Open API → 연동 그룹 보유·예수금 갱신(2단계). 데스크톱 앱에서만 돈다(brokerGet 이 네이티브 명령).
//   규칙(사용자 결정 2026-10-26): 연동 그룹에서 토스에서 가져온 행(source="toss")만 교체·잠금, 손으로 넣은 행은 그대로,
//   예수금 = cashBuyingPower. 휴대폰은 Drive 동기화로 결과만 받는다.
//   실측(2026-10-26): 숫자는 전부 문자열, 미국은 USD(averagePurchasePrice·purchaseAmount), 소수점 주식 있음, 매수일 없음.
import { publishTossRelayIfDue } from "./tossRelay";
import { useEffect } from "react";
import { brokerGet, getTossAccountSeq, isTossLinkOn, isBrokerAvailable, getTossEnabled } from "./broker";
import { linkedGroupOf, setLinkedGroup, type LinkedGroupMeta } from "./linkedGroups";
import { replaceSyncedHoldingsOfGroup, loadHoldings } from "./db";
import { setDeposit } from "./deposits";
import { fetchYahooBatch } from "./api";
import type { Stock } from "../types";
import { syncTossTradesIncremental } from "./tossTrades";

export const TOSS_SOURCE = "toss";

interface TossHoldingItem {
  symbol: string; name: string; marketCountry: string; currency: string;
  quantity: string; lastPrice: string; averagePurchasePrice: string;
  marketValue?: { purchaseAmount?: string; amount?: string };
}
interface TossHoldings { items?: TossHoldingItem[] }
interface TossBuyingPower { currency: string; cashBuyingPower: string }

const num = (s: string | number | null | undefined) => { const v = Number(s); return Number.isFinite(v) ? v : 0; };
const todayKst = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

export interface TossSyncResult { group: string; count: number; cash: number; at: string; fxUsed?: number; trades?: number }

/** 보유·예수금을 토스 값으로 갱신. 연동 그룹이 없거나 꺼져 있으면 null. 실패는 던진다(호출 쪽이 메시지로) */
export async function syncTossHoldings(): Promise<TossSyncResult | null> {
  if (!isTossLinkOn()) return null;
  const link = linkedGroupOf("toss");
  if (!link) return null;
  const { group, meta } = link;
  const account = meta.accountSeq || getTossAccountSeq();
  if (!account) throw new Error("계좌가 선택되지 않았습니다");

  const h = await brokerGet<TossHoldings>("toss", "/api/v1/holdings", account);
  const items = (h?.items ?? []).filter(i => i?.symbol && num(i.quantity) > 0);

  // 미국 보유가 있을 때만 환율 — 야후 KRW=X(1달러 원화)
  let fx: number | undefined;
  const needFx = items.some(i => i.currency === "USD");
  if (needFx) {
    try { fx = (await fetchYahooBatch([{ symbol: "KRW=X", name: "USD/KRW" }])).get("KRW=X")?.price; } catch { /* 아래에서 기억값으로 */ }
  }

  const existing = (await loadHoldings()).filter(s => (s.account ?? "") === group);
  const byTicker = new Map(existing.map(s => [s.ticker, s]));
  const usdAvg: NonNullable<LinkedGroupMeta["usdAvg"]> = { ...(meta.usdAvg ?? {}) };
  const today = todayKst();
  const rows: Stock[] = [];
  for (const it of items) {
    const ticker = it.symbol.trim();
    const qty = num(it.quantity);
    const prev = byTicker.get(ticker);
    let avg: number;
    if (it.currency === "USD") {
      const usd = num(it.averagePurchasePrice);
      const remembered = usdAvg[ticker];
      if (remembered && remembered.usd === usd && remembered.qty === qty) {
        avg = remembered.krw;                       // 달러 평단·수량 그대로 → 원화 평단 유지(환율 따라 흔들리지 않게)
      } else {
        const rate = fx ?? (remembered && remembered.usd > 0 ? remembered.krw / remembered.usd : undefined);
        if (!rate) throw new Error("환율(USD/KRW)을 받지 못해 미국 보유 평단을 환산할 수 없습니다 — 잠시 뒤 다시 시도");
        avg = Math.round(usd * rate);
        usdAvg[ticker] = { usd, qty, krw: avg };
      }
    } else {
      avg = num(it.averagePurchasePrice);
    }
    // 매수일은 토스가 안 준다 — 기존 행 유지, 새 행이거나 수량이 늘었으면 오늘(추가 매수로 본다)
    const buy_date = !prev || qty > (prev.shares ?? 0) ? today : (prev.buy_date ?? "");
    rows.push({
      ticker, name: it.name || prev?.name || ticker,
      shares: qty, avg_price: avg, invested: Math.round(qty * avg),
      buy_date, market: it.marketCountry === "US" ? "US" : (prev?.market ?? ""),
      account: group, source: TOSS_SOURCE,
    });
  }
  // 토스에서 사라진 종목의 환산 기억도 지운다
  for (const k of Object.keys(usdAvg)) if (!items.some(i => i.symbol.trim() === k)) delete usdAvg[k];

  const count = await replaceSyncedHoldingsOfGroup(group, rows, TOSS_SOURCE);

  // 예수금 = 현금 기준 매수 가능 금액(토스 앱 '주문 가능 금액'과 일치 — 실측)
  let cash = 0;
  try {
    const bp = await brokerGet<TossBuyingPower>("toss", "/api/v1/buying-power?currency=KRW", account);
    cash = Math.max(0, Math.round(num(bp?.cashBuyingPower)));
    setDeposit(group, cash);
  } catch { /* 예수금만 실패 — 보유는 이미 갱신됨 */ }

  const at = new Date().toISOString();
  setLinkedGroup(group, { ...meta, accountSeq: account, lastSyncAt: at, lastError: undefined, usdAvg });
  // 거래 이력 증분(3단계) — 실패해도 보유 갱신은 성공으로 둔다
  let trades = 0;
  try { trades = await syncTossTradesIncremental(); } catch (e) { console.warn("[toss] 거래 증분 실패:", e); }
  return { group, count, cash, at, fxUsed: fx, trades };
}

/** 실패를 메타에 남기고 다시 던진다(설정 칸·배지가 보여 준다) */
export async function syncTossHoldingsSafe(): Promise<TossSyncResult | null> {
  try { return await syncTossHoldings(); }
  catch (e) {
    const link = linkedGroupOf("toss");
    if (link) setLinkedGroup(link.group, { ...link.meta, lastError: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

const AUTO_MS = 5 * 60_000;
/** 데스크톱 앱 자동 갱신 — 켤 때 한 번 + 5분마다(화면이 보일 때만). 계좌 API 는 초당 1건이라 부담 없음 */
export function useTossAutoSync(): void {
  useEffect(() => {
    if (!isBrokerAvailable()) return;
    let stop = false;
    const run = () => {
      if (stop || document.visibilityState !== "visible" || !getTossEnabled() || !linkedGroupOf("toss")) return;
      void syncTossHoldingsSafe().catch(() => { /* 메타에 기록됨 */ });
      void publishTossRelayIfDue().catch(() => { /* 다음 주기에 */ });   // 앱에서만 받는 시세성 값을 Drive 로 웹·휴대폰에 중계
    };
    const t0 = window.setTimeout(run, 4000);   // 첫 화면 시세 요청이 몰리는 순간은 피한다
    const id = window.setInterval(run, AUTO_MS);
    const onVis = () => { if (document.visibilityState === "visible") run(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { stop = true; window.clearTimeout(t0); window.clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, []);
}
