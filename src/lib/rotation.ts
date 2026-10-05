// AI 순환매 — 한국 AI 생태계 6단계(반도체·전공정·후공정·전력기기·원자력·친환경) + 방산의 흐름, 비교용 AI 밖(금융·조선·화장품·필수소비재).
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

export type Family = "chip" | "energy" | "defense";
export interface Stage {
  key: string;
  label: string;
  family: Family;
  members: { code: string; name: string }[];
  us: { symbol: string; name: string };   // 간밤에 이 단계를 끌고 오는 미국 대장주(상관 1위 — 통계는 이것만 쓴다)
  us2: { symbol: string; name: string };  // 2위 — 카드에만 같이 보여 준다
  us3?: { symbol: string; name: string }; // 3위 — 3번째도 강한 단계만(전공정 KLA·광통신 코히런트). 카드에만
  // 통계 이력 보충용 종목 — 카드엔 안 나온다. members(ETF)가 최근 상장이라 이력이 짧을 때,
  //   **members 값이 하나도 없는 주·날에만** 이 종목들 평균을 대신 쓴다(있으면 ETF 만 쓴다).
  history?: { code: string; name: string }[];
}

// 단계 정의 — 한 벌. 미국 대장주는 '미국 직전 거래일 ↔ 한국 다음 날' 상관 1위(2026-09-30 실측).
// 한국 쪽 = 섹터 ETF + 주도주. ETF 가 모자란 단계는 주도주로 4칸을 채우고, ETF 끼리 상관 0.98 이상으로 겹치거나
//   거래가 너무 적은 ETF 는 빼고 그 자리에 대장주를 넣었다(2026-10-05 점검 — 같은 정보 두 번 대신 ETF 대 대장주 비교).
export const STAGES: Stage[] = [
  // 한국 쪽은 **섹터 ETF** — 종목 3~4개 묶음보다 미국 대장주 전날 ↔ 한국 다음 날 상관이 7단계 모두 높았다
  //   (분산돼 개별 종목 소음이 준다, 2026-10-01 실측 ~300거래일). 미국은 상관 1·2위.
  //   소재·부품은 뺐다 — ETF 로 보면 전공정(주간 0.91)·후공정(0.96)과 한 몸이고, 미국 1·2위도 전공정과 같았다.
  { key: "semi", label: "반도체", family: "chip",
    members: [{ code: "396500", name: "TIGER 반도체TOP10" }, { code: "091160", name: "KODEX 반도체" },
              { code: "005930", name: "삼성전자" }, { code: "000660", name: "SK하이닉스" }],
    // 3위 웨스턴디지털 — 이 줄 한국 묶음 다음 날 상관 0.37(샌디스크·마이크론 0.39 와 거의 같다, 2026-10-05)
    us: { symbol: "SNDK", name: "샌디스크" }, us2: { symbol: "MU", name: "마이크론" }, us3: { symbol: "WDC", name: "웨스턴디지털" } },
  { key: "front", label: "전공정", family: "chip",
    members: [{ code: "475300", name: "SOL 반도체전공정" }, { code: "471990", name: "KODEX AI반도체핵심장비" },
              { code: "476260", name: "HANARO 반도체핵심공정주도주" }, { code: "0239Y0", name: "PLUS 코리아HBM반도체" }],
    // 3번째 ASML — 데이터상 3위는 KLA(1년 0.43)지만 후공정 줄 대장주라 겹쳐서 다음 순위 ASML(0.39)을 쓴다(2026-10-05).
    us: { symbol: "LRCX", name: "램리서치" }, us2: { symbol: "AMAT", name: "어플라이드" }, us3: { symbol: "ASML", name: "ASML" } },
  { key: "back", label: "후공정", family: "chip",
    members: [{ code: "475310", name: "SOL 반도체후공정" }, { code: "455850", name: "SOL AI반도체소부장" },
              { code: "042700", name: "한미반도체" }, { code: "095340", name: "ISC" }],
    us: { symbol: "KLAC", name: "KLA" }, us2: { symbol: "ONTO", name: "온투" } },
  // CPU·기판 — 미국 CPU(AMD·인텔) ➜ 국내 기판 비중이 큰 ETF. (카드엔 국내 상장 미국CPU ETF 도 참고로)
  //   TIGER AI반도체핵심공정 = 삼성전기 23·이수페타시스 18·LG이노텍 13·대덕전자 10%(기판 합 68%),
  //   RISE 네트워크인프라 = 삼성전기 20·LG이노텍 10·이수페타시스 9%. 한국 기판주의 AMD 다음 날 상관이
  //   최근 60일 0.25 → ~0.5 로 커졌다(1년 기준으론 램리서치가 더 셌다, 2026-10-01).
  { key: "cpu", label: "CPU·기판", family: "chip",
    members: [{ code: "471760", name: "TIGER AI반도체핵심공정" }, { code: "367760", name: "RISE 네트워크인프라" },
              { code: "009150", name: "삼성전기" }, { code: "007660", name: "이수페타시스" }],
    // 3위 마벨 — 맞춤형 AI 칩·고속 네트워크 칩. 이 줄 최근 6개월 1위(0.40), 2년 0.27(2026-10-05). ARM 은 0.26/0.27 로 약했다.
    us: { symbol: "AMD", name: "AMD" }, us2: { symbol: "INTC", name: "인텔" }, us3: { symbol: "MRVL", name: "마벨" } },
  // 광통신 — AI 데이터센터 광 트랜시버·부품. 미국 루멘텀(최근 6개월 한국 광통신 다음 날 상관 0.48)·시에나(1년 0.34, 6개월 0.45).
  //   한국 = KoAct 광통신&위성네트워크액티브(광통신주 묶음과 상관 0.92) + 주도주 셋(국내 광통신 ETF 가 하나뿐이라).
  { key: "optic", label: "광통신", family: "chip",
    members: [{ code: "0219B0", name: "KoAct 광통신&위성네트워크액티브" }, { code: "327260", name: "RF머트리얼즈" },
              { code: "010170", name: "대한광통신" }, { code: "138080", name: "오이솔루션" }],
    // 3위 코히런트 — 최근 6개월 2위(0.46). 1년 기준으론 3~5위가 0.32~0.33 으로 비슷하다.
    us: { symbol: "LITE", name: "루멘텀" }, us2: { symbol: "CIEN", name: "시에나" }, us3: { symbol: "COHR", name: "코히런트" } },
  { key: "power", label: "전력기기", family: "energy",
    members: [{ code: "487240", name: "KODEX AI전력핵심설비" }, { code: "267260", name: "HD현대일렉트릭" },
              { code: "0117V0", name: "TIGER 코리아AI전력기기TOP3플러스" }, { code: "0209Z0", name: "ACE 코리아AI전력TOP10" }],
    us: { symbol: "PWR", name: "콴타서비스" }, us2: { symbol: "GEV", name: "GE버노바" } },
  { key: "nuclear", label: "원자력", family: "energy",
    members: [{ code: "433500", name: "ACE 원자력TOP10" }, { code: "0098F0", name: "KODEX 원자력SMR" },
              { code: "0091P0", name: "TIGER 코리아원자력" }, { code: "034020", name: "두산에너빌리티" }],
    us: { symbol: "CCJ", name: "카메코" }, us2: { symbol: "OKLO", name: "오클로" } },
  { key: "green", label: "친환경", family: "energy",
    members: [{ code: "377990", name: "TIGER Fn신재생에너지" }, { code: "009830", name: "한화솔루션" },
              { code: "112610", name: "씨에스윈드" }, { code: "457990", name: "PLUS 태양광&ESS" }],
    us: { symbol: "BE", name: "블룸에너지" }, us2: { symbol: "FSLR", name: "퍼스트솔라" } },
  // 방산 — AI 는 아니지만 미국이 끌고 오는 힘이 AI 단계만큼 있다(미국 방산 ETF 전날 ↔ 한국 다음 날 0.34,
  //   2026-10-01 실측). 반도체와 주간 상관 0.08 — AI 가 쉴 때 따로 가는 곳.
  { key: "defense", label: "방산", family: "defense",
    members: [{ code: "449450", name: "PLUS K방산" }, { code: "0080G0", name: "KODEX 방산TOP10" },
              { code: "463250", name: "TIGER K방산&우주" }, { code: "012450", name: "한화에어로스페이스" }],
    us: { symbol: "ITA", name: "미국 방산 ETF" }, us2: { symbol: "RTX", name: "레이시온" } },
];

// AI 밖 — 미국이 끌고 오진 않지만(다음 날 상관 0.13~0.30) AI 와 거의 따로 간다(반도체와 주간 -0.07~0.14,
//   증권만 0.49). 'AI 가 쉴 때 돈이 어디로 가나' 를 보려고 **통계(강세 묶음·일별 히트맵)에만** 넣는다.
//   대장주·다음 후보·과거 성적 계산엔 안 쓴다. 증권+은행 = 금융(주간 0.63), 조선은 방산과 0.69 지만 미국 짝이 없어 여기.
export interface OutsideGroup { key: string; label: string; members: { code: string; name: string }[] }
export const OUTSIDE: OutsideGroup[] = [
  { key: "finance", label: "금융", members: [{ code: "091170", name: "KODEX 은행" }, { code: "102970", name: "KODEX 증권" }] },
  { key: "ship", label: "조선", members: [{ code: "466920", name: "SOL 조선TOP3플러스" }, { code: "494670", name: "TIGER 조선TOP10" }] },
  { key: "beauty", label: "화장품", members: [{ code: "228790", name: "TIGER 화장품" }, { code: "479850", name: "HANARO K-뷰티" },
                                              { code: "0008T0", name: "SOL 화장품TOP3플러스" }] },
  // 필수소비재(음식료) — 반도체와 일간 상관 0.16~0.19 로 가장 따로 간다. 미국 짝(P&G·코카콜라·XLP)은 0.14~0.16 으로 약하다
  //   (2년 실측 2026-10-05). 경기방어로 돈이 옮겨 가는지 보는 용도.
  { key: "staples", label: "필수소비재", members: [{ code: "266410", name: "KODEX 필수소비재" }, { code: "438900", name: "HANARO Fn K-푸드" }] },
];
/** 주별·일별 수익률을 계산하는 전체 묶음 — 순환매 단계 + AI 밖. */
type Mem = { code: string; name: string };
export const ALL_GROUPS: { key: string; label: string; members: Mem[]; history?: Mem[] }[] = [...STAGES, ...OUTSIDE];
// 묶음 값 — members 값이 있으면 그것만, 없으면 history 값(이력 보충)
function groupVals<T>(g: { members: Mem[]; history?: Mem[] }, f: (code: string) => T | null | undefined): T[] {
  const m = g.members.map(x => f(x.code)).filter((v): v is T => v != null);
  if (m.length || !g.history) return m;
  return g.history.map(x => f(x.code)).filter((v): v is T => v != null);
}

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

const LS_KEY = "ai_rotation_v13";   // v13: 친환경 KODEX 신재생(중복) → 한화솔루션
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
  const codes = [...new Set(ALL_GROUPS.flatMap(s => [...s.members, ...(s.history ?? [])].map(m => m.code)))];
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

  // ── 주별: 종목별 주말 종가 → 묶음 동일가중 주간 수익률
  //   그 주에 값이 있는 종목만 평균낸다 — 예전엔 **모든 종목에 값이 있는 주만** 써서, 최근 상장 ETF 하나가
  //   전체 기간을 잘랐다(0117V0 상장 231일 → 모든 단계가 ~46주로). 묶음마다 1개 이상 있는 주만 남긴다.
  const weekClose: Record<string, Map<string, number>> = {};
  for (const c of codes) {
    const m = new Map<string, number>();
    for (const p of kr[c] ?? []) m.set(isoWeek(p.date), p.close);   // 날짜 오름차순 → 주의 마지막 종가가 남는다
    weekClose[c] = m;
  }
  const wkRet = (code: string, a: string, b: string) => {
    const x = weekClose[code]?.get(a), y = weekClose[code]?.get(b);
    return x && y ? (y / x - 1) * 100 : null;
  };
  const allWeeks = [...new Set(codes.flatMap(c => [...weekClose[c].keys()]))].sort();
  const weeks: string[] = [];
  for (const w of allWeeks) {
    const prev = weeks[weeks.length - 1];
    if (prev === undefined) {   // 첫 주 — 모든 묶음에 종가가 하나라도 있어야 기준으로 삼는다
      if (ALL_GROUPS.every(g => groupVals(g, c => (weekClose[c]?.has(w) ? 1 : null)).length > 0)) weeks.push(w);
      continue;
    }
    if (ALL_GROUPS.every(g => groupVals(g, c => wkRet(c, prev, w)).length > 0)) weeks.push(w);
  }
  const weekly: Record<string, number[]> = {};
  for (const g of ALL_GROUPS) {
    weekly[g.key] = [];
    for (let i = 1; i < weeks.length; i++) {
      const rs = groupVals(g, c => wkRet(c, weeks[i - 1], weeks[i]));
      weekly[g.key].push(mean(rs));
    }
  }
  const lastWeekPartial = weeks.length > 0 && weeks[weeks.length - 1] === isoWeek(new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10));

  // ── 일별: 묶음 동일가중 일간 수익률 (미국 대장주 상관·일별 히트맵용)
  const dayRet = (c: string) => {
    const s = kr[c] ?? [];
    const m = new Map<string, number>();
    for (let i = 1; i < s.length; i++) if (s[i - 1].close > 0) m.set(s[i].date, s[i].close / s[i - 1].close - 1);
    return m;
  };
  // 묶음별 일별 등락(%) — 묶음마다 1개 이상 값이 있는 날만(있는 종목끼리 평균), 최근 DAILY_KEEP 일
  const rets = new Map(codes.map(c => [c, dayRet(c)] as const));
  const allDays = [...new Set(codes.flatMap(c => [...rets.get(c)!.keys()]))].sort();
  const days = allDays.filter(d => ALL_GROUPS.every(g => groupVals(g, c => rets.get(c)?.get(d)).length > 0)).slice(-DAILY_KEEP);
  const daily: Record<string, number[]> = {};
  for (const g of ALL_GROUPS) daily[g.key] = days.map(d => mean(groupVals(g, c => rets.get(c)?.get(d))) * 100);

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
