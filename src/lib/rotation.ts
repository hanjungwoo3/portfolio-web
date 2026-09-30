// AI 순환매 — 한국 AI 생태계 6단계(반도체·전공정·후공정·전력기기·원자력·친환경)의 흐름.
//
// 무엇을 보여주나
//   ① 지금 어느 단계가 강한가(1주·4주·13주)
//   ② 다음 후보 — **최근 4주 가장 소외된 단계**. 그 규칙의 과거 성적을 늘 같이 낸다.
//   ③ 주별 1등 히스토리 · ④ 간밤 미국 대장주 → 오늘 한국 · ⑤ 순서가 있나(통계)
//
// ★ 왜 "현재 1등 → 다음 단계" 가 아니라 "소외 단계" 인가 — 97주 실측(2026-09-30):
//     현재 1등 기준 바통 터치 통계로 고르면 다음 주 평균 대비 -0.99%p(t=-0.96) — 무작위보다 못했다.
//     최근 4주 꼴찌를 고르면 **뒤 절반**에선 +2.17%p 였다.
//   ⚠️ 그런데 **전체 93주로 보면 +0.55%p(t=0.90)** 이고 앞 절반은 오히려 마이너스였다.
//     최근엔 맞았지만 그 전엔 반대였다 — 불안정한 신호다. 처음엔 뒤 절반만 재서 과대평가했다.
//   그래서 화면에 **앞/뒤 절반을 나눈 성적**을 매번 다시 계산해 같이 보여준다.
//     데이터가 쌓이며 규칙이 맞는지 틀어지는지가 그대로 드러나게.
//
// 호출 비용: 한국 20종목 일봉 20콜 + 미국 대장주 1년 일봉 6콜(상관 계산) + 시세 배치 1콜.
//   계산 결과(수 KB)를 localStorage 에 6시간 캐시한다.

import { fetchTossKrCandles, fetchYahooPriceHistory } from "./api";

export type Family = "chip" | "energy";
export interface Stage {
  key: string;
  label: string;
  family: Family;
  members: { code: string; name: string }[];
  us: { symbol: string; name: string };   // 간밤에 이 단계를 끌고 오는 미국 대장주(상관 1위 — 통계는 이것만 쓴다)
  us2: { symbol: string; name: string };  // 2위 — 카드에만 같이 보여 준다
}

// 단계 정의 — 한 벌. 미국 대장주는 '미국 직전 거래일 ↔ 한국 다음 날' 상관 1위(2026-09-30 실측).
export const STAGES: Stage[] = [
  // 한국 쪽은 **섹터 ETF** — 종목 3~4개 묶음보다 미국 대장주 전날 ↔ 한국 다음 날 상관이 7단계 모두 높았다
  //   (분산돼 개별 종목 소음이 준다, 2026-10-01 실측 ~300거래일). 미국은 상관 1·2위.
  //   소재·부품은 뺐다 — ETF 로 보면 전공정(주간 0.91)·후공정(0.96)과 한 몸이고, 미국 1·2위도 전공정과 같았다.
  { key: "semi", label: "반도체", family: "chip",
    members: [{ code: "396500", name: "TIGER 반도체TOP10" }, { code: "091160", name: "KODEX 반도체" },
              { code: "091230", name: "TIGER 반도체" }],
    us: { symbol: "SNDK", name: "샌디스크" }, us2: { symbol: "MU", name: "마이크론" } },
  { key: "front", label: "전공정", family: "chip",
    members: [{ code: "475300", name: "SOL 반도체전공정" }, { code: "471990", name: "KODEX AI반도체핵심장비" },
              { code: "471760", name: "TIGER AI반도체핵심공정" }],
    us: { symbol: "LRCX", name: "램리서치" }, us2: { symbol: "AMAT", name: "어플라이드" } },
  { key: "back", label: "후공정", family: "chip",
    members: [{ code: "475310", name: "SOL 반도체후공정" }, { code: "455850", name: "SOL AI반도체소부장" }],
    us: { symbol: "KLAC", name: "KLA" }, us2: { symbol: "ONTO", name: "온투" } },
  { key: "power", label: "전력기기", family: "energy",
    members: [{ code: "487240", name: "KODEX AI전력핵심설비" }, { code: "491820", name: "HANARO 전력설비투자" },
              { code: "0117V0", name: "TIGER 코리아AI전력기기TOP3플러스" }],
    us: { symbol: "PWR", name: "콴타서비스" }, us2: { symbol: "GEV", name: "GE버노바" } },
  { key: "nuclear", label: "원자력", family: "energy",
    members: [{ code: "433500", name: "ACE 원자력TOP10" }, { code: "0098F0", name: "KODEX 원자력SMR" },
              { code: "0091P0", name: "TIGER 코리아원자력" }],
    us: { symbol: "CCJ", name: "카메코" }, us2: { symbol: "OKLO", name: "오클로" } },
  { key: "green", label: "친환경", family: "energy",
    members: [{ code: "377990", name: "TIGER Fn신재생에너지" }, { code: "385510", name: "KODEX 신재생에너지액티브" },
              { code: "381570", name: "HANARO Fn친환경에너지" }],
    us: { symbol: "BE", name: "블룸에너지" }, us2: { symbol: "FSLR", name: "퍼스트솔라" } },
];

export const LAG_WEEKS = 4;   // 소외 판정 창(주). 뒤 절반에서 1·2·4주가 같은 방향이었다 — 전체로는 약하다(파일 상단)

export interface RotationData {
  builtAt: number;
  weeks: string[];                        // ISO 주 (마지막은 진행 중일 수 있다)
  weekly: Record<string, number[]>;       // 단계 → 주별 수익률(%) (weeks[i] 는 weeks[i-1]→weeks[i])
  lastWeekPartial: boolean;               // 마지막 주가 아직 안 끝났나
  usCorr: Record<string, number | null>;  // 단계 → 미국 대장주 전날 ↔ 한국 다음 날 상관
  days: string[];                         // 최근 거래일(오름차순, 최대 DAILY_KEEP) — 일별 등락 그래프용
  daily: Record<string, number[]>;        // 단계 → 일별 수익률(%) (days[i] 하루치, 동일가중)
}

const LS_KEY = "ai_rotation_v4";   // v4: 한국 쪽을 섹터 ETF 로 — 옛 캐시는 종목 기준이라 새로 받는다
const DAILY_KEEP = 120;
const TTL_MS = 6 * 60 * 60 * 1000;

function isoWeek(d: string): string {
  const dt = new Date(`${d}T00:00:00Z`);
  const day = (dt.getUTCDay() + 6) % 7;            // 월=0
  dt.setUTCDate(dt.getUTCDate() - day + 3);        // 그 주 목요일
  const y = dt.getUTCFullYear();
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const w = 1 + Math.round(((dt.getTime() - jan4.getTime()) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${y}-W${String(w).padStart(2, "0")}`;
}
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
function corr(a: number[], b: number[]): number | null {
  if (a.length < 20 || a.length !== b.length) return null;
  const ma = mean(a), mb = mean(b);
  let c = 0, va = 0, vb = 0;
  for (let i = 0; i < a.length; i++) {
    c += (a[i] - ma) * (b[i] - mb); va += (a[i] - ma) ** 2; vb += (b[i] - mb) ** 2;
  }
  return va > 0 && vb > 0 ? c / Math.sqrt(va * vb) : null;
}

export function loadCachedRotation(): RotationData | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as RotationData;
    // 빈 결과는 캐시로 치지 않는다 — 일시적 0건이 TTL 동안 굳는다.
    if (!d.weeks || d.weeks.length < 10 || !d.days?.length || Date.now() - d.builtAt > TTL_MS) return null;
    return d;
  } catch { return null; }
}

export async function fetchRotation(): Promise<RotationData> {
  const codes = STAGES.flatMap(s => s.members.map(m => m.code));
  // 한국 일봉 — 동시 6개씩
  const kr: Record<string, { date: string; close: number }[]> = {};
  const queue = [...codes];
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (;;) {
      const c = queue.shift();
      if (!c) return;
      try { kr[c] = (await fetchTossKrCandles(c, "day", 450)).map(p => ({ date: p.date, close: p.close })); }
      catch { kr[c] = []; }
    }
  }));

  // ── 주별: 종목별 주말 종가 → 단계 동일가중 주간 수익률
  const weekClose: Record<string, Map<string, number>> = {};
  for (const c of codes) {
    const m = new Map<string, number>();
    for (const p of kr[c] ?? []) m.set(isoWeek(p.date), p.close);   // 날짜 오름차순 → 주의 마지막 종가가 남는다
    weekClose[c] = m;
  }
  const weekSets = codes.map(c => new Set(weekClose[c].keys())).filter(s => s.size > 0);
  const weeks = weekSets.length ? [...weekSets[0]].filter(w => weekSets.every(s => s.has(w))).sort() : [];
  const weekly: Record<string, number[]> = {};
  for (const st of STAGES) {
    weekly[st.key] = [];
    for (let i = 1; i < weeks.length; i++) {
      const rs = st.members.map(m => {
        const a = weekClose[m.code].get(weeks[i - 1]), b = weekClose[m.code].get(weeks[i]);
        return a && b ? (b / a - 1) * 100 : 0;
      });
      weekly[st.key].push(mean(rs));
    }
  }
  const lastWeekPartial = weeks.length > 0 && weeks[weeks.length - 1] === isoWeek(new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10));

  // ── 일별: 단계 동일가중 일간 수익률 (미국 대장주 상관용)
  const dayRet = (c: string) => {
    const s = kr[c] ?? [];
    const m = new Map<string, number>();
    for (let i = 1; i < s.length; i++) if (s[i - 1].close > 0) m.set(s[i].date, s[i].close / s[i - 1].close - 1);
    return m;
  };
  // 단계별 일별 등락(%) — 모든 종목에 값이 있는 날만, 최근 DAILY_KEEP 일
  const rets = new Map(codes.map(c => [c, dayRet(c)] as const));
  const dsets = codes.map(c => rets.get(c)!).filter(m => m.size > 0);
  const days = dsets.length ? [...dsets[0].keys()].filter(d => dsets.every(m => m.has(d))).sort().slice(-DAILY_KEEP) : [];
  const daily: Record<string, number[]> = {};
  for (const st of STAGES) daily[st.key] = days.map(d => mean(st.members.map(m => rets.get(m.code)?.get(d) ?? 0)) * 100);

  const usCorr: Record<string, number | null> = {};
  await Promise.all(STAGES.map(async st => {
    try {
      const mem = st.members.map(m => dayRet(m.code));
      const days = [...mem[0].keys()].filter(d => mem.every(m => m.has(d))).sort();
      const basket = new Map(days.map(d => [d, mean(mem.map(m => m.get(d)!))]));
      const us = await fetchYahooPriceHistory(st.us.symbol, "1y");
      const ud: { date: string; r: number }[] = [];
      for (let i = 1; i < us.length; i++) if (us[i - 1].close > 0) ud.push({ date: us[i].date, r: us[i].close / us[i - 1].close - 1 });
      // 한국 d 일 ← 그 직전 미국 거래일(미국장은 한국 새벽에 끝난다)
      const xs: number[] = [], ys: number[] = [];
      let j = 0;
      for (const d of days) {
        while (j < ud.length && ud[j].date < d) j++;
        if (j === 0) continue;
        xs.push(ud[j - 1].r); ys.push(basket.get(d)!);
      }
      usCorr[st.key] = corr(xs, ys);
    } catch { usCorr[st.key] = null; }
  }));

  const data: RotationData = { builtAt: Date.now(), weeks, weekly, lastWeekPartial, usCorr, days, daily };
  if (weeks.length >= 10) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch { /* 용량 — 캐시 없이 동작 */ }
  }
  return data;
}

// ───────── 계산 ─────────
export const sumLast = (a: number[], n: number, end = a.length) => {
  let s = 1;
  for (let k = Math.max(0, end - n); k < end; k++) s *= 1 + a[k] / 100;
  return (s - 1) * 100;
};

// 소외 단계 규칙 — 끝(end) 직전 LAG_WEEKS 주 누적이 가장 약한 단계
export function laggardAt(d: RotationData, end: number): string {
  return STAGES.reduce((best, st) =>
    sumLast(d.weekly[st.key], LAG_WEEKS, end) < sumLast(d.weekly[best.key], LAG_WEEKS, end) ? st : best,
  STAGES[0]).key;
}

// 규칙의 과거 성적 — 각 주 t 에서 직전 4주 꼴찌를 골랐다면 t 주에 평균보다 얼마나 나았나.
//   진행 중인 마지막 주는 결과가 아직 없으니 뺀다. 앞/뒤 절반을 따로 낸다 — 한쪽에서만 맞으면
//   규칙이 아니라 그 시기의 우연이다(실제로 앞 절반 마이너스 · 뒤 절반 플러스였다).
export interface Half { n: number; meanEx: number; wins: number }
export interface TrackRecord {
  n: number; meanEx: number; t: number; wins: number;
  first: Half; second: Half;
}
function half(ex: number[]): Half {
  return { n: ex.length, meanEx: ex.length ? mean(ex) : 0, wins: ex.filter(x => x > 0).length };
}
export function trackRecord(d: RotationData): TrackRecord | null {
  const T = d.weekly[STAGES[0].key].length - (d.lastWeekPartial ? 1 : 0);
  const ex: number[] = [];
  for (let t = LAG_WEEKS; t < T; t++) {
    const p = laggardAt(d, t);
    const avg = mean(STAGES.map(s => d.weekly[s.key][t]));
    ex.push(d.weekly[p][t] - avg);
  }
  if (ex.length < 10) return null;
  const m = mean(ex);
  const sd = Math.sqrt(ex.reduce((s, x) => s + (x - m) ** 2, 0) / (ex.length - 1));
  const mid = Math.floor(ex.length / 2);
  return {
    n: ex.length, meanEx: m, t: sd > 0 ? m / (sd / Math.sqrt(ex.length)) : 0,
    wins: ex.filter(x => x > 0).length,
    first: half(ex.slice(0, mid)), second: half(ex.slice(mid)),
  };
}

// 주별 1등
export function leaders(d: RotationData): string[] {
  const T = d.weekly[STAGES[0].key].length;
  return Array.from({ length: T }, (_, t) =>
    STAGES.reduce((b, s) => (d.weekly[s.key][t] > d.weekly[b.key][t] ? s : b), STAGES[0]).key);
}

// 선행 상관 — A 이번 주 ↔ B 다음 주
export function leadLag(d: RotationData): Record<string, Record<string, number | null>> {
  const out: Record<string, Record<string, number | null>> = {};
  for (const a of STAGES) {
    out[a.key] = {};
    for (const b of STAGES) {
      const A = d.weekly[a.key], B = d.weekly[b.key];
      out[a.key][b.key] = corr(A.slice(0, -1), B.slice(1));
    }
  }
  return out;
}
