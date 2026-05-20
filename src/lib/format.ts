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
  if (/^[\dA-Za-z]{6}$/.test(symbol)) return "KR";
  if (symbol.endsWith(".KS")
      || symbol === "^KS11"
      || symbol === "^KS200"
      || symbol === "^KQ11"
      || symbol === "^KQ100"
      || symbol === "VKOSPI") return "KR";
  if (symbol === "^N225") return "JP";
  // 환율/선물/암호화폐/지수 — 24h
  if (symbol.includes("=") || symbol === "DX-Y.NYB" || symbol.includes("-")) return "OTHER";
  // VIX / 미국 국채금리 — Yahoo 가 확장시간(04:00-20:00 ET)까지 갱신 → US 분류
  //   ^VIX = 변동성지수, ^TNX/^FVX/^TYX/^IRX = 미 국채 만기별 yield
  if (symbol === "^VIX" || symbol === "^TNX" || symbol === "^FVX"
      || symbol === "^TYX" || symbol === "^IRX") return "US";
  // ^ 로 시작 = 미국 정규장 지수 (^GSPC, ^IXIC, ^DJI, ^SOX 등 — 정규장만)
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

// 시장 정규장 시간 여부 — 흐림(dim) 판정용. 정규장 지나면 흐림(시간외 현재가는 그대로 표시).
// - KR: 09:00-15:30 KST 정규장
// - US / US_INDEX: 09:30-16:00 ET 정규장
// - JP: 08:30-15:30 JST
// - OTHER: 항상 열림 (환율/선물/암호화폐 등 24h — 흐림 없음)
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
    // 정규장 기준 — 정규시간 지나면 흐림(현재가는 시간외도 그대로 표시).
    // 선물·환율·암호화폐(OTHER)는 24h 라 흐림 없음(default true).
    case "KR":      return 9*60       <= hhmm && hhmm < 15*60 + 30;
    case "US":      return 9*60 + 30  <= hhmm && hhmm < 16*60;
    case "US_INDEX":return 9*60 + 30  <= hhmm && hhmm < 16*60;
    case "JP":      return 8*60 + 30  <= hhmm && hhmm < 15*60 + 30;
    default:        return true;
  }
}

// 심볼 기준 sleeping
export function isSymbolSleeping(symbol: string): boolean {
  return !isMarketOpen(marketOfSymbol(symbol));
}

// ISO 시각 → KST "HH:MM" (24시간). 잘못된 값이면 "".
export function fmtKstHHMM(iso?: string): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(ms));
}

// 보유 종목 단일가 "마감 시간" 라벨 — 실제 단일가 종료 시각.
// tradingEnd 가 미래면 그 값(NXT 20:00), 이미 지났으면(KRX 정규장 15:30) 시간외 단일가 종료 18:00.
export function krCloseTimeLabel(tradingEnd?: string): string {
  if (tradingEnd) {
    const ms = Date.parse(tradingEnd);
    if (Number.isFinite(ms) && ms > Date.now()) return fmtKstHHMM(tradingEnd);
  }
  return "18:00";
}

// 보유 종목 흐림(마감) 판정 — 토스 tradingEnd/단일가 신호 기반 (10분 체결 휴리스틱 불필요).
// 열림: 단일가 세션 중(singlePrice) / tradingEnd 이전(정규·NXT 접속매매).
// 마감: tradingEnd 지났고 단일가도 아님(다음 세션 전까지). 08:00 이전/20:00 이후/주말 안전망.
export function isKrHoldingClosed(
  tradingEnd?: string, nextTradingStart?: string, singlePrice?: boolean,
): boolean {
  if (krSessionPhase() === "CLOSED") return true;   // 안전망
  if (singlePrice) return false;                     // 시간외 단일가 진행 중 → 열림
  if (tradingEnd) {
    const end = Date.parse(tradingEnd);
    if (Number.isFinite(end) && Date.now() >= end) {
      const start = nextTradingStart ? Date.parse(nextTradingStart) : NaN;
      // tradingEnd 지났고 다음 세션 시작 전 → 마감
      if (!(Number.isFinite(start) && Date.now() >= start)) return true;
    }
  }
  return false;
}

// KST 08:00 ~ 08:59 — 한국 프리장 동시호가 시간 (정규장 09:00 직전).
// 이 시점부터 새 거래일 — "어제보다" 가격은 0 으로 초기화 (전일 종가 기준 차이 의미 없음).
// Toss API 의 base 가 09:00 이후에야 새 거래일 종가로 갱신되므로 우리가 강제 처리.
export function isKrPreOpen(): boolean {
  const t = nowInTz("Asia/Seoul");
  if (t.weekday === 0 || t.weekday === 6) return false;
  const m = t.hour * 60 + t.minute;
  return 8 * 60 <= m && m < 9 * 60;
}

// 한국 장 세션 phase — 데스크톱 v1/v2 kr_session_phase 동일
export type KrPhase = "REGULAR" | "EXTENDED" | "CLOSED";

export function krSessionPhase(): KrPhase {
  const t = nowInTz("Asia/Seoul");
  if (t.weekday === 0 || t.weekday === 6) return "CLOSED";
  const m = t.hour * 60 + t.minute;
  if (9 * 60 <= m && m < 15 * 60 + 30) return "REGULAR";
  if ((8 * 60 <= m && m < 8 * 60 + 50)
      || (15 * 60 + 30 <= m && m < 20 * 60)) return "EXTENDED";
  return "CLOSED";
}

// 종목명 prefix 로 ETF 판단 — 한국 ETF 발행사 prefix 매칭 (정확도 95%+).
// 예: "KODEX 200", "TIGER 반도체", "K-방산", "ACE 미국S&P500"
const ETF_NAME_PATTERNS = [
  /^KODEX\b/i, /^TIGER\b/i, /^ACE\b/i, /^KBSTAR\b/i, /^PLUS\b/i,
  /^HANARO\b/i, /^ARIRANG\b/i, /^SOL\b/i, /^KOSEF\b/i, /^RISE\b/i,
  /^FOCUS\b/i, /^SMART\b/i, /^TIMEFOLIO\b/i, /^KIWOOM\b/i,
  /^K-/i,             // K-방산, K-로봇 등
  /^마이티\b/, /^WON\b/i, /^ITF\b/i, /^HK\b/i, /^WOORI\b/i,
];
export function isEtfByName(name: string | undefined | null): boolean {
  if (!name) return false;
  const trimmed = name.trim();
  return ETF_NAME_PATTERNS.some(p => p.test(trimmed));
}

// 보유 종목 sleeping 판정 (KR) — 데스크톱 v2 동일.
// REGULAR: 항상 활성 / CLOSED: 항상 휴면 /
// EXTENDED: 마지막 체결 후 10분 경과 시 휴면.
export function isHoldingSleeping(tradeDtIso?: string): boolean {
  const phase = krSessionPhase();
  if (phase === "REGULAR") return false;
  if (phase === "CLOSED") return true;
  // EXTENDED
  if (!tradeDtIso) return true;
  const tradeMs = new Date(tradeDtIso).getTime();
  if (!Number.isFinite(tradeMs)) return true;
  const minutesSince = (Date.now() - tradeMs) / 60_000;
  return minutesSince >= 10;
}
