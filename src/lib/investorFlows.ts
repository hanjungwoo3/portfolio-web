// 수급 매집 — 외국인 · 기관(금융투자 제외) · 연기금의 5/20/60일 누적 순매수.
//   크롤러(portfolio-etf-index/scripts/flows.js)가 매일 06:00 KST 에 계산해 둔 JSON 을 읽는다(0콜).
//   종목마다 1콜이라 화면에서 부르면 1,300콜이 넘는다.
//
// 백테스트(2026-10-01, 2026-01~09 160거래일, 거래대금 10억+ 999종, 그날 시총 대비 비율):
//   셋 다 20일 매집 상위 30% → 5·10·20일 뒤 시장 대비 +0.36 / +0.75 / +1.72%p, 앞·뒤 절반 모두 +.
//   한 주체만(외국인 단독은 마이너스)·연속 순매수·'매집했는데 주가는 안 오름' 은 오히려 나빴다.

const URL_FLOWS =
  "https://raw.githubusercontent.com/hanjungwoo3/portfolio-etf-index/main/data/investor-flows.json";

export type FlowInvestor = "fo" | "in" | "pe";
export type FlowWindow = 5 | 20 | 60;
export const INVESTOR_LABEL: Record<FlowInvestor, string> = { fo: "외국인", in: "기관", pe: "연기금" };

export interface FlowWin {
  fo: number; in: number; pe: number;          // 누적 순매수(억원)
  foR: number; inR: number; peR: number;       // 창 시작일 시총 대비 %
  ret: number;                                  // 그 기간 주가 등락 %
}
export interface FlowStock {
  code: string; name: string; market: "코스피" | "코스닥"; capEok: number; close: number; date: string;
  w: Partial<Record<"5" | "20" | "60", FlowWin>>;
  streak: Record<FlowInvestor, number>;
  // 60일 시계열(과거 → 최근): 종가, 일별 순매수(0.1억 단위) — 미니 차트용
  s?: { c: number[]; fo: number[]; in: number[]; pe: number[] };
  fr?: [number, number] | null;   // 외국인 지분율 % — [지금, 60일 전]
  ind?: string | null;            // 네이버 업종
}
export interface FlowData {
  meta: { builtAt: string; asOf: string; count: number; windows: number[]; minCapEok: number };
  stocks: FlowStock[];
}

// 백테스트 성적 — 화면 표에 그대로 쓴다
export const FLOW_BACKTEST: { label: string; n: number; d5: number; d10: number; d20: number; halves: string; good: boolean }[] = [
  { label: "외·기·연 셋 다 매집 상위 30% (20일)", n: 6981, d5: 0.36, d10: 0.75, d20: 1.72, halves: "+2.1 / +1.2", good: true },
  { label: "셋 다 20일 순매수(+)", n: 16122, d5: 0.12, d10: 0.39, d20: 0.78, halves: "+0.7 / +0.9", good: true },
  { label: "연기금만 매집 상위 10%", n: 13575, d5: 0.15, d10: 0.46, d20: 0.96, halves: "+1.8 / -0.2", good: false },
  { label: "기관만 매집 상위 10%", n: 13575, d5: -0.17, d10: 0.08, d20: 0.89, halves: "+2.2 / -0.4", good: false },
  { label: "외국인만 매집 상위 10%", n: 13575, d5: -0.04, d10: -0.25, d20: -0.49, halves: "+1.4 / -2.0", good: false },
  { label: "매집했는데 주가는 안 오름(외국인)", n: 7627, d5: -0.52, d10: -1.36, d20: -1.95, halves: "-2.0 / -1.9", good: false },
];

// v2: 시계열·지분율·업종 추가 — 옛 캐시엔 없어 새로 받는다(파일이 ~1.8MB 라 저장이 실패하면 캐시 없이 동작)
const LS_KEY = "investor_flows_v2";
const LS_TS = "investor_flows_ts_v2";
const TTL_MS = 3 * 60 * 60 * 1000;

export async function loadInvestorFlows(): Promise<FlowData> {
  try {
    const ts = Number(localStorage.getItem(LS_TS) ?? "0");
    const raw = localStorage.getItem(LS_KEY);
    if (raw && Date.now() - ts < TTL_MS) {
      const d = JSON.parse(raw) as FlowData;
      if (d.stocks?.length) return d;                 // 빈 캐시는 적중으로 치지 않는다
    }
  } catch { /* noop */ }
  const r = await fetch(URL_FLOWS, { cache: "no-store" });
  if (!r.ok) throw new Error(`investor-flows HTTP ${r.status}`);
  const d = await r.json() as FlowData;
  if (d.stocks?.length) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(d));
      localStorage.setItem(LS_TS, String(Date.now()));
    } catch { /* 용량 초과 — 캐시 없이 동작 */ }
  }
  return d;
}

export interface RankedFlow {
  s: FlowStock;
  win: FlowWin;
  pct: Record<FlowInvestor, number>;   // 시총 대비 비율의 백분위(0~1, 1 = 가장 많이 매집)
  all3Top30: boolean;              // 셋 다 상위 30% — 백테스트에서 유일하게 일관되게 좋았던 조합
  score: number;                   // 정렬 기준
}

/** 창·주체 선택에 따라 순위를 매긴다. who="all" = 셋 다 순매수인 종목만, 셋 중 가장 약한 백분위 순. */
export function rankFlows(stocks: FlowStock[], win: FlowWindow, who: FlowInvestor | "all"): RankedFlow[] {
  const key = String(win) as "5" | "20" | "60";
  const have = stocks.filter(s => s.w[key]);
  const pctOf = (k: "foR" | "inR" | "peR") => {
    const sorted = have.map(s => s.w[key]![k]).sort((a, b) => a - b);
    return (v: number) => {
      let lo = 0, hi = sorted.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] <= v) lo = m + 1; else hi = m; }
      return sorted.length ? lo / sorted.length : 0;
    };
  };
  const pf = pctOf("foR"), pi = pctOf("inR"), pp = pctOf("peR");
  const out: RankedFlow[] = [];
  for (const s of have) {
    const w = s.w[key]!;
    const pct = { fo: pf(w.foR), in: pi(w.inR), pe: pp(w.peR) };
    const all3Top30 = pct.fo >= 0.7 && pct.in >= 0.7 && pct.pe >= 0.7 && w.fo > 0 && w.in > 0 && w.pe > 0;
    if (who === "all") {
      if (!(w.fo > 0 && w.in > 0 && w.pe > 0)) continue;
      out.push({ s, win: w, pct, all3Top30, score: Math.min(pct.fo, pct.in, pct.pe) });
    } else {
      const amt = w[who];
      if (!(amt > 0)) continue;
      out.push({ s, win: w, pct, all3Top30, score: w[`${who}R` as const] });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}
