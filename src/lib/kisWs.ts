// 한국투자 실시간 체결(웹소켓) — 웹 쪽. 연결·접속키는 앱 네이티브(desktop/src-tauri/src/kis_ws.rs)만 다룬다(사용자 2026-11-02).
//   여러 화면이 각자 종목을 원해도 네이티브 호출은 **하나**(모든 종목을 한 번에) — 화면마다 따로 부르면 서로의 종목 목록을 덮어쓴다.
//   1초마다 kis_ws_poll(codes) → 그 사이 쌓인 체결을 종목별 구독자에게 나눠 준다. 구독자가 없으면 멈춘다(30초 뒤 네이티브가 연결 정리).
import { isKisLinkOn } from "./broker";
import type { TossTick } from "./api";

// H0STCNT0 필드(공식 예제 ccnl_krx.py columns 순서) — 쓰는 것만
const F = { CODE: 0, HOUR: 1, PRICE: 2, VOL: 12, CUM: 13, DVSN: 21 } as const;
const NFIELD = 46;

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
function invoke(): Invoke | null {
  const t = (window as unknown as { __TAURI_INTERNALS__?: { invoke: Invoke } }).__TAURI_INTERNALS__;
  return t?.invoke ? t.invoke.bind(t) : null;
}

export type KisWsStatus = "" | "connecting" | "live" | `error: ${string}`;
type Cb = (ticks: TossTick[]) => void;
const subs = new Map<string, Set<Cb>>();
let timer: ReturnType<typeof setInterval> | null = null;
let status: KisWsStatus = "";
let liveAt = 0;

/** 앱 + 한국투자 연동이면 웹소켓을 쓸 수 있다 */
export function kisWsAvailable(): boolean { return isKisLinkOn() && !!invoke(); }
/** 지금 실시간으로 받고 있는가 — 아니면 토스 폴링으로 메운다 */
export function kisWsLive(): boolean { return status === "live" && Date.now() - liveAt < 5_000; }
export function kisWsStatus(): KisWsStatus { return status; }

/** "0|H0STCNT0|003|f^f^…" → 체결들(토스 체결과 같은 모양: 시각 HH:MM:SS·가격·수량·매수/매도·누적 거래량) */
export function parseKisTicks(raw: string): { code: string; tick: TossTick }[] {
  const p = raw.split("|");
  // H0STCNT0(KRX) · H0UNCNT0(통합 KRX+NXT, 0.1.14+) — 앞쪽 필드 순서가 같다. 한 건 필드 수는 '전체 ÷ 건수'로(통합이 몇 개 다를 수 있다)
  if (p.length < 4 || (p[1] !== "H0STCNT0" && p[1] !== "H0UNCNT0")) return [];
  const f = p[3].split("^");
  const n = Number(p[2]) || 1;
  const step = f.length % n === 0 && f.length / n > F.DVSN ? f.length / n : NFIELD;
  const out: { code: string; tick: TossTick }[] = [];
  for (let i = 0; i + F.DVSN < f.length; i += step) {
    const h = f[i + F.HOUR] ?? "";
    const price = Number(f[i + F.PRICE]), volume = Number(f[i + F.VOL]), cum = Number(f[i + F.CUM]);
    const dv = f[i + F.DVSN];
    // 1 = 매수 체결, 5 = 매도 체결(3 = 장전 등 — 방향이 없어 뺀다)
    const side = dv === "1" ? "BUY" : dv === "5" ? "SELL" : null;
    if (!side || !(price > 0) || !(volume > 0) || h.length < 6) continue;
    out.push({ code: f[i + F.CODE], tick: { time: `${h.slice(0, 2)}:${h.slice(2, 4)}:${h.slice(4, 6)}`, price, volume, side, cum: cum > 0 ? cum : 0 } });
  }
  return out;
}

async function poll() {
  const inv = invoke();
  if (!inv) return;
  const codes = [...subs.keys(), ...[...qsubs.keys()].map(c => `Q${c}`), ...[...msubs.keys()].map(c => `M${c}`)];
  try {
    const r = await inv("kis_ws_poll", { codes }) as { status: string; data: string[] };
    status = (r.status || "") as KisWsStatus;
    if (status === "live") liveAt = Date.now();
    const by = new Map<string, TossTick[]>();
    for (const raw of r.data) {
      for (const { code: c, tick } of parseKisTicks(raw)) (by.get(c) ?? by.set(c, []).get(c)!).push(tick);
    }
    for (const [c, ts] of by) subs.get(c)?.forEach(cb => cb(ts));
    // 호가 — 종목마다 가장 최근 것 하나만
    const lastQ = new Map<string, KisQuote>();
    for (const raw of r.data) for (const q of parseKisQuotes(raw)) lastQ.set(q.code, q);
    for (const [c, q] of lastQ) qsubs.get(c)?.forEach(cb => cb(q));
    // 거래원 — 들어온 순서대로 전부(창구별 누적의 차이로 순간 매매를 잡는다)
    for (const raw of r.data) for (const m of parseKisMembers(raw)) msubs.get(m.code)?.forEach(cb => cb(m));
  } catch (e) {
    const m = String((e as Error)?.message ?? e);
    // 웹소켓이 없는 옛 앱(0.1.10 이하) — 명령이 없다고 나온다
    status = `error: ${/not allowed|not found|unknown command/i.test(m) ? "앱을 새 버전으로 업데이트해 주세요" : m}`;
  }
}

function ensureTimer() { if (!timer) { timer = setInterval(() => { void poll(); }, 1_000); void poll(); } }
function stopIfIdle() { if (!subs.size && !qsubs.size && !msubs.size && timer) { clearInterval(timer); timer = null; status = ""; void invoke()?.("kis_ws_poll", { codes: [] }).catch(() => {}); } }

/** 종목 체결 구독 — 돌려준 함수로 해제. 앱·한국투자 연동이 아니면 아무것도 안 한다 */
export function subscribeKisTicks(code: string, cb: Cb): () => void {
  if (!kisWsAvailable() || !/^[\dA-Za-z]{6}$/.test(code)) return () => {};
  (subs.get(code) ?? subs.set(code, new Set()).get(code)!).add(cb);
  ensureTimer();
  return () => {
    const s = subs.get(code);
    s?.delete(cb);
    if (s && !s.size) subs.delete(code);
    stopIfIdle();
  };
}


// ─── 실시간 호가(H0UNASP0 통합 · H0STASP0 KRX) — 0.1.15+ 앱. 키 'Q'+코드로 구독(체결과 같은 연결) ───
//   필드(공식 예제 asking_price_total): 0 코드 · 1 시각 · 3~12 매도호가1~10 · 13~22 매수호가1~10 · 23~32 매도잔량 · 33~42 매수잔량 · 43·44 총잔량 · 47 예상체결가
export interface KisQuote { code: string; time: string; sell: { price: number; qty: number }[]; buy: { price: number; qty: number }[]; sumSell: number; sumBuy: number; est: number }
type QCb = (q: KisQuote) => void;
const qsubs = new Map<string, Set<QCb>>();
export function parseKisQuotes(raw: string): KisQuote[] {
  const p = raw.split("|");
  if (p.length < 4 || (p[1] !== "H0UNASP0" && p[1] !== "H0STASP0")) return [];
  const f = p[3].split("^"), n = Number(p[2]) || 1;
  const step = f.length % n === 0 ? f.length / n : 66;
  const out: KisQuote[] = [];
  for (let i = 0; i + 44 < f.length; i += step) {
    const g = (k: number) => Number(f[i + k]) || 0;
    const sell = Array.from({ length: 10 }, (_, k) => ({ price: g(3 + k), qty: g(23 + k) })).filter(x => x.price > 0).sort((a, b) => a.price - b.price);
    const buy = Array.from({ length: 10 }, (_, k) => ({ price: g(13 + k), qty: g(33 + k) })).filter(x => x.price > 0).sort((a, b) => b.price - a.price);
    if (sell.length && buy.length) out.push({ code: f[i], time: f[i + 1] ?? "", sell, buy, sumSell: g(43), sumBuy: g(44), est: g(47) });
  }
  return out;
}
/** 실시간 호가 구독 — 앱 + 한국투자일 때만(없으면 아무 일도 안 한다). 해제 함수 반환 */
export function subscribeKisQuotes(code: string, cb: QCb): () => void {
  if (!kisWsAvailable()) return () => {};
  const set = qsubs.get(code) ?? qsubs.set(code, new Set()).get(code)!;
  set.add(cb);
  ensureTimer();
  return () => { set.delete(cb); if (!set.size) qsubs.delete(code); stopIfIdle(); };
}

// ─── 실시간 거래원(회원사) H0UNMBC0 통합 · H0STMBC0 KRX — 앱 0.1.16+. 키 'M'+코드(사용자 2026-11-10 "거래원 정보도 한투 api — 바로 2번") ───
//   필드(공식 예제 examples_llm/domestic_stock/member_total, 78개): 0 코드 · 1~5 매도 창구명 · 6~10 매수 창구명 · 11~15 매도 누적수량 · 16~20 매수 누적수량
//   · 21~25 매도 외국계(Y/N) · 26~30 매수 외국계 · … · 61 외국계 매도 합계 · 62 외국계 매수 합계 · 65 외국계 순매수. 시각 필드는 없다(받은 때로 찍는다)
export interface KisMemberSide { name: string; qty: number; foreign: boolean }
export interface KisMembers { code: string; sell: KisMemberSide[]; buy: KisMemberSide[]; globSell: number; globBuy: number; globNet: number }
type MCb = (m: KisMembers) => void;
const msubs = new Map<string, Set<MCb>>();
export function parseKisMembers(raw: string): KisMembers[] {
  const p = raw.split("|");
  if (p.length < 4 || (p[1] !== "H0UNMBC0" && p[1] !== "H0STMBC0" && p[1] !== "H0NXMBC0")) return [];
  const f = p[3].split("^"), n = Number(p[2]) || 1;
  const step = f.length % n === 0 ? f.length / n : 78;
  const out: KisMembers[] = [];
  for (let i = 0; i + 65 < f.length; i += step) {
    const g = (k: number) => Number(String(f[i + k] ?? "").replace(/,/g, "")) || 0;
    const side = (nameAt: number, qtyAt: number, ynAt: number) => Array.from({ length: 5 }, (_, k) => ({
      name: (f[i + nameAt + k] ?? "").trim(), qty: g(qtyAt + k), foreign: (f[i + ynAt + k] ?? "") === "Y",
    })).filter(x => x.name);
    out.push({ code: f[i], sell: side(1, 11, 21), buy: side(6, 16, 26), globSell: g(61), globBuy: g(62), globNet: g(65) });
  }
  return out;
}
/** 실시간 거래원 구독 — 앱 + 한국투자일 때만. 해제 함수 반환 */
export function subscribeKisMembers(code: string, cb: MCb): () => void {
  if (!kisWsAvailable() || !/^[\dA-Za-z]{6}$/.test(code)) return () => {};
  const set = msubs.get(code) ?? msubs.set(code, new Set()).get(code)!;
  set.add(cb);
  ensureTimer();
  return () => { set.delete(cb); if (!set.size) msubs.delete(code); stopIfIdle(); };
}
