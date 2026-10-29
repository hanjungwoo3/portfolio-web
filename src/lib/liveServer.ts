// 서버 수집본 — ETF 랭킹·종목찾기(눌림목)·실적 일정·히트맵을 크롤러(portfolio-etf-index scripts/live.js)가 10분마다 받아 둔다
//   (사용자 요청 2026-10-29 "ETF 랭킹, 종목찾기(눌림목), 실적 일정, 히트맵까지 다 하자").
//   웹은 프록시 대신 이 파일을 읽는다 — 사용자 수와 상관없이 원본 호출은 서버 한 곳. 앱(직결)은 지금처럼 직접 받는다(더 최신, 프록시 비용 없음).
//   raw CDN 은 5분 캐시라 실제 나이는 최대 ~15분 — 화면에 서버 갱신 시각을 같이 보여준다.
import { isDirectApp } from "./nativeProxy";

const LIVE = "https://raw.githubusercontent.com/hanjungwoo3/portfolio-etf-index/live/data/live";

/** 서버 수집본을 먼저 쓰는가 — 웹(브라우저·모바일 웹)은 예, 앱은 직접 받는다. */
export function preferServer(): boolean {
  return !isDirectApp();
}

/** live/<name>.json — 실패·형태 불량이면 null(호출측이 직접 조회로 폴백할지 정한다).
 *  ver = 그 파일의 서버 갱신 시각(index.json) — 주면 주소 키로 써서 같은 판은 브라우저가 가진 걸 쓰고, 바뀌면 바로 새로 받는다. */
export async function fetchLive<T extends { fetchedAt: number }>(name: string, ver?: number): Promise<T | null> {
  try {
    // 판을 모르면 raw CDN 5분 캐시 — 2분 단위로 키를 바꿔 너무 묵지 않게(dartDisclosures 와 같은 방식)
    const r = await fetch(`${LIVE}/${name}.json?t=${ver ?? Math.floor(Date.now() / 120_000)}`);
    if (!r.ok) return null;
    const j = await r.json() as T;
    return typeof j?.fetchedAt === "number" ? j : null;
  } catch { return null; }
}

/** live/index.json — { 이름: 서버 갱신 시각 } 작은 파일. 설정 주기(5초 등)마다 이것만 보고 시각이 바뀐 것만 전체를 받는다
 *  (사용자 제안 2026-10-29 "5초마다 시간만 가져오고 시간이 바뀌면 가져오던지"). 매번 새 주소라 CDN 캐시를 건너뛴다. */
export async function fetchLiveIndex(): Promise<Record<string, number> | null> {
  try {
    const r = await fetch(`${LIVE}/index.json?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return null;
    const j = await r.json() as Record<string, number>;
    return j && typeof j === "object" ? j : null;
  } catch { return null; }
}

/** "10:42" — KST 시:분. 날이 다르면 "10/28 15:40". */
export function fmtServerStamp(ms: number): string {
  const k = new Date(ms + 9 * 3600_000).toISOString();
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  return k.slice(0, 10) === today ? k.slice(11, 16) : `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))} ${k.slice(11, 16)}`;
}
