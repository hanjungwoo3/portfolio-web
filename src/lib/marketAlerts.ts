// 시장경보 목록 — 투자경고·투자위험(지정 중) + 투자주의(오늘 지정). 지수 탭 카드의 경고 책갈피용.
//   크롤러(portfolio-etf-index/scripts/alerts.js)가 매일 06:00 KST 에 한국거래소 공시(KIND)에서 받아 둔다(0콜).
//   토스 wts-badges 는 종목당 1콜이라 지수 탭 한국 종목 전부에 부르면 프록시 호출수가 터진다.
//   (내 종목 카드는 지금처럼 토스 뱃지를 쓴다 — 관리종목·거래정지·단기과열까지 나온다. 여긴 시장경보 3단계만.)
import { useQuery } from "@tanstack/react-query";

const URL_ALERTS =
  "https://raw.githubusercontent.com/hanjungwoo3/portfolio-etf-index/main/data/market-alerts.json";

// 거래정지 = 크롤러가 KIND 매매거래정지 목록(그날 06:00 기준)에서 넣는다(2026-10-27, 사용자 "투자경고랑 같은 로직"). 장중 새 정지는 다음 날 반영.
export type AlertLevel = "투자주의" | "투자경고" | "투자위험" | "거래정지";
export interface MarketAlertFile {
  meta: { version: string; builtAt: string };
  alerts: Record<string, { level: AlertLevel; from: string; name: string }>;
}

const STALE_MS = 5 * 86400_000;   // 크롤이 며칠째 실패했으면 안 보여준다 — 풀린 경고를 계속 달고 있는 쪽이 더 나쁘다
const kstYmd = (ms: number) => new Date(ms + 9 * 3600_000).toISOString().slice(0, 10);

/** 파일 → 지금 유효한 경고만. 투자주의는 하루짜리라 지정일이 오늘(KST)일 때만 남긴다. */
export function activeAlerts(file: MarketAlertFile | null | undefined, now = Date.now()): Map<string, AlertLevel> {
  const out = new Map<string, AlertLevel>();
  if (!file?.alerts) return out;
  const built = Date.parse(file.meta?.builtAt ?? "");
  if (!Number.isFinite(built) || now - built > STALE_MS) return out;
  const today = kstYmd(now);
  for (const [code, a] of Object.entries(file.alerts)) {
    if (a.level === "투자주의" && a.from !== today) continue;
    out.set(code, a.level);
  }
  return out;
}

async function loadMarketAlerts(): Promise<MarketAlertFile> {
  const r = await fetch(URL_ALERTS, { cache: "no-store" });
  if (!r.ok) throw new Error(`market-alerts HTTP ${r.status}`);
  return await r.json() as MarketAlertFile;
}

/** 종목코드 → 경고 단계. 못 받으면 빈 맵(책갈피만 안 뜬다). */
export function useMarketAlerts(): Map<string, AlertLevel> {
  const { data } = useQuery({
    queryKey: ["market-alert-list"],
    queryFn: loadMarketAlerts,
    staleTime: 60 * 60 * 1000,
    select: (f) => activeAlerts(f),
  });
  return data ?? EMPTY;
}
const EMPTY = new Map<string, AlertLevel>();
