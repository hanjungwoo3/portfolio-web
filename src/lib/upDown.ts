// 오른·내린 종목 수(시장 폭) — 코스피·코스닥 전체(사용자 2026-11-09 "kospimap 증시 전광판의 ↑19 ↓79 처럼").
//   출처 = 네이버 지수 integration 의 upDownStockInfo(실시간). 웹은 서버 수집본(live/updown.json, 2분), 앱은 직접 2콜.
import { fetchProxied } from "./api";
import { fetchLive, preferServer } from "./liveServer";

export interface UpDown { upper: number; rise: number; flat: number; fall: number; lower: number }   // rise 는 상한 포함, fall 은 하한 포함
export interface UpDownResult { at: number; kospi?: UpDown; kosdaq?: UpDown }

const toUD = (a?: number[]): UpDown | undefined => (a && a.length === 5 ? { upper: a[0], rise: a[1], flat: a[2], fall: a[3], lower: a[4] } : undefined);

export async function fetchUpDown(): Promise<UpDownResult> {
  if (preferServer()) {
    const d = await fetchLive<{ fetchedAt: number; KOSPI?: number[]; KOSDAQ?: number[] }>("updown");
    if (d && Date.now() - d.fetchedAt < 10 * 60_000) return { at: d.fetchedAt, kospi: toUD(d.KOSPI), kosdaq: toUD(d.KOSDAQ) };
    if (d) return { at: d.fetchedAt, kospi: toUD(d.KOSPI), kosdaq: toUD(d.KOSDAQ) };   // 장 밖 — 마지막 값 그대로(프록시 아낀다)
  }
  const one = async (mkt: string) => {
    const r = await fetchProxied(`https://m.stock.naver.com/api/index/${mkt}/integration`);
    if (!r.ok) return undefined;
    const u = ((await r.json()) as { upDownStockInfo?: Record<string, unknown> }).upDownStockInfo;
    return u ? toUD([u.upperCount, u.riseCount, u.steadyCount, u.fallCount, u.lowerCount].map(x => Number(String(x ?? "").replace(/,/g, "")) || 0)) : undefined;   // "1,376" 쉼표
  };
  const [kospi, kosdaq] = await Promise.all([one("KOSPI"), one("KOSDAQ")]);
  if (!kospi && !kosdaq) throw new Error("오른·내린 종목 수를 못 받았어요");
  return { at: Date.now(), kospi, kosdaq };
}
