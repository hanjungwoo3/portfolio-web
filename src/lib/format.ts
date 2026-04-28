export function formatSigned(n: number): string {
  if (n === 0) return "0";
  return n > 0 ? `+${n.toLocaleString()}` : n.toLocaleString();
}

export function signColor(n: number): string {
  if (n > 0) return "text-rose-600";
  if (n < 0) return "text-blue-600";
  return "text-gray-500";
}

export function signBg(n: number): string {
  if (n > 0) return "bg-rose-50";
  if (n < 0) return "bg-blue-50";
  return "bg-gray-50";
}

export function formatVolume(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}만`;
  return n.toLocaleString();
}

// ─────────── KST 시각 (사용자 timezone 무관) ───────────
// UTC + 9시간 한 ms 를 Date 로 만들고, getUTC* 메서드로 KST 시각 추출.
// 주의: getHours/getDay (로컬) 는 사용 X — 사용자 OS 시간대에 영향받아 어긋남.

export function nowKst(): Date {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

// "YYYY-MM-DD" KST 날짜 문자열
export function nowKstDateStr(): string {
  return nowKst().toISOString().slice(0, 10);
}

// KST 시(0~23)
export function nowKstHour(): number {
  return nowKst().getUTCHours();
}

// 자정 ~ 프리마켓 시작(08:00 KST) 전: Toss 가 어제 데이터 반환 → "어제의 어제보다" 표시
export function isEarlyMorningKst(): boolean {
  return nowKstHour() < 8;
}

// ─────────── 시장 시간 판정 (데스크톱 v1/v2 동일 로직) ───────────

// 심볼 → 시장 분류
export type Market = "KR" | "US" | "US_INDEX" | "JP" | "OTHER";

export function marketOfSymbol(symbol: string): Market {
  if (!symbol) return "OTHER";
  // 6자리 숫자 (한국 주식/ETF)
  if (/^\d{6}$/.test(symbol)) return "KR";
  if (symbol.endsWith(".KS") || symbol === "^KS200" || symbol === "^KQ11") return "KR";
  if (symbol === "^N225") return "JP";
  // 환율/선물/암호화폐/지수 — 24h
  if (symbol.includes("=") || symbol === "DX-Y.NYB" || symbol.includes("-")) return "OTHER";
  // ^ 로 시작 = 미국 지수 (정규장만)
  if (symbol.startsWith("^")) return "US_INDEX";
  return "US";
}

// 특정 IANA timezone 의 현재 시각 (Intl 사용 — DST 자동 처리)
function nowInTz(tz: string): { hour: number; minute: number; weekday: number } {
  const now = new Date();
  const dayName = now.toLocaleString("en-US", { timeZone: tz, weekday: "short" });
  const timeStr = now.toLocaleString("en-US", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
  });
  // "24:30" 형식 가능 (en-US의 자정 처리 변동) — 0~23 으로 정규화
  const [hRaw, m] = timeStr.split(":").map(Number);
  const hour = hRaw === 24 ? 0 : hRaw;
  const dayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return { hour, minute: m, weekday: dayMap[dayName] ?? 0 };
}

// 시장 거래 시간 여부 (데스크톱 v1 is_market_open 동일)
// - KR: 09:00-15:30 KST 정규장
// - US: 04:00-20:00 ET (PRE+정규+POST)
// - US_INDEX: 09:30-16:00 ET (정규장만)
// - JP: 08:30-15:30 JST
// - OTHER: 항상 열림 (환율/선물 등)
export function isMarketOpen(market: Market): boolean {
  const TZ_MAP: Record<Market, string | null> = {
    KR: "Asia/Seoul", US: "America/New_York",
    US_INDEX: "America/New_York", JP: "Asia/Tokyo", OTHER: null,
  };
  const tz = TZ_MAP[market];
  if (!tz) return true;
  const t = nowInTz(tz);
  if (t.weekday === 0 || t.weekday === 6) return false;
  const hhmm = t.hour * 60 + t.minute;
  switch (market) {
    case "KR":      return 9*60       <= hhmm && hhmm < 15*60 + 30;
    case "US":      return 4*60       <= hhmm && hhmm < 20*60;
    case "US_INDEX":return 9*60 + 30  <= hhmm && hhmm < 16*60;
    case "JP":      return 8*60 + 30  <= hhmm && hhmm < 15*60 + 30;
    default:        return true;
  }
}

// 심볼 기준 sleeping
export function isSymbolSleeping(symbol: string): boolean {
  return !isMarketOpen(marketOfSymbol(symbol));
}
