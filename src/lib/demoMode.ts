// 데모 모드 — 처음 방문한 사람에게 빈 화면 대신 채워진 화면을 보여준다.
//
// 보유 종목이 IndexedDB 에 저장되는 구조라, 링크만 받아 들어온 사람은 모든 탭이 비어 있어
// 이 앱이 무엇을 하는지 알 수가 없다. 대형주 몇 개를 임시로 넣어 손익·차트·수급·추세가
// 다 채워진 화면을 보여주는 게 목적.
//
// 안전장치 — 남의 데이터를 절대 건드리지 않는다.
//   ① 보유가 완전히 비어 있을 때만 시작할 수 있다(enterDemo 가 스스로 검사).
//   ② 넣은 row 의 id 를 localStorage 에 기록해 두고, 종료 시 그 id 만 지운다.
//      (그룹 전체 삭제가 아니라 id 지정 삭제 — 사용자가 데모 중 추가한 종목은 남는다)

import { db, holdingId } from "./db";
import { fetchTossPrices } from "./api";
import type { Stock } from "../types";

export const DEMO_GROUP = "데모";

const FLAG_KEY = "demo_mode_on";
const IDS_KEY = "demo_mode_ids";

// 대형주 위주 — 시총 상위 + 업종 분산 + ETF 1종(ETF 전용 기능도 보이게).
//   ratio = 평단가 ÷ 현재가. 수익/손실이 섞이도록 1 아래위로 흩어 놓는다(빨강·파랑 둘 다 보이게).
//   ref = 시세 조회 실패 시 쓸 대략적인 기준가(2026-08 기준). 없으면 평단이 0 이 되어 손익이 깨진다.
interface DemoSpec { ticker: string; name: string; shares: number; ratio: number; ref: number; }
const DEMO_STOCKS: DemoSpec[] = [
  { ticker: "005930", name: "삼성전자",         shares: 50, ratio: 0.82, ref: 264500 },
  { ticker: "000660", name: "SK하이닉스",       shares:  5, ratio: 0.61, ref: 1634000 },
  { ticker: "373220", name: "LG에너지솔루션",   shares: 10, ratio: 1.14, ref: 351000 },
  { ticker: "005380", name: "현대차",           shares: 12, ratio: 0.88, ref: 431000 },
  { ticker: "005490", name: "POSCO홀딩스",      shares: 15, ratio: 1.07, ref: 321000 },
  { ticker: "035420", name: "NAVER",            shares: 20, ratio: 1.21, ref: 215500 },
  { ticker: "051910", name: "LG화학",           shares:  8, ratio: 1.32, ref: 269500 },
  { ticker: "068270", name: "셀트리온",         shares: 25, ratio: 0.93, ref: 194600 },
  { ticker: "012330", name: "현대모비스",       shares:  7, ratio: 0.79, ref: 512000 },
  { ticker: "069500", name: "KODEX 200",        shares: 40, ratio: 0.91, ref: 108550 },
];

export function isDemoActive(): boolean {
  try { return localStorage.getItem(FLAG_KEY) === "on"; } catch { return false; }
}

function loadIds(): string[] {
  try {
    const raw = localStorage.getItem(IDS_KEY);
    const v = raw ? JSON.parse(raw) : null;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch { return []; }
}

// 매수일 — 90일 전. 오늘 날짜로 넣으면 '오늘 매수'로 잡혀 오늘 손익이 전체 손익과 같아진다.
function buyDate(): string {
  const d = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000 + 9 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

export interface DemoResult { ok: boolean; added: number; reason?: string }

// 시작 — 보유가 비어 있을 때만. 현재가를 받아 평단을 ratio 로 역산해 넣는다.
//   (평단을 고정 숫자로 박아두면 시간이 지나며 손익률이 비현실적으로 벌어진다)
export async function enterDemo(): Promise<DemoResult> {
  const existing = await db.holdings.count();
  if (existing > 0) return { ok: false, added: 0, reason: "이미 등록된 종목이 있어 데모를 시작하지 않았습니다" };

  const priceByTicker = new Map<string, number>();
  try {
    for (const p of await fetchTossPrices(DEMO_STOCKS.map(s => s.ticker))) {
      if (p.price > 0) priceByTicker.set(p.ticker, p.price);
    }
  } catch { /* 시세 실패 — ref 로 폴백 */ }

  const date = buyDate();
  const rows: (Stock & { id: string })[] = DEMO_STOCKS.map(s => {
    const cur = priceByTicker.get(s.ticker) ?? s.ref;
    const avg = Math.round(cur * s.ratio);
    const stock: Stock = {
      ticker: s.ticker, name: s.name, shares: s.shares, avg_price: avg,
      invested: avg * s.shares, buy_date: date, market: "KOSPI", account: DEMO_GROUP,
    };
    return { ...stock, id: holdingId(stock) };
  });

  await db.holdings.bulkPut(rows);
  try {
    localStorage.setItem(IDS_KEY, JSON.stringify(rows.map(r => r.id)));
    localStorage.setItem(FLAG_KEY, "on");
  } catch { /* 저장 실패해도 화면은 이미 채워짐 — 종료는 그룹명으로 폴백 */ }
  return { ok: true, added: rows.length };
}

// 종료 — 넣었던 id 만 지운다. 기록이 없으면(스토리지 초기화 등) 데모 그룹 row 로 폴백.
export async function exitDemo(): Promise<number> {
  const ids = loadIds().length
    ? loadIds()
    : (await db.holdings.where("account").equals(DEMO_GROUP).toArray())
        .map(r => (r as Stock & { id: string }).id).filter(Boolean);
  if (ids.length) await db.holdings.bulkDelete(ids);
  const removed = ids.length;
  try {
    localStorage.removeItem(IDS_KEY);
    localStorage.removeItem(FLAG_KEY);
  } catch { /* noop */ }
  return removed;
}
