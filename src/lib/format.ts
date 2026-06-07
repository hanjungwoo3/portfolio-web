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

// buy_date 가 오늘(KST)인지 — 'YYYY-MM-DD' / 'YYYYMMDD'(임포트 데이터) 양쪽 형식 허용.
// 형식 불일치로 "오늘 매수"가 안 잡혀 손익이 어제종가 기준으로 잡히던 문제 방지.
export function isTodayKst(dateStr?: string): boolean {
  if (!dateStr) return false;
  return dateStr.replace(/\D/g, "") === nowKstDateStr().replace(/-/g, "");
}

// 표시용 일변동 — 거래일엔 전일종가(base) 기준. 비거래일(자정 롤오버로 base 가 현재가로 리셋→변동 0)이면
//  마지막 거래일 종가(prevClose) 기준으로 '어제%/금액'을 계속 유지. 새 거래일 시작 시 자동 전환.
export function dayChangeDiff(p?: { price: number; base: number; prevClose?: number }): number {
  if (!p) return 0;
  const d = p.price - p.base;
  return d !== 0 ? d : p.price - (p.prevClose ?? p.price);
}
export function dayChangePct(p?: { price: number; base: number; prevClose?: number }): number | undefined {
  if (!p) return undefined;
  const d = p.price - p.base;
  if (d !== 0) return p.base > 0 ? (d / p.base) * 100 : undefined;
  return p.prevClose && p.prevClose > 0 ? ((p.price - p.prevClose) / p.prevClose) * 100 : undefined;
}

// 보유분의 '어제 기준' 평가합 — 오늘 손익(= 현재평가 − 이 값) 계산용.
//  · 오늘 매수분: 어제 보유가 없으므로 기준 = 매입원가
//  · 그 외(어제부터 보유): 기준 = 전일 종가(price.base). 비거래일(base=0)엔 현재가.
// 합산(내주식)처럼 매수일이 섞인 경우 todayShares/todayCost 로 보유분별 분리 합산.
export function holdingYesterdayBaseSum(
  stock: { shares: number; avg_price: number; buy_date?: string; todayShares?: number; todayCost?: number },
  price: { price: number; base: number },
): number {
  const baseUnit = price.base > 0 ? price.base : price.price;
  if (stock.todayShares != null) {
    const oldShares = stock.shares - stock.todayShares;
    return baseUnit * oldShares + (stock.todayCost ?? 0);
  }
  return (isTodayKst(stock.buy_date) ? stock.avg_price : baseUnit) * stock.shares;
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
export type Market = "KR" | "KR_NIGHT" | "US" | "US_INDEX" | "JP" | "OTHER";

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
  // 한국 야간선물 (yasun.gg) — 18:00~05:00 KST 거래 시간만 활성, 그 외 흐림.
  if (symbol === "^KS200N" || symbol === "^KQ150N") return "KR_NIGHT";
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

// NYSE/NASDAQ 정규장 휴장일 (ET 날짜, YYYY-MM-DD). 조기폐장(반일)은 제외 — 정규시간만 단축.
const US_MARKET_HOLIDAYS = new Set<string>([
  // 2025
  "2025-01-01", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26",
  "2025-06-19", "2025-07-04", "2025-09-01", "2025-11-27", "2025-12-25",
  // 2026
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
  "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  // 2027
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31",
  "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);
// 특정 timezone 의 현재 날짜 "YYYY-MM-DD" (en-CA = ISO 형식)
function dateStrInTz(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

// 시장 정규장 시간 여부 — 흐림(dim) 판정용. 정규장 지나면 흐림(시간외 현재가는 그대로 표시).
// - KR: 09:00-15:30 KST 정규장
// - US(개별종목): 04:00-16:00 ET (프리마켓+정규장) — 프리마켓 실시간 거래라 흐림 제외.
//   (애프터마켓 16:00~ 은 흐림 유지. 지수와 달리 종목은 프리마켓 가격이 들어옴)
// - US_INDEX(지수 ^SOX/^GSPC 등): 09:30-16:00 ET 정규장만 — 프리마켓엔 지수 갱신 안 됨
// - JP: 08:30-15:30 JST
// - OTHER: 항상 열림 (환율/선물/암호화폐 등 24h — 흐림 없음)
export function isMarketOpen(market: Market): boolean {
  const TZ_MAP: Record<Market, string | null> = {
    KR: "Asia/Seoul", KR_NIGHT: "Asia/Seoul", US: "America/New_York",
    US_INDEX: "America/New_York", JP: "Asia/Tokyo", OTHER: null,
  };
  const tz = TZ_MAP[market];
  if (!tz) return true;
  const t = nowInTz(tz);
  // 미국 정규장 휴장일 (메모리얼데이 등) — 평일이어도 휴장
  if ((market === "US" || market === "US_INDEX")
      && US_MARKET_HOLIDAYS.has(dateStrInTz(tz))) return false;
  const hhmm = t.hour * 60 + t.minute;
  // 한국 야간선물 — 평일 야간(월~금 18:00~24:00) + 다음날 새벽(화~토 00:00~05:00).
  //   일요일·월 새벽은 휴장. 토 05:00 이후~일요일 전체 흐림.
  if (market === "KR_NIGHT") {
    const nightStart   = t.weekday >= 1 && t.weekday <= 5 && hhmm >= 18 * 60;   // 월~금 18:00+
    const earlyMorning = t.weekday >= 2 && t.weekday <= 6 && hhmm < 5 * 60;      // 화~토 00:00~04:59
    return nightStart || earlyMorning;
  }
  if (t.weekday === 0 || t.weekday === 6) return false;
  switch (market) {
    // 정규장 기준 — 정규시간 지나면 흐림(현재가는 시간외도 그대로 표시).
    // 선물·환율·암호화폐(OTHER)는 24h 라 흐림 없음(default true).
    case "KR":      return 9*60       <= hhmm && hhmm < 15*60 + 30;
    // 개별 종목(MU/NVDA 등) — 프리마켓(04:00)~정규장 마감(16:00). 프리마켓은 실시간 거래 → 흐림 제외.
    case "US":      return 4*60       <= hhmm && hhmm < 16*60;
    // 지수(^SOX/^GSPC 등) — 프리마켓엔 갱신 안 됨 → 정규장(09:30-16:00)만 live.
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

// 유닉스 초(unix sec) → "3일 3시간전 갱신" 상대시간 — 잠자는 지수 카드 마지막 거래 표시용
export function fmtAgo(sec?: number): string {
  if (!sec || !Number.isFinite(sec)) return "";
  const diffMin = Math.floor((Date.now() - sec * 1000) / 60000);
  if (diffMin < 60) return "";   // 1시간 미만(최근 갱신)은 표시 안 함
  const hr = Math.floor(diffMin / 60);
  if (hr < 24) return `${hr}시간전 갱신`;
  const day = Math.floor(hr / 24);
  const remHr = hr % 24;
  return remHr > 0 ? `${day}일 ${remHr}시간전 갱신` : `${day}일전 갱신`;
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

// 단일가 세션 종류 — 09:00 이전이면 프리장(장전 동시호가/단일가),
// 그 외(주로 15:30~18:00) 시간외 단일가. 카드 라벨 분기용.
export function krSinglePriceSession(): "PRE" | "POST" {
  const t = nowInTz("Asia/Seoul");
  return t.hour * 60 + t.minute < 9 * 60 ? "PRE" : "POST";
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

// 종목별 "실제 매매 마감 시각"(시간외 포함) — 토스 exchange 필드 기반.
//   integrated = NXT+KRX 통합거래 → NXT 접속매매 20:00 까지 매매 가능
//   krx        = KRX 전용         → 시간외 단일가 18:00 까지 매매 가능
// 정규장 마감(15:30)이 아니라 "더 이상 사거나 팔 수 없는" 최종 시각 기준.
export function krFinalCloseHHMM(exchange?: string): string {
  return exchange === "integrated" ? "20:00" : "18:00";
}

// 최종 매매 마감까지 남은 분(KST). withinMin 이내일 때만 숫자, 아니면 null → "임박" 강조용.
//   - 휴장일 오탐 방지: tradingEnd 가 오늘(KST 거래일)일 때만 동작.
//     휴장일엔 tradingEnd 가 직전 거래일이라 날짜 불일치 → null.
//   - 주말도 null.
export function krCloseImminentMin(
  exchange?: string, tradingEnd?: string, withinMin = 30,
): number | null {
  if (!tradingEnd) return null;
  const endMs = Date.parse(tradingEnd);
  if (!Number.isFinite(endMs)) return null;
  const t = nowInTz("Asia/Seoul");
  if (t.weekday === 0 || t.weekday === 6) return null;
  // tradingEnd 의 KST 날짜가 오늘이어야 — 휴장일/미거래 종목 제외
  const endDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(endMs));
  if (endDate !== dateStrInTz("Asia/Seoul")) return null;
  const closeMin = exchange === "integrated" ? 20 * 60 : 18 * 60;
  const remain = closeMin - (t.hour * 60 + t.minute);
  if (remain <= 0 || remain > withinMin) return null;
  return remain;
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

// 한국·미국 시장이 하나라도 활동 중인지 — 폴링 throttle 판정용.
//   KR: 프리장~시간외(08:00–20:00 KST, krSessionPhase) 중이면 활동.
//   US: 프리마켓~애프터마켓(04:00–20:00 ET) 평일·비휴장일이면 활동.
// 둘 다 아니면(주말/휴장/심야 ECN 시간대) 비활동 → 폴링 늦춤.
export function isAnyMarketActive(): boolean {
  if (krSessionPhase() !== "CLOSED") return true;
  const t = nowInTz("America/New_York");
  if (t.weekday === 0 || t.weekday === 6) return false;
  if (US_MARKET_HOLIDAYS.has(dateStrInTz("America/New_York"))) return false;
  const m = t.hour * 60 + t.minute;
  return 4 * 60 <= m && m < 20 * 60;
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
