// 🔔 지금 시끄러운 종목 — 최근 몇 분 사이 평소보다 돈이 확 몰린 종목 알림판(사용자 2026-11-09 "'지금 시끄러운 종목' 알림판 가능?").
//   ⚠️ 사라는 신호가 아니다 — 같은 날 25종목·178종목일 1분봉 실측에서 '거래 급증 따라 사기'는 비용 빼면 평균 −0.25%(손해).
//      쓰임새는 '지금 어디로 돈이 몰리나'를 빨리 아는 것.
//   데이터 = 네이버 실시간 순위(m.stock /api/stocks/{priceTop|up}/{KOSPI|KOSDAQ}, pageSize≤100, 실측 토스 체결가와 같은 값).
//     트레이딩뷰 scanner 는 KRX 가 20분 지연(update_mode=delayed_streaming_1200)이라 '지금'에 못 쓴다.
//   순위는 누적값만 준다 → 1분마다 찍어 두고(스냅샷) 최근 5분 차이로 '지금' 몰린 돈을 계산한다.
//   스냅샷은 모듈 변수 + sessionStorage(새로고침해도 이어짐). 열어 둔 동안만 쌓인다.
import { fetchProxied } from "./api";

export interface HotRow {
  code: string; name: string; market: "코스피" | "코스닥";
  price: number; pct: number;          // 지금 값·오늘 등락률(%)
  value: number;                       // 오늘 누적 거래대금(원)
  recentValue: number;                 // 최근 N분 거래대금(원)
  recentPct: number;                   // 최근 N분 값 변화(%)
  times: number;                       // 평소(오늘 1분 평균) 대비 몇 배
  upper: boolean;                      // 상한가
}
interface Snap { at: number; m: Record<string, [number, number]> }   // code → [값, 누적 거래대금(원)]
type Meta = { name: string; market: "코스피" | "코스닥"; pct: number; upper: boolean };

const KEY = "hotNow:snaps:v1";
const KEEP_MS = 40 * 60_000;
let snaps: Snap[] = (() => {
  try { const s = JSON.parse(sessionStorage.getItem(KEY) ?? "[]") as Snap[]; return Array.isArray(s) ? s.filter(x => Date.now() - x.at < KEEP_MS) : []; } catch { return []; }
})();
const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify(snaps)); } catch { /* 저장 못 해도 화면은 그대로 */ } };

const num = (s: unknown) => { const n = Number(String(s ?? "").replace(/,/g, "")); return Number.isFinite(n) ? n : 0; };

async function list(kind: "priceTop" | "up", mkt: "KOSPI" | "KOSDAQ") {
  const r = await fetchProxied(`https://m.stock.naver.com/api/stocks/${kind}/${mkt}?page=1&pageSize=100`);
  if (!r.ok) throw new Error(`naver ${kind}/${mkt}: HTTP ${r.status}`);
  const j = await r.json() as { stocks?: Record<string, unknown>[] };
  return (j.stocks ?? []).filter(s => s.stockEndType === "stock").map(s => ({
    code: String(s.itemCode ?? ""), name: String(s.stockName ?? ""), market: (mkt === "KOSPI" ? "코스피" : "코스닥") as Meta["market"],
    price: num(s.closePriceRaw ?? s.closePrice), pct: num(s.fluctuationsRatio),
    value: num(s.accumulatedTradingValueRaw) || num(s.accumulatedTradingValue) * 1e6,   // Raw = 원, 아니면 백만원 단위
    upper: (s.compareToPreviousPrice as { name?: string } | undefined)?.name === "UPPER_LIMIT",
  })).filter(x => x.code && x.price > 0);
}

/** 오늘 장이 열린 지 몇 분(평소 1분 평균의 분모). 08:00 NXT 부터 거래가 쌓이므로 그때부터 센다 */
function minutesOpen(now: number) {
  const d = new Date(now + 9 * 3600_000);
  const m = d.getUTCHours() * 60 + d.getUTCMinutes() - 8 * 60;
  return Math.max(30, Math.min(m, 12 * 60));
}

export interface HotResult { rows: HotRow[]; windowMin: number; snapCount: number; quiet: boolean; at: number }

/** 1분마다 부른다 — 순위 4개 받아 스냅샷을 쌓고, 최근 5분(모자라면 있는 만큼) 차이로 줄 세운다 */
export async function fetchHotNow(windowMin = 5): Promise<HotResult> {
  const lists = await Promise.allSettled([list("priceTop", "KOSPI"), list("priceTop", "KOSDAQ"), list("up", "KOSPI"), list("up", "KOSDAQ")]);
  const meta = new Map<string, Meta>();
  const m: Snap["m"] = {};
  for (const l of lists) if (l.status === "fulfilled") for (const x of l.value) {
    m[x.code] = [x.price, x.value];
    meta.set(x.code, { name: x.name, market: x.market, pct: x.pct, upper: x.upper });
  }
  if (!Object.keys(m).length) throw new Error("순위를 못 받았어요");
  const now = Date.now();
  snaps = [...snaps.filter(s => now - s.at < KEEP_MS), { at: now, m }];
  save();
  // 기준 스냅샷 = windowMin 분 전에 가장 가까운 것(없으면 가장 오래된 것, 최소 50초 전)
  const target = now - windowMin * 60_000;
  const older = snaps.filter(s => now - s.at >= 50_000);
  const base = older.length ? older.reduce((a, b) => (Math.abs(b.at - target) < Math.abs(a.at - target) ? b : a)) : null;
  if (!base) return { rows: [], windowMin: 0, snapCount: snaps.length, quiet: false, at: now };
  const mins = (now - base.at) / 60_000;
  const open = minutesOpen(now);
  const rows: HotRow[] = [];
  let moved = 0;
  for (const [code, [price, value]] of Object.entries(m)) {
    const b = base.m[code], mt = meta.get(code);
    if (!b || !mt) continue;
    const rv = value - b[1];
    if (rv > 0) moved++;
    if (rv < 1e8) continue;                                   // 최근 거래대금 1억 미만은 잡음
    const perMin = value / open;
    const times = perMin > 0 ? rv / mins / perMin : 0;
    rows.push({ code, name: mt.name, market: mt.market, price, pct: mt.pct, value, recentValue: rv,
      recentPct: b[0] > 0 ? (price / b[0] - 1) * 100 : 0, times, upper: mt.upper });
  }
  rows.sort((a, b) => b.times - a.times);
  return { rows: rows.filter(r => r.times >= 1.5).slice(0, 40), windowMin: Math.round(mins), snapCount: snaps.length, quiet: moved < 5, at: now };
}
