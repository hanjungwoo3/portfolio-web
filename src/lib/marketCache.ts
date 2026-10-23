// 시세 자료 기기 저장(캐시) — 천천히 바뀌는 자료(일봉 등)를 IndexedDB 에 두고 앱을 다시 켜도 다시 쓴다.
//   앱을 켤 때마다 야후 일봉을 수백 건 새로 받아 야후가 막았다(429, 2026-10-23) → 저장해 두고 기간이 지난 것만 받는다.
//   ★ 사용자 자료 DB(db.ts — Drive 동기화 대상)와 섞지 않는다. 이건 지워져도 다시 받으면 그만인 자료다.
//   ★ 빈 값·실패는 저장하지 않는다(빈 캐시는 저장도 적중도 금지 — 일시적 0건이 기간 내내 굳는다).
//     예외: '없음'이 확정된 응답(야후 404 = 그 거래소에 없는 종목)은 표시를 붙여 저장한다 — .KS/.KQ 양쪽을 묻는 절반이 404 다.
import Dexie, { type Table } from "dexie";

interface Row { key: string; ts: number; data: unknown }

class MarketCacheDb extends Dexie {
  kv!: Table<Row, string>;
  constructor() {
    super("pf-market-cache");
    this.version(1).stores({ kv: "key, ts" });
  }
}

let db: MarketCacheDb | null = null;
function getDb(): MarketCacheDb | null {
  if (db) return db;
  try { db = new MarketCacheDb(); return db; } catch { return null; }   // 사생활 보호 모드 등 — 캐시 없이 동작
}

const mem = new Map<string, Row>();            // 같은 실행 안에서는 메모리로(IndexedDB 왕복 없이)
const inflight = new Map<string, Promise<unknown>>();   // 같은 키를 동시에 부르면 한 번만 받는다

export const NOT_FOUND = { __notFound: true } as const;   // '없음' 확정 표시
export const isNotFound = (v: unknown): v is typeof NOT_FOUND => !!v && typeof v === "object" && (v as { __notFound?: boolean }).__notFound === true;

async function read(key: string): Promise<Row | undefined> {
  const m = mem.get(key);
  if (m) return m;
  try {
    const r = await getDb()?.kv.get(key);
    if (r) mem.set(key, r);
    return r;
  } catch { return undefined; }
}

function write(key: string, data: unknown) {
  const row = { key, ts: Date.now(), data };
  mem.set(key, row);
  void getDb()?.kv.put(row).catch(() => { /* 저장 실패 — 이번 실행 메모리로만 */ });
}

/**
 * key 로 저장된 값이 ttlMs 안이면 그걸, 아니면 fn() 으로 받아 저장한다.
 *   isEmpty(값) 이 참이면 저장하지 않는다(다음에 다시 묻는다).
 *   fn() 이 던지면 — 기간이 지났더라도 저장된 값이 있으면 그걸 돌려준다(야후가 막혀도 그래프가 남게). 없으면 그대로 던진다.
 */
export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>, isEmpty: (v: T) => boolean): Promise<T> {
  const hit = await read(key);
  if (hit && Date.now() - hit.ts < ttlMs) return hit.data as T;
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const p = (async () => {
    try {
      const v = await fn();
      if (!isEmpty(v)) write(key, v);
      return v;
    } catch (e) {
      if (hit) return hit.data as T;
      throw e;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

/** 오래된 줄 정리 — 앱 시작 때 한 번. 이틀 넘은 건 어차피 다시 받는다 */
export function pruneMarketCache(maxAgeMs = 2 * 24 * 3600_000) {
  const cut = Date.now() - maxAgeMs;
  void getDb()?.kv.where("ts").below(cut).delete().catch(() => {});
}
