// 지수 탭 '섹터 흐름' — 테마별 종목 바스켓의 오늘 등락을 본다.
//
// ETF 랭킹(etfRanking.ts)과는 다른 축이다.
//   ETF 랭킹: 상품이 있는 테마만 보이고, 채권·미국 ETF 같은 칸이 자리를 차지한다.
//   여기:     네이버 '테마' 종목 바스켓이라 ETF 가 없는 테마(광통신·CPO 등)도 보이고,
//             시장 흐름과 무관한 칸이 아예 없다. "오늘 어느 섹터가 강세인가" 만 답한다.
//
// 카드 정의와 종목은 크롤러가 하루 1회 만들어 둔다(portfolio-etf-index/data/theme-cards.json).
//   여기서는 그 종목들의 시세만 받는다 — 419종 = 3 프록시 콜(토스 배치 200종/콜).
//   시가총액 5,000억 미만은 크롤러가 이미 걸러냈다(테마 종목 절반이 1,300억 미만이라
//   안 거르면 잡주 몇 개가 중앙값을 흔든다). 그래서 여기 오는 종목은 이미 깨끗하다.
//   ETF 랭킹과 같은 이유로 폴링에 못 태운다. 캐시를 그리고 새로고침으로 받는다.

import { useCallback, useEffect, useState } from "react";
import { fetchTossPrices } from "./api";
import { dayChangePct } from "./format";
import { hasDedicatedTransport } from "./proxyConfig";

const URL_CARDS =
  "https://raw.githubusercontent.com/hanjungwoo3/portfolio-etf-index/main/data/theme-cards.json";

interface ThemeCardData {
  cards: Record<string, string[]>;    // 카드명 → 종목코드[]
  names: Record<string, string>;      // 종목코드 → 종목명
  caps: Record<string, number>;       // 종목코드 → 시가총액(억원)
  // 크롤러가 적용한 시총 하한(억원). ★ 화면 문구는 반드시 이 값을 쓴다 —
  //   하한을 바꿔도 브라우저는 12시간 동안 옛 파일을 캐시하므로, 숫자를 코드에 박아 두면
  //   "5,000억 미만 제외" 라 써 놓고 4,171억짜리가 목록에 보이는 일이 생긴다(실제로 그랬다).
  minCap: number;
}

export interface ThemeStock {
  code: string;
  name: string;
  pct: number;
  price: number;
  value: number;    // 거래대금(추정) = 현재가 × 거래량
  cap: number;      // 시가총액(억원) — 크롤 시점 기준
  // 이번 세션에 실제로 체결됐는가. false 면 값이 직전 거래일 것이라 통계에서 빼고,
  //   팝업에서는 흐리게 보여준다(앱의 장마감 흐림과 같은 취급).
  fresh: boolean;
}

export interface ThemeStat {
  key: string;
  label: string;
  count: number;      // 이번 세션에 체결된 종목 수 (통계의 모집단)
  total: number;      // 카드에 편입된 종목 수 — count/total 로 커버리지를 본다
  median: number;     // 거래대금 상위 LEAD 종목의 중앙값 등락률(%)
  upRatio: number;    // 그중 오른 종목 비율
  best: ThemeStock;   // 그 세션 가장 많이 오른 것(상위 LEAD 안에서)
  rows: ThemeStock[]; // 전 종목, 거래대금 내림차순 (미체결 포함 — 팝업에서 흐리게)
}

export interface ThemeFlow {
  fetchedAt: number;
  scanned: number;     // 이번 세션에 체결된 종목 수 (통계 모집단)
  minCap: number;      // 이 스냅샷에 적용된 시총 하한(억원) — 화면 문구용
  total: number;       // 카드에 편입된 전체 종목 수 (scanned/total = 커버리지)
  // 데이터가 실제로 몇 일자인지(KST YYYY-MM-DD). 장 시작 전(08~09시)·주말에 받으면
  //   오늘이 아니라 직전 거래일이 된다 — 화면에 그렇게 밝혀야 오늘 흐름으로 오해하지 않는다.
  tradeDate: string;
  themes: ThemeStat[];
}

// 흐름은 '주도주' 로 본다. 시총 하한(크롤러, 5,000억)으로 잡주를 걷어낸 뒤,
//   그중 거래대금 상위 LEAD 종의 중앙값을 쓴다. 거래대금은 그날 돈이 실제로 몰린 곳이라
//   시가총액 순보다 '오늘의 주도' 에 가깝다.
//   (실측 2026-09-09: 2차전지 전 종목 +2.27% vs 이 방식 +6.05%)
const LEAD = 20;

const LS_KEY = "theme_flow_v6";   // v6: 세션 경계를 구간별로(프리·정규·애프터)
const LS_CARDS = "theme_cards_v3";   // v3: minCap(적용된 시총 하한) 추가
const LS_CARDS_TS = "theme_cards_ts_v3";
const CARDS_TTL_MS = 12 * 60 * 60 * 1000;

let cardsMemo: ThemeCardData | null = null;
let cardsInflight: Promise<ThemeCardData> | null = null;

export function loadThemeCards(): Promise<ThemeCardData> {
  if (cardsMemo) return Promise.resolve(cardsMemo);
  if (cardsInflight) return cardsInflight;
  cardsInflight = (async () => {
    try {
      const ts = Number(localStorage.getItem(LS_CARDS_TS) ?? "0");
      const raw = localStorage.getItem(LS_CARDS);
      if (raw && Date.now() - ts < CARDS_TTL_MS) {
        cardsMemo = JSON.parse(raw) as ThemeCardData;
        return cardsMemo;
      }
    } catch { /* noop */ }
    const r = await fetch(URL_CARDS, { cache: "no-store" });
    if (!r.ok) throw new Error(`theme-cards HTTP ${r.status}`);
    const json = await r.json() as ThemeCardData & { meta?: { themeMinCap?: number } };
    cardsMemo = {
      cards: json.cards ?? {}, names: json.names ?? {}, caps: json.caps ?? {},
      minCap: json.meta?.themeMinCap ?? 0,
    };
    try {
      localStorage.setItem(LS_CARDS, JSON.stringify(cardsMemo));
      localStorage.setItem(LS_CARDS_TS, String(Date.now()));
    } catch { /* 용량 초과 — 캐시 없이도 동작 */ }
    return cardsMemo;
  })();
  cardsInflight.finally(() => { cardsInflight = null; });
  return cardsInflight;
}

export function loadCachedThemeFlow(): ThemeFlow | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const f = JSON.parse(raw) as ThemeFlow;
    return Array.isArray(f.themes) ? f : null;
  } catch { return null; }
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export async function fetchThemeFlow(): Promise<ThemeFlow> {
  const { cards, names, caps, minCap } = await loadThemeCards();
  // 카드끼리 종목이 겹치므로(삼성SDI = 2차전지 + 전기차) 합집합으로 한 번만 받는다.
  const union = [...new Set(Object.values(cards).flat())];
  const prices = await fetchTossPrices(union);

  // ── 이번 '세션' 을 정한다 ────────────────────────────────────────────────
  // 세션 안에서 체결된 종목만 중앙값에 넣는다. 안 뛴 종목은 값이 직전 세션 것이라
  //   섞이면 흐름이 눌린다(dayChangePct 의 prevClose 폴백 때문에 0% 도 아닌 옛 등락률이 온다).
  //   목록에서 빼지는 않는다 — 흐리게 두고 계산에서만 뺀다.
  //
  // 경계가 시간대마다 다르다. 한국 시장은 하루에 세 구간이 있다.
  //   08:00~08:50  NXT 프리마켓   — 일부만 거래
  //   09:00~15:30  정규장         — 사실상 전부 거래
  //   15:40~20:00  NXT 애프터     — 일부만 거래
  // 애프터에 08:00 을 기준으로 잡으면 정규장 종가(15:30)에 멈춘 종목이 전부 '체결' 로
  //   잡혀서 흐림이 하나도 안 생긴다(실측 15:55: 체결 5/5종). 그래서 구간별로 나눈다.
  //
  // 거래가 다 끝난 밤(20:00 이후)에는 08:00 기준으로 되돌린다 — 그날 전 종목이 포함되어
  //   카드가 그날 최종 등락률을 보여준다. 안 그러면 표본이 0 이 되어 카드가 사라진다.
  const nowKst = new Date(Date.now() + 9 * 3600_000);
  const todayKst = nowKst.toISOString().slice(0, 10);
  const at = (hhmm: string) => Date.parse(`${todayKst}T${hhmm}:00+09:00`);
  const minsKst = nowKst.getUTCHours() * 60 + nowKst.getUTCMinutes();
  const AFTER_OPEN = 15 * 60 + 40, AFTER_CLOSE = 20 * 60;
  const sessionStart = minsKst >= AFTER_OPEN && minsKst < AFTER_CLOSE ? at("15:40") : at("08:00");
  const tradedToday = prices.some(p => p.trade_dt && Date.parse(p.trade_dt) >= sessionStart);

  let tradeDate = todayKst;
  if (!tradedToday) {
    // 폴백 — 가장 최근 거래일을 세션으로. (최빈값이 아니라 최신값이어야 한다)
    tradeDate = "";
    for (const p of prices) if (p.trade_date && p.trade_date > tradeDate) tradeDate = p.trade_date;
  }
  const isFresh = (p: { trade_dt?: string; trade_date: string }): boolean =>
    tradedToday
      ? !!p.trade_dt && Date.parse(p.trade_dt) >= sessionStart
      : p.trade_date === tradeDate;

  const byCode = new Map<string, ThemeStock>();
  for (const p of prices) {
    const pct = dayChangePct(p);
    if (pct === undefined || !Number.isFinite(pct)) continue;
    byCode.set(p.ticker, {
      code: p.ticker,
      name: names[p.ticker] ?? p.ticker,
      pct,
      price: p.price,
      value: (p.price || 0) * (p.volume || 0),
      cap: caps?.[p.ticker] ?? 0,
      fresh: isFresh(p),
    });
  }

  const themes: ThemeStat[] = [];
  for (const [label, codes] of Object.entries(cards)) {
    const rows = codes.map(c => byCode.get(c)).filter((x): x is ThemeStock => !!x)
      .sort((a, b) => b.value - a.value);
    // ★ 통계는 이번 세션에 체결된 것만으로 낸다. 미체결(fresh=false)은 값이 어제 것이라
    //   중앙값을 오염시킨다. 목록(rows)에는 남겨 두고 팝업에서 흐리게 보여준다.
    const live = rows.filter(r => r.fresh);
    if (live.length < 3) continue;   // 표본이 너무 적으면 중앙값이 한 종목에 좌우된다
    const lead = live.slice(0, LEAD);
    themes.push({
      key: label, label,
      count: live.length,
      total: codes.length,
      median: median(lead.map(r => r.pct)),
      upRatio: lead.filter(r => r.pct > 0).length / lead.length,
      best: [...lead].sort((a, b) => b.pct - a.pct)[0],
      rows,
    });
  }
  themes.sort((a, b) => b.median - a.median);

  const flow: ThemeFlow = {
    fetchedAt: Date.now(),
    scanned: [...byCode.values()].filter(s => s.fresh).length,
    total: union.length,
    minCap, tradeDate, themes,
  };
  try { localStorage.setItem(LS_KEY, JSON.stringify(flow)); } catch { /* noop */ }
  return flow;
}

// ETF 랭킹과 같은 규칙 — 자동 조회는 전용 전송(확장·앱·개인 워커)에서만, 최소 간격 5분.
//   공개 프록시 사용자는 캐시를 보고 새로고침 버튼으로 직접 받는다.
let inFlight: Promise<ThemeFlow> | null = null;
let lastAutoAt = 0;
const AUTO_MIN_GAP_MS = 5 * 60 * 1000;

export interface ThemeFlowState {
  flow: ThemeFlow | null;
  loading: boolean;
  refresh: () => void;
}

export function useThemeFlow(enabled: boolean): ThemeFlowState {
  const [flow, setFlow] = useState<ThemeFlow | null>(() => loadCachedThemeFlow());
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    void fetchThemeFlow()
      .then(setFlow)
      .catch(() => { /* 실패하면 이전 캐시를 그대로 둔다 */ })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (!hasDedicatedTransport()) return;
    if (Date.now() - lastAutoAt < AUTO_MIN_GAP_MS) return;
    lastAutoAt = Date.now();
    // StrictMode 이중 실행을 합치되, 끝나면 비운다(다시 들어오면 새로 받게).
    inFlight ??= fetchThemeFlow().finally(() => { inFlight = null; });
    let alive = true;
    void inFlight.then(f => { if (alive) setFlow(f); }).catch(() => { /* 캐시 유지 */ });
    return () => { alive = false; };
  }, [enabled]);

  return { flow, loading, refresh };
}
