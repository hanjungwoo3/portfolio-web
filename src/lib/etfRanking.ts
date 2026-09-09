// 전체 ETF 상승률 랭킹 — etfIndex 의 ETF 목록(828종) 전 종목 시세를 받아 등락률로 줄 세운다.
//
// 호출 비용: 토스 배치가 50종/콜 이므로 828종 = 약 17 프록시 콜. 이 앱은 호출수가 병목이라
// 폴링에 태우면 안 된다 → 사용자가 "새로고침" 을 누를 때만 조회하고 localStorage 에 캐시한다.
// (탭 첫 진입 시 캐시가 없으면 1회 자동 조회)

import { useCallback, useEffect, useState } from "react";
import type { Price } from "../types";
import { fetchTossPrices } from "./api";
import { loadEtfData } from "./etfIndex";
import { dayChangePct } from "./format";
import { buildSectorStats, type EtfSectorStat } from "./etfSectors";

export interface EtfRankRow {
  code: string;
  name: string;
  pct: number;      // 등락률 (%)
  price: number;    // 현재가
  base: number;     // 어제 종가(기준가)
  volume: number;
}

export interface EtfRanking {
  fetchedAt: number;     // 조회 시각 (ms) — "기준 15:51" 표시용
  tradeDate: string;     // 데이터 기준 거래일 (토스 trade_date 최빈값)
  scanned: number;       // 등락률을 구한 종목 수
  total: number;         // 색인상 ETF 총 개수
  top: EtfRankRow[];     // 상승 상위 (pct 내림차순)
  bottom: EtfRankRow[];  // 하락 하위 (pct 오름차순 — 가장 많이 빠진 게 먼저)
  // 섹터 요약 — 상·하위 100 이 아니라 '전수'로 집계해야 의미가 있어서 조회 시점에 만들어 둔다.
  //   (top/bottom 만 남기고 버리면 나중에 다시 계산할 수 없다 — 17콜을 또 쓸 수는 없다)
  sectors: EtfSectorStat[];
}

// 저장 개수. 표시는 상위 50 이고 "더보기" 로 KEEP 까지 펼친다.
export const RANK_KEEP = 100;
export const RANK_SHOW = 50;

// 레버리지 ETF 판별 — 이름에 "레버리지" 포함 (예: KODEX 2차전지산업레버리지). 랭킹 "레버리지 제외" 필터용.
export function isLeverageEtf(name: string): boolean {
  return name.includes("레버리지");
}

// 선물 ETF 판별 — 이름에 "선물" 포함 (예: HANARO 코스닥150선물레버리지, KODEX 골드선물). 랭킹 "선물 제외" 필터용.
export function isFuturesEtf(name: string): boolean {
  return name.includes("선물");
}

// v2 — 섹터 요약(sectors)이 추가된 형태. 옛 캐시(v1)는 섹터가 없어 그대로 못 쓴다.
//   키를 올리면 탭 첫 진입 때 자동으로 한 번 다시 받는다(그 뒤로는 새로고침 버튼으로만).
const LS_KEY = "etf_ranking_v2";

export function loadCachedRanking(): EtfRanking | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as EtfRanking;
    // 형태가 안 맞는 옛 캐시는 버린다
    if (!Array.isArray(r.top) || !Array.isArray(r.bottom)) return null;
    if (!Array.isArray(r.sectors)) return null;
    return r;
  } catch {
    return null;
  }
}

function saveRanking(r: EtfRanking): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(r)); }
  catch { /* 용량 초과 등 — 캐시는 없어도 동작 */ }
}

// 가장 많이 등장한 trade_date — 일부 종목이 거래정지로 옛 날짜를 물고 있어도 대표값이 흔들리지 않음
function dominantTradeDate(prices: Price[]): string {
  const count = new Map<string, number>();
  for (const p of prices) {
    if (!p.trade_date) continue;
    count.set(p.trade_date, (count.get(p.trade_date) ?? 0) + 1);
  }
  let best = "", bestN = 0;
  for (const [d, n] of count) if (n > bestN) { best = d; bestN = n; }
  return best;
}

// 전체 ETF 시세 조회 → 등락률 정렬. 17콜 소모하므로 호출부에서 사용자 액션에만 묶을 것.
export async function fetchEtfRanking(): Promise<EtfRanking> {
  const data = await loadEtfData();
  const codes = Object.keys(data.list);
  const prices = await fetchTossPrices(codes);   // 내부에서 50개씩 청크 분할

  const rows: EtfRankRow[] = [];
  for (const p of prices) {
    const pct = dayChangePct(p);
    if (pct === undefined || !Number.isFinite(pct)) continue;
    rows.push({
      code: p.ticker,
      name: data.list[p.ticker]?.name ?? p.ticker,
      pct,
      price: p.price,
      base: p.base,
      volume: p.volume,
    });
  }
  rows.sort((a, b) => b.pct - a.pct);

  const ranking: EtfRanking = {
    fetchedAt: Date.now(),
    tradeDate: dominantTradeDate(prices),
    scanned: rows.length,
    total: codes.length,
    top: rows.slice(0, RANK_KEEP),
    // 하락 하위 — 뒤에서 KEEP 개를 떼어 "가장 많이 빠진 것" 부터 오게 뒤집는다
    bottom: rows.slice(Math.max(0, rows.length - RANK_KEEP)).reverse(),
    sectors: buildSectorStats(rows),   // ★ 전수(rows) 기준 — 상·하위만 보면 섹터가 왜곡된다
  };
  saveRanking(ranking);
  return ranking;
}

// 지수 탭용 — 탭에 들어올 때마다 새로 받고, 그 사이에는 새로고침 버튼으로 받는다.
//   지수 탭은 조건부 렌더라 탭을 나가면 언마운트되고 돌아오면 다시 마운트된다 → 이펙트가 곧
//   '탭 진입' 신호다. 폴링은 여전히 안 한다(전수 조회가 약 17 프록시 콜).
//   캐시는 즉시 그려 두고 새 값이 오면 갈아끼우므로 빈 화면이 보이지 않는다.
//   ETF랭킹 탭과 같은 localStorage 캐시라 한쪽이 받으면 다른 쪽도 새 값을 본다.
//   ★ '진행 중인 조회' 만 공유한다(끝나면 비운다). 페이지 내내 붙들면 탭을 다시 들어와도
//     같은 결과가 재사용돼 갱신이 안 된다. 반대로 아무 것도 공유 안 하면 StrictMode 의
//     이펙트 이중 실행 때문에 같은 조회가 두 번 나간다 — 그 사이만 합치는 게 맞다.
let inFlight: Promise<EtfRanking> | null = null;
export interface SectorFlowState {
  ranking: EtfRanking | null;
  loading: boolean;
  refresh: () => void;
}

export function useCachedSectorFlow(enabled: boolean): SectorFlowState {
  const [ranking, setRanking] = useState<EtfRanking | null>(() => loadCachedRanking());
  const [loading, setLoading] = useState(false);

  // 사용자가 누른 새로고침 — 진행 표시를 켠다.
  const refresh = useCallback(() => {
    setLoading(true);
    void fetchEtfRanking()
      .then(setRanking)
      .catch(() => { /* 실패하면 이전 캐시를 그대로 둔다 */ })
      .finally(() => setLoading(false));
  }, []);

  // 탭 진입(마운트)마다 새로 받는다. 여기선 setState 를 동기로 부르지 않는다(이펙트 규칙).
  useEffect(() => {
    if (!enabled) return;
    inFlight ??= fetchEtfRanking().finally(() => { inFlight = null; });
    let alive = true;
    void inFlight
      .then(r => { if (alive) setRanking(r); })
      .catch(() => { /* 실패하면 캐시(없으면 고정 카드)가 그대로 남는다 */ });
    return () => { alive = false; };
  }, [enabled]);

  return { ranking, loading, refresh };
}
