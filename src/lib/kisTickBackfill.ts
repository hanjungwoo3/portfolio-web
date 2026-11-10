// 빈 분 거슬러 채우기 — 한국투자 '주식현재가 당일시간대별체결' FHPST01060000(앱 + 한국투자 연동만, 사용자 2026-11-10).
//   이 API 는 지정 시각 이전 체결 **30건**만 준다 → 체결을 하나하나 모으면 삼성전자 1시간 반에 수백 번이라 못 쓴다.
//   대신 각 체결에 붙은 **누적 거래량(acml_vol)·누적 체결강도(tday_rltv = 매수÷매도×100)** 로 그 시각까지 매수·매도 누적을 나눈다:
//     매수 누적 = acml × r ÷ (100 + r), 매도 누적 = acml − 매수 누적
//   분 경계(매분 59초)마다 한 번씩만 부르면 두 경계의 차이 = 그 1분의 매수·매도 양. 1분에 1콜.
//   실측(삼성전자 10:15→10:16, 2026-11-10): 매수 19,746 + 매도 11,453 = 거래량 증가 31,199 와 일치.
//   ⚠️ 동시호가(09:00 시가 등) 거래는 체결강도에 안 들어가 그 분만 조금 어긋날 수 있다.
import { kisGet } from "./broker";
import { isKisLinkOn } from "./broker";
import { tickBox, saveBox, notifyBox, type MinuteFlow } from "./tickStore";

type Row = { stck_cntg_hour?: string; stck_prpr?: string; tday_rltv?: string; acml_vol?: string };
const num = (s?: string) => Number(String(s ?? "").replace(/,/g, "")) || 0;

/** 그 시각(HHMMSS) 이전 마지막 체결의 매수·매도 누적(주)과 값 */
async function cumAt(code: string, hhmmss: string): Promise<{ buy: number; sell: number; price: number } | null> {
  const { body } = await kisGet<{ rt_cd?: string; output2?: Row[] }>("/uapi/domestic-stock/v1/quotations/inquire-time-itemconclusion", "FHPST01060000",
    { FID_COND_MRKT_DIV_CODE: "UN", FID_INPUT_ISCD: code, FID_INPUT_HOUR_1: hhmmss });
  const r = body.output2?.[0];
  if (!r) return null;
  const acml = num(r.acml_vol), rl = num(r.tday_rltv), price = num(r.stck_prpr);
  if (!(acml > 0) || !(rl > 0)) return null;
  const buy = (acml * rl) / (100 + rl);
  return { buy, sell: acml - buy, price };
}

const minus1s = (hm: string) => {   // "10:16" → "101559" (그 분 직전 = 앞 분의 끝)
  const [h, m] = hm.split(":").map(Number);
  const t = h * 60 + m - 1;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}${String(t % 60).padStart(2, "0")}59`;
};
const nextMin = (hm: string) => { const [h, m] = hm.split(":").map(Number); const t = h * 60 + m + 1; return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };

const running = new Set<string>();
// 진행률 — 화면에 'sync 44%' (사용자 2026-11-10 "이전 data 를 sync 하는 중에 % 표시")
const progress = new Map<string, { done: number; total: number }>();
/** 채우는 중이면 0~100, 아니면 null */
export function backfillPct(code: string): number | null {
  const p = progress.get(code);
  return p && p.total > 0 ? Math.min(99, Math.floor((p.done / p.total) * 100)) : null;
}
/** wanted = 매수·매도를 모르는 분들(1분봉에만 있는 분). 최근 분부터 거꾸로, 붙어 있는 구간마다 경계 하나씩 불러 채운다 */
export async function backfillTickMinutes(code: string, wanted: string[], maxCalls = 240): Promise<number> {
  if (!isKisLinkOn() || running.has(code) || !wanted.length) return 0;
  running.add(code);
  let calls = 0, filled = 0;
  try {
    const s = tickBox(code);
    const todo = [...new Set(wanted)].filter(t => !s.minutes.has(t)).sort().reverse();   // 최근 → 과거
    const cache = new Map<string, { buy: number; sell: number; price: number } | null>();
    const at = async (hm: string) => {   // hm 분이 시작하기 직전 누적
      if (cache.has(hm)) return cache.get(hm)!;
      calls++;
      const v = await cumAt(code, minus1s(hm)).catch(() => null);
      cache.set(hm, v);
      return v;
    };
    const total = Math.min(todo.length, maxCalls);
    progress.set(code, { done: 0, total });
    notifyBox(code);
    let done = 0;
    for (const t of todo) {
      if (calls >= maxCalls) break;
      progress.set(code, { done: done++, total });
      if (done % 3 === 0) notifyBox(code);   // 막대가 채워지는 대로 % 도
      if (s.minutes.has(t)) continue;
      const a = await at(t), b = await at(nextMin(t));
      if (!a || !b) continue;
      const buyVol = Math.max(0, Math.round(b.buy - a.buy)), sellVol = Math.max(0, Math.round(b.sell - a.sell));
      if (buyVol + sellVol === 0) continue;
      const m: MinuteFlow = { t, buyVol, sellVol, buyAmt: buyVol * b.price, sellAmt: sellVol * b.price, close: b.price, back: true };
      s.minutes.set(t, m);
      filled++;
      if (filled % 5 === 0) { saveBox(code); notifyBox(code); }   // 채우는 대로 화면에
    }
  } finally {
    running.delete(code);
    progress.delete(code);
    notifyBox(code);
    if (filled) { saveBox(code); notifyBox(code); }
  }
  return filled;
}
