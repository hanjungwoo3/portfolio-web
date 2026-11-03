// 거래대금 급증 레이더 — 앱 + 한국투자 연동일 때, 지수·업종 화면의 국내 개별 종목을 1분마다 훑어
//   "최근 몇 분 거래대금 페이스가 오늘 평균 페이스의 몇 배인가" 를 잰다(사용자 2026-11-03 "순서대로" ①).
//   출처: 한국투자 관심종목(멀티종목) 시세 FHKST11300006 — 30종목에 1콜, acml_tr_pbmn(누적 거래대금, 원). 실전 키 실측 2026-11-03.
//   정규장(09:00~15:30 KRX)만 — 멀티 시세의 J 는 KRX 값이라 NXT 애프터엔 안 늘어난다.
//   스냅숏은 메모리에만(창을 닫으면 처음부터) — 5분 창이 차기 전엔 신호를 내지 않는다.
import { useSyncExternalStore } from "react";
import { kisGet, isKisLinkOn } from "./broker";
import { US_PAIRS } from "./usMarketData";

/** 지수·업종 화면의 국내 개별 종목(ETF 제외) — 카드가 있는 종목만 */
export const RADAR_CODES: string[] = [...new Set(US_PAIRS.filter(p => p.krStock && /^[\dA-Za-z]{6}\.KS$/.test(p.symbol)).map(p => p.symbol.slice(0, 6)))];

const WINDOW_MIN = 5;          // 최근 5분 페이스
const MIN_SPAN_MIN = 2;        // 스냅숏이 2분 이상 벌어져야 잰다(앱을 막 켰을 때)
const HOT_RATIO = 3;           // 오늘 평균 페이스의 3배 이상
const HOT_MIN_WON = 3e8;       // 그 창에서 3억 원 이상 — 거래가 거의 없는 종목의 '0 → 조금' 을 거른다
const KEEP_MS = 20 * 60_000;

export interface RadarHit {
  ratio: number;        // 최근 페이스 ÷ 오늘 평균 페이스
  perMin: number;       // 최근 분당 거래대금(원)
  windowMin: number;    // 실제로 잰 창(분)
  at: number;           // 잰 시각(ms)
}
const snaps = new Map<string, { t: number; v: number }[]>();
let hits = new Map<string, RadarHit>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(f => f());

const kst = () => new Date(Date.now() + 9 * 3600_000);
function inRegular(): boolean {
  const k = kst(), d = k.getUTCDay(), m = k.getUTCHours() * 60 + k.getUTCMinutes();
  return d !== 0 && d !== 6 && m >= 9 * 60 && m <= 15 * 60 + 30;
}
/** 09:00 부터 지난 분(정규장 기준) */
function minutesSinceOpen(t: number): number {
  const k = new Date(t + 9 * 3600_000);
  return Math.min(390, k.getUTCHours() * 60 + k.getUTCMinutes() + k.getUTCSeconds() / 60 - 9 * 60);
}

interface MultRow { inter_shrn_iscd?: string; acml_tr_pbmn?: string }
async function fetchBatch(codes: string[]): Promise<MultRow[]> {
  const p: Record<string, string> = {};
  codes.forEach((c, i) => { p[`FID_COND_MRKT_DIV_CODE_${i + 1}`] = "J"; p[`FID_INPUT_ISCD_${i + 1}`] = c; });
  const { body } = await kisGet<{ rt_cd?: string; output?: MultRow[] }>("/uapi/domestic-stock/v1/quotations/intstock-multprice", "FHKST11300006", p);
  return body.output ?? [];
}

async function tick() {
  if (!isKisLinkOn() || !inRegular()) return;
  const now = Date.now();
  for (let i = 0; i < RADAR_CODES.length; i += 30) {
    let rows: MultRow[] = [];
    try { rows = await fetchBatch(RADAR_CODES.slice(i, i + 30)); } catch { continue; }   // 한 묶음 실패는 다음 분에
    for (const r of rows) {
      const c = r.inter_shrn_iscd, v = Number(r.acml_tr_pbmn);
      if (!c || !(v >= 0)) continue;
      const arr = snaps.get(c) ?? snaps.set(c, []).get(c)!;
      arr.push({ t: now, v });
      while (arr.length && now - arr[0].t > KEEP_MS) arr.shift();
    }
  }
  const next = new Map<string, RadarHit>();
  for (const [c, arr] of snaps) { const h = radarHitOf(arr, now); if (h) next.set(c, h); }
  hits = next;
  emit();
}

/** 한 종목 스냅숏(누적 거래대금, 시각순) → 급증이면 정보. 순수 함수(테스트용) */
export function radarHitOf(arr: { t: number; v: number }[], now: number): RadarHit | null {
  const last = arr[arr.length - 1];
  if (!last || now - last.t > 3 * 60_000) return null;
  // 창 시작 = 5분 전에 가장 가까운(그보다 오래되지 않은) 스냅숏
  const base = arr.find(s => last.t - s.t <= WINDOW_MIN * 60_000 + 30_000) ?? arr[0];
  const span = (last.t - base.t) / 60_000;
  if (span < MIN_SPAN_MIN) return null;
  const dv = last.v - base.v;
  const elapsed = minutesSinceOpen(last.t);
  if (elapsed < 10 || dv < HOT_MIN_WON) return null;   // 장 시작 10분은 동시호가 물량이 평균을 흐린다
  const avg = last.v / elapsed, perMin = dv / span;
  const ratio = avg > 0 ? perMin / avg : 0;
  return ratio >= HOT_RATIO ? { ratio, perMin, windowMin: Math.round(span), at: last.t } : null;
}

let started = false;
/** 앱이 켜진 동안 1분마다(어느 탭이든 — 창이 차야 신호가 나므로) */
export function startKisRadar(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  void tick();
  setInterval(() => { void tick(); }, 60_000);
}

/** 종목코드 → 급증 정보(없으면 급증 아님) */
export function useKisRadar(): Map<string, RadarHit> {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => hits, () => hits);
}

/** 카드 꼬리표 문구·설명 */
export function radarLabel(h: RadarHit): { text: string; title: string } {
  const eok = h.perMin / 1e8;
  return {
    text: `🔥거래 ×${h.ratio >= 10 ? Math.round(h.ratio) : h.ratio.toFixed(1)}`,
    title: `거래대금 급증 — 최근 ${h.windowMin}분 페이스가 오늘 평균의 ${h.ratio.toFixed(1)}배 (분당 ${eok >= 10 ? Math.round(eok) : eok.toFixed(1)}억 원) · 한국투자 1분마다`,
  };
}
