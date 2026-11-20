// 미국 종목 실시간 체결 누적 — 반도체 수급(미국) 탭(사용자 2026-11-21 "반도체 수급에 삼성전자·하이닉스처럼 미국도").
//   국내 useTickFlow 와 같은 방식(토스 ticks 최근 300건을 5초마다, 누적 거래량으로 중복 제거, 오늘치는 localStorage)인데
//   미국 장은 한국 자정을 넘기므로(정규장 23:30~06:00 KST) **미국 동부 시각(ET) 날짜·분**으로 쌓는다 — KST 로 쌓으면 자정에 버려지고 분 순서가 뒤집힌다.
//   금액은 원화(토스 priceKrw × 수량) — 국내 탭과 같은 억 단위로 읽게. 과거 체결 API 가 없어 화면이 꺼져 있던 동안은 빈칸.
import { useEffect, useState } from "react";
import { fetchTossUsTicks, fetchTossUsMinuteToday, type TossUsTick } from "./api";
import { isDirectApp } from "./nativeProxy";
import { kisGet, isKisLinkOn } from "./broker";

// 반도체 수급(미국) 칸 종목 — 화면과 배경 수집이 같은 목록을 쓴다(lib 한 벌)
export const US_SEMI_STOCKS = [
  { ticker: "MU", toss: "US19890516001", name: "마이크론", desc: "메모리(D램·HBM·낸드) — 삼성전자·SK하이닉스와 같은 업종" },
  { ticker: "NVDA", toss: "US19990122001", name: "엔비디아", desc: "AI 칩 1위 — HBM 최대 구매자" },
  // + 하이닉스 ADR·앤트로픽(사용자 2026-11-21 "2개 더 추가해서 4개로" → "브로드컴 대신 앤트로픽", "TSMC 대신 하이닉스 ADR")
  { ticker: "SKHY", toss: "NAS2607010002", name: "SK하이닉스 ADR", desc: "나스닥 상장 하이닉스 — 간밤 하이닉스 값" },
  { ticker: "ANT", toss: "NAS2611011001", name: "앤트로픽", desc: "AI 모델(Claude) — 반도체 수요 쪽, 2026-11 상장" },
] as const;

export interface UsMinute { t: string; buyVol: number; sellVol: number; buyAmt: number; sellAmt: number; close: number; est?: boolean; amt?: number; kis?: boolean }   // kis = 한투 누적으로 정확히 나눈 분   // t = ET "HH:MM", 금액 = 원 · est = 1분봉으로 채운 분(매수·매도 모름, amt = 거래대금)
export interface UsBig { time: string; side: "BUY" | "SELL"; amt: number; price: number; volume: number }   // time = ET "HH:MM:SS"
// kisDay = 한투 당일 누적(장 시작부터, 앱+한투만) — vpow = 당일 체결강도, buy·sell = 주
export interface UsKisDay { vpow: number; tvol: number; buy: number; sell: number; at: string }
export interface UsTickFlow { kisDay?: UsKisDay; minutes: UsMinute[]; big: UsBig[]; gaps: number; since?: string; last?: string; base?: number; price?: number; priceKrw?: number; error?: string; etDate: string }

const POLL_MS = 5_000;
const FILL_ON = false;
const FILL_MIN = 120;   // 켜기 전 1분봉으로 채우는 길이(분)
export const US_BIG_MIN = 1e7;   // 1천만원 이상을 모아 두고, 보여 줄 기준은 종목마다 자동(국내 bigThreshold — 1억·5천만·3천만·1천만, 사용자 2026-11-21 "하이닉스 ADR은 1억이 너무 큰 거 아냐?")

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

interface Box { kisSnaps?: Record<string, [number, number, number]>; kisDay?: UsKisDay; at?: number; lastCum: number; minutes: Map<string, UsMinute>; big: UsBig[]; gaps: number; since?: string; last?: string; base?: number; price?: number; priceKrw?: number; date: string }
type Saved = Omit<Box, "minutes"> & { minutes: UsMinute[] };
const boxes = new Map<string, Box>();
const listeners = new Map<string, Set<() => void>>();
const notify = (code: string) => listeners.get(code)?.forEach(f => f());
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
  b.big = b.big.slice(0, 400);
  const last = fresh[fresh.length - 1];
  b.lastCum = last.cum; b.since ??= fresh[0].et; b.last = last.et;
  b.price = last.price; b.priceKrw = last.priceKrw; if (last.base) b.base = last.base;
  b.at = Date.now();
  save(code, b);
  notify(code);
}

// ─── 배경 수집 — 앱이면 화면을 안 열어도 미국 장 시간엔 계속 받아 둔다(국내 삼성전자·하이닉스처럼, 사용자 2026-11-21 "미리 받아두는 건?") ───
//   앱은 직접 요청이라 공용 프록시 부담이 없다. 웹은 그대로(화면을 켠 동안만) — 4종목 × 5초를 늘 부르면 공용 프록시가 버티지 못한다.
//   미국 평일 ET 04:00~20:00(프리~애프터)만. 토스 데이마켓(밤)은 거래가 얇아 뺐다
let bgTimer: ReturnType<typeof setInterval> | null = null;
export function usBgRunning(): boolean { return bgTimer != null; }
export function startUsBackgroundTicks() {
  if (bgTimer || !isDirectApp()) return;
  const poll = async () => {
    const n = etNow(), wd = new Date(`${n.date}T12:00:00Z`).getUTCDay();
    if (wd === 0 || wd === 6 || n.min < 4 * 60 || n.min >= 20 * 60) return;
    for (const s of US_SEMI_STOCKS) {
      try { ingestUsTicks(s.toss, await fetchTossUsTicks(s.toss)); } catch { /* 다음 차례 */ }
    }
  };
  void poll();
  bgTimer = setInterval(poll, POLL_MS);
  startKisSampler();
}

// ─── 한투 1분 기록 — 앱 + 한국투자 연동이면 4종목의 누적 거래량(tvol)·당일 체결강도(vpow)를 매분 한 번(사용자 2026-11-21 "진행하자").
//   한투 해외 체결추이(HHDFS76200300)는 최근 100건만 주고 거슬러 못 간다(실측) — 대신 행마다 붙는 tvol·vpow 를 분마다 찍어 두면
//   두 시점의 차이 = 그 1분의 매수·매도(국내 거슬러 채우기와 같은 식: 매수 누적 = tvol × r ÷ (100 + r)). 토스 100건 표본과 달리 빠짐이 없다.
//   4종목 × 1분 1콜. 매분 3초에(앞 분이 막 끝난 뒤)
const EXCD: Record<string, string> = { MU: "NAS", NVDA: "NAS", SKHY: "NAS", ANT: "NAS" };
type KisCcnl = { khms?: string; last?: string; tvol?: string; vpow?: string };
async function kisSnap(ticker: string): Promise<{ khms: string; price: number; tvol: number; vpow: number } | null> {
  const { body } = await kisGet<{ rt_cd?: string; output2?: KisCcnl[] }>("/uapi/overseas-price/v1/quotations/inquire-ccnl", "HHDFS76200300",
    { EXCD: EXCD[ticker] ?? "NAS", AUTH: "", KEYB: "", TDAY: "1", SYMB: ticker });
  const r = body.output2?.[0];
  const tvol = Number(r?.tvol), vpow = Number(r?.vpow), price = Number(r?.last);
  return r?.khms && tvol > 0 && vpow > 0 ? { khms: r.khms, price, tvol, vpow } : null;
}
let kisTimer: ReturnType<typeof setTimeout> | null = null;
function startKisSampler() {
  if (kisTimer) return;
  const run = async () => {
    const n = etNow(), wd = new Date(`${n.date}T12:00:00Z`).getUTCDay();
    if (isKisLinkOn() && !(wd === 0 || wd === 6 || n.min < 4 * 60 || n.min >= 20 * 60)) {
      for (const s of US_SEMI_STOCKS) {
        try {
          const v = await kisSnap(s.ticker);
          if (!v) continue;
          const b = box(s.toss);
          const k = Number(v.khms.slice(0, 2)) * 60 + Number(v.khms.slice(2, 4));
          const key = hm((k - n.kstDiff + 1440) % 1440);   // 마지막 체결의 ET 분 = 그 분까지의 누적
          const buy = (v.tvol * v.vpow) / (100 + v.vpow);
          (b.kisSnaps ??= {})[key] = [buy, v.tvol - buy, v.price];
          b.kisDay = { vpow: v.vpow, tvol: v.tvol, buy, sell: v.tvol - buy, at: key };
          save(s.toss, b); notify(s.toss);
        } catch { /* 다음 분 */ }
      }
    }
    kisTimer = setTimeout(run, 60_000 - (Date.now() % 60_000) + 3_000);
  };
  kisTimer = setTimeout(run, 60_000 - (Date.now() % 60_000) + 3_000);
}

/** 한투 1분 기록 → 분별 매수·매도(바로 앞 분 기록이 있는 분만). 금액 = 수량 × 그 분 값 × 환율(토스 원화/달러) */
function kisMinutes(b: Box): Map<string, UsMinute> {
  const out = new Map<string, UsMinute>();
  const sn = b.kisSnaps ?? {};
  const keys = Object.keys(sn).sort();
  const fx = b.price && b.priceKrw ? b.priceKrw / b.price : 0;
  const toM = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  for (let i = 1; i < keys.length; i++) {
    const a = sn[keys[i - 1]], c = sn[keys[i]];
    if (toM(keys[i]) - toM(keys[i - 1]) !== 1) continue;   // 사이에 빠진 분이 있으면 어느 분 것인지 몰라 건너뛴다
    const bv = Math.max(0, c[0] - a[0]), sv = Math.max(0, c[1] - a[1]);
    out.set(keys[i], { t: keys[i], buyVol: bv, sellVol: sv, buyAmt: bv * c[2] * fx, sellAmt: sv * c[2] * fx, close: c[2], kis: true });
  }
  return out;
}

export function useUsTickFlow(tossCode: string, enabled = true): UsTickFlow {
  const [, setVer] = useState(0);
  const [error, setError] = useState<string>();
  useEffect(() => {   // 배경 수집이 넣으면 다시 그린다
    const set = listeners.get(tossCode) ?? listeners.set(tossCode, new Set()).get(tossCode)!;
    const f = () => setVer(v => v + 1);
    set.add(f);
    return () => { set.delete(f); };
  }, [tossCode]);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const tick = async () => {
      // 앱 배경 수집이 미국 장 시간에 이미 받는 중이면 화면은 따로 안 부른다(같은 호출 두 번 방지)
      if (document.hidden || (usBgRunning() && US_SEMI_STOCKS.some(s => s.toss === tossCode) && Date.now() - (box(tossCode).at ?? 0) < 15_000)) return;
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
  // 켜기 전·꺼져 있던 분은 1분봉(가격·거래량)으로 — 5분마다, **최근 2시간만**(사용자 2026-11-21 "켜기 전의 거래기록은 없어?" → "2시간 정도만")
  const [fill, setFill] = useState<Map<string, UsMinute>>(new Map());
  useEffect(() => {
    if (!enabled || !FILL_ON) return;   // 48시간 그래프는 5분봉으로 가격을 그려 이제 안 받는다(사용자 2026-11-21) — 호출 절약
    let alive = true;
    const load = () => fetchTossUsMinuteToday(tossCode, etNow().date, FILL_MIN + 10).then(cs => {
      const now = etNow().min, from = hm(Math.max(0, now - FILL_MIN));
      if (alive) setFill(new Map(cs.filter(c => c.t >= from).map(c => [c.t, { t: c.t, buyVol: 0, sellVol: 0, buyAmt: 0, sellAmt: 0, close: c.close, est: true, amt: c.amt }])));
    }).catch(() => { /* 없으면 빈칸 */ });
    void load();
    const id = setInterval(load, 5 * 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [tossCode, enabled]);
  const b = box(tossCode);
  // 실시간이 있는 분은 실시간, 없는 분만 1분봉. 마지막 실시간 분 뒤의 1분봉은 버린다(진행 중인 분을 덮지 않게)
  const merged = new Map(b.minutes);
  for (const [t, m] of kisMinutes(b)) merged.set(t, { ...m, close: merged.get(t)?.close ?? m.close });   // 한투로 정확히 나눈 분이 있으면 그걸로(토스 표본 대신)
  const lastReal = b.last?.slice(0, 5);
  for (const [t, m] of fill) if (!merged.has(t) && (!lastReal || t < lastReal)) merged.set(t, m);
  return { kisDay: b.kisDay, minutes: [...merged.values()].sort((x, y) => x.t.localeCompare(y.t)), big: b.big, gaps: b.gaps, since: b.since, last: b.last, base: b.base, price: b.price, priceKrw: b.priceKrw, error, etDate: b.date };
}
