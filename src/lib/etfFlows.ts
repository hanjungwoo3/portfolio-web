// ETF 외국인·개인 순매수 (전일·5일·20일·60일, 억원) — 크롤러가 하루 1회 계산해 둔 값을 읽는다.
//   portfolio-etf-index/scripts/etf-flows.js → data/etf-flows.json. ETF 당 1콜이라 화면에서 부르면 1,100콜이 넘는다.
//
// 기관은 일부러 없다 — ETF 의 기관 수치엔 LP(유동성공급자) 호가 대응 물량이 섞여 '개인 +, 기관 −' 가
//   거울처럼 나온다. 신호로 읽을 수 있는 건 외국인, 개인은 반대편 참고용(사용자 결정 2026-10-19).
//
// ★ 값은 마지막 크롤(매일 06:00 KST) 시점의 **전 거래일까지**다. 장중 수급은 무료 소스가 없다.

import { useEffect, useState } from "react";

const URL_FLOWS =
  "https://raw.githubusercontent.com/hanjungwoo3/portfolio-etf-index/main/data/etf-flows.json";

export type FlowWho = "fo" | "pe";
export type FlowWindow = 1 | 5 | 20 | 60;
export const FLOW_WINDOWS: FlowWindow[] = [1, 5, 20, 60];
export const FLOW_WHO_LABEL: Record<FlowWho, string> = { fo: "외국인", pe: "개인" };
export const FLOW_WINDOW_LABEL: Record<FlowWindow, string> = { 1: "전일", 5: "5일", 20: "20일", 60: "60일" };

// 파일의 배열 순서 — [외1, 개1, 외5, 개5, 외20, 개20, 외60, 개60] (크롤러 주석과 같아야 한다)
export function flowOf(v: (number | null)[] | undefined, who: FlowWho, win: FlowWindow): number | undefined {
  if (!v) return undefined;
  const x = v[FLOW_WINDOWS.indexOf(win) * 2 + (who === "fo" ? 0 : 1)];
  return x == null ? undefined : x;
}

const LS_KEY = "etf_flows_v1";
const LS_TS = "etf_flows_ts_v1";
const TTL_MS = 6 * 60 * 60 * 1000;

export interface EtfFlowData { flows: Record<string, (number | null)[]>; asOf: string }

let memo: EtfFlowData | null = null;
let inflight: Promise<EtfFlowData | null> | null = null;

export function loadEtfFlows(): Promise<EtfFlowData | null> {
  if (memo) return Promise.resolve(memo);
  if (inflight) return inflight;
  const p = (async (): Promise<EtfFlowData | null> => {
    try {
      const ts = Number(localStorage.getItem(LS_TS) ?? "0");
      const raw = localStorage.getItem(LS_KEY);
      if (raw && Date.now() - ts < TTL_MS) {
        const c = JSON.parse(raw) as EtfFlowData;
        if (Object.keys(c.flows ?? {}).length > 0) { memo = c; return memo; }   // 빈 캐시는 적중으로 치지 않는다
      }
    } catch { /* noop */ }
    const r = await fetch(URL_FLOWS, { cache: "no-store" });
    if (!r.ok) throw new Error(`etf-flows HTTP ${r.status}`);
    const json = await r.json() as { meta?: { asOf?: string }; flows?: Record<string, (number | null)[]> };
    const d: EtfFlowData = { flows: json.flows ?? {}, asOf: json.meta?.asOf ?? "" };
    if (Object.keys(d.flows).length === 0) return null;      // 빈 결과는 저장도 안 한다
    memo = d;
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

// 수급별 탭을 처음 열 때만 받는다.
export function useEtfFlows(enabled: boolean) {
  const [data, setData] = useState(memo);
  useEffect(() => {
    if (!enabled || memo) return;
    let alive = true;
    void loadEtfFlows().then(d => { if (alive) setData(d); });
    return () => { alive = false; };
  }, [enabled]);
  return data;
}
