// 토스 공식 API 값의 **앱 → Drive → 웹·휴대폰 중계**(사용자 요청 2026-10-26 "불러오는 건 앱만 되지만 불러온 값은 sync 되어도").
//   계좌 자료(보유·예수금·거래)는 이미 portfolio.json 동기화로 넘어간다. 여기는 앱에서만 받을 수 있는 **시세성 값**
//   (지금은 증시 [장기] 주·월·연 투자자 매매대금)을 appDataFolder 의 작은 파일 `toss-relay.json` 에 올려 두고,
//   웹·휴대폰은 토스 API 대신 이 파일을 읽는다(같은 구글 계정으로 Drive 동기화가 켜져 있어야 한다).
//   · 앱: 자동 갱신 주기(useTossAutoSync)에 얹어 6시간에 한 번 6개 시계열(코스피·코스닥 × 주·월·연)을 받아 올린다.
//   · 웹: 세션당 한 번 내려받아 메모리에(30분). 파일이 없으면 [장기] 버튼도 없다.
import { useEffect, useState } from "react";
import { downloadNamed, uploadNamed } from "./googleDrive";
import { isSignedIn } from "./googleAuth";
import { fetchTossMarketFlow, type LongFlowInterval, type LongFlowMarket, type LongFlowPoint } from "./tossMarketFlow";

export const TOSS_RELAY_FILE = "toss-relay.json";
const PUBLISH_EVERY_MS = 6 * 3600_000;
const PUBLISH_STAMP = "toss_relay_published_at";
const INTERVALS: { key: LongFlowInterval; count: number }[] = [{ key: "1w", count: 26 }, { key: "1mo", count: 24 }, { key: "1y", count: 15 }];
const MARKETS: LongFlowMarket[] = ["kospi", "kosdaq"];

export interface TossRelay {
  v: 1;
  updatedAt: string;   // ISO — 앱이 받은 시각
  marketFlow: Partial<Record<LongFlowMarket, Partial<Record<LongFlowInterval, LongFlowPoint[]>>>>;
}

/** 앱 쪽 — 6시간에 한 번, Drive 로그인돼 있을 때만. 실패는 조용히(다음 주기에 다시) */
export async function publishTossRelayIfDue(force = false): Promise<boolean> {
  if (!isSignedIn()) return false;
  try {
    const last = Number(localStorage.getItem(PUBLISH_STAMP) ?? "0");
    if (!force && Date.now() - last < PUBLISH_EVERY_MS) return false;
  } catch { /* noop */ }
  const marketFlow: TossRelay["marketFlow"] = {};
  for (const m of MARKETS) {
    marketFlow[m] = {};
    for (const it of INTERVALS) {
      try { marketFlow[m]![it.key] = await fetchTossMarketFlow(m, it.key, it.count); }
      catch { /* 한 시계열 실패는 건너뛴다 */ }
    }
  }
  const relay: TossRelay = { v: 1, updatedAt: new Date().toISOString(), marketFlow };
  try {
    await uploadNamed(TOSS_RELAY_FILE, relay);
    try { localStorage.setItem(PUBLISH_STAMP, String(Date.now())); } catch { /* noop */ }
    cache = { at: Date.now(), relay };
    return true;
  } catch { return false; }
}

// 웹 쪽 — 내려받기(메모리 30분). 로그인 안 됐거나 파일 없으면 null
let cache: { at: number; relay: TossRelay | null } | null = null;
let inflight: Promise<TossRelay | null> | null = null;
export async function loadTossRelay(): Promise<TossRelay | null> {
  if (cache && Date.now() - cache.at < 30 * 60_000) return cache.relay;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      if (!isSignedIn()) return null;
      const r = await downloadNamed<TossRelay>(TOSS_RELAY_FILE);
      const relay = r?.data && r.data.v === 1 && r.data.marketFlow ? r.data : null;
      cache = { at: Date.now(), relay };
      return relay;
    } catch { return null; }
    finally { inflight = null; }
  })();
  return inflight;
}

/** 화면용 — 중계 파일(없으면 null). 로그인 상태가 바뀌면 다시 본다 */
export function useTossRelay(enabled: boolean): TossRelay | null {
  const [relay, setRelay] = useState<TossRelay | null>(cache?.relay ?? null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void loadTossRelay().then(r => { if (alive) setRelay(r); });
    return () => { alive = false; };
  }, [enabled]);
  return relay;
}
