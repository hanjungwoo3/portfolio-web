// 미국 섹터 흐름 — 지수 탭. 한국 섹터(themeFlow.ts)와 같은 질문에 답한다: "오늘 어느 섹터가 강한가".
//
// 한국과 결정적으로 다른 점: **분류까지 한 콜에 온다.**
//   한국은 크롤러가 만든 분류 파일 + 토스 시세 3콜이 필요하다(419종).
//   미국은 TradingView scanner 한 번이면 503종의 등락률·거래대금·시총·섹터·산업이 모두 온다(86KB).
//   그래서 캐시 전략은 같아도 비용은 1/3 이다.
//
// 분류는 TradingView 것을 그대로 쓴다 — 섹터 20개(대분류) / 산업 100개(소분류).
//   우리가 테마를 손으로 정의하면 그 목록을 계속 관리해야 하고, 종목 편입 기준이 우리 손에
//   있는 순간 "왜 이 종목이 여기 있나" 를 매번 설명해야 한다. 분류는 빌리고 계산만 우리가 한다
//   (중앙값·오른 비율 — 한국 카드와 같은 공식이라 두 화면의 숫자를 같은 눈으로 읽을 수 있다).

import { useCallback, useEffect, useState } from "react";
import { fetchUsSectorScan, type UsScanRow, type UsScanUniverse } from "./api";
import { usSectorKrLabel } from "./usSectorLabels";

/** 카드 묶음 기준. sector = 20개 대분류, industry = 100개 소분류. */
export type UsGroupSource = "sector" | "industry";
export const US_GROUP_LABEL: Record<UsGroupSource, string> = {
  sector: "섹터(20)", industry: "산업(100)",
};

/** 스캔 범위 — 넓힐수록 산업당 표본이 늘고(중앙값 안정) 응답이 커진다. api.ts 의 US_UNIVERSE 주석 참고. */
export const US_UNIVERSE_LABEL: Record<UsScanUniverse, string> = {
  sp500: "S&P 500", cap1b: "$10억↑", cap300m: "$3억↑", all: "전체",
};
export const US_UNIVERSE_DESC: Record<UsScanUniverse, string> = {
  sp500:   "S&P 500 503종 · 약 86KB — 가장 가볍다",
  cap1b:   "시총 $10억(약 1.4조원) 이상 5,338종 · 약 1.1MB",
  cap300m: "시총 $3억(약 4천억원) 이상 7,023종 · 약 1.4MB — 한국 카드의 시총 5,000억 하한과 같은 눈높이",
  all:     "미국 전 종목 19,943종 · 약 3.9MB — 잡주까지 들어와 소형 산업의 중앙값이 흔들릴 수 있다",
};

/** 이 스냅샷의 등락률이 어느 세션 것인가. 화면에 반드시 밝힌다. */
export type UsBasis = "pre" | "regular" | "post" | "closed";
export const US_BASIS_LABEL: Record<UsBasis, string> = {
  pre: "프리장", regular: "정규장", post: "애프터", closed: "정규장 종가",
};

export interface UsSectorStock {
  ticker: string;
  name: string;
  logoid: string;
  exchange: string;
  pct: number;          // 표시 기준(basis)에 맞춘 등락률 %
  regularPct: number;   // 정규장 등락률 — 프리/애프터일 때 직전 정규장이 얼마였는지 같이 본다
  close: number;        // USD
  value: number;        // 거래대금(USD)
  cap: number;          // 시가총액(USD)
}

export interface UsSectorStat {
  key: string;        // TradingView 원명(영문) — 캐시·비교의 기준. 라벨이 바뀌어도 이건 그대로다
  label: string;      // 화면용 한글 (사전에 없으면 영문 그대로)
  enName: string;     // 원명 — 팝업에서 근거로 같이 보여준다
  count: number;      // 이 묶음의 종목 수 (= 모집단)
  total: number;
  median: number;     // 거래대금 상위 LEAD 종의 중앙값 등락률(%)
  upRatio: number;
  best: UsSectorStock;
  rows: UsSectorStock[];   // 거래대금 내림차순
}

export interface UsSectorFlow {
  fetchedAt: number;
  basis: UsBasis;
  scanned: number;    // 스캔된 종목 수
  universe: UsScanUniverse;
  // 캐시에 넣느라 종목 목록을 잘랐는가 — 잘랐으면 팝업이 '일부만' 이라고 밝혀야 한다.
  trimmed?: boolean;
  themes: UsSectorStat[];
}

// 한국 카드와 같은 값을 쓴다 — 거래대금 상위 20종의 중앙값. 시총 순이 아니라 거래대금 순인 이유는
//   "오늘 돈이 몰린 곳" 이 그날의 주도에 가깝기 때문이다(themeFlow.ts 주석 참고).
const LEAD = 20;
// 표본이 3종 미만이면 중앙값이 한 종목이다 — 카드로 만들지 않는다. (한국과 같은 기준)
const MIN_SAMPLE = 3;

// 범위·묶음별로 캐시를 나눈다 — 한 키를 돌려 쓰면 토글할 때마다 다른 묶음의 값이 잠깐 보인다.
const lsKey = (universe: UsScanUniverse, source: UsGroupSource) => `us_flow_v2_${universe}_${source}`;
// localStorage 는 보통 5MB 다. 전체(19,943종) 스냅샷을 통째로 넣으면 보유 데이터까지 밀어낸다 —
//   1MB 를 넘으면 묶음당 상위 30종만 남겨 저장한다(화면에 '일부' 라고 밝힌다).
const LS_MAX_BYTES = 1_000_000;
const CACHE_ROWS = 30;

/** 뉴욕 현지 시각(분) + 요일. 세션 판정 전용 — 초 단위는 필요 없다. */
function nowEt(): { mins: number; weekday: number } {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour12: false,
    weekday: "short", hour: "2-digit", minute: "2-digit",
  });
  const parts = Object.fromEntries(f.formatToParts(new Date()).map(p => [p.type, p.value]));
  const wdMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const hour = Number(parts.hour === "24" ? "0" : parts.hour);   // en-US h23 은 24 를 줄 수 있다
  return { mins: hour * 60 + Number(parts.minute), weekday: wdMap[parts.weekday as string] ?? 1 };
}

/** 지금이 프리장/정규장/애프터/장외 중 어디인가 (ET 기준, 휴일은 판정하지 않는다). */
export function usSessionNow(): UsBasis {
  const { mins, weekday } = nowEt();
  if (weekday === 0 || weekday === 6) return "closed";
  if (mins >= 4 * 60 && mins < 9 * 60 + 30) return "pre";
  if (mins >= 9 * 60 + 30 && mins < 16 * 60) return "regular";
  if (mins >= 16 * 60 && mins < 20 * 60) return "post";
  return "closed";
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** 세션에 맞는 등락률을 고른다. 프리/애프터 값이 비어 있으면(대부분 종목이 그렇다) 정규장으로 돌아간다. */
function pctOf(r: UsScanRow, basis: UsBasis): number {
  if (basis === "pre" && r.premarketPct) return r.premarketPct;
  if (basis === "post" && r.postmarketPct) return r.postmarketPct;
  return r.changePct;
}

export function loadCachedUsSectorFlow(universe: UsScanUniverse, source: UsGroupSource): UsSectorFlow | null {
  try {
    const raw = localStorage.getItem(lsKey(universe, source));
    if (!raw) return null;
    const f = JSON.parse(raw) as UsSectorFlow;
    return Array.isArray(f.themes) && f.themes.length > 0 ? f : null;
  } catch { return null; }
}

export async function fetchUsSectorFlow(
  universe: UsScanUniverse, source: UsGroupSource,
): Promise<UsSectorFlow> {
  const rows = await fetchUsSectorScan(universe);
  const basis = usSessionNow();

  // 프리/애프터인데 실제로 값이 들어온 종목이 거의 없으면(새벽 프리장 초반) 정규장 기준으로 되돌린다.
  //   0% 로 채워진 종목이 중앙값을 0 으로 눌러 카드가 전부 회색이 되는 것을 막는다.
  const extendedKey = basis === "pre" ? "premarketPct" : basis === "post" ? "postmarketPct" : null;
  const liveExtended = extendedKey ? rows.filter(r => r[extendedKey] !== 0).length : 0;
  const effBasis: UsBasis = extendedKey && liveExtended < rows.length * 0.1 ? "closed" : basis;

  const groups = new Map<string, UsSectorStock[]>();
  for (const r of rows) {
    const key = source === "sector" ? r.sector : r.industry;
    if (!key) continue;
    const stock: UsSectorStock = {
      ticker: r.ticker, name: r.name, logoid: r.logoid, exchange: r.exchange,
      pct: pctOf(r, effBasis), regularPct: r.changePct,
      close: r.close, value: r.valueTraded, cap: r.marketCap,
    };
    const arr = groups.get(key);
    if (arr) arr.push(stock); else groups.set(key, [stock]);
  }

  const themes: UsSectorStat[] = [];
  for (const [label, list] of groups) {
    if (list.length < MIN_SAMPLE) continue;
    const sorted = [...list].sort((a, b) => b.value - a.value);
    const lead = sorted.slice(0, LEAD);
    themes.push({
      key: label, label: usSectorKrLabel(label), enName: label,
      count: sorted.length, total: sorted.length,
      median: median(lead.map(r => r.pct)),
      upRatio: lead.filter(r => r.pct > 0).length / lead.length,
      best: [...lead].sort((a, b) => b.pct - a.pct)[0],
      rows: sorted,
    });
  }
  themes.sort((a, b) => b.median - a.median);

  const flow: UsSectorFlow = {
    fetchedAt: Date.now(), basis: effBasis, scanned: rows.length, universe, themes,
  };
  try {
    let json = JSON.stringify(flow);
    if (json.length > LS_MAX_BYTES) {
      // 종목 목록만 줄인다 — 카드(중앙값·비율)는 이미 계산된 값이라 그대로 남는다.
      json = JSON.stringify({
        ...flow, trimmed: true,
        themes: themes.map(t => ({ ...t, rows: t.rows.slice(0, CACHE_ROWS) })),
      });
    }
    localStorage.setItem(lsKey(universe, source), json);
  } catch { /* 용량 초과 — 캐시 없이도 동작 */ }
  return flow;
}

// 자동 조회는 **1콜**이라 한국 섹터(3콜)와 달리 전용 전송을 요구하지 않는다. 대신 최소 간격을 둔다.
//   묶음 기준(섹터/산업)이 달라도 응답은 같은 스캔이므로 in-flight 는 하나로 합친다.
const AUTO_MIN_GAP_MS = 5 * 60 * 1000;
const inFlight: Record<string, Promise<UsSectorFlow> | undefined> = {};
const lastAutoAt: Record<string, number | undefined> = {};

export interface UsSectorFlowState {
  flow: UsSectorFlow | null;
  loading: boolean;
  error: Error | null;
  refresh: () => void;
}

export function useUsSectorFlow(
  enabled: boolean, universe: UsScanUniverse, source: UsGroupSource,
): UsSectorFlowState {
  const key = `${universe}_${source}`;
  const [flow, setFlow] = useState<UsSectorFlow | null>(() => loadCachedUsSectorFlow(universe, source));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // 기준을 바꾸면 그 기준의 캐시부터 보여준다 — 비워 두면 화면이 한 번 깜빡인다.
  useEffect(() => { setFlow(loadCachedUsSectorFlow(universe, source)); }, [universe, source]);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    void fetchUsSectorFlow(universe, source)
      .then(f => { setFlow(f); })
      .catch((e: Error) => { setError(e); })   // 실패해도 이전 캐시는 그대로 둔다
      .finally(() => setLoading(false));
  }, [universe, source]);

  useEffect(() => {
    if (!enabled) return;
    const last = lastAutoAt[key] ?? 0;
    if (Date.now() - last < AUTO_MIN_GAP_MS) return;
    lastAutoAt[key] = Date.now();
    // StrictMode 이중 실행을 합치되, 끝나면 비운다(다시 들어오면 새로 받게).
    inFlight[key] ??= fetchUsSectorFlow(universe, source).finally(() => { delete inFlight[key]; });
    let alive = true;
    void inFlight[key]
      ?.then(f => { if (alive) setFlow(f); })
      .catch((e: Error) => { if (alive) setError(e); });
    return () => { alive = false; };
  }, [enabled, key, universe, source]);

  return { flow, loading, error, refresh };
}
