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
  if (p.length < 4 || p[1] !== "H0STCNT0") return [];
  const f = p[3].split("^");
  const out: { code: string; tick: TossTick }[] = [];
  for (let i = 0; i + F.DVSN < f.length; i += NFIELD) {
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
  const codes = [...subs.keys()];
  try {
    const r = await inv("kis_ws_poll", { codes }) as { status: string; data: string[] };
    status = (r.status || "") as KisWsStatus;
    if (status === "live") liveAt = Date.now();
    const by = new Map<string, TossTick[]>();
    for (const raw of r.data) {
      for (const { code: c, tick } of parseKisTicks(raw)) (by.get(c) ?? by.set(c, []).get(c)!).push(tick);
    }
    for (const [c, ts] of by) subs.get(c)?.forEach(cb => cb(ts));
  } catch (e) {
    const m = String((e as Error)?.message ?? e);
    // 웹소켓이 없는 옛 앱(0.1.10 이하) — 명령이 없다고 나온다
    status = `error: ${/not allowed|not found|unknown command/i.test(m) ? "앱을 새 버전으로 업데이트해 주세요" : m}`;
  }
}

/** 종목 체결 구독 — 돌려준 함수로 해제. 앱·한국투자 연동이 아니면 아무것도 안 한다 */
export function subscribeKisTicks(code: string, cb: Cb): () => void {
  if (!kisWsAvailable() || !/^[\dA-Za-z]{6}$/.test(code)) return () => {};
  (subs.get(code) ?? subs.set(code, new Set()).get(code)!).add(cb);
  if (!timer) { timer = setInterval(() => { void poll(); }, 1_000); void poll(); }
  return () => {
    const s = subs.get(code);
    s?.delete(cb);
    if (s && !s.size) subs.delete(code);
    if (!subs.size && timer) { clearInterval(timer); timer = null; status = ""; void invoke()?.("kis_ws_poll", { codes: [] }).catch(() => {}); }
  };
}
