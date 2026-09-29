// 눌림목 스크리너 — "상승추세 중 과매도" 종목 걸러내기.
//
// 조건 다섯: RSI · 흑자 · 볼린저 하단 근접 · 200일선 위 · 고가 대비 낙폭 (+ 유동성 하한).
//   단타가 아니라 **눌림목 역추세** 셋업이다(보유 수일~수주). 이름을 그렇게 붙인 이유:
//   "강한 추세(200일선 위) + 그 추세 안에서 가장 깊은 눌림(볼린저 하단·RSI 낮음) + 흑자" 다.
//
// 호출 비용: TradingView 스캐너 **2콜**(코스피·코스닥). 종목별 지표를 따로 부르면 2,600콜이다.
//   히트맵과 같은 호스트라 프록시 화이트리스트는 이미 통과. 사용자가 누를 때만 조회하고 캐시한다.
//
// 대상 = 상장 **보통주 전부** (실측 2026-09-29: 코스피 828 + 코스닥 1,795 = 2,623종).
//   symbolset 이 주식만 담아서 **우선주·ETF·ETN 은 안 들어온다**(삼성전자우·KODEX 200 부재 확인).
//   의도한 동작이다 — 우선주는 유동성이 얇고, ETF 는 '흑자 기업' 조건이 무의미하며 ETF랭킹 탭이 맡는다.
//   여기에 지표 결측 100종(주로 상장 1년 미만 — 200일선이 없다)을 더 빼 평가대상은 ~2,520종.
//
// ⚠️ 문턱을 원본 그대로(RSI<40 · 볼린저 하단 '이하' · 낙폭 20%+) 두면 오늘 통과가 0종이다.
//   실측 2026-09-29: 2,502종 → RSI 550 → 흑자 315 → 볼린저 하단 이하 71 → 200일선 위 **2** → 낙폭 **0**.
//   병목은 '볼린저 하단 이하 × 200일선 위'(전체 9종). 그래서 기본값을 '하단 +3% 이내' 로 완화했다.

import { fetchProxied, ProxyHostError } from "./api";

export interface ScreenRow {
  code: string;
  name: string;          // 영문 회사명(scanner description)
  logoid: string;
  market: "코스피" | "코스닥";
  close: number;
  changePct: number;
  volume: number;
  valueTraded: number;   // 거래대금(원)
  marketCap: number;
  rsi: number;
  bbGap: number;         // 볼린저 하단 대비 %(+면 하단 위, 0 이하면 하단 이탈)
  smaGap: number;        // 200일선 대비 %
  netIncome: number;     // 순이익(원, 스캐너 최신 보고치) — 흑자 판정
  ddFromHigh: number;    // 52주 고가 대비 %(음수)
  sector: string;
}

export interface ScreenCriteria {
  rsiMax: number;          // RSI 이 값 미만
  profitOnly: boolean;     // 순이익 > 0
  bbGapMax: number;        // 볼린저 하단 +N% 이내 (0 이면 '하단 이하')
  smaGapMin: number;       // 200일선 대비 최소 %(0 이면 '위')
  ddMax: number;           // 52주 고가 대비 이 값 이하(예 -20). 0 이면 제한 없음
  minValueTradedEok: number; // 거래대금 하한(억원)
}

export const DEFAULT_CRITERIA: ScreenCriteria = {
  rsiMax: 45, profitOnly: true, bbGapMax: 3, smaGapMin: 0, ddMax: 0, minValueTradedEok: 10,
};

// 조건 하나하나를 같은 모양으로 — 퍼널(단계별 통과 수)과 카드 체크리스트가 한 정의를 공유한다.
export interface Cond { key: string; label: (c: ScreenCriteria) => string; pass: (r: ScreenRow, c: ScreenCriteria) => boolean; }
export const CONDS: Cond[] = [
  { key: "rsi",    label: c => `RSI < ${c.rsiMax}`,                    pass: (r, c) => r.rsi < c.rsiMax },
  { key: "profit", label: () => "흑자 (순이익 > 0)",                 pass: (r, c) => !c.profitOnly || r.netIncome > 0 },
  { key: "bb",     label: c => c.bbGapMax <= 0 ? "볼린저 하단 이하" : `볼린저 하단 +${c.bbGapMax}% 이내`,
                                                                        pass: (r, c) => r.bbGap <= c.bbGapMax },
  { key: "sma",    label: c => c.smaGapMin === 0 ? "200일선 위" : `200일선 ${c.smaGapMin > 0 ? "+" : ""}${c.smaGapMin}% 이상`,
                                                                        pass: (r, c) => r.smaGap > c.smaGapMin },
  { key: "dd",     label: c => c.ddMax === 0 ? "고가 대비 낙폭 (제한 없음)" : `52주 고가 대비 ${c.ddMax}% 이하`,
                                                                        pass: (r, c) => c.ddMax === 0 || r.ddFromHigh <= c.ddMax },
  { key: "liq",    label: c => `거래대금 ${c.minValueTradedEok}억 이상`,  pass: (r, c) => r.valueTraded >= c.minValueTradedEok * 1e8 },
];

export function passCount(r: ScreenRow, c: ScreenCriteria): number {
  return CONDS.reduce((n, cd) => n + (cd.pass(r, c) ? 1 : 0), 0);
}

// 단계별 통과 수 — 조건을 위에서부터 하나씩 더해 갈 때 남는 종목 수.
//   "어디서 무너지는지" 를 보여줘야 문턱을 어디서 풀지 판단이 된다.
export function funnel(rows: ScreenRow[], c: ScreenCriteria): { label: string; left: number }[] {
  let cur = rows;
  return CONDS.map(cd => {
    cur = cur.filter(r => cd.pass(r, c));
    return { label: cd.label(c), left: cur.length };
  });
}

const COLUMNS = ["name", "description", "logoid", "close", "change", "volume", "Value.Traded",
  "market_cap_basic", "RSI", "BB.lower", "SMA200", "net_income", "price_52_week_high", "sector"];

export interface ScreenSnapshot { fetchedAt: number; rows: ScreenRow[] }
const LS_KEY = "stock_screener_v1";

export function loadCachedScreen(): ScreenSnapshot | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as ScreenSnapshot;
    // 빈 스냅샷은 캐시로 치지 않는다 — 일시적 0건이 TTL 동안 굳는다.
    if (!Array.isArray(s.rows) || s.rows.length === 0) return null;
    return s;
  } catch { return null; }
}

async function scanMarket(market: "코스피" | "코스닥"): Promise<ScreenRow[]> {
  const symbolset = market === "코스피" ? "SYML:KRX;KOSPI" : "SYML:KRX;KOSDAQ";
  const resp = await fetchProxied("https://scanner.tradingview.com/korea/scan", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      symbols: { symbolset: [symbolset] }, columns: COLUMNS,
      sort: { sortBy: "market_cap_basic", sortOrder: "desc" }, range: [0, 2000],
    }),
  });
  const text = await resp.text();
  let j: { error?: string; data?: { s: string; d: unknown[] }[] };
  try { j = JSON.parse(text); } catch { throw new Error("스캐너 응답 파싱 실패"); }
  if (typeof j.error === "string" && j.error) {
    if (/host not allowed/i.test(j.error)) throw new ProxyHostError(j.error);
    throw new Error(j.error);
  }
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const out: ScreenRow[] = [];
  for (const row of j.data ?? []) {
    const d = row.d;
    const i = (k: string) => d[COLUMNS.indexOf(k)];
    const close = num(i("close")), rsi = num(i("RSI")), bb = num(i("BB.lower"));
    const sma = num(i("SMA200")), hi = num(i("price_52_week_high"));
    // 지표가 하나라도 없으면(신규 상장 등) 조건을 못 따진다 — 조용히 통과시키면 안 되니 제외.
    if (close == null || rsi == null || bb == null || sma == null || hi == null || hi <= 0
        || bb <= 0 || sma <= 0) continue;
    out.push({
      code: String(i("name") ?? ""),
      name: String(i("description") ?? i("name") ?? ""),
      logoid: String(i("logoid") ?? ""),
      market,
      close,
      changePct: num(i("change")) ?? 0,
      volume: num(i("volume")) ?? 0,
      valueTraded: num(i("Value.Traded")) ?? 0,
      marketCap: num(i("market_cap_basic")) ?? 0,
      rsi,
      bbGap: (close / bb - 1) * 100,
      smaGap: (close / sma - 1) * 100,
      netIncome: num(i("net_income")) ?? 0,
      ddFromHigh: (close / hi - 1) * 100,
      sector: String(i("sector") ?? ""),
    });
  }
  return out;
}

export async function fetchScreenerUniverse(): Promise<ScreenSnapshot> {
  const [kospi, kosdaq] = await Promise.all([scanMarket("코스피"), scanMarket("코스닥")]);
  const rows = [...kospi, ...kosdaq];
  const snap: ScreenSnapshot = { fetchedAt: Date.now(), rows };
  if (rows.length > 0) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(snap)); } catch { /* 용량 초과 — 캐시 없이 동작 */ }
  }
  return snap;
}
