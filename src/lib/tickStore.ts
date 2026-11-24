// 종목 실시간 체결 통 — 1분 단위 매수·매도 누적을 **앱 전체가 함께** 쓴다(사용자 2026-11-10 "2, 3 같이 적용하면?").
//   ① 화면(useTickFlow)이 켜져 있으면 토스 5초 폴링·한투 웹소켓으로 넣는다(예전과 같음).
//   ② 앱(한국투자 연동)이면 **창을 안 열어도** 대표 종목(삼성전자·SK하이닉스)을 한투 웹소켓으로 계속 받아 둔다 — startBackgroundTicks.
//   ③ 그래도 빈 분은 한투 '당일 시간대별 체결'(FHPST01060000)로 거슬러 채운다 — kisTickBackfill.
//   오늘치는 localStorage 에 저장(날짜 바뀌면 버림). 중복은 누적 거래량(cum)으로 출처별로 거른다.
import type { TossTick } from "./api";
import { kisWsAvailable, subscribeKisTicks } from "./kisWs";
import { watchMembers } from "./memberFlow";
import { lsSet } from "./lsGuard";

export interface MinuteFlow {
  t: string;          // "HH:MM"
  buyVol: number; sellVol: number;
  buyAmt: number; sellAmt: number;   // 원
  close: number;
  vol?: number;       // 1분봉으로 채운 분의 거래량 — 매수·매도는 모른다
  est?: boolean;      // 1분봉으로 채운 분(매수·매도 모름)
  back?: boolean;     // 한투 누적 체결강도로 거슬러 채운 분(매수·매도는 계산값)
}
export interface BigTrade { time: string; side: "BUY" | "SELL"; amt: number; price: number; volume: number }

export const BIG_STEPS = [1e8, 5e7, 3e7, 1e7] as const;
const BIG_MIN = BIG_STEPS[BIG_STEPS.length - 1];

export interface TickBox {
  lastCum: number;                 // 토스 기준 마지막 누적 거래량
  lastKis: number; lastKisTime: string; kisLastAt: number;   // 한투 웹소켓 기준
  minutes: Map<string, MinuteFlow>;
  big: BigTrade[]; gaps: number; since?: string; last?: string;
  // 한투 거슬러 채우기 기록 — 오늘 이미 물어본 분 경계(누적 매수·매도·값, 응답이 비었으면 null)와 호출 수. 같은 걸 두 번 안 부른다(사용자 2026-11-10 "매번 다시 가져오는 건 낭비")
  cums: Record<string, [number, number, number] | null>;
  kisCalls: number;
}
type Saved = { date: string; lastCum: number; minutes: MinuteFlow[]; big: BigTrade[]; gaps: number; since?: string; last?: string; cums?: TickBox["cums"]; kisCalls?: number };

export const kstDate = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
// 지금(KST) + 1분 "HH:MM:SS" — 이보다 늦은 체결 시각은 오늘 것일 수 없다(어제 저녁 체결)
const kstNowPlus1 = () => new Date(Date.now() + 9 * 3600_000 + 60_000).toISOString().slice(11, 19);
const emptyBox = (): TickBox => ({ lastCum: 0, lastKis: 0, lastKisTime: "", kisLastAt: 0, minutes: new Map(), big: [], gaps: 0, cums: {}, kisCalls: 0 });
const storeKey = (code: string) => `semi_tickflow_${code}`;
const boxes = new Map<string, TickBox>();
const listeners = new Map<string, Set<() => void>>();

export function tickBox(code: string): TickBox {
  let b = boxes.get(code);
  if (b && b === boxes.get(code) && (b as TickBox & { _date?: string })._date === kstDate()) return b;
  let sv: Saved | null = null;
  try {
    const v = JSON.parse(localStorage.getItem(storeKey(code)) ?? "null") as Saved | null;
    sv = v && v.date === kstDate() && !(v.last && v.last > kstNowPlus1()) ? v : null;
    // 지난 날짜 기록은 '지난 거래일'로 옮겨 둔다 — 장 마감 뒤·주말 그래프에 그날 매수·매도·큰 체결을 그리려고(사용자 2026-11-21)
    if (v && v.date < kstDate() && v.minutes?.length) localStorage.setItem(`${storeKey(code)}_prev`, JSON.stringify(v));
  } catch { /* 없음 */ }   // 지금보다 늦은 체결이 든 저장본 = 어제 것이 섞였다 → 버림
  b = sv
    ? { lastCum: sv.lastCum, lastKis: 0, lastKisTime: "", kisLastAt: 0, minutes: new Map(sv.minutes.map(m => [m.t, m])), big: sv.big, gaps: sv.gaps, since: sv.since, last: sv.last, cums: sv.cums ?? {}, kisCalls: sv.kisCalls ?? 0 }
    : { lastCum: 0, lastKis: 0, lastKisTime: "", kisLastAt: 0, minutes: new Map(), big: [], gaps: 0, cums: {}, kisCalls: 0 };
  (b as TickBox & { _date?: string })._date = kstDate();
  boxes.set(code, b);
  return b;
}

let saveTimer: Record<string, ReturnType<typeof setTimeout>> = {};
/** 지난 거래일 체결 기록(그 날짜와 맞을 때만) — 1분 매수·매도와 큰 체결 */
export function prevBox(code: string, date: string): { minutes: MinuteFlow[]; big: BigTrade[] } | null {
  tickBox(code);   // 날짜가 바뀐 기록을 _prev 로 옮기게
  try { const v = JSON.parse(localStorage.getItem(`${storeKey(code)}_prev`) ?? "null") as Saved | null; return v && v.date === date ? { minutes: v.minutes, big: v.big } : null; } catch { return null; }
}
export function saveBox(code: string) {
  clearTimeout(saveTimer[code]);
  saveTimer[code] = setTimeout(() => {
    const s = tickBox(code);
    try {
      const sv: Saved = { date: kstDate(), lastCum: s.lastCum, minutes: [...s.minutes.values()], big: s.big, gaps: s.gaps, since: s.since, last: s.last, cums: s.cums, kisCalls: s.kisCalls };
      lsSet(storeKey(code), JSON.stringify(sv));   // 가득 차면 캐시를 비우고 다시(lsGuard)
    } catch { /* 저장 실패 — 화면은 그대로 */ }
  }, 1_000);
}
export function notifyBox(code: string) { listeners.get(code)?.forEach(f => f()); }
export function onBox(code: string, f: () => void): () => void {
  (listeners.get(code) ?? listeners.set(code, new Set()).get(code)!).add(f);
  return () => { listeners.get(code)?.delete(f); };
}

/** 체결 넣기 — 출처별 누적 거래량으로 중복을 거른다(같은 체결이 화면·배경 두 구독으로 와도 한 번만) */
export function ingestTicks(code: string, ts: TossTick[], src: "toss" | "kis") {
  // 장이 열리기 전엔 토스가 **어제 저녁(NXT 애프터) 체결**을 돌려준다 — 오늘 것으로 받으면 그 누적 거래량(큼) 때문에
  //   오늘 체결(누적이 작다)을 전부 중복으로 버렸다(실측 2026-11-19 수능 10시 개장: 그래프가 19:59 에 멈춤). 지금보다 늦은 시각은 버린다
  const cut = kstNowPlus1();
  ts = ts.filter(t => !t.time || t.time <= cut);
  if (!ts.length) return;
  let s = tickBox(code);
  // 이미 어제 체결이 섞여 저장됐으면(이 고침 전에 받은 것) 오늘 상자를 새로
  if (s.last && s.last > cut) { const nb = emptyBox(); (nb as TickBox & { _date?: string })._date = kstDate(); boxes.set(code, nb); s = nb; }
  const last = src === "kis" ? s.lastKis : s.lastCum;
  const fresh = ts.filter(t => t.cum > last).sort((a, b) => a.cum - b.cum);
  if (!fresh.length) return;
  if (src === "kis") { s.lastKis = fresh[fresh.length - 1].cum; s.lastKisTime = fresh[fresh.length - 1].time; s.kisLastAt = Date.now(); }
  if (src === "toss" && s.lastCum && fresh[0].cum - fresh[0].volume > s.lastCum) s.gaps++;
  for (const t of fresh) {
    if (src === "toss" && s.lastKisTime && t.time <= s.lastKisTime) continue;
    const m = t.time.slice(0, 5);
    let b = s.minutes.get(m);
    if (!b || b.back) { b = { t: m, buyVol: 0, sellVol: 0, buyAmt: 0, sellAmt: 0, close: t.price }; s.minutes.set(m, b); }   // 거슬러 채운 분을 실시간이 만나면 실시간으로
    const amt = t.price * t.volume;
    if (t.side === "BUY") { b.buyVol += t.volume; b.buyAmt += amt; } else { b.sellVol += t.volume; b.sellAmt += amt; }
    b.close = t.price;
    if (amt >= BIG_MIN) s.big.unshift({ time: t.time, side: t.side, amt, price: t.price, volume: t.volume });
  }
  s.big = s.big.slice(0, 200);
  if (src === "toss") s.lastCum = fresh[fresh.length - 1].cum;
  s.since ??= fresh[0].time;
  s.last = fresh[fresh.length - 1].time;
  saveBox(code);
  notifyBox(code);
}

// ─── 배경 수집 — 앱 + 한국투자 연동이면 창을 닫아도 대표 종목을 계속 받는다 ───
export const BG_TICK_CODES = ["005930", "000660"];   // 삼성전자 · SK하이닉스(반도체 수급 탭의 두 종목)
let bgUnsubs: (() => void)[] | null = null;
let bgTimer: ReturnType<typeof setInterval> | null = null;
export function startBackgroundTicks() {
  if (bgTimer) return;
  const tryStart = () => {
    if (bgUnsubs || !kisWsAvailable()) return;   // 연동이 나중에 켜질 수도 있다 — 1분마다 다시 본다
    bgUnsubs = [
      ...BG_TICK_CODES.map(c => subscribeKisTicks(c, ts => ingestTicks(c, ts, "kis"))),
      ...BG_TICK_CODES.map(c => watchMembers(c)),   // 거래원 순간 매매도 배경에서(사용자 2026-11-10)
    ];
  };
  tryStart();
  bgTimer = setInterval(() => { if (bgUnsubs && !kisWsAvailable()) { bgUnsubs.forEach(f => f()); bgUnsubs = null; } tryStart(); }, 60_000);
}
