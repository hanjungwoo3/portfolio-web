// 최근 5거래일 주요 공시(전 종목) — 종목코드 → 공시 줄. 카드의 공시 종류 꼬리표(실적·계약·합병·분할…)용(사용자 2026-11-03
//   "지수나 개별종목 카드에도"). 날짜별 DART 서버 파일(최신공시 탭과 같은 파일, 10분마다 갱신)이라 종목 수와 무관하게 하루 1파일.
//   잡음(ETF 안내·임원 소유 보고 등)은 빼고 최신공시 기본 종류(실적·배당·자사주·계약·증자·CB·합병·분할·소송·제재)만.
import { useQuery } from "@tanstack/react-query";
import { fetchDartCounts, fetchDartDayPreferServer, loadListedCorps, normCorp, type DartRow } from "./dartDisclosures";
import { classifyDisclosure, DEFAULT_DISC_CATS, type DiscCat } from "./disclosureFilter";

export type DiscRow = DartRow & { code: string; cat: DiscCat };

export async function loadRecentDiscAll(): Promise<Map<string, DiscRow[]>> {
  const counts = await fetchDartCounts();
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const days = Object.keys(counts).filter(d => d <= today && counts[d] > 0).sort().slice(-5);
  if (!days.includes(today)) days.push(today);
  const [lists, corps] = await Promise.all([
    Promise.all(days.map(d => fetchDartDayPreferServer(d).then(x => x.rows).catch(() => [] as DartRow[]))),
    loadListedCorps().catch(() => new Map<string, string>()),
  ]);
  const keep = new Set<DiscCat>(DEFAULT_DISC_CATS);
  const out = new Map<string, DiscRow[]>();
  for (const r of lists.flat()) {
    const code = r.code ?? corps.get(normCorp(r.corp));
    if (!code) continue;
    const c = classifyDisclosure(r.title);
    if (c.noise || !keep.has(c.cat)) continue;
    (out.get(code) ?? out.set(code, []).get(code)!).push({ ...r, code, cat: c.cat });
  }
  for (const v of out.values()) v.sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  return out;
}

const EMPTY = new Map<string, DiscRow[]>();
/** 종목코드 → 최근 공시(최신순). 못 받으면 빈 맵 */
export function useRecentDisc(enabled = true): Map<string, DiscRow[]> {
  const { data } = useQuery({
    queryKey: ["recent-disc-all"], queryFn: loadRecentDiscAll, enabled,
    staleTime: 5 * 60_000, refetchInterval: 10 * 60_000, retry: 1,
  });
  return data ?? EMPTY;
}
