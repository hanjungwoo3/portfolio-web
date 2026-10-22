// 종목 실시간 체결 누적 — 토스 ticks(최근 300건 ≈ 수십 초)를 5초마다 받아 **이 화면이 켜진 동안** 1분 단위로 쌓는다.
//   과거 체결을 거슬러 받는 API 가 없다 → **오늘치를 이 브라우저(localStorage)에 저장**해 새로고침·재방문에도 잇는다
//   (사용자 요청 2026-10-21). 날짜(KST)가 바뀌면 버린다. 꺼져 있던 동안은 못 받으니 빈 구간으로 센다.
//   중복 제거: 체결마다 붙는 누적 거래량(cum)이 단조 증가라 마지막 cum 보다 큰 것만 새 체결로 본다.
//   두 번 받는 사이 300건을 넘게 체결되면 빈 구간이 생긴다 → gaps 로 세어 화면에 알린다.
import { useEffect, useRef, useState } from "react";
import { fetchTossTicks } from "./api";

export interface MinuteFlow {
  t: string;          // "HH:MM"
  buyVol: number; sellVol: number;
  buyAmt: number; sellAmt: number;   // 원
  close: number;
}
export interface BigTrade { time: string; side: "BUY" | "SELL"; amt: number; price: number; volume: number }
export interface TickFlow { minutes: MinuteFlow[]; big: BigTrade[]; gaps: number; since?: string; last?: string; error?: string }

const POLL_MS = 5_000;
const kstDate = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const storeKey = (code: string) => `semi_tickflow_${code}`;
type Saved = { date: string; lastCum: number; minutes: MinuteFlow[]; big: BigTrade[]; gaps: number; since?: string; last?: string };
function loadSaved(code: string): Saved | null {
  try {
    const v = JSON.parse(localStorage.getItem(storeKey(code)) ?? "null") as Saved | null;
    return v && v.date === kstDate() ? v : null;   // 어제 것은 버린다
  } catch { return null; }
}
// 큰 체결 기준 — 1억부터, 그 이상이 적은 종목(중소형주)은 단계를 낮춘다(사용자 요청 2026-10-22).
//   모으기는 가장 낮은 단계(1천만)부터 해 두고, 보여 줄 때 bigThreshold 로 고른다.
export const BIG_STEPS = [1e8, 5e7, 3e7, 1e7] as const;
const BIG_MIN = BIG_STEPS[BIG_STEPS.length - 1];
/** 보여 줄 큰 체결 기준 — 그 이상이 5건 이상 쌓인 가장 높은 단계(없으면 가장 낮은 단계) */
export function bigThreshold(big: BigTrade[]): number {
  return BIG_STEPS.find(t => big.filter(b => b.amt >= t).length >= 5) ?? BIG_MIN;
}
/** 1억 → "1억", 5천만 → "5천만" */
export const wonStep = (t: number) => (t >= 1e8 ? `${t / 1e8}억` : `${t / 1e7}천만`);

export function useTickFlow(code: string, enabled = true): TickFlow {
  const store = useRef<{ lastCum: number; minutes: Map<string, MinuteFlow>; big: BigTrade[]; gaps: number; since?: string; last?: string }>(null!);
  if (!store.current) {
    const sv = loadSaved(code);
    store.current = sv
      ? { lastCum: sv.lastCum, minutes: new Map(sv.minutes.map(m => [m.t, m])), big: sv.big, gaps: sv.gaps, since: sv.since, last: sv.last }
      : { lastCum: 0, minutes: new Map(), big: [], gaps: 0 };
  }
  const [, setVer] = useState(0);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const ts = await fetchTossTicks(code);
        if (!alive) return;
        setError(undefined);
        const s = store.current;
        const fresh = ts.filter(t => t.cum > s.lastCum).sort((a, b) => a.cum - b.cum);   // 응답은 최신 → 과거
        if (!fresh.length) return;
        // 이전에 받은 것과 이어지는가 — 첫 새 체결의 (cum - volume) 가 직전 마지막 cum 이면 빈틈 없음
        if (s.lastCum && fresh[0].cum - fresh[0].volume > s.lastCum) s.gaps++;
        for (const t of fresh) {
          const m = t.time.slice(0, 5);
          let b = s.minutes.get(m);
          if (!b) { b = { t: m, buyVol: 0, sellVol: 0, buyAmt: 0, sellAmt: 0, close: t.price }; s.minutes.set(m, b); }
          const amt = t.price * t.volume;
          if (t.side === "BUY") { b.buyVol += t.volume; b.buyAmt += amt; } else { b.sellVol += t.volume; b.sellAmt += amt; }
          b.close = t.price;
          if (amt >= BIG_MIN) s.big.unshift({ time: t.time, side: t.side, amt, price: t.price, volume: t.volume });
        }
        s.big = s.big.slice(0, 200);   // 낮은 단계까지 모으니 넉넉히
        s.lastCum = fresh[fresh.length - 1].cum;
        s.since ??= fresh[0].time;
        s.last = fresh[fresh.length - 1].time;
        try {
          const sv: Saved = { date: kstDate(), lastCum: s.lastCum, minutes: [...s.minutes.values()], big: s.big, gaps: s.gaps, since: s.since, last: s.last };
          localStorage.setItem(storeKey(code), JSON.stringify(sv));
        } catch { /* 저장 실패(사생활 모드·용량) — 화면은 그대로 */ }
        setVer(v => v + 1);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    void tick();
    const id = setInterval(tick, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, [code, enabled]);
  const s = store.current;
  return { minutes: [...s.minutes.values()].sort((a, b) => a.t.localeCompare(b.t)), big: s.big, gaps: s.gaps, since: s.since, last: s.last, error };
}

/** 최근 n분의 체결강도(매수 체결량 ÷ 매도 체결량 × 100) */
export function strength(ms: MinuteFlow[], n = ms.length): number | undefined {
  const xs = ms.slice(-n);
  const b = xs.reduce((a, m) => a + m.buyVol, 0), s = xs.reduce((a, m) => a + m.sellVol, 0);
  return s > 0 ? (b / s) * 100 : undefined;
}
/** 최근 n분의 순매수 체결 금액(원) */
export function netAmt(ms: MinuteFlow[], n = ms.length): number {
  return ms.slice(-n).reduce((a, m) => a + m.buyAmt - m.sellAmt, 0);
}
