// 시장 주요 이벤트 (KOSPI/KOSDAQ 차트 마커용)
//   - 옵션만기일: 매월 둘째 목요일 (계산)
//   - 쿼드러플 위칭: 분기 (3/6/9/12월) 옵션만기일 = 선물·옵션 동시 만기
//   - 금통위 (한국은행): 정적 일정 + 발표 금리 (best-effort, 검증 후 수정)
//   - FOMC (미국): 정적 일정 + 발표 금리 (Fed funds target range)

export type MarketEventType = "option-expiry" | "quadruple" | "bok-rate" | "fomc";

export interface MarketEvent {
  date: string;            // YYYY-MM-DD
  type: MarketEventType;
  title: string;           // 풀 이름 (툴팁)
  short: string;           // 짧은 라벨 (마커 텍스트)
  rate?: number;           // 발표 금리 (%): BOK=단일값, Fed=상단(upper)
  rateLow?: number;        // Fed 하단 (target range 의 lower bound)
  prevRate?: number;       // 직전 금리 (변화 표시용, 동결/인상/인하 자동 산출)
}

// 둘째 목요일 (Thu = 4) 계산
function secondThursday(year: number, month0: number): Date {
  const first = new Date(year, month0, 1);
  const dow = first.getDay();
  const dayOfMonth = ((4 - dow + 7) % 7) + 1 + 7;   // 1st Thu + 7
  return new Date(year, month0, dayOfMonth);
}

// 옵션·선물 만기일 — 주어진 기간 내 모두 생성 (자동)
export function calcExpiryEvents(from: Date, to: Date): MarketEvent[] {
  const out: MarketEvent[] = [];
  const d = new Date(from.getFullYear(), from.getMonth(), 1);
  while (d <= to) {
    const expiry = secondThursday(d.getFullYear(), d.getMonth());
    if (expiry >= from && expiry <= to) {
      const m = d.getMonth() + 1;
      const isQuad = [3, 6, 9, 12].includes(m);
      out.push({
        date: expiry.toISOString().slice(0, 10),
        type: isQuad ? "quadruple" : "option-expiry",
        title: isQuad ? `쿼드러플 위칭 (${m}월 선물·옵션 동시 만기)` : `옵션만기 (${m}월)`,
        short: isQuad ? "쿼드" : "옵만",
      });
    }
    d.setMonth(d.getMonth() + 1);
  }
  return out;
}

// 한국은행 기준금리 결정일 + 발표 금리 (best-effort)
//   확인된 값만 rate 채움. 미확정/불확실 항목은 rate 생략.
export const BOK_MEETINGS: MarketEvent[] = [
  // 2024
  { date: "2024-08-22", type: "bok-rate", title: "한국은행 금통위", short: "금통위", rate: 3.50, prevRate: 3.50 },
  { date: "2024-10-11", type: "bok-rate", title: "한국은행 금통위", short: "금통위", rate: 3.25, prevRate: 3.50 },
  { date: "2024-11-28", type: "bok-rate", title: "한국은행 금통위", short: "금통위", rate: 3.00, prevRate: 3.25 },
  // 2025
  { date: "2025-01-16", type: "bok-rate", title: "한국은행 금통위", short: "금통위", rate: 3.00, prevRate: 3.00 },
  { date: "2025-02-25", type: "bok-rate", title: "한국은행 금통위", short: "금통위", rate: 2.75, prevRate: 3.00 },
  { date: "2025-04-17", type: "bok-rate", title: "한국은행 금통위", short: "금통위", rate: 2.75, prevRate: 2.75 },
  { date: "2025-05-29", type: "bok-rate", title: "한국은행 금통위", short: "금통위", rate: 2.50, prevRate: 2.75 },
  { date: "2025-07-10", type: "bok-rate", title: "한국은행 금통위", short: "금통위", rate: 2.50, prevRate: 2.50 },
  { date: "2025-08-28", type: "bok-rate", title: "한국은행 금통위", short: "금통위" },
  { date: "2025-10-23", type: "bok-rate", title: "한국은행 금통위", short: "금통위" },
  { date: "2025-11-27", type: "bok-rate", title: "한국은행 금통위", short: "금통위" },
  // 2026
  { date: "2026-01-15", type: "bok-rate", title: "한국은행 금통위", short: "금통위" },
  { date: "2026-02-26", type: "bok-rate", title: "한국은행 금통위", short: "금통위" },
  { date: "2026-04-09", type: "bok-rate", title: "한국은행 금통위", short: "금통위" },
  { date: "2026-05-28", type: "bok-rate", title: "한국은행 금통위", short: "금통위" },
  { date: "2026-07-09", type: "bok-rate", title: "한국은행 금통위", short: "금통위" },
  { date: "2026-08-27", type: "bok-rate", title: "한국은행 금통위", short: "금통위" },
  { date: "2026-10-22", type: "bok-rate", title: "한국은행 금통위", short: "금통위" },
  { date: "2026-11-26", type: "bok-rate", title: "한국은행 금통위", short: "금통위" },
];

// FOMC (미국 연방공개시장위원회) 결정일 + Fed funds target range (한국 시간 = 회의 종료 다음날)
export const FOMC_MEETINGS: MarketEvent[] = [
  // 2024
  { date: "2024-09-19", type: "fomc", title: "FOMC", short: "FOMC", rate: 5.00, rateLow: 4.75, prevRate: 5.50 }, // -0.50
  { date: "2024-11-08", type: "fomc", title: "FOMC", short: "FOMC", rate: 4.75, rateLow: 4.50, prevRate: 5.00 }, // -0.25
  { date: "2024-12-19", type: "fomc", title: "FOMC", short: "FOMC", rate: 4.50, rateLow: 4.25, prevRate: 4.75 }, // -0.25
  // 2025
  { date: "2025-01-30", type: "fomc", title: "FOMC", short: "FOMC", rate: 4.50, rateLow: 4.25, prevRate: 4.50 }, // 동결
  { date: "2025-03-20", type: "fomc", title: "FOMC", short: "FOMC", rate: 4.50, rateLow: 4.25, prevRate: 4.50 },
  { date: "2025-05-08", type: "fomc", title: "FOMC", short: "FOMC", rate: 4.50, rateLow: 4.25, prevRate: 4.50 },
  { date: "2025-06-19", type: "fomc", title: "FOMC", short: "FOMC", rate: 4.50, rateLow: 4.25, prevRate: 4.50 },
  { date: "2025-07-31", type: "fomc", title: "FOMC", short: "FOMC", rate: 4.50, rateLow: 4.25, prevRate: 4.50 },
  { date: "2025-09-17", type: "fomc", title: "FOMC", short: "FOMC" },
  { date: "2025-10-29", type: "fomc", title: "FOMC", short: "FOMC" },
  { date: "2025-12-10", type: "fomc", title: "FOMC", short: "FOMC" },
  // 2026
  { date: "2026-01-28", type: "fomc", title: "FOMC", short: "FOMC" },
  { date: "2026-03-18", type: "fomc", title: "FOMC", short: "FOMC" },
  { date: "2026-04-29", type: "fomc", title: "FOMC", short: "FOMC" },
  { date: "2026-06-17", type: "fomc", title: "FOMC", short: "FOMC" },
  { date: "2026-07-29", type: "fomc", title: "FOMC", short: "FOMC" },
  { date: "2026-09-16", type: "fomc", title: "FOMC", short: "FOMC" },
  { date: "2026-11-04", type: "fomc", title: "FOMC", short: "FOMC" },
  { date: "2026-12-16", type: "fomc", title: "FOMC", short: "FOMC" },
];

// 이벤트의 표시 제목 생성 — rate 있으면 "이름 — 2.50% (동결)" 형태
export function eventDisplay(e: MarketEvent): string {
  if (e.rate === undefined) return e.title;
  // Fed: target range 표기, BOK: 단일값
  const rateStr = (e.rateLow !== undefined && e.rateLow !== e.rate)
    ? `${e.rateLow.toFixed(2)}-${e.rate.toFixed(2)}%`
    : `${e.rate.toFixed(2)}%`;
  let changeStr = "";
  if (e.prevRate !== undefined) {
    const diff = e.rate - e.prevRate;
    if (Math.abs(diff) < 0.001) changeStr = " (동결)";
    else if (diff > 0) changeStr = ` (+${diff.toFixed(2)}%p)`;
    else changeStr = ` (${diff.toFixed(2)}%p)`;
  }
  return `${e.title} — ${rateStr}${changeStr}`;
}

// 마커 라벨 (짧은 버전) — rate 있으면 "금통위 2.50" 형태
export function eventShort(e: MarketEvent): string {
  if (e.rate === undefined) return e.short;
  const rateStr = (e.rateLow !== undefined && e.rateLow !== e.rate)
    ? `${e.rateLow.toFixed(2)}-${e.rate.toFixed(2)}`
    : e.rate.toFixed(2);
  return `${e.short} ${rateStr}`;
}

// 통합 — 주어진 기간 내 모든 이벤트 반환 (날짜순)
//   현재는 옵션만기 + 쿼드러플만 표시. BOK/FOMC 는 정확한 금리 데이터 자동화 후 활성화 예정.
export function getMarketEvents(fromDate: string, toDate: string): MarketEvent[] {
  const from = new Date(fromDate);
  const to = new Date(toDate);
  const all: MarketEvent[] = [
    ...calcExpiryEvents(from, to),
  ];
  all.sort((a, b) => a.date.localeCompare(b.date));
  return all;
}

// 마커 색상 (이벤트 타입별)
export const EVENT_COLORS: Record<MarketEventType, string> = {
  "option-expiry": "#9ca3af",   // gray-400  — 월 옵션 (영향 보통)
  "quadruple":     "#f59e0b",   // amber-500 — 분기 동시만기 (변동성↑)
  "bok-rate":      "#dc2626",   // red-600   — 금통위 (한국 금리)
  "fomc":          "#2563eb",   // blue-600  — FOMC (미국 금리)
};
