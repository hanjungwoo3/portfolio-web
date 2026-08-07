// ETF 구성 비중 정적 사전 로드 — public/etf-weights.json (scripts/gen-etf-weights.mjs 생성).
//   히트맵 'ETF 비중' 크기 모드용. 런타임 0콜(프록시 불필요). 실패/빈 응답이면 캐시 안 하고 재시도.
export interface EtfWeightsData {
  gijunYMD: string;                                    // 구성 기준일 (YYYYMMDD)
  weights: Record<string, Record<string, number>>;    // weightKey → { 종목코드: 비중% }
}

let promise: Promise<EtfWeightsData | null> | null = null;
export function loadEtfWeights(): Promise<EtfWeightsData | null> {
  if (!promise) {
    promise = fetch(`${import.meta.env.BASE_URL}etf-weights.json`)
      .then(r => (r.ok ? r.json() : null))
      .then((d: EtfWeightsData | null) => {
        if (!d || !d.weights || Object.keys(d.weights).length === 0) { promise = null; return null; }
        return d;
      })
      .catch(() => { promise = null; return null; });
  }
  return promise;
}
