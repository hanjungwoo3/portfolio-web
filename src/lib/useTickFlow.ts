// 한국투자 연동(앱)이면 웹소켓 체결을 1초마다 받아 같은 통에 넣는다(lib/kisWs, 사용자 2026-11-02) — 그동안 토스 폴링은 쉰다.
//   웹소켓이 끊기거나 실패하면(kisWsLive false) 토스 5초 폴링이 그대로 이어받는다. 둘 다 누적 거래량(cum)으로 중복을 거른다.
// 종목 실시간 체결 누적 — 토스 ticks(최근 300건 ≈ 수십 초)를 5초마다 받아 **이 화면이 켜진 동안** 1분 단위로 쌓는다.
//   과거 체결을 거슬러 받는 API 가 없다 → **오늘치를 이 브라우저(localStorage)에 저장**해 새로고침·재방문에도 잇는다
//   (사용자 요청 2026-10-21). 날짜(KST)가 바뀌면 버린다. 꺼져 있던 동안은 못 받으니 빈 구간으로 센다.
//   중복 제거: 체결마다 붙는 누적 거래량(cum)이 단조 증가라 마지막 cum 보다 큰 것만 새 체결로 본다.
//   두 번 받는 사이 300건을 넘게 체결되면 빈 구간이 생긴다 → gaps 로 세어 화면에 알린다.
import { useEffect, useState } from "react";
import { fetchTossTicks, fetchTossMinuteToday } from "./api";
import { kisWsLive, subscribeKisTicks } from "./kisWs";
import { tickBox, ingestTicks, onBox, BIG_STEPS, type MinuteFlow, type BigTrade } from "./tickStore";
import { backfillTickMinutes, backfillPct } from "./kisTickBackfill";

// 통(1분 매수·매도 누적)은 lib/tickStore — 앱이면 창을 닫아도 대표 종목을 계속 받고(배경 수집), 빈 분은 한투로 거슬러 채운다(사용자 2026-11-10)
export type { MinuteFlow, BigTrade } from "./tickStore";
export { BIG_STEPS } from "./tickStore";
export interface TickFlow { minutes: MinuteFlow[]; big: BigTrade[]; gaps: number; since?: string; last?: string; error?: string; backfilling?: boolean; syncPct?: number | null }

const POLL_MS = 5_000;
const BIG_MIN = BIG_STEPS[BIG_STEPS.length - 1];
/** 보여 줄 큰 체결 기준 — 그 이상이 5건 이상 쌓인 가장 높은 단계(없으면 가장 낮은 단계) */
export function bigThreshold(big: BigTrade[]): number {
  return BIG_STEPS.find(t => big.filter(b => b.amt >= t).length >= 5) ?? BIG_MIN;
}
/** 1억 → "1억", 5천만 → "5천만" */
export const wonStep = (t: number) => (t >= 1e8 ? `${t / 1e8}억` : `${t / 1e7}천만`);
const nowHm = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(11, 16);

export function useTickFlow(code: string, enabled = true): TickFlow {
  const [, setVer] = useState(0);
  useEffect(() => onBox(code, () => setVer(v => v + 1)), [code]);
  const [backfilling, setBackfilling] = useState(false);
  // 실시간 체결이 없는 분은 1분봉(가격·거래량)으로 — 켜기 전·창을 닫았던 구간이 빈칸으로 시작하지 않게(사용자 2026-11-09)
  //   앱(한국투자)이면 그 분들의 매수·매도를 한투로 거슬러 채운다(사용자 2026-11-10)
  const [fill, setFill] = useState<Map<string, MinuteFlow>>(new Map());
  useEffect(() => {
    if (!enabled || !/^[\dA-Za-z]{6}$/.test(code)) return;
    let alive = true;
    const load = () => fetchTossMinuteToday(code).then(cs => {
      if (!alive) return;
      setFill(new Map(cs.map(c => [c.t, { t: c.t, buyVol: 0, sellVol: 0, buyAmt: 0, sellAmt: 0, close: c.close, vol: c.volume, est: true }])));
      const box = tickBox(code), cur = nowHm();
      const wanted = cs.map(c => c.t).filter(t => t < cur && !box.minutes.has(t));   // 진행 중인 분은 빼고
      if (wanted.length) { setBackfilling(true); void backfillTickMinutes(code, wanted).finally(() => { if (alive) setBackfilling(false); }); }
    }).catch(() => { /* 없으면 지금처럼 빈칸 */ });
    void load();
    const id = setInterval(load, 5 * 60_000);   // 창을 닫았다 다시 연 사이의 빈칸도 메운다
    return () => { alive = false; clearInterval(id); };
  }, [code, enabled]);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const tick = async () => {
      // 웹소켓이 살아 있고 **실제로 체결이 들어오는 중**일 때만 토스는 쉰다(NXT 시간엔 한투 KRX 체결이 조용할 수 있다)
      if (document.hidden || (kisWsLive() && Date.now() - tickBox(code).kisLastAt < 20_000)) return;
      try {
        const ts = await fetchTossTicks(code);
        if (!alive) return;
        setError(undefined);
        ingestTicks(code, ts, "toss");
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    const unsub = subscribeKisTicks(code, ts => { if (alive) { setError(undefined); ingestTicks(code, ts, "kis"); } });
    void tick();
    const id = setInterval(tick, POLL_MS);
    return () => { alive = false; clearInterval(id); unsub(); };
  }, [code, enabled]);
  const s = tickBox(code);
  // 실시간·거슬러 채운 분이 있으면 그것, 없는 분만 1분봉으로. 맨 마지막 실시간 분 뒤의 1분봉은 버린다(진행 중인 분을 덮지 않게)
  const merged = new Map(s.minutes);
  const lastReal = s.last?.slice(0, 5);
  for (const [t, m] of fill) if (!merged.has(t) && (!lastReal || t < lastReal)) merged.set(t, m);
  return { minutes: [...merged.values()].sort((a, b) => a.t.localeCompare(b.t)), big: s.big, gaps: s.gaps, since: s.since, last: s.last, error, backfilling, syncPct: backfillPct(code) };
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
