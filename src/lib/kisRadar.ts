// 거래대금 급증 레이더 — 앱 + 한국투자 연동일 때, 지수·업종 화면의 국내 개별 종목을 1분마다 훑어
//   "최근 몇 분 거래대금 페이스가 오늘 평균 페이스의 몇 배인가" 를 잰다(사용자 2026-11-03 "순서대로" ①).
//   출처: 한국투자 관심종목(멀티종목) 시세 FHKST11300006 — 30종목에 1콜, acml_tr_pbmn(누적 거래대금, 원). 실전 키 실측 2026-11-03.
//   시장 코드 UN(통합 KRX+NXT) — J(KRX)는 프리장에 0 이었다(실측 2026-11-04 08:05, 삼성 UN 1,254억·J 0). 08:00~20:00.
//   장 구간(프리 08:00~08:50 · 정규 09:00~15:30 · 애프터 15:30~20:00)마다 거래 속도가 크게 달라 **같은 구간 안 평균**과 비교한다
//   (오늘 전체 평균과 비교하면 9시 정규장이 열리는 순간 모든 종목이 급증으로 뜬다).
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
// 종목별 이번 장 구간의 첫 스냅숏 — 구간 평균 페이스의 기준
const sessStart = new Map<string, { sess: Sess; t: number; v: number }>();
let hits = new Map<string, RadarHit>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(f => f());

export type Sess = "pre" | "reg" | "after";
/** 장 구간 — 08:00~08:50 프리(NXT) · 09:00~15:30 정규 · 15:30~20:00 애프터(NXT). 그 밖은 null */
export function sessionOf(t: number): Sess | null {
  const k = new Date(t + 9 * 3600_000), d = k.getUTCDay(), m = k.getUTCHours() * 60 + k.getUTCMinutes();
  if (d === 0 || d === 6) return null;
  if (m >= 8 * 60 && m < 8 * 60 + 50) return "pre";
  if (m >= 9 * 60 && m < 15 * 60 + 30) return "reg";
  if (m >= 15 * 60 + 30 && m < 20 * 60) return "after";
  return null;
}

interface MultRow { inter_shrn_iscd?: string; acml_tr_pbmn?: string }
async function fetchBatch(codes: string[]): Promise<MultRow[]> {
  const p: Record<string, string> = {};
  codes.forEach((c, i) => { p[`FID_COND_MRKT_DIV_CODE_${i + 1}`] = "UN"; p[`FID_INPUT_ISCD_${i + 1}`] = c; });
  const { body } = await kisGet<{ rt_cd?: string; output?: MultRow[] }>("/uapi/domestic-stock/v1/quotations/intstock-multprice", "FHKST11300006", p);
  return body.output ?? [];
}

async function tick() {
  const now = Date.now(), sess = sessionOf(now);
  if (!isKisLinkOn() || !sess) return;
  for (let i = 0; i < RADAR_CODES.length; i += 30) {
    let rows: MultRow[] = [];
    try { rows = await fetchBatch(RADAR_CODES.slice(i, i + 30)); } catch { continue; }   // 한 묶음 실패는 다음 분에
    for (const r of rows) {
      const c = r.inter_shrn_iscd, v = Number(r.acml_tr_pbmn);
      if (!c || !(v >= 0)) continue;
      const arr = snaps.get(c) ?? snaps.set(c, []).get(c)!;
      arr.push({ t: now, v });
      if (sessStart.get(c)?.sess !== sess) sessStart.set(c, { sess, t: now, v });
      while (arr.length && now - arr[0].t > KEEP_MS) arr.shift();
    }
  }
  const next = new Map<string, RadarHit>();
  for (const [c, arr] of snaps) { const st = sessStart.get(c); if (st?.sess !== sess) continue; const h = radarHitOf(arr, now, st); if (h) next.set(c, h); }
  hits = next;
  emit();
}

/** 한 종목 스냅숏(누적 거래대금, 시각순) → 급증이면 정보. 순수 함수(테스트용) */
export function radarHitOf(arr: { t: number; v: number }[], now: number, start: { t: number; v: number }): RadarHit | null {
  const last = arr[arr.length - 1];
  if (!last || now - last.t > 3 * 60_000) return null;
  // 창 시작 = 5분 전에 가장 가까운(그보다 오래되지 않은) 스냅숏
  const base = arr.find(s => last.t - s.t <= WINDOW_MIN * 60_000 + 30_000) ?? arr[0];
  const span = (last.t - base.t) / 60_000;
  if (span < MIN_SPAN_MIN) return null;
  const dv = last.v - base.v;
  // 구간 평균 = 이 구간 첫 스냅숏부터 지금까지 — 10분은 쌓여야(장 시작 직후·앱을 막 켰을 때 평균이 흔들린다)
  const elapsed = (last.t - start.t) / 60_000;
  if (elapsed < 10 || dv < HOT_MIN_WON) return null;
  const avg = (last.v - start.v) / elapsed, perMin = dv / span;
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
    title: `거래대금 급증 — 최근 ${h.windowMin}분 페이스가 이번 장 구간(프리·정규·애프터) 평균의 ${h.ratio.toFixed(1)}배 (분당 ${eok >= 10 ? Math.round(eok) : eok.toFixed(1)}억 원) · 한국투자 1분마다`,
  };
}
