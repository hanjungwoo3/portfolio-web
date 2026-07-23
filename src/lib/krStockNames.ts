// 코드→한글 종목명 매핑 — 정적 사전(빌드 포함) + 런타임 폴백(localStorage 캐시).
//   · 정적 사전 public/kr-stock-names.json: 런타임 0콜, 모든 사용자 즉시 공유(2600여 종목).
//     갱신: npm run gen-names (scripts/gen-stock-names.mjs). 종목명은 거의 불변이라 가끔이면 충분.
//   · 사전에 없는 코드(신규상장 등)만 네이버 polling 으로 조회 후 localStorage 에 캐시 → 다음부턴 무콜.
import { fetchProxied } from "./api";

let dictPromise: Promise<Record<string, string>> | null = null;
// 정적 사전 로드(성공 1회 메모리 캐시). 실패/빈 응답이면 캐시 무효화 + 예외 → 호출측 재시도.
//   → 최초 fetch 가 일시 실패해도 영구히 {} 로 굳어 모든 이름이 네이버(워커) 폴백되던 문제 방지.
//     (React Query staleTime:Infinity 라도 reject 는 성공 캐시가 안 돼 자동 재시도됨.)
export function loadKrNameDict(): Promise<Record<string, string>> {
  if (!dictPromise) {
    dictPromise = fetch(`${import.meta.env.BASE_URL}kr-stock-names.json`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`kr-names HTTP ${r.status}`))))
      .then((dict: Record<string, string>) => {
        if (!dict || Object.keys(dict).length === 0) throw new Error("kr-names empty");
        return dict;
      })
      .catch(err => { dictPromise = null; throw err; });  // 캐시 무효화 → 다음 호출/RQ 재시도
  }
  return dictPromise;
}

const LS_KEY = "kr_stock_names_runtime";
export function getRuntimeNames(): Record<string, string> {
  try {
    const v = localStorage.getItem(LS_KEY);
    const o: unknown = v ? JSON.parse(v) : {};
    return o && typeof o === "object" ? (o as Record<string, string>) : {};
  } catch { return {}; }
}
function addRuntimeNames(map: Record<string, string>): void {
  if (!Object.keys(map).length) return;
  try { localStorage.setItem(LS_KEY, JSON.stringify({ ...getRuntimeNames(), ...map })); }
  catch { /* noop */ }
}

// 사전·런타임캐시에 없는 코드만 네이버 polling 배치(50개씩)로 한글명 조회 → 캐시에 저장.
//   반환: 이번에 새로 얻은 {code: name}.
export async function fetchMissingKrNames(codes: string[]): Promise<Record<string, string>> {
  const uniq = [...new Set(codes.filter(c => /^[\dA-Za-z]{6}$/.test(c)))];
  if (!uniq.length) return {};
  const BATCH = 50;
  const chunks: string[][] = [];
  for (let i = 0; i < uniq.length; i += BATCH) chunks.push(uniq.slice(i, i + BATCH));
  const results = await Promise.all(chunks.map(async chunk => {
    const out: Record<string, string> = {};
    try {
      const resp = await fetchProxied(
        `https://polling.finance.naver.com/api/realtime/domestic/stock/${chunk.join(",")}`);
      if (!resp.ok) return out;
      const j = await resp.json() as { datas?: { itemCode?: string; stockName?: string }[] };
      for (const x of j.datas ?? []) if (x.itemCode && x.stockName) out[String(x.itemCode)] = String(x.stockName);
    } catch { /* noop */ }
    return out;
  }));
  const merged: Record<string, string> = {};
  for (const r of results) Object.assign(merged, r);
  addRuntimeNames(merged);
  return merged;
}
