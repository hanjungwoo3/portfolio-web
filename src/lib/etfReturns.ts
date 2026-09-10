// ETF 기간 수익률 (1주·1개월·3개월) — 크롤러가 하루 1회 계산해 둔 값을 읽는다.
//
// 왜 여기서 계산하지 않나 — 기간 수익률은 과거 일봉이 필요해서 ETF 당 1콜이다(1,100콜 이상).
//   '오늘' 등락률은 배치로 6콜이면 되지만 기간은 그럴 방법이 없다. 그래서 크롤러가 미리
//   계산해 심어 두고(portfolio-etf-index/data/etf-returns.json) 프론트는 0콜로 읽는다.
//
// ★ 값은 마지막 크롤(매일 06:00 KST) 시점 기준이다. 오늘 장중 움직임은 안 들어 있다 —
//   1주·1개월·3개월 수익률에서 하루 차이는 거의 무의미하지만, 화면에 그렇게 밝힌다.

import { useEffect, useState } from "react";

const URL_RETURNS =
  "https://raw.githubusercontent.com/hanjungwoo3/portfolio-etf-index/main/data/etf-returns.json";

// 크롤러의 RETURN_PERIODS 와 키가 같아야 한다.
export type ReturnPeriod = "w1" | "m1" | "m3";
export interface EtfReturn { w1?: number; m1?: number; m3?: number }
export type EtfReturnMap = Record<string, EtfReturn>;

export const PERIOD_LABEL: Record<ReturnPeriod, string> = {
  w1: "1주", m1: "1개월", m3: "3개월",
};

const LS_KEY = "etf_returns_v1";
const LS_TS = "etf_returns_ts_v1";
const TTL_MS = 12 * 60 * 60 * 1000;

export interface EtfReturnData { returns: EtfReturnMap; version: string }

let memo: EtfReturnData | null = null;
let inflight: Promise<EtfReturnData | null> | null = null;

export function loadEtfReturns(): Promise<EtfReturnData | null> {
  if (memo) return Promise.resolve(memo);
  if (inflight) return inflight;
  const p = (async (): Promise<EtfReturnData | null> => {
    try {
      const ts = Number(localStorage.getItem(LS_TS) ?? "0");
      const raw = localStorage.getItem(LS_KEY);
      if (raw && Date.now() - ts < TTL_MS) {
        memo = JSON.parse(raw) as typeof memo;
        return memo;
      }
    } catch { /* noop */ }
    const r = await fetch(URL_RETURNS, { cache: "no-store" });
    if (!r.ok) throw new Error(`etf-returns HTTP ${r.status}`);
    const json = await r.json() as { meta?: { version?: string }; returns?: EtfReturnMap };
    memo = { returns: json.returns ?? {}, version: json.meta?.version ?? "" };
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(memo));
      localStorage.setItem(LS_TS, String(Date.now()));
    } catch { /* 용량 초과 — 캐시 없이도 동작 */ }
    return memo;
  })().catch(() => null);
  inflight = p;
  void p.finally(() => { inflight = null; });
  return p;
}

// 기간 탭을 처음 누를 때만 받는다(오늘만 볼 사용자는 이 파일을 아예 안 받는다).
export function useEtfReturns(enabled: boolean) {
  const [data, setData] = useState(memo);
  useEffect(() => {
    if (!enabled || memo) return;
    let alive = true;
    void loadEtfReturns().then(d => { if (alive) setData(d); });
    return () => { alive = false; };
  }, [enabled]);
  return data;
}
