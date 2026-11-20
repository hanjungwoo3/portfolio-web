// 미국 종목 실시간 체결 누적 — 반도체 수급(미국) 탭(사용자 2026-11-21 "반도체 수급에 삼성전자·하이닉스처럼 미국도").
//   국내 useTickFlow 와 같은 방식(토스 ticks 최근 300건을 5초마다, 누적 거래량으로 중복 제거, 오늘치는 localStorage)인데
//   미국 장은 한국 자정을 넘기므로(정규장 23:30~06:00 KST) **미국 동부 시각(ET) 날짜·분**으로 쌓는다 — KST 로 쌓으면 자정에 버려지고 분 순서가 뒤집힌다.
//   금액은 원화(토스 priceKrw × 수량) — 국내 탭과 같은 억 단위로 읽게. 과거 체결 API 가 없어 화면이 꺼져 있던 동안은 빈칸.
import { useEffect, useState } from "react";
import { fetchTossUsTicks, fetchTossUsMinuteToday, type TossUsTick } from "./api";

export interface UsMinute { t: string; buyVol: number; sellVol: number; buyAmt: number; sellAmt: number; close: number; est?: boolean; amt?: number }   // t = ET "HH:MM", 금액 = 원 · est = 1분봉으로 채운 분(매수·매도 모름, amt = 거래대금)
export interface UsBig { time: string; side: "BUY" | "SELL"; amt: number; price: number; volume: number }   // time = ET "HH:MM:SS"
export interface UsTickFlow { minutes: UsMinute[]; big: UsBig[]; gaps: number; since?: string; last?: string; base?: number; price?: number; priceKrw?: number; error?: string; etDate: string }

const POLL_MS = 5_000;
export const US_BIG_MIN = 1e8;   // 1억원 이상 = 큰 체결

/** 지금 미국 동부(뉴욕) 날짜·분, KST 와의 차이(분) — 서머타임은 Intl 이 알아서 */
export function etNow(at = Date.now()): { date: string; min: number; kstDiff: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(at)).map(x => [x.type, x.value]));
  const min = Number(p.hour) * 60 + Number(p.minute);
  const k = new Date(at + 9 * 3600_000), kmin = k.getUTCHours() * 60 + k.getUTCMinutes();
  return { date: `${p.year}-${p.month}-${p.day}`, min, kstDiff: (((kmin - min) % 1440) + 1440) % 1440 };
}
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
/** ET "HH:MM" → KST "HH:MM"(그래프 글자용) */
export function etToKst(t: string, kstDiff = etNow().kstDiff): string {
  const m = Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return hm((m + kstDiff) % 1440);
}

interface Box { lastCum: number; minutes: Map<string, UsMinute>; big: UsBig[]; gaps: number; since?: string; last?: string; base?: number; price?: number; priceKrw?: number; date: string }
type Saved = Omit<Box, "minutes"> & { minutes: UsMinute[] };
const boxes = new Map<string, Box>();
const key = (code: string) => `us_tickflow_${code}`;

function box(code: string): Box {
  const d = etNow().date;
  const b = boxes.get(code);
  if (b && b.date === d) return b;
  let nb: Box = { lastCum: 0, minutes: new Map(), big: [], gaps: 0, date: d };
  try {
    const v = JSON.parse(localStorage.getItem(key(code)) ?? "null") as Saved | null;
    if (v && v.date === d) nb = { ...v, minutes: new Map(v.minutes.map(m => [m.t, m])) };
  } catch { /* 없음 */ }
  boxes.set(code, nb);
  return nb;
}
function save(code: string, b: Box) {
  try { localStorage.setItem(key(code), JSON.stringify({ ...b, minutes: [...b.minutes.values()] } satisfies Saved)); } catch { /* 이번만 */ }
}

/** 체결 넣기 — 한국 시각 체결을 ET 분으로. 지금(ET)보다 늦은 시각 = 어제 것(자정 너머)이라 버린다 */
export function ingestUsTicks(code: string, ts: TossUsTick[]) {
  const now = etNow(), b = box(code);
  const conv = ts.map(t => {
    const k = Number(t.time.slice(0, 2)) * 60 + Number(t.time.slice(3, 5));
    const e = (k - now.kstDiff + 1440) % 1440;
    return { ...t, et: `${hm(e)}${t.time.slice(5, 8)}`, em: e };
  }).filter(t => t.em <= now.min + 1);
  if (!conv.length) return;
  const newest = conv.reduce((a, x) => (x.cum > a.cum ? x : a));
  // 누적 거래량이 처음부터 다시 시작했으면(토스 세션이 바뀜 — 데이마켓·프리장 경계) 기준을 0 으로
  if (b.lastCum && b.last && newest.et > b.last && newest.cum < b.lastCum) b.lastCum = 0;
  const fresh = conv.filter(t => t.cum > b.lastCum).sort((x, y) => x.cum - y.cum);
  if (!fresh.length) return;
  if (b.lastCum && fresh[0].cum - fresh[0].volume > b.lastCum) b.gaps++;   // 두 번 받는 사이 300건을 넘게 체결 — 빈 구간
  for (const t of fresh) {
    const m = t.et.slice(0, 5);
    let mm = b.minutes.get(m);
    if (!mm) { mm = { t: m, buyVol: 0, sellVol: 0, buyAmt: 0, sellAmt: 0, close: t.price }; b.minutes.set(m, mm); }
    const amt = (t.priceKrw || 0) * t.volume;
    if (t.side === "BUY") { mm.buyVol += t.volume; mm.buyAmt += amt; } else { mm.sellVol += t.volume; mm.sellAmt += amt; }
    mm.close = t.price;
    if (amt >= US_BIG_MIN) b.big.unshift({ time: t.et, side: t.side, amt, price: t.price, volume: t.volume });
  }
  b.big = b.big.slice(0, 200);
  const last = fresh[fresh.length - 1];
  b.lastCum = last.cum; b.since ??= fresh[0].et; b.last = last.et;
  b.price = last.price; b.priceKrw = last.priceKrw; if (last.base) b.base = last.base;
  save(code, b);
}

export function useUsTickFlow(tossCode: string, enabled = true): UsTickFlow {
  const [, setVer] = useState(0);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const ts = await fetchTossUsTicks(tossCode);
        if (!alive) return;
        setError(undefined);
        ingestUsTicks(tossCode, ts);
        setVer(v => v + 1);
      } catch (e) { if (alive) setError((e as Error).message); }
    };
    void tick();
    const id = setInterval(tick, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, [tossCode, enabled]);
  // 켜기 전·꺼져 있던 분은 1분봉(가격·거래량)으로 — 5분마다(사용자 2026-11-21 "켜기 전의 거래기록은 없어?")
  const [fill, setFill] = useState<Map<string, UsMinute>>(new Map());
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () => fetchTossUsMinuteToday(tossCode, etNow().date).then(cs => {
      if (alive) setFill(new Map(cs.map(c => [c.t, { t: c.t, buyVol: 0, sellVol: 0, buyAmt: 0, sellAmt: 0, close: c.close, est: true, amt: c.amt }])));
    }).catch(() => { /* 없으면 빈칸 */ });
    void load();
    const id = setInterval(load, 5 * 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [tossCode, enabled]);
  const b = box(tossCode);
  // 실시간이 있는 분은 실시간, 없는 분만 1분봉. 마지막 실시간 분 뒤의 1분봉은 버린다(진행 중인 분을 덮지 않게)
  const merged = new Map(b.minutes);
  const lastReal = b.last?.slice(0, 5);
  for (const [t, m] of fill) if (!merged.has(t) && (!lastReal || t < lastReal)) merged.set(t, m);
  return { minutes: [...merged.values()].sort((x, y) => x.t.localeCompare(y.t)), big: b.big, gaps: b.gaps, since: b.since, last: b.last, base: b.base, price: b.price, priceKrw: b.priceKrw, error, etDate: b.date };
}
