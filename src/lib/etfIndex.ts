// portfolio-etf-index — 별도 레포의 정적 JSON을 fetch 해서 종목↔ETF 매핑 제공.
// 데이터는 매일 1회 GH Actions 가 갱신. raw.githubusercontent.com CDN(5분 캐시) 사용.
// 클라이언트는 12h localStorage 캐시 + 메모리 캐시.

import { useEffect, useState } from "react";

const BASE = "https://raw.githubusercontent.com/hanjungwoo3/portfolio-etf-index/main/data";
const URL_INDEX = `${BASE}/etf-index.json`;
const URL_LIST  = `${BASE}/etf-list.json`;

const LS_INDEX = "etf_index_v1";
const LS_LIST  = "etf_list_v1";
const LS_TS    = "etf_data_ts";
const TTL_MS   = 12 * 60 * 60 * 1000;   // 12시간

export interface EtfMeta { name: string }
export interface EtfHolding {
  etfCode: string;
  etfName: string;
  ratio: number;            // 이 종목이 ETF 안에서 차지하는 비중 (%)
}
export interface EtfMatchSingle extends EtfHolding {}
export interface EtfMatchMulti {
  etfCode: string;
  etfName: string;
  perTicker: Record<string, number>;   // ticker → 비중 (%)
  totalRatio: number;                   // 합산 비중
  hitCount: number;                     // 매칭된 입력 종목 수
}

interface EtfData {
  stocks: Record<string, Array<[string, number]>>;   // ticker → [[etfCode, ratio], ...]
  list: Record<string, EtfMeta>;                      // etfCode → {name}
  meta: { version: string; etfCount: number; stockCount: number };
}

let memo: EtfData | null = null;
let inflight: Promise<EtfData> | null = null;
// 데이터 로드 완료/캐시 무효화 시 구독자에게 알림 — React 카드 뱃지 갱신용
const subscribers = new Set<() => void>();
function notify(): void { subscribers.forEach(fn => fn()); }

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
  return await r.json() as T;
}

// 데이터 로드 — 메모리 캐시 → localStorage(12h) → 네트워크
export function loadEtfData(): Promise<EtfData> {
  if (memo) return Promise.resolve(memo);
  if (inflight) return inflight;
  inflight = (async () => {
    // 1) localStorage 캐시 (12h)
    try {
      const ts = Number(localStorage.getItem(LS_TS) ?? "0");
      if (Date.now() - ts < TTL_MS) {
        const idxRaw = localStorage.getItem(LS_INDEX);
        const lstRaw = localStorage.getItem(LS_LIST);
        if (idxRaw && lstRaw) {
          const idx = JSON.parse(idxRaw) as { meta: EtfData["meta"]; stocks: EtfData["stocks"] };
          const lst = JSON.parse(lstRaw) as { etfs: EtfData["list"] };
          memo = { stocks: idx.stocks, list: lst.etfs, meta: idx.meta };
          return memo;
        }
      }
    } catch { /* noop */ }
    // 2) 네트워크 (병렬)
    const [idxJson, lstJson] = await Promise.all([
      fetchJson<{ meta: EtfData["meta"]; stocks: EtfData["stocks"] }>(URL_INDEX),
      fetchJson<{ etfs: EtfData["list"] }>(URL_LIST),
    ]);
    memo = { stocks: idxJson.stocks, list: lstJson.etfs, meta: idxJson.meta };
    try {
      localStorage.setItem(LS_INDEX, JSON.stringify({ meta: idxJson.meta, stocks: idxJson.stocks }));
      localStorage.setItem(LS_LIST, JSON.stringify({ etfs: lstJson.etfs }));
      localStorage.setItem(LS_TS, String(Date.now()));
    } catch { /* noop */ }
    return memo;
  })();
  // localStorage 즉시 적중도 notify 동작하도록 then 으로 처리
  inflight.then(() => notify()).catch(() => { /* noop */ });
  return inflight;
}

// 캐시 무효화 (수동 새로고침용)
export function clearEtfCache(): void {
  memo = null; inflight = null;
  try {
    localStorage.removeItem(LS_INDEX);
    localStorage.removeItem(LS_LIST);
    localStorage.removeItem(LS_TS);
  } catch { /* noop */ }
  notify();
}

// React 훅 — 종목별 포함 ETF 개수. 첫 호출 시 데이터 로드 트리거, 로드 완료 시 자동 갱신.
export function useEtfCount(ticker: string): number {
  const [, force] = useState(0);
  useEffect(() => {
    if (!memo) void loadEtfData();
    const fn = () => force(v => v + 1);
    subscribers.add(fn);
    return () => { subscribers.delete(fn); };
  }, []);
  return memo?.stocks[ticker]?.length ?? 0;
}

// 단일 종목 포함 ETF — 비중 내림차순
export async function getEtfsContainingStock(ticker: string): Promise<EtfHolding[]> {
  const data = await loadEtfData();
  const arr = data.stocks[ticker] ?? [];
  return arr.map(([code, ratio]) => ({
    etfCode: code,
    etfName: data.list[code]?.name ?? code,
    ratio,
  }));
}

// 단일 종목 포함 ETF 카운트 — 카드 배지용 (사전 로드 안 됐으면 0 반환, 동기)
export function getEtfCountSync(ticker: string): number {
  return memo?.stocks[ticker]?.length ?? 0;
}

// 다중 종목 — 교집합/합집합. 정렬: hitCount 내림차순 → totalRatio 내림차순
export async function getEtfsContainingStocks(
  tickers: string[], mode: "all" | "any" = "all",
): Promise<EtfMatchMulti[]> {
  return searchEtfs({ include: tickers, exclude: [], mode });
}

// 포함/제외 필터 동시 적용.
// - include: mode 에 따라 모두 포함("all") 또는 하나라도 포함("any")
// - exclude: 단 하나라도 들어있으면 결과에서 제외
export interface EtfSearchOpts {
  include: string[];
  exclude?: string[];
  mode?: "all" | "any";
}
export async function searchEtfs(opts: EtfSearchOpts): Promise<EtfMatchMulti[]> {
  const include = opts.include ?? [];
  const exclude = opts.exclude ?? [];
  const mode = opts.mode ?? "all";
  if (include.length === 0 && exclude.length === 0) return [];
  const data = await loadEtfData();

  // 제외 ETF 집합 — exclude 종목 중 하나라도 들어있는 ETF
  const excludedEtfs = new Set<string>();
  for (const t of exclude) {
    const arr = data.stocks[t];
    if (!arr) continue;
    for (const [code] of arr) excludedEtfs.add(code);
  }

  // include 가 비어있으면 "제외 종목이 없는 모든 ETF" 를 반환할 수도 있으나,
  // 의미가 모호하므로 빈 결과 반환.
  if (include.length === 0) return [];

  // ETF 별 매칭 집계
  const byEtf: Map<string, { perTicker: Record<string, number>; total: number; hits: number }> = new Map();
  for (const t of include) {
    const arr = data.stocks[t];
    if (!arr) continue;
    for (const [code, ratio] of arr) {
      if (excludedEtfs.has(code)) continue;
      const cur = byEtf.get(code) ?? { perTicker: {}, total: 0, hits: 0 };
      if (cur.perTicker[t] === undefined) { cur.hits += 1; cur.total += ratio; cur.perTicker[t] = ratio; }
      byEtf.set(code, cur);
    }
  }
  const minHits = mode === "all" ? include.length : 1;
  const out: EtfMatchMulti[] = [];
  for (const [code, v] of byEtf) {
    if (v.hits < minHits) continue;
    out.push({
      etfCode: code,
      etfName: data.list[code]?.name ?? code,
      perTicker: v.perTicker,
      totalRatio: v.total,
      hitCount: v.hits,
    });
  }
  out.sort((a, b) => b.hitCount - a.hitCount || b.totalRatio - a.totalRatio);
  return out;
}
