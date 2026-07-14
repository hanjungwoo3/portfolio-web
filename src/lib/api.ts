import type { Price, Investor, Consensus } from "../types";
import { reportProxySuccess, reportProxyFailure, isProxyDown } from "./proxyStatus";
import { getEnabledPersonalProxies } from "./proxyConfig";
import { incrementProxyCall, cleanupOldProxyCalls } from "./usageCounter";
import { isKrNightSession, krFuturesName, isKrFuturesTradingNow, isUsAfterMarketOpen, isUsExtendedTradingOpen } from "./format";
import { rememberTossCode, getTossCode } from "./toss";

// 앱 로드 시 1회 — 30일 이상 된 일자 키 정리
cleanupOldProxyCalls();
import { setTossMaintenance, parseTossMaintenance, setNaverFallback, getTossMaintenance } from "./tossMaintenance";

// 공개 라운드 로빈 (Cloudflare + Vercel + Deno + Render + Netlify + Supabase)
const PUBLIC_PROXY_URLS: string[] = [
  import.meta.env.VITE_PROXY_URL,
  import.meta.env.VITE_PROXY_URL_2,
  import.meta.env.VITE_PROXY_URL_3,
  import.meta.env.VITE_PROXY_URL_4,
  import.meta.env.VITE_PROXY_URL_5,
  import.meta.env.VITE_PROXY_URL_6,
].filter(Boolean) as string[];
if (PUBLIC_PROXY_URLS.length === 0) PUBLIC_PROXY_URLS.push("http://localhost:8787");

// 런타임 — 켜진 전용 프록시가 있으면 그것들만 사용(여러 개면 랜덤 분산), 없으면 공개 4-way
export function getProxyUrls(): string[] {
  const personal = getEnabledPersonalProxies();
  return personal.length > 0 ? personal : PUBLIC_PROXY_URLS;
}

// 호환용 — UI/통계 표시 (현재 활성 list)
export const PROXY_URLS = new Proxy([] as string[], {
  get(_t, prop) {
    const arr = getProxyUrls();
    if (prop === "length") return arr.length;
    if (typeof prop === "string" && /^\d+$/.test(prop)) return arr[Number(prop)];
    const v = arr[prop as keyof typeof arr];
    return typeof v === "function" ? v.bind(arr) : v;
  },
});

function buildProxyUrl(base: string, targetUrl: string): string {
  return `${base}/?url=${encodeURIComponent(targetUrl)}`;
}

// 자동 fallback — 건강한 proxy 우선 + 실패 시 다른 proxy로 재시도
// init 옵션 — POST + body 등 RequestInit 일부 전달 가능 (워커가 POST 지원)
export async function fetchProxied(
  targetUrl: string, init?: RequestInit,
): Promise<Response> {
  // 호출 카운트 — 이 브라우저 일자별 (논리적 fetch 1회로 집계, 재시도 무관)
  incrementProxyCall();
  const urls = getProxyUrls();
  // 건강(=down 아님) 우선, down은 후순위. 그 안에서는 랜덤 (부하 분산)
  const healthy = urls.filter(u => !isProxyDown(u))
                      .sort(() => Math.random() - 0.5);
  const down = urls.filter(u => isProxyDown(u))
                   .sort(() => Math.random() - 0.5);
  const order = [...healthy, ...down];
  let lastErr: unknown;
  let lastResp: Response | undefined;
  for (const base of order) {
    try {
      const resp = await fetch(buildProxyUrl(base, targetUrl), init);
      // 응답을 돌려받았다 = 프록시(워커)는 살아있음. 타깃 소스의 4xx/5xx 는
      // 프록시 다운으로 치지 않음 (특정 소스 에러로 "모두 다운" 오판 방지).
      reportProxySuccess(base);
      if (resp.ok) return resp;
      lastResp = resp;   // 비-ok 응답 보관 — 호출측이 status 보고 판단 (예: 토스 490 점검)
      lastErr = new Error(`HTTP ${resp.status} from ${base}`);
    } catch (e) {
      // 네트워크 에러(연결 자체 실패) 만 프록시 다운으로 집계
      reportProxyFailure(base);
      lastErr = e;
    }
  }
  if (lastResp) return lastResp;   // 모두 비-ok 면 마지막 응답 반환 (호출측에서 처리)
  throw lastErr instanceof Error ? lastErr : new Error("All proxies failed");
}

function toKstDateString(iso: string): string {
  const dtUtc = new Date(iso);
  const kstMs = dtUtc.getTime() + 9 * 60 * 60 * 1000;
  const kst = new Date(kstMs);
  return kst.toISOString().slice(0, 10);
}
// 토스 ISO 체결시각 → unix sec (갱신 정체 판정용). new Date(iso) 는 UTC epoch 으로
// 해석되므로 Date.now() 와 직접 비교 가능 (toKstDateString 이 +9h 하는 것과 동일 전제).
function isoToUnixSec(iso?: string): number | undefined {
  if (!iso) return undefined;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined;
}

interface TossPriceItem {
  code: string;
  close: number;
  base: number;
  open: number;
  high?: number;
  low?: number;
  volume: number;
  tradeDateTime: string;
  krxSinglePrice?: boolean;
  nxtSinglePrice?: boolean;
  krxTradingSuspended?: boolean;
  nxtTradingSuspended?: boolean;
  krxAfterSingleClose?: number; // 시간외 단일가 예상체결가(16:00~18:00) — krxSinglePrice 시 제공
  high52w?: number;
  low52w?: number;
}
interface TossPriceResponse { result: TossPriceItem[]; }

// 토스 미국 종목 가격 — 24시간 ECN Overnight 포함 (Yahoo postMarketPrice 보다 최신).
// 입력: US19890516001 같은 토스 코드. 응답: close(현재가) / base(직전 정규장 종가)
export interface TossUsPrice {
  code: string;
  close: number;       // USD 네이티브 현재가
  base: number;        // 직전 정규장 종가 (USD)
  closeKrw: number;    // 토스 환산 원화 정규장 종가 (토스 앱 표시값)
  baseKrw: number;     // 토스 환산 원화 직전(어제) 종가
  afterCloseKrw: number; // 애프터장 원화 현재가 (16:00~20:00 ET, 없으면 0)
  pct: number;         // (close - base) / base × 100
  tradeDateTime: string;
}
export async function fetchTossUsPrices(codes: string[]): Promise<Map<string, TossUsPrice>> {
  const out = new Map<string, TossUsPrice>();
  if (codes.length === 0) return out;
  const target = `https://wts-info-api.tossinvest.com/api/v3/stock-prices/details?productCodes=${codes.join(",")}`;
  try {
    const resp = await fetchProxied(target);
    if (!resp.ok) return out;
    const data = await resp.json() as {
      result?: Array<{
        code: string; close: number; base: number; tradeDateTime: string;
        closeKrw?: number; baseKrw?: number; afterMarketCloseKrw?: number;
      }>;
    };
    for (const item of (data.result ?? [])) {
      if (!item.code || !item.close || !item.base) continue;
      const pct = item.base > 0 ? ((item.close - item.base) / item.base) * 100 : 0;
      // 원화 환산값은 토스가 같이 내려줌(토스 앱 표시값). 누락 시 close/base 로 폴백(달러).
      const closeKrw = item.closeKrw && item.closeKrw > 0 ? item.closeKrw : item.close;
      const baseKrw  = item.baseKrw  && item.baseKrw  > 0 ? item.baseKrw  : item.base;
      out.set(item.code, {
        code: item.code, close: item.close, base: item.base,
        closeKrw, baseKrw,
        afterCloseKrw: item.afterMarketCloseKrw && item.afterMarketCloseKrw > 0 ? item.afterMarketCloseKrw : 0,
        pct, tradeDateTime: item.tradeDateTime,
      });
    }
  } catch { /* network failure — return empty */ }
  return out;
}

// 사용자 보유 US 종목 가격 — 토스 우선(원화·24h, 내부코드 필요) + Yahoo 폴백.
//  보유 priceMap 에 병합할 수 있게 Price[] 로 반환 (KR 종목과 동일 형식).
//  토스코드는 검색/인기 랭킹에서 받아 localStorage 에 기억(rememberTossCode)해 둔 것 사용.
export async function fetchUsHoldingPrices(tickers: string[]): Promise<Price[]> {
  if (tickers.length === 0) return [];
  const coded: { ticker: string; code: string }[] = [];
  const uncoded: string[] = [];
  for (const t of tickers) {
    const code = getTossCode(t);
    // 토스 US 시세 경로(원화 환산) — 레거시 US 접두뿐 아니라 신형·ADR 상장의 NAS/NYS/AMX 도 포함.
    //   (US 만 보면 ADR(NAS…)이 Yahoo USD 로 빠져 달러값에 원이 붙는 버그) 코드 없으면 Yahoo 폴백.
    if (code && /^(US|NAS|NYS|AMX)/.test(code)) coded.push({ ticker: t, code });
    else uncoded.push(t);
  }
  const out: Price[] = [];
  // ── 토스 우선 (원화·애프터장 포함, fetchTossUsIndexMap 과 동일 변환)
  if (coded.length) {
    try {
      const m = await fetchTossUsPrices(coded.map(c => c.code));
      const afterOpen = isUsAfterMarketOpen();
      for (const { ticker, code } of coded) {
        const tp = m.get(code);
        if (!tp) { uncoded.push(ticker); continue; }
        const hasKrw = tp.closeKrw > tp.close;                  // 원화는 달러×~1500
        const liveKrw = hasKrw ? tp.closeKrw : tp.close;        // 토스 close = 현재가 (정규·프리·오버나잇 live, 애프터·휴장 땐 정규 종가)
        const baseKrw = hasKrw ? tp.baseKrw  : tp.base;         // 토스 base = 기준가
        // 오버나잇·프리마켓(close 가 라이브)엔 정규 종가가 base 에, 애프터·휴장엔 close 가 정규 종가 (지수창과 동일 판정).
        const closeIsLive = isUsExtendedTradingOpen() && !afterOpen;
        const regClose = closeIsLive ? baseKrw : liveKrw;       // 정규장 마감가(usRegClose 책갈피용)
        const useAfter = hasKrw && afterOpen && tp.afterCloseKrw > 0;
        const price = useAfter ? tp.afterCloseKrw : liveKrw;
        const base  = useAfter ? regClose : baseKrw;            // 애프터/오버나잇: 정규종가 대비 / 정규·휴장: 어제 대비
        // 마감 등락률 = 정규 종가의 전일대비. 오버나잇/프리엔 전전일 종가가 없어 계산 불가 → undefined.
        const regPct = closeIsLive
          ? undefined
          : (baseKrw > 0 ? ((regClose - baseKrw) / baseKrw) * 100 : undefined);
        out.push({
          ticker, price, base, prevClose: base, open: 0, volume: 0,
          usRegClose: regClose, usRegPct: regPct,   // 정규장 마감가·전일대비 등락률(지수창과 동일)
          // 달러 보조표기·흐림 판정용 — 지수창(fetchTossUsIndexMap)과 동일 계산.
          priceUsd: (hasKrw && tp.closeKrw > 0) ? price * (tp.close / tp.closeKrw) : tp.close,
          currency: hasKrw ? "KRW" : "USD",
          freshTime: isoToUnixSec(tp.tradeDateTime),
          trade_date: tp.tradeDateTime ? toKstDateString(tp.tradeDateTime) : "",
          trade_dt: tp.tradeDateTime,
        });
      }
    } catch {
      for (const c of coded) uncoded.push(c.ticker);
    }
  }
  // ── Yahoo 폴백 (토스코드 없거나 토스 실패분) — USD 그대로(환율 변환 없음)
  if (uncoded.length) {
    try {
      const ym = await fetchYahooBatch([...new Set(uncoded)].map(t => ({ symbol: t, name: t })));
      for (const t of new Set(uncoded)) {
        const ui = ym.get(t);
        if (!ui) continue;
        out.push({
          ticker: t, price: ui.price, base: ui.prev, prevClose: ui.prevClose,
          usRegClose: ui.price,
          usRegPct: ui.prevClose > 0 ? ((ui.price - ui.prevClose) / ui.prevClose) * 100 : undefined,
          currency: "USD",   // Yahoo 폴백 = 달러 그대로 → priceUsd 미설정($ 보조표기 스킵), 흐림은 시간창 폴백
          open: 0, volume: 0, trade_date: ui.tradeDate,
        });
      }
    } catch { /* noop */ }
  }
  return out;
}

// ETF 구성 종목 (PCF, Portfolio Composition File) — 토스 v2 endpoint.
// 응답: { result: { items: [{ name, ratio, stockCode, ... }] } }
export interface EtfComposition {
  stockCode: string;   // A005930 형태
  name: string;
  ratio: number;       // 비중 (%)
}
// ETF 핵심 지표 — 네이버 integration 의 etfKeyIndicator (총보수·분배율·괴리율·NAV·운용사 등)
export interface EtfKeyIndicator {
  totalFee?: number;        // 총보수(%)
  dividendYield?: number;   // 분배율(TTM, %)
  deviationRate?: number;   // 괴리율(%)
  deviationSign?: string;   // + / -
  chaseErrorRate?: number;  // 추적오차(%) — 기초지수 대비 이탈. 패시브 낮음(<1), 액티브 큼(10~). etfAnalysis 에서 보강
  issuerName?: string;      // 운용사
  nav?: string;             // 1좌 NAV
  totalNav?: string;        // 순자산총액(문자, 예 "32조 4,463억")
  marketValue?: string;     // 시가총액(문자)
  returnRate1m?: number;
  returnRate3m?: number;
  returnRate1y?: number;
}
export async function fetchEtfKeyIndicator(ticker: string): Promise<EtfKeyIndicator | null> {
  if (!/^[\dA-Za-z]{6}$/.test(ticker)) return null;
  try {
    // integration = 핵심지표(보수·괴리율·NAV…), etfAnalysis = 추적오차(integration 엔 없음). 병렬.
    const [rInt, rAna] = await Promise.all([
      fetchProxied(`https://m.stock.naver.com/api/stock/${ticker}/integration`),
      fetchProxied(`https://m.stock.naver.com/api/stock/${ticker}/etfAnalysis`).catch(() => null),
    ]);
    if (!rInt.ok) return null;
    const d = await rInt.json() as { etfKeyIndicator?: EtfKeyIndicator };
    const ki = d.etfKeyIndicator ?? null;
    if (!ki) return null;
    if (rAna?.ok) {
      try {
        const a = await rAna.json() as { chaseErrorRate?: number };
        if (a.chaseErrorRate != null) ki.chaseErrorRate = a.chaseErrorRate;
      } catch { /* etfAnalysis 파싱 실패 — 추적오차만 생략 */ }
    }
    return ki;
  } catch {
    return null;
  }
}

export interface EtfCompositionResult {
  items: EtfComposition[];
  endDate: string | null;   // 구성(PDF) 기준일 (예: "2026-06-18") — 한국거래소 발표 최신 영업일
}
export async function fetchEtfCompositions(ticker: string): Promise<EtfCompositionResult> {
  const target = `https://wts-info-api.tossinvest.com/api/v2/stock-infos/A${ticker}/compositions`;
  try {
    const resp = await fetchProxied(target);
    if (!resp.ok) return { items: [], endDate: null };
    const data = await resp.json() as {
      result?: {
        endDate?: string;
        items?: Array<{
          stockCode?: string;
          name?: string;
          ratio?: number;
        }>;
      };
    };
    const items = (data.result?.items ?? [])
      .map(it => ({
        stockCode: it.stockCode ?? "",   // 선물·"그 외" 는 null → 빈 문자열
        name: it.name ?? "",
        ratio: typeof it.ratio === "number" ? it.ratio : 0,
      }))
      .filter(it => it.name)             // name 만 있으면 표시 (stockCode 없어도 OK)
      .sort((a, b) => b.ratio - a.ratio);
    return { items, endDate: data.result?.endDate ?? null };
  } catch {
    return { items: [], endDate: null };
  }
}

// 한국 섹터 ranking — KODEX/TIGER 섹터 ETF 기반 자체 계산.
// 우리 사이트와 일관성(매크로 탭 한국 ETF 줄과 동일) + 4기간(오늘/5/10/20일) 모두 활성화.
// Yahoo chart 일별 종가 → 마지막 vs N거래일 전 종가 비교로 등락률 계산.
export interface KrSectorEtf {
  ticker: string;   // 6자리 (Yahoo 호출 시 .KS 자동 추가)
  name: string;     // 섹터 표시명 (예: "반도체")
  fullName?: string; // ETF 정식명 (호버용)
  isMarket?: boolean; // 시장 전체 proxy(KOSPI/KOSDAQ) — 시각 구분용
}
export const KR_SECTOR_ETFS: KrSectorEtf[] = [
  // 시장 전체 ETF (proxy) — KOSPI 200 / KOSDAQ 150 추종
  { ticker: "069500", name: "KODEX 200",      fullName: "KODEX 200 (KOSPI 200 추종)",          isMarket: true },
  { ticker: "229200", name: "KODEX 코스닥150", fullName: "KODEX KOSDAQ 150 (KOSDAQ 150 추종)",  isMarket: true },
  // 섹터 ETF
  { ticker: "091160", name: "반도체",   fullName: "KODEX 반도체" },
  { ticker: "117700", name: "건설",     fullName: "KODEX 건설" },
  { ticker: "305720", name: "2차전지",  fullName: "KODEX 2차전지" },
  { ticker: "244580", name: "바이오",   fullName: "KODEX 바이오" },
  { ticker: "091170", name: "은행",     fullName: "KODEX 은행" },
  { ticker: "449450", name: "방산",     fullName: "K-방산" },
  { ticker: "266420", name: "헬스케어", fullName: "KODEX 헬스케어" },
  { ticker: "0190C0", name: "피지컬AI", fullName: "RISE 피지컬AI" },
  { ticker: "445290", name: "로봇",     fullName: "KODEX 로봇" },
  { ticker: "091180", name: "자동차",   fullName: "KODEX 자동차" },
  { ticker: "102970", name: "증권",     fullName: "KODEX 증권" },
  { ticker: "117680", name: "철강",     fullName: "KODEX 철강" },
  { ticker: "117460", name: "에너지화학", fullName: "KODEX 에너지화학" },
  { ticker: "266410", name: "필수소비재", fullName: "KODEX 필수소비재" },
  { ticker: "228790", name: "화장품",   fullName: "TIGER 화장품" },
  { ticker: "466920", name: "조선",     fullName: "SOL 조선TOP3플러스" },
  { ticker: "434730", name: "원자력",   fullName: "HANARO 원자력iSelect" },
  { ticker: "266360", name: "K콘텐츠",  fullName: "KODEX K콘텐츠" },
  { ticker: "300950", name: "게임",     fullName: "KODEX 게임산업" },
  { ticker: "140700", name: "보험",     fullName: "KODEX 보험" },
  { ticker: "329200", name: "리츠",     fullName: "TIGER 리츠부동산인프라" },
];

export interface KrSectorEtfRank {
  ticker: string;
  name: string;
  fullName?: string;
  isMarket?: boolean;
  today: number | null;   // 오늘 등락률 (%) — 어제 종가 대비
  d5: number | null;      // 5거래일 (1주)
  d10: number | null;     // 10거래일 (2주)
  d20: number | null;     // 20거래일 (1달)
  // 각 기간 거래대금 합계 (원)
  amountToday: number | null;
  amountD5: number | null;
  amountD10: number | null;
  amountD20: number | null;
  // OBV-like 누적 (상승일 +close×volume / 하락일 −close×volume) — 정밀 자금 유출입 추정
  obvToday: number | null;
  obvD5: number | null;
  obvD10: number | null;
  obvD20: number | null;
  lastClose: number | null;
}

function pctBetween(closes: number[], lookback: number): number | null {
  if (closes.length < lookback + 1) return null;
  const last = closes[closes.length - 1];
  const prev = closes[closes.length - 1 - lookback];
  if (!Number.isFinite(last) || !Number.isFinite(prev) || prev <= 0) return null;
  return ((last - prev) / prev) * 100;
}

// 마지막 N 거래일 거래대금 합계 = Σ(close × volume) 마지막 N 개
function amountSum(closes: number[], volumes: number[], lookback: number): number | null {
  const len = Math.min(closes.length, volumes.length);
  if (len < lookback) return null;
  let s = 0;
  for (let i = len - lookback; i < len; i++) {
    const c = closes[i], v = volumes[i];
    if (Number.isFinite(c) && Number.isFinite(v)) s += c * v;
  }
  return s;
}

// OBV-like 누적: 각 일별 sign(이전 종가 대비) × close × volume 의 합.
// lookback N 이면 그 N 거래일 안에서만 누적 (직전 일과 비교 필요해서 N+1 개 필요).
function obvSum(closes: number[], volumes: number[], lookback: number): number | null {
  const len = Math.min(closes.length, volumes.length);
  if (len < lookback + 1) return null;
  let s = 0;
  for (let i = len - lookback; i < len; i++) {
    const cPrev = closes[i - 1], c = closes[i], v = volumes[i];
    if (!Number.isFinite(cPrev) || !Number.isFinite(c) || !Number.isFinite(v)) continue;
    const sign = c > cPrev ? 1 : c < cPrev ? -1 : 0;
    s += sign * c * v;
  }
  return s;
}

// chart endpoint — close + volume 둘 다 추출 (시간순 정렬)
async function fetchYahooChartCV(symbol: string, range = "2mo"): Promise<{ closes: number[]; volumes: number[] }> {
  const target = `https://query1.finance.yahoo.com/v8/finance/chart/`
              + `${encodeURIComponent(symbol)}?interval=1d&range=${range}`;
  try {
    const resp = await fetchProxied(target);
    if (!resp.ok) return { closes: [], volumes: [] };
    const data = await resp.json() as {
      chart?: { result?: Array<{ indicators?: { quote?: Array<{
        close?: (number | null)[]; volume?: (number | null)[];
      }> } }> }
    };
    const q = data.chart?.result?.[0]?.indicators?.quote?.[0];
    const rawC = q?.close ?? [];
    const rawV = q?.volume ?? [];
    // null 제거 시 close/volume 인덱스 일치 보장 — 같은 위치에서 함께 필터
    const closes: number[] = [];
    const volumes: number[] = [];
    for (let i = 0; i < Math.max(rawC.length, rawV.length); i++) {
      const c = rawC[i], v = rawV[i];
      if (typeof c === "number" && Number.isFinite(c)
          && typeof v === "number" && Number.isFinite(v)) {
        closes.push(c);
        volumes.push(v);
      }
    }
    return { closes, volumes };
  } catch {
    return { closes: [], volumes: [] };
  }
}

export async function fetchKrSectorEtfRanking(): Promise<KrSectorEtfRank[]> {
  const results = await Promise.all(
    KR_SECTOR_ETFS.map(async etf => {
      const { closes, volumes } = await fetchYahooChartCV(`${etf.ticker}.KS`, "2mo");
      if (closes.length < 2) {
        return {
          ticker: etf.ticker, name: etf.name, fullName: etf.fullName, isMarket: etf.isMarket,
          today: null, d5: null, d10: null, d20: null,
          amountToday: null, amountD5: null, amountD10: null, amountD20: null,
          obvToday: null, obvD5: null, obvD10: null, obvD20: null,
          lastClose: null,
        } as KrSectorEtfRank;
      }
      return {
        ticker: etf.ticker, name: etf.name, fullName: etf.fullName, isMarket: etf.isMarket,
        today: pctBetween(closes, 1),
        d5: pctBetween(closes, 5),
        d10: pctBetween(closes, 10),
        d20: pctBetween(closes, 20),
        amountToday: amountSum(closes, volumes, 1),
        amountD5: amountSum(closes, volumes, 5),
        amountD10: amountSum(closes, volumes, 10),
        amountD20: amountSum(closes, volumes, 20),
        obvToday: obvSum(closes, volumes, 1),
        obvD5: obvSum(closes, volumes, 5),
        obvD10: obvSum(closes, volumes, 10),
        obvD20: obvSum(closes, volumes, 20),
        lastClose: closes[closes.length - 1],
      } as KrSectorEtfRank;
    })
  );
  return results;
}

// ─── 증시 자금동향 — 네이버 금융 sise_deposit (고객예탁금·신용잔고·주식형/혼합형/채권형 펀드, 단위 억원, 일자별) ───
//   finance.naver.com 은 이미 프록시 화이트리스트에 있음(테마·종목과 동일 호스트). EUC-KR → decodeHtmlBuf.
export type FundFlowKey = "deposit" | "credit" | "stock" | "mixed" | "bond";
export interface FundFlowMetric {
  key: FundFlowKey;
  value: number;     // 최신값 (억원)
  diff: number;      // 전일대비 (억원, 부호)
  series: number[];  // 최근 시계열 (과거→최신, 억원)
}
export interface MarketDepositData {
  date: string;             // 최신 일자 (YY.MM.DD)
  dates: string[];          // series 와 정렬된 일자 (과거→최신, YY.MM.DD)
  metrics: FundFlowMetric[];
}
// 표 컬럼 인덱스 — [날짜, 고객예탁금, 대비, 신용잔고, 대비, 주식형, 대비, 혼합형, 대비, 채권형, 대비]
const FUND_FLOW_COLS: { key: FundFlowKey; idx: number }[] = [
  { key: "deposit", idx: 1 }, { key: "credit", idx: 3 },
  { key: "stock", idx: 5 }, { key: "mixed", idx: 7 }, { key: "bond", idx: 9 },
];
export async function fetchMarketDeposit(): Promise<MarketDepositData | null> {
  const resp = await fetchProxied("https://finance.naver.com/sise/sise_deposit.naver");
  if (!resp.ok) return null;
  const html = decodeHtmlBuf(await resp.arrayBuffer(), resp.headers.get("Content-Type") || "");
  const rows: Record<FundFlowKey, number>[] = [];
  const rowDates: string[] = [];
  for (const tr of html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? []) {
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
      .map(m => m[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, "").trim())
      .filter(c => c !== "");
    if (cells.length >= 10 && /^\d{2}\.\d{2}\.\d{2}$/.test(cells[0])) {
      const num = (s: string) => Number(s.replace(/,/g, ""));
      const row = {} as Record<FundFlowKey, number>;
      let ok = true;
      for (const { key, idx } of FUND_FLOW_COLS) {
        const v = num(cells[idx]);
        if (!Number.isFinite(v)) { ok = false; break; }
        row[key] = v;
      }
      if (ok) { rowDates.push(cells[0]); rows.push(row); }
    }
  }
  if (!rows.length) return null;
  const latest = rows[0], prev = rows[1];
  const idx = rows.slice(0, 20).map((_, i) => i).reverse();   // 과거→최신 인덱스
  return {
    date: rowDates[0],
    dates: idx.map(i => rowDates[i]),
    metrics: FUND_FLOW_COLS.map(({ key }) => ({
      key,
      value: latest[key],
      diff: prev ? latest[key] - prev[key] : 0,
      series: idx.map(i => rows[i][key]),
    })),
  };
}

// ─── 시장 투자자 순매수 — 네이버 금융 sise 메인 (코스피/코스닥/코스피200 개인·외국인·기관, 단위 억원) ───
export interface InvestorNet { indiv: number; foreign: number; inst: number; }
export type MarketInvestor = Partial<Record<"KOSPI" | "KOSDAQ" | "KPI200", InvestorNet>>;
const INVESTOR_MARKETS: Record<string, keyof MarketInvestor> = {
  "코스피200": "KPI200",   // 코스피보다 먼저 매칭돼야 함(정규식 대안 순서)
  "코스피": "KOSPI",
  "코스닥": "KOSDAQ",
};
export async function fetchMarketInvestor(): Promise<MarketInvestor | null> {
  const resp = await fetchProxied("https://finance.naver.com/sise/");
  if (!resp.ok) return null;
  const html = decodeHtmlBuf(await resp.arrayBuffer(), resp.headers.get("Content-Type") || "");
  const txt = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const re = /(코스피200|코스피|코스닥)\s*개인\s*([+\-]?[\d,]+)\s*억\s*외국인\s*([+\-]?[\d,]+)\s*억\s*기관\s*([+\-]?[\d,]+)\s*억/g;
  const num = (s: string) => Number(s.replace(/,/g, ""));
  const out: MarketInvestor = {};
  let m: RegExpExecArray | null;
  while ((m = re.exec(txt))) {
    const key = INVESTOR_MARKETS[m[1]];
    if (key && !out[key]) out[key] = { indiv: num(m[2]), foreign: num(m[3]), inst: num(m[4]) };
  }
  return Object.keys(out).length ? out : null;
}

// ─── 증시 뉴스 — 토스증권 뉴스 (POST /dashboard/wts/news, 익명 가능). tossinvest.com/feed/news 와 동일 소스 ───
//   카테고리 4종 모두 익명 접근 가능(로그인 시 인기뉴스만 개인화, 익명은 '많이 보는 뉴스' 일반본).
export interface TossNewsStock { stockCode: string; stockName: string; fluctuation?: number; market?: string; }
export interface TossNewsItem {
  newsId: string;
  title: string;
  summary: string;
  agency: string;      // 언론사 (이데일리 등)
  nation: string;      // "KR" | "US" 등
  createdAt: string;   // ISO
  imageUrl?: string;
  stocks: TossNewsStock[];
}
interface TossNewsRaw {
  newsId: string; title: string; summary?: string; contentText?: string;
  source?: string; agencyName?: string; nation?: string; createdAt: string;
  imageUrl?: string | null;
  relatedStocks?: { stockCode: string; stockName: string; fluctuation?: number; market?: string }[];
}
// 뉴스 원문 링크(언론사 기사 URL) — 상세 엔드포인트의 linkUrl. 클릭 시 토스가 아니라 원문으로 이동.
export async function fetchTossNewsLink(newsId: string): Promise<string | null> {
  try {
    const resp = await fetchProxied(`https://wts-info-api.tossinvest.com/api/v2/news/${encodeURIComponent(newsId)}`);
    if (!resp.ok) return null;
    const data = await resp.json() as { result?: { availableLanguages?: string[]; [lang: string]: { linkUrl?: string } | string[] | undefined } };
    const r = data.result;
    if (!r) return null;
    const lang = (Array.isArray(r.availableLanguages) && r.availableLanguages[0]) || "kr";
    const pick = (r[lang] ?? r.kr) as { linkUrl?: string } | undefined;
    return pick?.linkUrl ?? null;
  } catch { return null; }
}
// 카테고리 4종 — 인기(PERSONALIZED)/주요(ALL_HIGHLIGHT)/최신(HOT)/급상승(SOARING_STOCK). 전부 익명 가능.
export type TossNewsCategory = "PERSONALIZED" | "ALL_HIGHLIGHT" | "HOT" | "SOARING_STOCK";
export async function fetchTossNews(category: TossNewsCategory = "ALL_HIGHLIGHT"): Promise<TossNewsItem[]> {
  const resp = await fetchProxied("https://wts-info-api.tossinvest.com/api/v1/dashboard/wts/news", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: category }),
  });
  if (!resp.ok) return [];
  const data = await resp.json() as { result?: { news?: TossNewsRaw[] } };
  return (data.result?.news ?? []).map(n => ({
    newsId: n.newsId,
    title: n.title,
    summary: n.summary ?? n.contentText ?? "",
    agency: n.agencyName || n.source || "",
    nation: n.nation || "",
    createdAt: n.createdAt,
    imageUrl: n.imageUrl || undefined,
    stocks: (n.relatedStocks ?? []).map(s => ({
      stockCode: s.stockCode, stockName: s.stockName, fluctuation: s.fluctuation, market: s.market,
    })),
  }));
}

// 한국 업종(섹터) ranking — 토스 TICS (Toss Industry Classification System) depth1 = 대분류.
// 응답: 섹터별 오늘 등락률 + 순위 + 상승/하락 종목 수 + 아이콘.
// 기간(5/10/20일) 별 endpoint 는 미확인 → 우선 오늘만.
export interface KrSectorRankItem {
  ticsId: string;        // 섹터 식별자 (예: "425" = 윤활유)
  title: string;         // 섹터명 한국어
  pct: number;           // 등락률 (+9.6 = +9.6%)
  ranking: number;       // 순위 (1부터)
  priceLabel?: string;   // "3개 중 2개 종목 상승" 같은 보조 라벨
  imageUrl?: string;     // 섹터 아이콘 (토스 CDN)
  imageBgLight?: string; // 아이콘 배경 (라이트 모드)
  imageBgDark?: string;
}
export async function fetchKrSectorRanking(): Promise<KrSectorRankItem[]> {
  const target = "https://wts-info-api.tossinvest.com/api/v1/rankings/contents/tics_margin_depth1/tags/kr";
  try {
    const resp = await fetchProxied(target);
    if (!resp.ok) return [];
    const data = await resp.json() as {
      result?: {
        data?: Array<{
          ticsId?: string;
          title?: string;
          value?: string;       // "+9.6%"
          ranking?: number;
          priceValue?: string;
          imageUrl?: string;
          imageBackground?: { light?: string; dark?: string };
        }>;
      };
    };
    const items = data.result?.data ?? [];
    return items
      .map(r => {
        const pctNum = parseFloat((r.value ?? "0").replace(/[+%,\s]/g, ""));
        const ticsId = r.ticsId ?? "";
        const title = r.title ?? "";
        if (!ticsId || !title) return null;
        return {
          ticsId, title,
          pct: Number.isFinite(pctNum) ? pctNum : 0,
          ranking: r.ranking ?? 0,
          priceLabel: r.priceValue ?? undefined,
          imageUrl: r.imageUrl ?? undefined,
          imageBgLight: r.imageBackground?.light,
          imageBgDark: r.imageBackground?.dark,
        } as KrSectorRankItem;
      })
      .filter((x): x is KrSectorRankItem => x !== null)
      .sort((a, b) => a.ranking - b.ranking);
  } catch {
    return [];
  }
}

// 토스 실시간 인기(관심) 종목 랭킹 — 한국(코스피/코스닥) + 미국 + ETF 혼합.
//  symbol = 앱 ticker (KR 6자리 / US 티커). 첫 사용자 기본 목록 시드용.
export async function fetchTossRealtimeRanking(size = 10): Promise<SearchResult[]> {
  const target = `https://wts-info-api.tossinvest.com/api/v1/rankings/realtime/stock?size=${size}`;
  try {
    const resp = await fetchProxied(target);
    if (!resp.ok) return [];
    const data = await resp.json() as {
      result?: { data?: Array<{
        symbol?: string; name?: string; code?: string;
        market?: { displayName?: string };
      }> };
    };
    const out: SearchResult[] = [];
    for (const r of data.result?.data ?? []) {
      const ticker = (r.symbol ?? "").trim();
      if (!ticker) continue;
      if (r.code) rememberTossCode(ticker, r.code);   // US 내부코드 기억(링크용)
      out.push({ ticker, name: r.name ?? ticker, market: r.market?.displayName ?? "" });
    }
    return out;
  } catch {
    return [];
  }
}

// 토스 시가총액 Top — live (오늘 기준). KR 6자리 전용. stockCode 의 'A' 접두어 제거.
export async function fetchTossMarketCap(size = 10): Promise<SearchResult[]> {
  const target = "https://wts-info-api.tossinvest.com/api/v1/rankings/contents/market_cap/tags/kr";
  try {
    const resp = await fetchProxied(target);
    if (!resp.ok) return [];
    const data = await resp.json() as { result?: { data?: Array<{ stockCode?: string; title?: string }> } };
    const out: SearchResult[] = [];
    for (const r of data.result?.data ?? []) {
      const raw = (r.stockCode ?? "").trim();
      const ticker = raw.startsWith("A") ? raw.slice(1) : raw;   // 토스 A005930 → 005930
      if (!/^[\dA-Za-z]{6}$/.test(ticker)) continue;
      out.push({ ticker, name: r.title ?? ticker, market: "KOSPI" });
      if (out.length >= size) break;
    }
    return out;
  } catch {
    return [];
  }
}

// 한국 주식 정규장 종가/변동률 — Yahoo v7 batch (15분 지연이지만 마감가는 정확)
// 토스 close 는 시간외 단일가 포함이라 정규장 종가와 다를 수 있음 — 분리 필요.
export interface KrRegularPrice {
  ticker: string;
  regularPrice: number;
  regularPct: number;       // (regularPrice - prevClose) / prevClose × 100
  marketState: string;
  tradingEnd?: string;      // 이번/직전 세션 종료 시각 (ISO) — 종목별(정규장 15:30 or NXT 20:00)
  nextTradingStart?: string; // 다음 세션 시작 시각 (ISO)
  exchange?: string;        // "integrated"(NXT+KRX 통합 → 시간외 20:00) | "krx"(KRX 전용 → 시간외 단일가 18:00)
}
// 토스 stock-infos API 의 market.code (KSP=KOSPI, KSQ=KOSDAQ) 로 정확한 거래소 판별.
// Stock.market 이 잘못 저장된 경우(6자리 코드 검색 시 무조건 "KOSPI" 였음)를 자동 교정.
export async function verifyKrMarkets(
  tickers: string[],
): Promise<Map<string, "KOSPI" | "KOSDAQ">> {
  const out = new Map<string, "KOSPI" | "KOSDAQ">();
  if (tickers.length === 0) return out;
  await Promise.all(tickers.map(async t => {
    try {
      const r = await fetchProxied(`https://wts-info-api.tossinvest.com/api/v2/stock-infos/code-or-symbol/A${t}`);
      if (!r.ok) return;
      const j = await r.json() as { result?: { market?: { code?: string } } };
      const code = j.result?.market?.code;
      if (code === "KSP") out.set(t, "KOSPI");
      else if (code === "KSQ") out.set(t, "KOSDAQ");
    } catch { /* skip */ }
  }));
  return out;
}

// ETF 구성의 해외(미국) 종목 토스 내부코드(US19890516001 / NAS0250224006 등) → 티커·시장 해석.
//   compositions 응답의 해외 stockCode 는 티커가 아니라 토스 내부코드라 가격/추가에 쓰려면 변환 필요.
export async function fetchTossCodeInfo(code: string): Promise<{ symbol: string; isUs: boolean } | null> {
  try {
    const r = await fetchProxied(`https://wts-info-api.tossinvest.com/api/v2/stock-infos/code-or-symbol/${code}`);
    if (!r.ok) return null;
    const j = await r.json() as { result?: { symbol?: string; market?: { code?: string } } };
    const symbol = j.result?.symbol;
    if (!symbol) return null;
    const mk = j.result?.market?.code ?? "";   // NSQ=NASDAQ, NYS=NYSE, AMS=AMEX
    return { symbol, isUs: mk === "NSQ" || mk === "NYS" || mk === "AMS" || mk === "NYSE" };
  } catch {
    return null;
  }
}

// 종목명 재취득 — 토스 JSON(UTF-8, 인코딩 안전·시세와 같은 출처라 확실히 닿음) 우선, 실패 시 네이버 HTML.
// 깨진 종목명 복구(repairBrokenNames)용 — 토스 stock-infos 의 name 필드 사용.
export async function fetchKrStockName(ticker: string): Promise<string | null> {
  if (!/^[\dA-Za-z]{6}$/.test(ticker)) return null;
  try {
    const r = await fetchProxied(`https://wts-info-api.tossinvest.com/api/v2/stock-infos/code-or-symbol/A${ticker}`);
    if (r.ok) {
      const j = await r.json() as { result?: Record<string, unknown> };
      const res = j.result ?? {};
      const name = (res.name ?? res.korName ?? res.companyName ?? res.fullName) as string | undefined;
      if (name && name.trim()) return name.trim();
    }
  } catch { /* 토스 실패 — 네이버 폴백 */ }
  return await fetchStockName(ticker);
}

// 한국 정규장(공식) 종가 — 토스 stock-prices?meta=true 의 close (거래현황 "오늘 종가"와 동일).
// details.close 는 시간외/NXT 실시간 최신가라 변하지만, meta.close 는 공식 종가로 안정적 →
// 시간외에 메인(실시간)과 다를 때 "마감 책갈피" 로 정규장 종가를 보여줌.
// Yahoo .KS/.KQ 는 15~20분 지연·간헐적 stale(과거값) 이라 토스로 교체.
// markets 매개변수는 호환용으로 유지 (토스는 A 코드만 사용).
export async function fetchKrRegularPrices(
  tickers: string[],
  _markets?: Map<string, string>,
): Promise<Map<string, KrRegularPrice>> {
  const out = new Map<string, KrRegularPrice>();
  if (tickers.length === 0) return out;
  const codes = tickers
    .filter(t => /^[\dA-Za-z]{6}$/.test(t))
    .map(t => `A${t}`)
    .join(",");
  if (!codes) return out;
  const target = `https://wts-info-api.tossinvest.com/api/v3/stock-prices?meta=true&productCodes=${codes}`;
  try {
    const resp = await fetchProxied(target);
    if (!resp.ok) return out;
    const data = await resp.json() as {
      result?: Array<{ productCode?: string; close?: number; base?: number; tradingEnd?: string; nextTradingStart?: string; exchange?: string }>;
    };
    for (const r of (data.result ?? [])) {
      const ticker = (r.productCode ?? "").replace(/^A/, "");
      if (!/^[\dA-Za-z]{6}$/.test(ticker)) continue;
      if (typeof r.close !== "number" || !Number.isFinite(r.close)) continue;
      const base = typeof r.base === "number" ? r.base : 0;
      const regPct = base > 0 ? ((r.close - base) / base) * 100 : 0;
      out.set(ticker, {
        ticker,
        regularPrice: r.close,
        regularPct: regPct,
        marketState: "",
        tradingEnd: r.tradingEnd,
        nextTradingStart: r.nextTradingStart,
        exchange: r.exchange,
      });
    }
  } catch { /* network — return empty */ }
  return out;
}

// 토스 가격 — 큰 배치는 URL 길이/개수 제한으로 400(Bad Request) → 청크 분할 후 병합.
// (컨센서스/전체 탭 등 200+ 종목을 한 URL 에 다 넣어 전체 400 나던 문제 수정)
export async function fetchTossPrices(tickers: string[]): Promise<Price[]> {
  if (tickers.length === 0) return [];
  const CHUNK = 50;
  if (tickers.length > CHUNK) {
    const chunks: string[][] = [];
    for (let i = 0; i < tickers.length; i += CHUNK) chunks.push(tickers.slice(i, i + CHUNK));
    const settled = await Promise.allSettled(chunks.map(c => fetchTossPricesBatch(c)));
    const out: Price[] = [];
    for (const s of settled) {
      if (s.status === "fulfilled") out.push(...s.value);
      // 점검(490)은 전체 상태로 전파 — 일부 청크라도 점검이면 점검 처리
      else if (s.reason instanceof Error && s.reason.message === "toss-maintenance") throw s.reason;
    }
    return out;
  }
  return fetchTossPricesBatch(tickers);
}

async function fetchTossPricesBatch(tickers: string[]): Promise<Price[]> {
  if (tickers.length === 0) return [];
  const codes = tickers.map(t => `A${t}`).join(",");
  const target = `https://wts-info-api.tossinvest.com/api/v3/stock-prices/details?productCodes=${codes}`;
  const resp = await fetchProxied(target);
  if (!resp.ok) {
    // 토스 점검(490 unavailable.agency) 감지 → 점검 상태로 표시
    if (resp.status === 490) {
      try {
        const m = parseTossMaintenance(await resp.clone().json());
        if (m) {
          // 기존 네이버 fallback 플래그 보존 (매 갱신마다 "불러오는 중" 깜빡임 방지)
          const cur = getTossMaintenance();
          setTossMaintenance({ ...m, naverWorking: cur.naverWorking, needsWorkerUpdate: cur.needsWorkerUpdate });
          throw new Error("toss-maintenance");
        }
      } catch (e) { if (e instanceof Error && e.message === "toss-maintenance") throw e; }
    }
    throw new Error(`Toss price fetch failed: ${resp.status}`);
  }
  const data = await resp.json() as TossPriceResponse;
  setTossMaintenance(null);   // 정상 응답 → 점검 해제
  // 비거래일·정규장 시작 전 처리 — base = close → 어제대비 0
  // 판정: 마지막 체결의 KST 날짜가 "오늘 KST 날짜" 와 다르면 오늘 거래가 없음
  // (주말·공휴일·노동절·정규장 시작 전 모두 이 조건에 자동 부합).
  // 휴장 캘린더 불필요 — tradeDateTime 만으로 판정.
  const todayKst = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  return (data.result || []).map(item => {
    let base = item.base;
    let high: number | undefined = item.high;
    let low: number | undefined = item.low;
    let volume = item.volume;
    // 시간외 단일가 예상체결가 — 단일가 매매중일 때만. 비거래일이면 직전 세션값이 남아있을 수 있어 아래서 무효화.
    let afterSingle: number | undefined = item.krxSinglePrice ? item.krxAfterSingleClose : undefined;
    if (item.tradeDateTime) {
      const tradeKst = new Date(
        new Date(item.tradeDateTime).getTime() + 9 * 3600_000
      ).toISOString().slice(0, 10);
      if (tradeKst !== todayKst) {
        // 오늘 거래 없음 → 어제대비 0 + 고/저/거래량 숨김
        // (마지막 거래일의 고/저/거래량을 "오늘 값" 처럼 잘못 보이는 문제 수정)
        base = item.close;
        high = undefined;
        low = undefined;
        volume = 0;
        afterSingle = undefined;
      }
    }
    return {
      ticker: item.code.replace(/^A/, ""),
      price: item.close,
      base,
      prevClose: item.base,  // 직전 거래일 종가 — 비거래일 보정 영향 없음 (색상용)
      open: item.open,
      volume,
      trade_date: item.tradeDateTime ? toKstDateString(item.tradeDateTime) : "",
      trade_dt: item.tradeDateTime,
      high,
      low,
      singlePrice: !!(item.krxSinglePrice || item.nxtSinglePrice),
      afterSinglePrice: afterSingle && afterSingle > 0 ? afterSingle : undefined,
      krxSuspended: item.krxTradingSuspended,
      nxtSuspended: item.nxtTradingSuspended,
      high52w: item.high52w,
      low52w: item.low52w,
    };
  });
}

// 네이버 실시간 시세 (배치 1콜) — 토스 점검 시 fallback.
// polling.finance.naver.com 이 워커 화이트리스트에 없으면(구 워커) 403 → 안내 플래그.
interface NaverPollingItem {
  itemCode: string;
  closePrice: string;
  compareToPreviousClosePrice: string;
  openPrice?: string;
  highPrice?: string;
  lowPrice?: string;
  accumulatedTradingVolume?: string;
  localTradedAt?: string;
}
const naverNum = (s?: string): number => Number(String(s ?? "").replace(/[,\s]/g, "")) || 0;
export async function fetchNaverPrices(tickers: string[]): Promise<Price[]> {
  if (tickers.length === 0) return [];
  const target = `https://polling.finance.naver.com/api/realtime/domestic/stock/${tickers.join(",")}`;
  const resp = await fetchProxied(target);
  if (!resp.ok) {
    if (resp.status === 403) {
      // 워커가 polling.finance.naver.com 미허용 (구버전) → 안내
      setNaverFallback(false, true);
      throw new Error("naver-needs-worker-update");
    }
    setNaverFallback(false);
    throw new Error(`Naver price fetch failed: ${resp.status}`);
  }
  const data = await resp.json() as { datas?: NaverPollingItem[] };
  const list = data.datas ?? [];
  setNaverFallback(list.length > 0);
  return list.map(it => {
    const price = naverNum(it.closePrice);
    const diff = naverNum(it.compareToPreviousClosePrice);
    const prevClose = price - diff;   // 전일 종가 역산
    return {
      ticker: it.itemCode,
      price,
      base: prevClose,
      prevClose,
      open: naverNum(it.openPrice),
      volume: naverNum(it.accumulatedTradingVolume),
      trade_date: it.localTradedAt ?? "",
      trade_dt: it.localTradedAt,
      high: it.highPrice ? naverNum(it.highPrice) : undefined,
      low: it.lowPrice ? naverNum(it.lowPrice) : undefined,
    } as Price;
  });
}

interface TossInvestorItem {
  baseDate: string;
  netIndividualsBuyVolume: number;
  netForeignerBuyVolume: number;
  netInstitutionBuyVolume: number;
  netPensionFundBuyVolume: number;
  netFinancialInvestmentBuyVolume: number;
  netTrustBuyVolume: number;
  netPrivateEquityFundBuyVolume: number;
  netInsuranceBuyVolume: number;
  netBankBuyVolume: number;
  netOtherFinancialInstitutionsBuyVolume: number;
  netOtherCorporationBuyVolume: number;
  foreignerRatio?: number;
}
interface TossInvestorResponse { result: { body: TossInvestorItem[] }; }

function nowKstHour(): number {
  const n = new Date();
  return new Date(n.getTime() + (9 * 60 + n.getTimezoneOffset()) * 60_000).getHours();
}


function mapInvestorItem(item: TossInvestorItem): Investor {
  return {
    date: item.baseDate,
    개인: Number(item.netIndividualsBuyVolume || 0),
    외국인: Number(item.netForeignerBuyVolume || 0),
    기관: Number(item.netInstitutionBuyVolume || 0),
    연기금: Number(item.netPensionFundBuyVolume || 0),
    금융투자: Number(item.netFinancialInvestmentBuyVolume || 0),
    투신: Number(item.netTrustBuyVolume || 0),
    사모: Number(item.netPrivateEquityFundBuyVolume || 0),
    보험: Number(item.netInsuranceBuyVolume || 0),
    은행: Number(item.netBankBuyVolume || 0),
    기타금융: Number(item.netOtherFinancialInstitutionsBuyVolume || 0),
    기타법인: Number(item.netOtherCorporationBuyVolume || 0),
    외국인비율: Number(item.foreignerRatio || 0),
  };
}

// 일별 투자자 순매수 history (최신 → 과거 순)
export async function fetchInvestorHistory(
  ticker: string, size = 60,
): Promise<Investor[]> {
  const target =
    `https://wts-info-api.tossinvest.com/api/v1/stock-infos/trade/trend/trading-trend` +
    `?productCode=A${ticker}&size=${size}`;
  const resp = await fetchProxied(target);
  if (!resp.ok) return [];
  const data = await resp.json() as TossInvestorResponse;
  const body = data.result?.body || [];
  return body.map(mapInvestorItem);
}

// 큰 size 부터 시도 → 빈 응답이면 단계적으로 작은 size 폴백.
// Toss API hard cap = 200 (실측). 그 위는 빈 응답이니 [200, 120, 60] 사용 권장.
export async function fetchInvestorHistorySafe(
  ticker: string, sizes: number[],
): Promise<Investor[]> {
  for (const s of sizes) {
    const data = await fetchInvestorHistory(ticker, s);
    if (data.length > 0) return data;
  }
  return [];
}

// 일별 가격 history (Yahoo Finance) — 한국 6자리 → KOSPI(.KS) 우선, 실패 시 KOSDAQ(.KQ)
export interface PricePoint {
  date: string;       // YYYY-MM-DD (KST)
  close: number;
  volume: number;
  open?: number;
  high?: number;
  low?: number;
}

interface YahooChartResp {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: (number | null)[];
          high?: (number | null)[];
          low?: (number | null)[];
          close?: (number | null)[];
          volume?: (number | null)[];
        }>;
      };
      events?: {
        dividends?: Record<string, { date: number; amount: number }>;
        splits?: Record<string, {
          date: number;
          numerator: number;
          denominator: number;
          splitRatio?: string;
        }>;
      };
    }>;
  };
}

// 배당 이벤트 (배당락일 = ex-dividend date)
export interface DividendEvent {
  date: string;       // YYYY-MM-DD (KST)
  amount: number;     // 주당 배당금 (원 또는 USD)
}

// 액면분할/병합 이벤트
export interface SplitEvent {
  date: string;        // YYYY-MM-DD (KST)
  numerator: number;   // 분할 후 (예: 50:1 → 50)
  denominator: number; // 분할 전 (예: 50:1 → 1)
  ratio: string;       // "50:1" 형태 표시용
}

// DART 공시 (OpenDART API list.json 기반)
export interface DartDisclosure {
  date: string;        // YYYY-MM-DD (rcept_dt → KST)
  title: string;       // 보고서명 (report_nm)
  url: string;         // DART 상세 URL
  reportNm: string;    // 원본 보고서명 (filter 용)
}

// 일별 공매도 (토스 short-selling-trend API)
export interface ShortSellingPoint {
  date: string;          // YYYY-MM-DD
  avgPrice: number;      // 공매도 평균가
  shortVolume: number;   // 공매도 수량 (주)
  ratio: number;         // 거래량 대비 공매도 비율 (%)
  amountRatio: number;   // 거래대금 대비 공매도 비율 (%)
}

// 시장 매매동향 (토스 index/net-buying API) — KOSPI/KOSDAQ 일별 투자자별 순매수
//   금액 단위: 원 (1억 = 100,000,000) → UI 에서 억원으로 변환 필요
export interface MarketFlowPoint {
  date: string;
  individuals: number;        // 개인
  foreigners: number;         // 외국인
  institutions: number;       // 기관계
  // 기관 상세 (큰 단위 → 작은 단위 순)
  financialInvestment: number; // 금융투자
  pensionFund: number;         // 연기금등
  trust: number;               // 투신
  privateEquity: number;       // 사모펀드
  insurance: number;           // 보험
  bank: number;                // 은행
  otherFinancial: number;      // 기타금융
}
export const MARKET_INDEX_CODES = {
  KOSPI:  "KGG01P",
  KOSDAQ: "QGG01P",
} as const;
export type MarketIndexKey = keyof typeof MARKET_INDEX_CODES;

async function fetchPriceHistoryFor(
  symbol: string, range: string,
): Promise<PricePoint[]> {
  const r = await fetchPriceHistoryWithEventsFor(symbol, range);
  return r.prices;
}

// 가격 + 배당 + 액면분할 이벤트 통합 fetch
async function fetchPriceHistoryWithEventsFor(
  symbol: string, range: string,
): Promise<{ prices: PricePoint[]; dividends: DividendEvent[]; splits: SplitEvent[] }> {
  const target =
    `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}` +
    `?range=${range}&interval=1d&events=div%2Csplit`;
  const empty = { prices: [] as PricePoint[], dividends: [] as DividendEvent[], splits: [] as SplitEvent[] };
  const resp = await fetchProxied(target);
  if (!resp.ok) return empty;
  const data = await resp.json() as YahooChartResp;
  const res = data.chart?.result?.[0];
  if (!res) return empty;
  const ts = res.timestamp ?? [];
  const q = res.indicators?.quote?.[0] ?? {};
  const closes = q.close ?? [];
  const volumes = q.volume ?? [];
  const opens = q.open ?? [];
  const highs = q.high ?? [];
  const lows = q.low ?? [];
  const points: PricePoint[] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i];
    if (c == null) continue;
    const d = new Date(ts[i] * 1000);
    const kst = new Date(d.getTime() + (d.getTimezoneOffset() + 540) * 60_000);
    const date = kst.toISOString().slice(0, 10);
    points.push({
      date, close: c,
      volume: volumes[i] ?? 0,
      open: opens[i] ?? undefined,
      high: highs[i] ?? undefined,
      low: lows[i] ?? undefined,
    });
  }
  // 배당 이벤트 — KST 기준 날짜로 변환
  const dividends: DividendEvent[] = [];
  const divMap = res.events?.dividends ?? {};
  for (const v of Object.values(divMap)) {
    const d = new Date(v.date * 1000);
    const kst = new Date(d.getTime() + (d.getTimezoneOffset() + 540) * 60_000);
    dividends.push({
      date: kst.toISOString().slice(0, 10),
      amount: v.amount,
    });
  }
  dividends.sort((a, b) => a.date.localeCompare(b.date));
  // 액면분할 이벤트
  const splits: SplitEvent[] = [];
  const splitMap = res.events?.splits ?? {};
  for (const v of Object.values(splitMap)) {
    const d = new Date(v.date * 1000);
    const kst = new Date(d.getTime() + (d.getTimezoneOffset() + 540) * 60_000);
    splits.push({
      date: kst.toISOString().slice(0, 10),
      numerator: v.numerator,
      denominator: v.denominator,
      ratio: v.splitRatio || `${v.numerator}:${v.denominator}`,
    });
  }
  splits.sort((a, b) => a.date.localeCompare(b.date));
  return { prices: points, dividends, splits };
}

// 한국 6자리 → KOSPI 시도 → 실패 시 KOSDAQ
export async function fetchKrPriceHistory(
  ticker: string, range = "1y",
): Promise<PricePoint[]> {
  if (!/^[\dA-Za-z]{6}$/.test(ticker)) return [];
  // KOSDAQ 종목을 .KS 로 받으면 노이즈 1봉만 나오는 경우가 있어(>0 폴백으론 부족),
  //   2봉 미만이면 .KQ 로 폴백 — fetchKrSparkSeries 와 동일 규칙.
  const ks = await fetchPriceHistoryFor(`${ticker}.KS`, range);
  if (ks.length >= 2) return ks;
  const kq = await fetchPriceHistoryFor(`${ticker}.KQ`, range);
  return kq.length >= ks.length ? kq : ks;
}

// Yahoo 임의 심볼 가격 history (^KS11, ^KQ11 등 인덱스 포함)
export async function fetchYahooPriceHistory(
  symbol: string, range = "1y",
): Promise<PricePoint[]> {
  return await fetchPriceHistoryFor(symbol, range);
}

// Sparkline / 미니 캔들 전용 — OHLC. interval 가변 (1d/1wk/1mo).
// 한국 6자리 → .KS 우선, 실패 시 .KQ.
export interface SparkPoint {
  date: string;
  open: number; high: number; low: number; close: number;
}
async function fetchSparkSeriesFor(
  symbol: string, range: string, interval: string,
): Promise<SparkPoint[]> {
  const target =
    `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}` +
    `?range=${range}&interval=${interval}`;
  const resp = await fetchProxied(target);
  if (!resp.ok) return [];
  const data = await resp.json() as YahooChartResp;
  const res = data.chart?.result?.[0];
  if (!res) return [];
  const ts = res.timestamp ?? [];
  const q = res.indicators?.quote?.[0] ?? {};
  const opens = q.open ?? [];
  const highs = q.high ?? [];
  const lows = q.low ?? [];
  const closes = q.close ?? [];
  const out: SparkPoint[] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i];
    if (c == null) continue;
    const d = new Date(ts[i] * 1000);
    const kst = new Date(d.getTime() + (d.getTimezoneOffset() + 540) * 60_000);
    out.push({
      date: kst.toISOString().slice(0, 10),
      open:  opens[i] ?? c,
      high:  highs[i] ?? c,
      low:   lows[i]  ?? c,
      close: c,
    });
  }
  return out;
}
export async function fetchKrSparkSeries(
  ticker: string, range: string, interval: string,
): Promise<SparkPoint[]> {
  if (!/^[\dA-Za-z]{6}$/.test(ticker)) return [];
  const ks = await fetchSparkSeriesFor(`${ticker}.KS`, range, interval);
  if (ks.length >= 2) return ks;
  return await fetchSparkSeriesFor(`${ticker}.KQ`, range, interval);
}

// 한국 종목 가격 + 배당 + 액면분할 이벤트 통합 fetch
export async function fetchKrPriceHistoryWithEvents(
  ticker: string, range = "1y",
): Promise<{ prices: PricePoint[]; dividends: DividendEvent[]; splits: SplitEvent[] }> {
  const empty = { prices: [] as PricePoint[], dividends: [] as DividendEvent[], splits: [] as SplitEvent[] };
  if (!/^[\dA-Za-z]{6}$/.test(ticker)) return empty;
  // KOSDAQ 종목을 .KS 로 받으면 노이즈 1봉만 나오는 경우가 있어(>0 폴백으론 부족), 2봉 미만이면 .KQ 로 폴백.
  const ks = await fetchPriceHistoryWithEventsFor(`${ticker}.KS`, range);
  if (ks.prices.length >= 2) return ks;
  const kq = await fetchPriceHistoryWithEventsFor(`${ticker}.KQ`, range);
  return kq.prices.length >= ks.prices.length ? kq : ks;
}

// 공시 fetch — Naver 모바일 API (인증 불필요, m.stock.naver.com 이미 워커 화이트리스트)
//   페이지당 20건 고정 (size 파라미터 무시) → 1년치 보통 3-5페이지 병렬 fetch.
//   노이즈 필터 — 시세 모니터링·5% 보고·신탁의결권·정정 등 차트에 의미 없는 공시 제거.
const DISCLOSURE_NOISE_PATTERNS = [
  "가격제한폭",            // 자동 시세 모니터링
  "주식선물",              // 선물·옵션 거래 모니터링
  "주식옵션",
  "신탁업자",              // 신탁 의결권 행사
  "임원ㆍ주요주주",        // 5% 보고서 (대부분 미세 변동)
  "임원·주요주주",
  "임원 · 주요주주",
  "주식등의대량보유",      // 대량보유상황보고서 (마찬가지)
  "주식 등의 대량보유",
  "특정증권등소유상황",    // 특정증권 소유 보고
  "(정정)",                // 정정공시 — 원본만 표시
  "(첨부정정)",
  "(기재정정)",
];

// 공매도 fetch — 토스 wts-info-api (인증 불필요, 워커 화이트리스트 이미 등록)
//   max size 100 / 페이지당 → 1년치 위해 4페이지 순차 fetch
export async function fetchKrShortSelling(
  ticker: string, months = 12,
): Promise<ShortSellingPoint[]> {
  if (!/^\d{6}$/.test(ticker)) return [];

  const since = new Date();
  since.setMonth(since.getMonth() - months);

  const out: ShortSellingPoint[] = [];
  let key: string | null = null;

  for (let i = 0; i < 4; i++) {
    let url = `https://wts-info-api.tossinvest.com/api/v1/mds/info/short-selling-trend?stockCode=A${ticker}&size=100`;
    if (key) url += `&key=${encodeURIComponent(key)}`;
    let resp: Response;
    try { resp = await fetchProxied(url); }
    catch { break; }
    if (!resp.ok) break;
    const data = await resp.json() as {
      result?: {
        body?: Array<{
          baseDate?: string;
          shortSellingAveragePrice?: number;
          shortSellingAveragePriceLong?: number;
          shortTradingVolume?: number;
          shortSellingRatio?: number;
          shortSellingTradingAmountRatio?: number;
        }>;
        pagingParam?: { key?: string | null };
      };
    };
    const body = data.result?.body;
    if (!Array.isArray(body) || body.length === 0) break;

    let stop = false;
    for (const r of body) {
      if (!r.baseDate) continue;
      if (new Date(r.baseDate) < since) { stop = true; continue; }
      out.push({
        date: r.baseDate,
        avgPrice: r.shortSellingAveragePriceLong ?? Math.round(r.shortSellingAveragePrice ?? 0),
        shortVolume: r.shortTradingVolume ?? 0,
        ratio: r.shortSellingRatio ?? 0,
        amountRatio: r.shortSellingTradingAmountRatio ?? 0,
      });
    }
    if (stop) break;
    key = data.result?.pagingParam?.key ?? null;
    if (!key) break;
  }

  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

// 일별 대차거래(securities lending) — 토스 lending-trading API
//   대차잔고 = 빌려간 주식 잔고 = 잠재적 공매도 물량. 잔고 증가=숏 빌드업 / 감소=숏커버(상환).
export interface LendingTradingPoint {
  date: string;            // YYYY-MM-DD
  balanceVolume: number;   // 대차 잔고수량 (주)
  balanceAmount: number;   // 대차 잔고금액 (원)
  newVolume: number;       // 신규 대차 (주)
  repayVolume: number;     // 상환 (주)
  fluctuation: number;     // 증감수량 (신규-상환, 주)
  close: number;           // 종가
}

// 공매도와 동일 호스트(wts-info-api) — 워커 화이트리스트 추가 불필요. 페이지네이션 순차 fetch.
export async function fetchKrLendingTrading(
  ticker: string, months = 12,
): Promise<LendingTradingPoint[]> {
  if (!/^[\dA-Za-z]{6}$/.test(ticker)) return [];

  const since = new Date();
  since.setMonth(since.getMonth() - months);

  const out: LendingTradingPoint[] = [];
  let key: string | null = null;

  for (let i = 0; i < 5; i++) {
    let url = `https://wts-info-api.tossinvest.com/api/v1/mds/info/lending-trading?stockCode=A${ticker}&size=100`;
    if (key) url += `&key=${encodeURIComponent(key)}`;
    let resp: Response;
    try { resp = await fetchProxied(url); }
    catch { break; }
    if (!resp.ok) break;
    const data = await resp.json() as {
      result?: {
        body?: Array<{
          baseDate?: string;
          executionQuantity?: number;
          repaymentQuantity?: number;
          lendingTradingFluctuation?: number;
          lendingTradingBalanceVolume?: number;
          lendingTradingBalanceAmount?: number;
          close?: number;
        }>;
        pagingParam?: { key?: string | null };
      };
    };
    const body = data.result?.body;
    if (!Array.isArray(body) || body.length === 0) break;

    let stop = false;
    for (const r of body) {
      if (!r.baseDate) continue;
      if (new Date(r.baseDate) < since) { stop = true; continue; }
      out.push({
        date: r.baseDate,
        balanceVolume: r.lendingTradingBalanceVolume ?? 0,
        balanceAmount: r.lendingTradingBalanceAmount ?? 0,
        newVolume: r.executionQuantity ?? 0,
        repayVolume: r.repaymentQuantity ?? 0,
        fluctuation: r.lendingTradingFluctuation ?? 0,
        close: r.close ?? 0,
      });
    }
    if (stop) break;
    key = data.result?.pagingParam?.key ?? null;
    if (!key) break;
  }

  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

// 토스 mds/info 일별 트렌드 공용 fetch — 공매도/대차/프로그램/신용/CFD 동일 페이지네이션 구조.
async function fetchTossMdsTrend<T extends { date: string }>(
  endpoint: string, ticker: string, months: number,
  map: (r: Record<string, unknown>) => T | null,
): Promise<T[]> {
  if (!/^[\dA-Za-z]{6}$/.test(ticker)) return [];
  const since = new Date();
  since.setMonth(since.getMonth() - months);
  const out: T[] = [];
  let key: string | null = null;
  for (let i = 0; i < 5; i++) {
    let url = `https://wts-info-api.tossinvest.com/api/v1/mds/info/${endpoint}?stockCode=A${ticker}&size=100`;
    if (key) url += `&key=${encodeURIComponent(key)}`;
    let resp: Response;
    try { resp = await fetchProxied(url); }
    catch { break; }
    if (!resp.ok) break;
    const data = await resp.json() as {
      result?: { body?: Array<Record<string, unknown>>; pagingParam?: { key?: string | null } };
    };
    const body = data.result?.body;
    if (!Array.isArray(body) || body.length === 0) break;
    let stop = false;
    for (const r of body) {
      const bd = r.baseDate as string | undefined;
      if (!bd) continue;
      if (new Date(bd) < since) { stop = true; continue; }
      const m = map(r);
      if (m) out.push(m);
    }
    if (stop) break;
    key = data.result?.pagingParam?.key ?? null;
    if (!key) break;
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

// 프로그램매매 — 차익(arbitrage)/비차익(nonArbitrage)/합계 순매수. 기관·외인 대량 수급 + 선물 연계 차익.
export interface ProgramTradingPoint {
  date: string;
  arbitrageNet: number;     // 차익 순매수 (주)
  nonArbitrageNet: number;  // 비차익 순매수 (주)
  totalNet: number;         // 합계 순매수 (주)
}
export function fetchKrProgramTrading(ticker: string, months = 12): Promise<ProgramTradingPoint[]> {
  return fetchTossMdsTrend("program-trading", ticker, months, r => ({
    date: r.baseDate as string,
    arbitrageNet: (r.arbitrageNetBuyQuantity as number) ?? 0,
    nonArbitrageNet: (r.nonArbitrageNetBuyQuantity as number) ?? 0,
    totalNet: (r.totalNetBuyQuantity as number) ?? 0,
  }));
}

// 신용거래(신용융자) 잔고 — 개인 빚투. 잔고 증가=과열·반대매매 리스크 / 급감=반대매매 투매.
export interface CreditLoanPoint {
  date: string;
  balanceVolume: number;   // 신용융자 잔고수량 (주)
  rate: number;            // 신용잔고 비율 (%)
  fluctuation: number;     // 증감 (주)
}
export function fetchKrCreditLoan(ticker: string, months = 12): Promise<CreditLoanPoint[]> {
  return fetchTossMdsTrend("credit", ticker, months, r => {
    const v = (r.marginLoanBalanceQuantity as number) ?? 0;
    if (!(v > 0)) return null;
    return {
      date: r.baseDate as string,
      balanceVolume: v,
      rate: (r.marginLoanBalanceRate as number) ?? 0,
      fluctuation: (r.marginLoanIncreaseDecreaseQuantity as number) ?? 0,
    };
  });
}

// CFD(차액결제거래) — 개인 레버리지. 매수잔고(롱)/매도잔고(숏). 종목 따라 데이터 없을 수 있음.
export interface CfdPoint {
  date: string;
  buyBalance: number;  buyRate: number;
  sellBalance: number; sellRate: number;
}
export function fetchKrCfd(ticker: string, months = 12): Promise<CfdPoint[]> {
  return fetchTossMdsTrend("cfd", ticker, months, r => {
    const buy = (r.buyBalanceQuantity as number) ?? 0;
    const sell = (r.sellBalanceQuantity as number) ?? 0;
    if (!(buy > 0) && !(sell > 0)) return null;
    return {
      date: r.baseDate as string,
      buyBalance: buy, buyRate: (r.buyBalanceRate as number) ?? 0,
      sellBalance: sell, sellRate: (r.sellBalanceRate as number) ?? 0,
    };
  });
}

// ─── 컨센서스 예상치 시계열 (토스 v2 financial/estimate) ─────────────
// 분기별 발표치 vs 애널리스트 예상치 + 서프라이즈율. POST {} 호출 — 워커 POST 통과 필요.
export type EstimateMetric = "revenue" | "operating-income" | "eps";

export interface EstimatePoint {
  period: string;            // "2025-12" 형식
  actual: number | null;     // 발표치 (미래 분기는 null)
  estimate: number | null;   // 애널리스트 예상치
  surprise: number | null;   // 서프라이즈율 (%)
}

export interface EstimateSeries {
  metric: EstimateMetric;
  points: EstimatePoint[];
  /** 다음 분기 예상치의 직전 분기 발표치 대비 변동률 (%) */
  fluctuationRate: number | null;
  /** 다음 분기 예상치 위치 — "HIGH" | "MID" | "LOW" 등 토스 분류 */
  position: string | null;
}

// metric → 응답 key 매핑
const ESTIMATE_KEY: Record<EstimateMetric, { actual: string; est: string }> = {
  "revenue":          { actual: "revenue",         est: "revenueEst" },
  "operating-income": { actual: "operatingIncome", est: "operatingIncomeEst" },
  "eps":              { actual: "eps",             est: "epsEst" },
};

export async function fetchTossEstimate(
  ticker: string, metric: EstimateMetric,
): Promise<EstimateSeries | null> {
  if (!/^\d{6}$/.test(ticker)) return null;
  const target = `https://wts-info-api.tossinvest.com/api/v2/companies/A${ticker}/financial/estimate/${metric}`;
  let resp: Response;
  try {
    resp = await fetchProxied(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  } catch { return null; }
  if (!resp.ok) return null;
  const data = await resp.json() as {
    result?: {
      fluctuationRate?: number;
      position?: string;
      graphs?: Array<Record<string, unknown>>;
    };
  };
  const r = data.result;
  if (!r || !Array.isArray(r.graphs)) return null;
  const { actual, est } = ESTIMATE_KEY[metric];
  const points: EstimatePoint[] = r.graphs.map(g => ({
    period: String(g.period ?? ""),
    actual: typeof g[actual] === "number" ? (g[actual] as number) : null,
    estimate: typeof g[est] === "number" ? (g[est] as number) : null,
    surprise: typeof g.surprise === "number" ? (g.surprise as number) : null,
  })).filter(p => p.period);
  return {
    metric,
    points,
    fluctuationRate: typeof r.fluctuationRate === "number" ? r.fluctuationRate : null,
    position: typeof r.position === "string" ? r.position : null,
  };
}

// 시장 매매동향 fetch — 토스 indices net-buying daily API (인증 X)
//   KOSPI: KGG01P  / KOSDAQ: QGG01P
//   API 동작: from 은 "응답의 최신 날짜" (해당 일자부터 과거로 count 일치 반환)
//   count max 100 → desiredDays > 100 면 nextDate 로 페이지네이션
//   응답 단위: 원 (UI 에서 /1억 변환)
export async function fetchKrMarketFlow(
  indexKey: MarketIndexKey,
  desiredDays = 250,
): Promise<MarketFlowPoint[]> {
  const code = MARKET_INDEX_CODES[indexKey];
  const out: MarketFlowPoint[] = [];
  // 시작 from = 오늘 (KST) — 응답이 오늘부터 과거 100일치
  let nextFrom: string | null = new Date(Date.now() + 9 * 3600_000)
    .toISOString().slice(0, 10);
  const seen = new Set<string>();
  // 100일 페이지 × 최대 4회 → 400거래일 (~1.5년) 안전 상한
  for (let i = 0; i < 4 && out.length < desiredDays && nextFrom; i++) {
    const url = `https://wts-info-api.tossinvest.com/api/v1/stock-infos/index/net-buying/daily`
              + `?code=${code}&count=100&from=${nextFrom}`;
    let resp: Response;
    try { resp = await fetchProxied(url); }
    catch { break; }
    if (!resp.ok) break;
    const data = await resp.json() as {
      result?: {
        nextDate?: string | null;
        investorActivityAmounts?: Array<{
          dt: string;
          individualsNetBuying?: number;
          foreignersNetBuying?: number;
          institutionsNetBuying?: number;
          financialInvestmentNetBuying?: number;
          pensionFundNetBuying?: number;
          trustNetBuying?: number;
          privateEquityFundNetBuying?: number;
          insuranceNetBuying?: number;
          bankNetBuying?: number;
          otherFinancialNetBuying?: number;
        }>;
      };
    };
    const items = data.result?.investorActivityAmounts ?? [];
    if (items.length === 0) break;
    for (const r of items) {
      if (seen.has(r.dt)) continue;
      seen.add(r.dt);
      out.push({
        date: r.dt,
        individuals:         r.individualsNetBuying ?? 0,
        foreigners:          r.foreignersNetBuying ?? 0,
        institutions:        r.institutionsNetBuying ?? 0,
        financialInvestment: r.financialInvestmentNetBuying ?? 0,
        pensionFund:         r.pensionFundNetBuying ?? 0,
        trust:               r.trustNetBuying ?? 0,
        privateEquity:       r.privateEquityFundNetBuying ?? 0,
        insurance:           r.insuranceNetBuying ?? 0,
        bank:                r.bankNetBuying ?? 0,
        otherFinancial:      r.otherFinancialNetBuying ?? 0,
      });
    }
    nextFrom = data.result?.nextDate ?? null;
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// ─── 당일 시간별 투자자 순매수 (네이버 investorDealTrendTime) ────────────────
//   HTS "시간별동향" 과 동일 — 당일 누적 순매수 시계열 (개인/외국인/기관+세부).
//   sosok: 01 코스피(억원) · 02 코스닥(억원) · 03 선물(계약). 로그인 불필요.
//   페이지당 ~10행(~14분), page=1 최신→과거. 09:00 도달 또는 빈 페이지까지 수집.
//   값은 이미 "당일 누적" 순매수 → 그대로 라인차트(누적) 사용.
export type IntradayMarket = "kospi" | "kosdaq" | "futures";
const INTRADAY_SOSOK: Record<IntradayMarket, string> = { kospi: "01", kosdaq: "02", futures: "03" };
export interface IntradayFlowPoint {
  time: string;   // "HH:MM"
  individuals: number; foreigners: number; institutions: number;
  financialInvestment: number; insurance: number; trust: number;
  bank: number; otherFinancial: number; pensionFund: number; otherCorp: number;
}
export interface IntradayFlow { unit: "억원" | "계약"; points: IntradayFlowPoint[]; }

// 컬럼 순서(네이버): 개인·외국인·기관계·금융투자·보험·투신(사모포함)·은행·기타금융·연기금·기타법인.
// (기관계 = 금융투자+보험+투신+은행+기타금융+연기금 으로 검증됨)
function parseIntradayInvestor(html: string): IntradayFlowPoint[] {
  const txt = html.replace(/<[^>]+>/g, " ").replace(/[ \t ]+/g, " ");
  const re = /(\d{2}:\d{2})((?:\s+-?[\d,]+){10})(?!\d)/g;
  const num = (s: string) => Number(s.replace(/,/g, "")) || 0;
  const out: IntradayFlowPoint[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(txt))) {
    const v = m[2].trim().split(/\s+/).map(num);
    if (v.length < 10) continue;
    out.push({
      time: m[1],
      individuals: v[0], foreigners: v[1], institutions: v[2],
      financialInvestment: v[3], insurance: v[4], trust: v[5],
      bank: v[6], otherFinancial: v[7], pensionFund: v[8], otherCorp: v[9],
    });
  }
  return out;
}

// bizdate(YYYYMMDD) 생략 시 오늘(KST). 과거 날짜도 조회 가능(네이버가 당일 시계열 보관).
export async function fetchKrIntradayInvestorFlow(market: IntradayMarket, bizdate?: string): Promise<IntradayFlow> {
  const sosok = INTRADAY_SOSOK[market];
  const bd = bizdate ?? new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10).replace(/-/g, "");
  const byTime = new Map<string, IntradayFlowPoint>();
  const MAX_PAGES = 42;   // ~14분/페이지 → 개장(09:00)~시간외(18:00) 전체 커버
  const BATCH = 7;        // 병렬 배치 (프록시 라운드로빈 분산)
  let reachedOpen = false;
  for (let start = 1; start <= MAX_PAGES && !reachedOpen; start += BATCH) {
    const pages = Array.from({ length: Math.min(BATCH, MAX_PAGES - start + 1) }, (_, i) => start + i);
    const results = await Promise.all(pages.map(async p => {
      try {
        const resp = await fetchProxied(
          `https://finance.naver.com/sise/investorDealTrendTime.naver?bizdate=${bd}&sosok=${sosok}&page=${p}`);
        if (!resp.ok) return [] as IntradayFlowPoint[];
        return parseIntradayInvestor(decodeHtmlBuf(await resp.arrayBuffer(), resp.headers.get("Content-Type") || ""));
      } catch { return [] as IntradayFlowPoint[]; }
    }));
    let anyRows = false;
    for (const pts of results) {
      if (pts.length > 0) anyRows = true;
      for (const pt of pts) {
        if (!byTime.has(pt.time)) byTime.set(pt.time, pt);
        if (pt.time <= "09:00") reachedOpen = true;   // 정규 개장 도달 → 더 과거 없음
      }
    }
    if (!anyRows) break;   // 빈 배치 = 데이터 끝
  }
  const points = [...byTime.values()].sort((a, b) => a.time.localeCompare(b.time));
  return { unit: market === "futures" ? "계약" : "억원", points };
}

// ─── 일별 투자자 순매수 (네이버 investorDealTrendDay, 기간별) ────────────────
//   HTS "일별동향" 과 동일. sosok 01/02/03 (선물=계약). 페이지당 10거래일, page=1 최신→과거.
//   값 = 일별 순매수(비누적). 화면에서 기간 합계·누적을 계산.
export interface DailyFlowPoint {
  date: string;   // "YYYY-MM-DD"
  individuals: number; foreigners: number; institutions: number;
  financialInvestment: number; insurance: number; trust: number;
  bank: number; otherFinancial: number; pensionFund: number; otherCorp: number;
}
export interface DailyFlow { unit: "억원" | "계약"; points: DailyFlowPoint[]; }

function parseDailyInvestor(html: string): DailyFlowPoint[] {
  const txt = html.replace(/<[^>]+>/g, " ").replace(/[ \t ]+/g, " ");
  const re = /(\d{2})\.(\d{2})\.(\d{2})((?:\s+-?[\d,]+){10})(?!\d)/g;
  const num = (s: string) => Number(s.replace(/,/g, "")) || 0;
  const out: DailyFlowPoint[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(txt))) {
    const v = m[4].trim().split(/\s+/).map(num);
    if (v.length < 10) continue;
    out.push({
      date: `20${m[1]}-${m[2]}-${m[3]}`,   // 26.07.14 → 2026-07-14
      individuals: v[0], foreigners: v[1], institutions: v[2],
      financialInvestment: v[3], insurance: v[4], trust: v[5],
      bank: v[6], otherFinancial: v[7], pensionFund: v[8], otherCorp: v[9],
    });
  }
  return out;
}

// days = 조회할 거래일 수(대략). 10거래일/페이지 → ceil(days/10) 페이지 + 여유 1.
export async function fetchKrDailyInvestorFlow(market: IntradayMarket, days = 22): Promise<DailyFlow> {
  const sosok = INTRADAY_SOSOK[market];
  const bizdate = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10).replace(/-/g, "");
  const maxPages = Math.min(30, Math.ceil(days / 10) + 1);   // 상한 30페이지(~300거래일)
  const byDate = new Map<string, DailyFlowPoint>();
  const pages = Array.from({ length: maxPages }, (_, i) => i + 1);
  const results = await Promise.all(pages.map(async p => {
    try {
      const resp = await fetchProxied(
        `https://finance.naver.com/sise/investorDealTrendDay.naver?bizdate=${bizdate}&sosok=${sosok}&page=${p}`);
      if (!resp.ok) return [] as DailyFlowPoint[];
      return parseDailyInvestor(decodeHtmlBuf(await resp.arrayBuffer(), resp.headers.get("Content-Type") || ""));
    } catch { return [] as DailyFlowPoint[]; }
  }));
  for (const pts of results) for (const pt of pts) if (!byDate.has(pt.date)) byDate.set(pt.date, pt);
  const points = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-days);
  return { unit: market === "futures" ? "계약" : "억원", points };
}

export async function fetchKrDisclosures(
  ticker: string, months = 12,
): Promise<DartDisclosure[]> {
  if (!/^\d{6}$/.test(ticker)) return [];

  const since = new Date();
  since.setMonth(since.getMonth() - months);

  const requests = [1, 2, 3, 4, 5].map(page =>
    fetchProxied(`https://m.stock.naver.com/api/stock/${ticker}/disclosure?page=${page}&size=100`)
      .then(r => r.ok ? r.json() : [])
      .catch(() => [])
  );
  const pages = await Promise.all(requests);

  const seen = new Set<number>();
  const out: DartDisclosure[] = [];
  for (const items of pages) {
    if (!Array.isArray(items)) continue;
    for (const it of items as Array<{ disclosureId: number; title: string; datetime: string }>) {
      if (!it || seen.has(it.disclosureId)) continue;
      seen.add(it.disclosureId);
      const dateOnly = (it.datetime || "").slice(0, 10);
      if (!dateOnly) continue;
      if (new Date(dateOnly) < since) continue;
      const title = it.title || "";
      if (DISCLOSURE_NOISE_PATTERNS.some(p => title.includes(p))) continue;
      // 회사명 접두 제거 — 두 패턴 다 처리:
      //   "삼성전자(주) 현금배당 결정"        → "현금배당 결정"
      //   "(주)에이치제이중공업 유상증자 결정" → "유상증자 결정"
      const cleaned = title
        .replace(/^[^()\s]+\(주\)\s*/, "")
        .replace(/^\(주\)[^\s]+\s*/, "")
        .trim() || title;
      out.push({
        date: dateOnly,
        title: cleaned,
        url: `https://m.stock.naver.com/domestic/stock/${ticker}/notice/${it.disclosureId}`,
        reportNm: title,
      });
    }
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

// 8시 KST 이전 + body[0] 전부 0 → body[1] 폴백 (데스크톱 v2 동일)
// 비거래일(주말/공휴일)엔 마지막 거래일 수급을 그대로 유지 — 가격 "어제% 유지"와 일관 (0 으로 비우지 않음).
export function pickTodayInvestor(history: Investor[]): Investor | null {
  if (history.length === 0) return null;
  let item = history[0];
  if (nowKstHour() < 8 && history.length >= 2) {
    const isAllZero =
      item.개인 === 0 && item.외국인 === 0 && item.기관 === 0;
    if (isAllZero) item = history[1];
  }
  return item;
}

export async function fetchInvestor(ticker: string): Promise<Investor | null> {
  const history = await fetchInvestorHistory(ticker, 60);
  return pickTodayInvestor(history);
}

// 토스 wts-badges — 풀네임 표시 (토스 화면과 일치)
// 우선순위: 투자위험 > 관리종목 > 거래정지 > 투자경고 > 공매도과열 > 단기과열 > 투자주의환기 > 투자주의
interface TossBadgeItem { title: string; }
interface TossBadgeResponse { result: TossBadgeItem[]; }

const WARNING_MAP: [string, string][] = [
  ["투자위험", "투자위험"],
  ["관리종목", "관리종목"],
  ["거래정지", "거래정지"],
  ["투자경고", "투자경고"],
  ["공매도", "공매도과열"],
  ["단기과열", "단기과열"],
  ["투자주의환기", "투자주의환기"],
  ["투자주의", "투자주의"],
];

export async function fetchWarning(ticker: string): Promise<string> {
  const target = `https://wts-info-api.tossinvest.com/api/v1/stock-infos/A${ticker}/wts-badges`;
  try {
    const resp = await fetchProxied(target);
    if (!resp.ok) return "";
    const data = await resp.json() as TossBadgeResponse;
    const titles = (data.result || []).map(it => it.title || "").join(" ");
    for (const [full, short] of WARNING_MAP) {
      if (titles.includes(full)) return short;
    }
  } catch {
    // ignore
  }
  return "";
}

// ─── 시장조치(시장경보) 공시 — 경고 뱃지 클릭 시 표시 ───────────────
// 네이버 공시 피드에서 거래소 시장조치(투자경고/위험/주의·매매거래정지·단기과열 등)만 추출.
export interface MarketAlertNotice {
  date: string;          // YYYY-MM-DD
  title: string;         // 회사명 접두 제거
  url: string;           // 네이버 공시 상세
  disclosureId: number;
}

const MARKET_ALERT_RE =
  /투자경고|투자위험|투자주의|관리종목|매매거래정지|거래정지|단기과열|공매도|과열종목|시장경보|소수계좌|종가급변|투자유의|지정예고|지정해제|불성실공시|상장폐지/;

export async function fetchMarketAlerts(ticker: string): Promise<MarketAlertNotice[]> {
  if (!/^\d{6}$/.test(ticker)) return [];
  try {
    const resp = await fetchProxied(
      `https://m.stock.naver.com/api/stock/${ticker}/disclosure?page=1&size=100`);
    if (!resp.ok) return [];
    const items = await resp.json() as Array<{ disclosureId: number; title: string; datetime: string }>;
    if (!Array.isArray(items)) return [];
    const seen = new Set<number>();
    const out: MarketAlertNotice[] = [];
    for (const it of items) {
      if (!it || seen.has(it.disclosureId)) continue;
      const title = it.title || "";
      if (!MARKET_ALERT_RE.test(title)) continue;
      seen.add(it.disclosureId);
      const cleaned = title
        .replace(/^[^()\s]+\(주\)\s*/, "")
        .replace(/^\(주\)[^\s]+\s*/, "")
        .trim() || title;
      out.push({
        date: (it.datetime || "").slice(0, 10),
        title: cleaned,
        url: `https://m.stock.naver.com/domestic/stock/${ticker}/notice/${it.disclosureId}`,
        disclosureId: it.disclosureId,
      });
    }
    out.sort((a, b) => b.date.localeCompare(a.date));
    return out.slice(0, 15);
  } catch {
    return [];
  }
}

// 공시 본문 → 원본 ASCII 표 구조 보존 (monospace 로 표시).
//   <br>·블록끝 → 줄바꿈, &nbsp; → 공백(정렬 유지 위해 개수 보존, 공백 뭉개기 금지)
export async function fetchDisclosureBody(ticker: string, disclosureId: number): Promise<string> {
  if (!/^\d{6}$/.test(ticker)) return "";
  try {
    const resp = await fetchProxied(
      `https://m.stock.naver.com/api/stock/${ticker}/disclosure/${disclosureId}`);
    if (!resp.ok) return "";
    const data = await resp.json() as { disclosure?: { contents?: string } };
    const raw = data.disclosure?.contents ?? "";
    if (!raw) return "";
    const txt = raw
      .replace(/<!--[\s\S]*?-->/g, "")              // XML 처리 주석(<!--?javax...?-->) 제거
      .replace(/<br\s*\/?>/gi, "\n")                // <br> → 줄바꿈
      .replace(/<\/(tr|td|div|p|table|h\d)>/gi, "\n") // 블록 끝 → 줄바꿈
      .replace(/<[^>]+>/g, "")                      // 나머지 태그 제거
      .replace(/&nbsp;/g, " ")                      // 정렬용 공백 — 개수 유지
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&#3[49];/g, "'");
    return txt
      .split("\n")
      .map(l => l.replace(/[ \t]+$/, ""))           // 줄 끝 공백만 정리(좌측 정렬 보존)
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")                   // 과도한 빈 줄 축소
      .trim();
  } catch {
    return "";
  }
}

// Yahoo Finance — 지수/심볼 가격 + 등락률
export interface UsIndex {
  symbol: string;
  name: string;
  price: number;
  prev: number;            // "어제대비" 표시용 (비거래일엔 price 와 동일 = 0)
  prevClose: number;       // 직전 거래일 종가 — 색상용 (비거래일 보정 영향 없음)
  diff: number;
  pct: number;
  currency?: string;
  priceUsd?: number;       // 미국 종목 달러 현재가(원화 표시와 함께 보조 표기용)
  regularPriceUsd?: number; // 정규장 종가 달러(마감 책갈피용 — 현재가 달러와 구분)
  tradeDate: string;       // KST 날짜 (YYYY-MM-DD) — 마지막 거래 시각 기준
  regularMarketTime?: number;  // 마지막 "정규장" 거래 시각 (unix sec) — 마감가 책갈피("갱신") 표시용 (시간외엔 정규 종가에 고정)
  freshTime?: number;          // 실제 마지막 데이터 갱신 시각 (unix sec) — 정규/시간외/오버나잇 통틀어 가장 최신. 흐림(정체) 판정 전용
  marketState: string;     // REGULAR / PRE / POST / CLOSED / PREPRE / POSTPOST
  // 시간외 (after-hours) — POST 마켓 상태가 아닌 때도 직전 시간외 가격 보존
  postPrice?: number;
  postPct?: number;        // 정규 종가 대비 시간외 변동률 (%)
  // 정규장 종가 + 변동률 — marketState 무관하게 항상 유지
  regularPrice?: number;
  regularPct?: number;     // (regularPrice - prevClose) / prevClose × 100
  // 토스 overview mini-chart 캔들 close 시계열 — Yahoo 가 historical 안 주는 심볼(^US2Y 등)의 sparkline 폴백
  sparkline?: number[];
}

// ─── 코스피200/코스닥150 야간선물 — yasun.gg 1분봉 캔들 ─────────
// virtual symbol(^KS200N, ^KQ150N) → yasun 실제 심볼(^KS200, ^KQ150) 매핑.
// 첫 캔들 open = 야간 시작가(=정규장 종가) 기준으로 변동률 계산.
interface YasunCandle { time: number; open: number; high: number; low: number; close: number; volume: number }

export const YASUN_NIGHT_SYMBOLS = new Set<string>(["^KS200N", "^KQ150N"]);
const YASUN_SYMBOL_MAP: Record<string, string> = {
  "^KS200N": "^KS200",
  "^KQ150N": "^KQ150",
};
export interface YasunNightData {
  index: UsIndex;
  closes: number[];       // 스파크라인 — 캔들 close 시계열
}

async function fetchYasunCandles(real: string, session: string): Promise<YasunCandle[]> {
  const url = `https://yasun.gg/api/candles?symbol=${encodeURIComponent(real)}&interval=1m&limit=700&session=${session}`;
  const resp = await fetchProxied(url);
  if (!resp.ok) return [];
  const data = await resp.json();
  return Array.isArray(data) ? (data as YasunCandle[]) : [];
}

// yasun.gg 페이지가 실제로 쓰는 실시간 시세 피드 — 전 종목 1회 응답.
// 기준점(전일 정산가)을 yasun 과 동일하게 맞추기 위해 changePercent/change/price 를 그대로 사용.
//   (캔들 first.open 기준은 야간 세션 시작가라 yasun 표시값과 어긋남)
interface YasunPrice { symbol: string; price: number; change: number; changePercent: number }
async function fetchYasunQuote(real: string): Promise<YasunPrice | null> {
  try {
    const resp = await fetchProxied("https://yasun.gg/api/prices");
    if (!resp.ok) return null;
    const arr = await resp.json();
    if (!Array.isArray(arr)) return null;
    const hit = (arr as YasunPrice[]).find(x => x.symbol === real);
    return hit && typeof hit.price === "number" ? hit : null;
  } catch {
    return null;
  }
}

export async function fetchYasunNightFutures(virtualSymbol: string): Promise<YasunNightData | null> {
  const real = YASUN_SYMBOL_MAP[virtualSymbol];
  if (!real) return null;
  // 현재 KST 시각 기준 세션 선택 — 야간(18:00~05:00)은 night, 그 외(주간)는 main.
  //   선택 세션이 비어 있으면(세션 간 공백) 다른 세션으로 폴백 → 마지막 값 유지.
  const night = isKrNightSession();
  const primary = night ? "night" : "main";
  const fallback = night ? "main" : "night";
  try {
    // 시세(quote)와 캔들(sparkline)을 병렬 fetch — quote 가 가격/변동률 출처, 캔들은 스파크라인 전용.
    const [quote, candlesPrimary] = await Promise.all([
      fetchYasunQuote(real),
      fetchYasunCandles(real, primary),
    ]);
    let allCandles = candlesPrimary;
    if (allCandles.length === 0) allCandles = await fetchYasunCandles(real, fallback);

    // 캔들에서 현재 세션만 추출 — 응답에 여러 세션이 섞일 수 있어 가장 큰 시간 갭(>30분) 뒤부터.
    let candles = allCandles;
    if (allCandles.length > 0) {
      let sessionStart = 0;
      for (let i = allCandles.length - 1; i > 0; i--) {
        if (allCandles[i].time - allCandles[i - 1].time > 30 * 60) {
          sessionStart = i;
          break;
        }
      }
      candles = allCandles.slice(sessionStart);
    }
    const last = candles.length > 0 ? candles[candles.length - 1] : undefined;

    // 가격/변동률: quote 우선(yasun 표시값과 동일), 없으면 캔들 first.open 기준으로 폴백.
    let price: number, diff: number, pct: number;
    if (quote) {
      price = quote.price;
      pct = quote.changePercent;
      diff = quote.change;
    } else {
      if (!last) return null;
      const base = candles[0].open;   // 폴백: 세션 시작가 = 정규장 종가 근사
      price = last.close;
      diff = price - base;
      pct = base > 0 ? (diff / base) * 100 : 0;
    }
    const base = price - diff;
    const lastTime = last ? last.time : Math.floor(Date.now() / 1000);
    // 실제 거래중이면 REGULAR(흐림 제외), 개장 대기·마감 구간이면 CLOSED(흐림 + '마감' 책갈피).
    const trading = isKrFuturesTradingNow();
    return {
      index: {
        symbol: virtualSymbol,
        name: krFuturesName(virtualSymbol),
        price,
        prev: base,
        prevClose: base,
        diff,
        pct,
        tradeDate: new Date(lastTime * 1000).toISOString().slice(0, 10),
        regularMarketTime: lastTime,
        freshTime: lastTime,   // yasun 마지막 캔들 시각 — 야간/주간 마감 후 멈추면 흐림
        marketState: trading ? "REGULAR" : "CLOSED",
        regularPrice: price,
        regularPct: pct,
      },
      closes: candles.map(c => c.close),
    };
  } catch {
    return null;
  }
}

// Yahoo quoteSummary v10 — yfinance Python 과 동일 데이터 소스
// Worker 가 crumb 자동 처리 (인증 우회). 데스크톱 v2 _fast_quote 와 같은 분기 적용.
interface QuoteSummaryRaw {
  raw?: number;
  fmt?: string;
}
interface QuoteSummaryPrice {
  regularMarketPrice?: QuoteSummaryRaw;
  regularMarketPreviousClose?: QuoteSummaryRaw;
  regularMarketChangePercent?: QuoteSummaryRaw;   // raw — Yahoo 페이지 표시값 (선물 등에선 prevClose 계산과 다를 수 있음)
  preMarketPrice?: QuoteSummaryRaw;
  postMarketPrice?: QuoteSummaryRaw;
  postMarketChangePercent?: QuoteSummaryRaw;
  regularMarketTime?: number;
  postMarketTime?: number;
  preMarketTime?: number;
  marketState?: string;
  currency?: string;
}
interface QuoteSummaryResponse {
  quoteSummary?: {
    result?: { price?: QuoteSummaryPrice }[] | null;
  };
}

function _val(x: QuoteSummaryRaw | undefined): number | undefined {
  if (!x || typeof x.raw !== "number") return undefined;
  return x.raw;
}
function _isValid(n: number | undefined): n is number {
  return typeof n === "number" && !Number.isNaN(n) && n !== 0;
}

export async function fetchYahooQuote(symbol: string, name: string): Promise<UsIndex | null> {
  const target = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=price`;
  try {
    const resp = await fetchProxied(target);
    if (!resp.ok) return null;
    const data = await resp.json() as QuoteSummaryResponse;
    const p = data.quoteSummary?.result?.[0]?.price;
    if (!p) return null;

    const regP = _val(p.regularMarketPrice);
    const regPrev = _val(p.regularMarketPreviousClose);
    const preP = _val(p.preMarketPrice);
    const postP = _val(p.postMarketPrice);
    const state = (p.marketState ?? "").toUpperCase();

    // 데스크톱 v2 _fast_quote 동일 분기:
    // PRE  → price=preMarketPrice,  base=regularMarketPrice (직전 정규장 종가)
    // POST → price=postMarketPrice, base=regularMarketPrice (오늘 정규장 종가)
    // 그 외 (REGULAR / CLOSED) → price=regularMarketPrice, base=regularMarketPreviousClose
    let price: number;
    let prev: number;
    if (state === "PRE" && _isValid(preP) && _isValid(regP)) {
      price = preP; prev = regP;
    } else if (state === "POST" && _isValid(postP) && _isValid(regP)) {
      price = postP; prev = regP;
    } else if (_isValid(regP)) {
      price = regP;
      prev = _isValid(regPrev) ? regPrev : regP;
    } else {
      return null;
    }

    // tradeDate (KST)
    let tradeDate = "";
    if (typeof p.regularMarketTime === "number") {
      const kstMs = p.regularMarketTime * 1000 + 9 * 3600 * 1000;
      tradeDate = new Date(kstMs).toISOString().slice(0, 10);
    }

    // 색상용 prevClose 보존 — 비거래일 보정 전 원래 값
    const prevClose = prev;

    // 시간외 (after-hours) 가격 — 정규 종가(regP) 대비 변동률 계산
    let postPrice: number | undefined;
    let postPct: number | undefined;
    if (_isValid(postP) && _isValid(regP) && regP > 0 && postP !== regP) {
      postPrice = postP;
      postPct = ((postP - regP) / regP) * 100;
    }

    // 비거래일 보정 — KR(.KS/.KQ/^KS*/^KQ*) 만 적용.
    // 한국 종목/지수는 장 마감 후 새 가격이 안 들어오면 그냥 % 0 으로 가리는 게 자연스러움.
    // 미국/글로벌/선물/원자재/환율 등은 선행지수 의미가 있어 마지막 정규장 종가 기준 % 그대로 유지.
    // (저유동성 미국 ETF 의 경우 정규장 중에도 tradeDate 가 어제로 잡힐 수 있어 KR 만 보정)
    const isKr = /\.K[SQ]$|^\^K[SQ]/.test(symbol);
    if (isKr && state === "CLOSED" && tradeDate) {
      const todayKst = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
      if (tradeDate !== todayKst) {
        prev = price;  // 비거래일 → 어제대비 0
      }
    }

    const diff = price - prev;
    const pct = prev > 0 ? (diff / prev) * 100 : 0;

    // 정규장 종가/변동률 — Yahoo regularMarketPrice + raw changePercent 우선 사용
    // (선물 등 일부 종목은 prevClose 계산과 changePercent 가 일치 안 함 → raw 사용)
    let regularPrice: number | undefined;
    let regularPct: number | undefined;
    if (_isValid(regP)) {
      regularPrice = regP;
      const rawPct = _val(p.regularMarketChangePercent);
      if (_isValid(rawPct)) {
        regularPct = rawPct * 100;  // Yahoo 는 fraction (0.005552 = 0.5552%)
      } else if (_isValid(regPrev) && regPrev > 0) {
        regularPct = ((regP - regPrev) / regPrev) * 100;
      }
    }

    // 실제 마지막 갱신 시각 — 정규/애프터/프리 중 가장 최신 (시간외 거래중이면 regularMarketTime 은 정규 종가에 고정되므로 post/preMarketTime 이 더 최신).
    const freshTime = [p.regularMarketTime, p.postMarketTime, p.preMarketTime]
      .filter((t): t is number => typeof t === "number" && t > 0)
      .reduce<number | undefined>((mx, t) => (mx == null || t > mx ? t : mx), undefined);

    return {
      symbol, name, price, prev, prevClose, diff, pct,
      currency: p.currency, tradeDate, regularMarketTime: p.regularMarketTime, freshTime, marketState: state,
      postPrice, postPct, regularPrice, regularPct,
    };
  } catch {
    return null;
  }
}

// Yahoo v7 quote — 다심볼 배치 (1요청에 ~40심볼). quoteSummary 심볼당 1콜 → 배치로 폴링당 요청수 급감.
// Worker 가 v7 crumb 자동 처리(needsYahooAuth). v10 과 차이:
//  · 값이 flat (regularMarketPrice: 123.4, {raw} 래핑 없음)
//  · regularMarketChangePercent 가 이미 퍼센트 단위 (v10 fraction 처럼 ×100 안 함)
interface V7Quote {
  symbol?: string;
  regularMarketPrice?: number;
  regularMarketPreviousClose?: number;
  regularMarketChangePercent?: number;   // 이미 % (예: 0.3545 = 0.3545%)
  preMarketPrice?: number;
  postMarketPrice?: number;
  regularMarketTime?: number;
  postMarketTime?: number;
  preMarketTime?: number;
  marketState?: string;
  currency?: string;
}
interface V7Response { quoteResponse?: { result?: V7Quote[] | null } }

const YAHOO_V7_CHUNK = 40;   // URL 길이 한도 — 40심볼/요청

function _vnum(x: number | undefined): number | undefined {
  return typeof x === "number" && Number.isFinite(x) ? x : undefined;
}

// v7 단일 quote → UsIndex. fetchYahooQuote(v10) 와 동일 분기 (flat 필드 + changePercent ×100 제거).
function v7QuoteToUsIndex(q: V7Quote, name: string): UsIndex | null {
  const symbol = q.symbol;
  if (!symbol) return null;
  const regP = _vnum(q.regularMarketPrice);
  const regPrev = _vnum(q.regularMarketPreviousClose);
  const preP = _vnum(q.preMarketPrice);
  const postP = _vnum(q.postMarketPrice);
  const state = (q.marketState ?? "").toUpperCase();

  let price: number;
  let prev: number;
  if (state === "PRE" && _isValid(preP) && _isValid(regP)) {
    price = preP; prev = regP;
  } else if (state === "POST" && _isValid(postP) && _isValid(regP)) {
    price = postP; prev = regP;
  } else if (_isValid(regP)) {
    price = regP;
    prev = _isValid(regPrev) ? regPrev : regP;
  } else {
    return null;
  }

  let tradeDate = "";
  if (typeof q.regularMarketTime === "number") {
    const kstMs = q.regularMarketTime * 1000 + 9 * 3600 * 1000;
    tradeDate = new Date(kstMs).toISOString().slice(0, 10);
  }
  const prevClose = prev;

  let postPrice: number | undefined;
  let postPct: number | undefined;
  if (_isValid(postP) && _isValid(regP) && regP > 0 && postP !== regP) {
    postPrice = postP;
    postPct = ((postP - regP) / regP) * 100;
  }

  // 비거래일 보정 — KR(.KS/.KQ/^KS*/^KQ*) 만 (fetchYahooQuote 와 동일)
  const isKr = /\.K[SQ]$|^\^K[SQ]/.test(symbol);
  if (isKr && state === "CLOSED" && tradeDate) {
    const todayKst = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    if (tradeDate !== todayKst) prev = price;
  }

  const diff = price - prev;
  const pct = prev > 0 ? (diff / prev) * 100 : 0;

  let regularPrice: number | undefined;
  let regularPct: number | undefined;
  if (_isValid(regP)) {
    regularPrice = regP;
    const rawPct = _vnum(q.regularMarketChangePercent);
    if (rawPct !== undefined) {
      regularPct = rawPct;   // v7 은 이미 퍼센트 (v10 처럼 ×100 안 함)
    } else if (_isValid(regPrev) && regPrev > 0) {
      regularPct = ((regP - regPrev) / regPrev) * 100;
    }
  }

  const freshTime = [q.regularMarketTime, q.postMarketTime, q.preMarketTime]
    .filter((t): t is number => typeof t === "number" && t > 0)
    .reduce<number | undefined>((mx, t) => (mx == null || t > mx ? t : mx), undefined);

  return {
    symbol, name, price, prev, prevClose, diff, pct,
    currency: q.currency, tradeDate, regularMarketTime: q.regularMarketTime, freshTime, marketState: state,
    postPrice, postPct, regularPrice, regularPct,
  };
}

// 전 심볼 Yahoo 베이스 — 40개씩 청크 병렬 (요청 수: 심볼수/40 ≈ 2콜). 순서 무관(호출측이 symbol 으로 머지).
async function fetchYahooBatchQuote(
  pairs: { symbol: string; name: string }[]
): Promise<(UsIndex | null)[]> {
  if (pairs.length === 0) return [];
  const nameBySymbol = new Map(pairs.map(p => [p.symbol, p.name]));
  const chunks: { symbol: string; name: string }[][] = [];
  for (let i = 0; i < pairs.length; i += YAHOO_V7_CHUNK) {
    chunks.push(pairs.slice(i, i + YAHOO_V7_CHUNK));
  }
  const settled = await Promise.allSettled(chunks.map(async chunk => {
    const symbols = chunk.map(p => encodeURIComponent(p.symbol)).join(",");
    const target = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols}`;
    const resp = await fetchProxied(target);
    if (!resp.ok) return [] as V7Quote[];
    const data = await resp.json() as V7Response;
    return data.quoteResponse?.result ?? [];
  }));

  const out: (UsIndex | null)[] = [];
  for (const s of settled) {
    if (s.status !== "fulfilled") continue;
    for (const q of s.value) {
      const idx = v7QuoteToUsIndex(q, (q.symbol && nameBySymbol.get(q.symbol)) || q.symbol || "");
      if (idx) out.push(idx);
    }
  }
  return out;
}

// Yahoo chart v8 — 일봉 종가 시계열 (스파크라인용)
// 예: fetchYahooChart("^GSPC", "3mo") → [7100, 7110, 7150, ...]
interface ChartResp {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: (number | null)[] }> };
    }> | null;
  };
}
export async function fetchYahooChart(
  symbol: string,
  range = "3mo",
  interval = "1d",
): Promise<number[]> {
  const target = `https://query1.finance.yahoo.com/v8/finance/chart/`
              + `${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
  try {
    const resp = await fetchProxied(target);
    if (!resp.ok) return [];
    const data = await resp.json() as ChartResp;
    const closes = data.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    // null 제거 (장 정지일·휴장 등)
    return closes.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  } catch {
    return [];
  }
}

// Yahoo 분봉 (intraday) — timestamp 포함. 시간대 겹침(intraday overlay) 차트용.
// 5분봉은 Yahoo 가 최대 ~60일 제공 → range="1mo"(약 20거래일) 권장.
// 반환: { t: epoch초(UTC), close } 배열 (null 봉 제외, 시간순).
export interface IntradayBar { t: number; close: number; }
export async function fetchYahooIntraday(
  symbol: string,
  range = "1mo",
  interval = "5m",
): Promise<IntradayBar[]> {
  // includePrePost=true — KR 은 프리마켓 미제공이지만 마감 동시호가(15:20~15:30)까지 더 완전하게 들어옴
  const target = `https://query1.finance.yahoo.com/v8/finance/chart/`
              + `${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=true`;
  try {
    const resp = await fetchProxied(target);
    if (!resp.ok) return [];
    const data = await resp.json() as ChartResp;
    const r = data.chart?.result?.[0];
    const ts = r?.timestamp ?? [];
    const closes = r?.indicators?.quote?.[0]?.close ?? [];
    const out: IntradayBar[] = [];
    for (let i = 0; i < ts.length; i++) {
      const c = closes[i];
      if (typeof c === "number" && Number.isFinite(c)) out.push({ t: ts[i], close: c });
    }
    return out;
  } catch {
    return [];
  }
}

// KR 6자리 → 분봉. KOSPI(.KS)/KOSDAQ(.KQ) 둘 다 받아 봉이 많은 쪽 선택.
// (KOSDAQ 을 .KS 로 받으면 빈값/노이즈 5~20봉만 나와 fetchKrPriceHistory 의 ">0" 폴백으론 부족 → 개수 비교)
export async function fetchKrIntraday(
  ticker: string, range = "1mo", interval = "5m",
): Promise<IntradayBar[]> {
  if (!/^[\dA-Za-z]{6}$/.test(ticker)) return [];   // 영숫자 신형 ETF 코드(0167A0 등) 포함
  const [ks, kq] = await Promise.all([
    fetchYahooIntraday(`${ticker}.KS`, range, interval),
    fetchYahooIntraday(`${ticker}.KQ`, range, interval),
  ]);
  return ks.length >= kq.length ? ks : kq;
}

// Yahoo ^지수 → 토스 indices 코드 매핑 (현재가만 토스, 없으면 Yahoo fallback)
// 차트(스파크라인)는 토스 API 가 인증벽이라 계속 Yahoo 사용.
const TOSS_INDEX_CODE: Record<string, string> = {
  "^KS11":  "KGG01P",    // KOSPI 종합
  "^KQ11":  "QGG01P",    // KOSDAQ 종합
  "^SOX":   "SOX.NAI",   // 필라델피아 반도체 지수
  "^IXIC":  "COMP.NAI",  // 나스닥 종합
  "^GSPC":  "SPX.CBI",   // S&P 500
  "^DJI":   "DJI.DJI",   // 다우존스
  "NQ=F":   "RFU.NQc1",  // 나스닥 선물
  "ES=F":   "RFU.ESc1",  // S&P 500 선물
  "RTY=F":  "RFU.RTYc1", // 러셀2000 선물
  "^VIX":   "RGI..VIX",  // VIX 변동성
  "DX-Y.NYB": "RGI..DXY", // 달러 인덱스
  // 미국 국채금리 — 2Y(정책 기대)·10Y(벤치마크). 2Y-10Y 역전 = 침체 신호.
  "^US2Y":  "ROB.US2YT-RR",  // 미국 2년 금리 (Yahoo 차트 티커 없음 — 토스 값만)
  "^TNX":   "ROB.US10YT-RR", // 미국 10년 금리 (차트 = Yahoo ^TNX)
  "^FVX":   "ROB.US5YT-RR",  // 미국 5년 (대시보드 미표시, 매핑만 보존)
  "^TYX":   "ROB.US30YT-RR", // 미국 30년 (대시보드 미표시, 매핑만 보존)
  // 원자재 선물 — 토스 overview 원자재 카테고리 (USD 값). 야후 대신 토스로 일원화.
  "GC=F":   "RFU.GCv1",   // 금
  "SI=F":   "RFU.SIv1",   // 은
  "CL=F":   "RFU.CLv1",   // WTI 원유
  "NG=F":   "RFU.NGv1",   // 천연가스
  "HG=F":   "RFU.HGv1",   // 구리
  // 비트코인 — 토스는 원화(VWAP.KRW-BTC) 기준. BTC-USD 심볼이지만 원화로 표시.
  "BTC-USD": "VWAP.KRW-BTC",
};

// Yahoo 심볼 → 토스 미국 종목 코드 (현재가만 토스, 없으면 Yahoo fallback).
// 토스 stock-prices/details (US 코드) — 24시간/시간외 거래값 포함.
const TOSS_US_STOCK_CODE: Record<string, string> = {
  // 빅테크 개별주
  "SPCX": "NAS2606012004",   // 스페이스X
  "AAPL": "US19801212001",
  "MSFT": "US19860313001",
  "GOOGL":"US20040819002",
  "AMZN": "US19970515001",
  "META": "US20120518001",
  "TSLA": "US20100629001",
  // 반도체 개별주
  "MU":   "US19890516001",
  "NVDA": "US19990122001",
  "SNDK": "NAS0250224006",   // 샌디스크 (2025 상장 → NAS 프리픽스)
  "SKHYV":"NAS2607010002",   // SK하이닉스 ADR (2026 상장 → NAS 프리픽스) — 원화 시세용
  "AMAT": "US19721012001",
  "LRCX": "US19840504001",
  "ASML": "US19950315001",
  "AMD":  "US20150102001",
  "AVGO": "US20090806002",
  "ORCL": "US19860312001",
  "INTC": "US19711013001",
  "QCOM": "US19911213001",
  // 미국 ETF
  "SPY":  "US19930122001",
  "QQQ":  "US19990310001",
  "DIA":  "US19980120001",
  "IWM":  "US20000526007",
  "VTI":  "US20010531001",
  "SMH":  "US20191211007",
  "PAVE": "US20170308001",
  "LIT":  "US20100723002",
  "XBI":  "US20060206001",
  "KBE":  "US20051115001",
  "ITA":  "US20060505010",
  "XLV":  "US19981222008",
  "KOID": "NAS0250605002",   // KraneShares 휴머노이드·피지컬AI
  "BOTZ": "US20160913001",
  "EWY":  "US20000512001",   // MSCI Korea — 외국인 투심 (Blue Ocean 24h 오버나잇)
};

// 토스 US 종목 가격(기존 fetchTossUsPrices) → UsIndex 변환. 현재가 = close, 기준 = base.
async function fetchTossUsIndexMap(
  items: { symbol: string; name: string; code: string }[],
): Promise<Map<string, UsIndex>> {
  const out = new Map<string, UsIndex>();
  if (items.length === 0) return out;
  const priceByCode = await fetchTossUsPrices(items.map(i => i.code));
  // 애프터장(16:00~20:00 ET): close 는 정규 종가로 고정, 체결은 afterMarketClose 로만 들어옴 → 메인을 애프터값으로.
  const afterOpen = isUsAfterMarketOpen();
  for (const it of items) {
    const tp = priceByCode.get(it.code);
    if (!tp) continue;
    // 토스 앱과 동일하게 환산 원화로 표시. closeKrw 없으면(폴백) 달러 그대로.
    const hasKrw = tp.closeKrw > tp.close;   // 원화는 달러 × ~1500 → 항상 큼
    const liveKrw = hasKrw ? tp.closeKrw : tp.close;   // 토스 close(원화) = 현재가 (정규·프리·오버나잇 땐 live, 애프터·휴장 땐 정규 종가)
    const baseKrw = hasKrw ? tp.baseKrw  : tp.base;    // 토스 base(원화) = 기준가
    // 토스 close 가 '라이브 비정규' 인 세션(오버나잇·프리마켓) 여부 — 이땐 정규 종가가 base 에 들어옴.
    //   (애프터장 16:00~20:00 ET·휴장 땐 close 가 정규 종가 그대로 → 그때만 close 가 마감가)
    const closeIsLive = isUsExtendedTradingOpen() && !afterOpen;
    // 정규장 마감가(책갈피용): close 가 라이브면 base(직전 정규 종가), 아니면 close 자체가 정규 종가.
    const regClose    = closeIsLive ? baseKrw : liveKrw;
    const regCloseUsd = closeIsLive ? tp.base : tp.close;
    // 애프터장 거래중이고 애프터값(원화)이 있으면 메인 = 애프터 현재가, 아니면 close(라이브 or 정규 종가).
    const useAfter = hasKrw && afterOpen && tp.afterCloseKrw > 0;
    const price = useAfter ? tp.afterCloseKrw : liveKrw;
    // 변동 기준: 애프터장은 토스 앱처럼 '정규 종가 대비'(애프터 세션 변동), 오버나잇/프리도 정규 종가(base) 대비, 정규/휴장은 어제(base) 대비.
    const base = useAfter ? regClose : baseKrw;
    const diff = price - base;
    const pct = base > 0 ? (diff / base) * 100 : 0;
    // 마감 책갈피 등락률 = 정규 종가의 전일대비. 오버나잇/프리엔 전전일 종가가 없어 계산 불가 → undefined(머지 시 Yahoo regularPct 폴백).
    const regPct = closeIsLive
      ? undefined
      : (baseKrw > 0 ? ((regClose - baseKrw) / baseKrw) * 100 : undefined);
    out.set(it.symbol, {
      symbol: it.symbol, name: it.name,
      price, prev: base, prevClose: base,
      diff, pct, currency: hasKrw ? "KRW" : "USD",
      // 달러 보조표기 — 현재가 달러(실시간: 현재 원가 × 환율) / 마감 달러(정규 종가 USD)
      priceUsd: (hasKrw && tp.closeKrw > 0) ? price * (tp.close / tp.closeKrw) : tp.close,
      regularPriceUsd: regCloseUsd,
      tradeDate: tp.tradeDateTime ? toKstDateString(tp.tradeDateTime) : "",
      // 토스 tradeDateTime = 실측 마지막 체결시각(체결 있을 때만 전진, 무체결 종목은 멈춤 — 폴링 검증됨).
      //   24h(Blue Ocean) 거래 중엔 계속 갱신 → 정체 판정에서 통과(밝게). 진짜 끊기면 흐림.
      freshTime: isoToUnixSec(tp.tradeDateTime),
      marketState: "",
      // 마감 책갈피 = 토스 정규 종가(원화) — 애프터장엔 메인(애프터)과 별개로 정규 종가 표시. Yahoo 달러값 대체.
      regularPrice: regClose, regularPct: regPct,
    });
  }
  return out;
}

// 토스 대시보드 overview — 주가지수/환율/금리/원자재/가상자산을 1콜로 일괄 수신.
// (기존 fetchTossIndexPrice 심볼당 1콜 + fetchTossExchangeRate 를 대체 → 폴링당 요청수 급감)
const TOSS_OVERVIEW_URL =
  "https://wts-cert-api.tossinvest.com/api/v3/dashboard/wts/overview/indicator/mini-chart";

// 토스 코드 → 우리 야후 심볼 (TOSS_INDEX_CODE 역매핑 + 환율 특수 코드)
const TOSS_CODE_TO_SYMBOL: Record<string, string> = (() => {
  const m: Record<string, string> = { EXCHANGE_RATE: "KRW=X" };  // 달러 환율 → KRW=X
  for (const [sym, code] of Object.entries(TOSS_INDEX_CODE)) m[code] = sym;
  return m;
})();

interface TossOverviewItem {
  code?: string;
  price?: { latestPrice?: number; basePrice?: number };
  miniChart?: { candles?: { price?: number }[] };
}
interface TossOverviewResp {
  result?: { indexMap?: Record<string, TossOverviewItem[]> };
}

// 1콜 → Map<야후심볼, UsIndex>. 실패하면 빈 Map (호출측에서 Yahoo base 가 폴백).
async function fetchTossOverview(): Promise<Map<string, UsIndex>> {
  const out = new Map<string, UsIndex>();
  try {
    const resp = await fetchProxied(TOSS_OVERVIEW_URL);
    if (!resp.ok) return out;
    const data = await resp.json() as TossOverviewResp;
    const indexMap = data.result?.indexMap;
    if (!indexMap) return out;
    const todayKst = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    for (const arr of Object.values(indexMap)) {
      if (!Array.isArray(arr)) continue;
      for (const it of arr) {
        const sym = it.code ? TOSS_CODE_TO_SYMBOL[it.code] : undefined;
        if (!sym || out.has(sym)) continue;   // SOX.NAI 등 중복 카테고리 — 먼저 본 것 유지
        const close = it.price?.latestPrice;
        const base = it.price?.basePrice;
        if (typeof close !== "number" || typeof base !== "number") continue;
        const diff = close - base;
        const pct = base > 0 ? (diff / base) * 100 : 0;
        // mini-chart 캔들 close 시계열 — Yahoo 가 차트 안 주는 심볼(^US2Y)의 sparkline 폴백용
        const candles = it.miniChart?.candles;
        const sparkline = Array.isArray(candles)
          ? candles.map(c => c.price).filter((v): v is number => typeof v === "number" && Number.isFinite(v))
          : [];
        out.set(sym, {
          symbol: sym, name: sym === "KRW=X" ? "USD/KRW" : sym,  // name 은 merge 시 pairs(야후) 쪽 우선
          price: close, prev: base, prevClose: base,
          diff, pct, currency: "KRW",
          // 마감 책갈피도 토스값으로 — 통화 일관(특히 BTC 원화). 미설정 시 Yahoo USD 책갈피가 남아 단위 혼선.
          regularPrice: close, regularPct: pct,
          tradeDate: todayKst, marketState: "",
          sparkline: sparkline.length > 1 ? sparkline : undefined,
        });
      }
    }
  } catch { /* Yahoo base 폴백 */ }
  return out;
}

// CNBC — Yahoo/토스에 없는 지수 (VKOSPI 등).
//
// 구 소스였던 api.investing.com 은 Cloudflare 봇 챌린지(cf-mitigated: challenge)가 엣지에 걸려
// 데이터센터 IP 에서 전면 403 이다. 브라우저 UA·Referer·domain-id·Bearer 토큰 다 붙여도, 프록시
// (Cloudflare/Netlify/Supabase) 를 태워도 뚫리지 않는다. → CNBC 로 교체.
//
// CNBC 는 두 엔드포인트 모두 ACAO: * 라 프록시 없이 브라우저가 직접 호출한다(프록시 호출수 절약).
const CNBC_SYMBOL: Record<string, string> = {
  "VKOSPI": ".KSVKOSPI",   // 코스피200 변동성지수 (한국 공포지수)
};
export function isCnbcIndex(symbol: string): boolean {
  return symbol in CNBC_SYMBOL;
}

const CNBC_TIMEOUT_MS = 8000;
async function fetchCnbcJson<T>(url: string): Promise<T | null> {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(CNBC_TIMEOUT_MS) });
    if (!resp.ok) return null;
    return await resp.json() as T;
  } catch {
    return null;
  }
}
// CNBC 응답은 수치도 전부 문자열("78.15", "-8.58%") → 숫자로 강제 변환
function cnbcNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const n = parseFloat(v.replace(/[%,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

interface CnbcQuote {
  last?: string; previous_day_closing?: string; change?: string; change_pct?: string;
  last_time?: string;
}
// 현재가 — 가볍다(~1KB). 폴링 주기마다 호출되는 경로라 차트(43KB) 대신 이쪽을 쓴다.
async function fetchCnbcIndexPrice(symbol: string, name: string): Promise<UsIndex | null> {
  const cnbcSym = CNBC_SYMBOL[symbol];
  if (!cnbcSym) return null;
  const url = "https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol"
    + `?symbols=${encodeURIComponent(cnbcSym)}`
    + "&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json&events=1";
  const data = await fetchCnbcJson<{
    FormattedQuoteResult?: { FormattedQuote?: CnbcQuote[] };
  }>(url);
  const q = data?.FormattedQuoteResult?.FormattedQuote?.[0];
  if (!q) return null;

  const price = cnbcNum(q.last);
  const prevClose = cnbcNum(q.previous_day_closing);
  if (price === null || prevClose === null) return null;
  const diff = cnbcNum(q.change) ?? price - prevClose;
  const pct = cnbcNum(q.change_pct) ?? (prevClose > 0 ? (diff / prevClose) * 100 : 0);

  // last_time 은 KST 오프셋 포함 ISO ("2026-07-10T15:51:10.000+0900") — 실측 체결시각.
  const lastMs = q.last_time ? Date.parse(q.last_time) : NaN;
  const tradeDate = Number.isFinite(lastMs)
    ? new Date(lastMs + 9 * 3600_000).toISOString().slice(0, 10)   // KST 일자
    : new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

  return {
    symbol, name, price, prev: prevClose, prevClose,
    diff, pct, currency: "", tradeDate, marketState: "",
    regularMarketTime: Number.isFinite(lastMs) ? Math.floor(lastMs / 1000) : undefined,
    // freshTime 미설정 — VKOSPI 는 장 마감 후 시각이 멈춘다. 정체로 오판하지 않도록
    //   KR 세션 로직(isMarketOpen)으로 흐림 판정 폴백. (구 investing 구현과 동일한 판단)
  };
}

// 일봉 — CNBC 의 timeRange 라벨은 실제 기간과 다르다. 실측(2026-07 기준):
//   "1M" → 일봉 244봉(약 1년) · "1Y" → 일봉 485봉(약 2년) · "5Y" → 주봉 522봉(약 10년)
// 1년치 일봉이 필요하므로 "1M" 이 맞다.
const CNBC_CHART_HASH = "9e1670c29a10707c417a1efd327d4b2b1d456b77f1426e7e84fb7d399416bb6b";
interface CnbcBar {
  open?: string; high?: string; low?: string; close?: string;
  tradeTime?: string;        // "20260710000000" — 당일 미완성 봉도 항상 채워짐
  tradeTimeinMills?: string | null;   // 당일 미완성 봉은 null → 날짜 산출에 쓰면 안 됨
}
async function fetchCnbcBars(symbol: string): Promise<CnbcBar[]> {
  const cnbcSym = CNBC_SYMBOL[symbol];
  if (!cnbcSym) return [];
  const variables = JSON.stringify({ symbol: cnbcSym, timeRange: "1M" });
  const extensions = JSON.stringify({ persistedQuery: { version: 1, sha256Hash: CNBC_CHART_HASH } });
  const url = "https://webql-redesign.cnbcfm.com/graphql?operationName=getQuoteChartData"
    + `&variables=${encodeURIComponent(variables)}`
    + `&extensions=${encodeURIComponent(extensions)}`;
  const data = await fetchCnbcJson<{
    data?: { chartData?: { priceBars?: CnbcBar[] } };
  }>(url);
  const bars = data?.data?.chartData?.priceBars;
  return Array.isArray(bars) ? bars : [];
}

// 차트(스파크라인)용 종가 시계열
export async function fetchCnbcChart(symbol: string): Promise<number[]> {
  const bars = await fetchCnbcBars(symbol);
  return bars.map(b => cnbcNum(b.close)).filter((v): v is number => v !== null);
}

// 일자 정렬용 종가 시계열 (PricePoint[]) — VKOSPI 등 오버레이용.
// lightweight-charts setData 는 시간 오름차순·중복 없는 데이터 필수 → 일자별 dedupe + 정렬.
export async function fetchCnbcPriceHistory(symbol: string): Promise<PricePoint[]> {
  const bars = await fetchCnbcBars(symbol);
  const byDate = new Map<string, PricePoint>();
  for (const b of bars) {
    const close = cnbcNum(b.close);
    // tradeTimeinMills 는 당일 봉에서 null 이라 tradeTime("YYYYMMDD...") 을 날짜 근거로 쓴다
    const t = b.tradeTime;
    if (close === null || typeof t !== "string" || !/^\d{8}/.test(t)) continue;
    const date = `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
    byDate.set(date, {                                  // 같은 날짜는 최신값
      date, close, volume: 0,
      open: cnbcNum(b.open) ?? close,
      high: cnbcNum(b.high) ?? close,
      low: cnbcNum(b.low) ?? close,
    });
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

// 토스 원달러 환율 — base(당일 09:00 고시 기준가) + close(실시간 현재가).
//   Yahoo/yasun forex(KRW=X)는 기준점을 새벽 FX 롤오버(~02시 KST)로 리셋해 변동률이 ~0%로 어긋남.
//   토스는 '어제 종가' 기준이라 토스 환율 페이지 표시값(-1.x%)과 일치.
export async function fetchTossExchangeRate(): Promise<UsIndex | null> {
  const url = "https://wts-info-api.tossinvest.com/api/v1/product/exchange-rate?buyCurrency=USD&sellCurrency=KRW";
  try {
    const resp = await fetchProxied(url);
    if (!resp.ok) return null;
    const data = await resp.json() as { result?: { base?: number; close?: number } };
    const r = data.result;
    if (!r || typeof r.close !== "number" || typeof r.base !== "number" || r.base <= 0) return null;
    const price = r.close, base = r.base;
    const diff = price - base;
    return {
      symbol: "KRW=X", name: "USD/KRW",
      price, prev: base, prevClose: base,
      diff, pct: (diff / base) * 100, currency: "KRW",
      tradeDate: new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10),
      marketState: "",
    };
  } catch {
    return null;
  }
}

// 다수 심볼 한꺼번에 — 병렬 fetch.
// 정책: 현재가 = 토스(가능하면), 차트·정규장 마감가(regularPrice/마감 책갈피) = Yahoo.
//   - Yahoo 를 모든 심볼에 대해 받아 베이스로 사용 (regularPrice/marketState/prevClose 확보)
//   - 토스로 값 받는 심볼은 price/pct 만 토스로 덮고 marketState="" (토스값이 메인),
//     regularPrice/regularPct 는 Yahoo 값 유지 → 장 마감 후 "마감가 책갈피" 표시 가능
//   - 토스 실패 시 Yahoo 전체 entry 가 그대로 남아 자동 fallback
// 라우팅: .KS 6자리(KODEX 등)·KOSPI/KOSDAQ/필반·미국지수/선물·미국ETF → 토스 현재가
export async function fetchYahooBatch(
  pairs: { symbol: string; name: string }[]
): Promise<Map<string, UsIndex>> {
  // 신형 ETF 는 영숫자 코드(예: 0190C0) — 숫자 6자리로 좁히면 Toss 경로에서 누락됨
  const ksRegex = /^([\dA-Za-z]{6})\.KS$/;
  const ksItems = pairs.filter(p => ksRegex.test(p.symbol));
  const tossUsItems = pairs
    .filter(p => TOSS_US_STOCK_CODE[p.symbol])
    .map(p => ({ ...p, code: TOSS_US_STOCK_CODE[p.symbol] }));
  const investItems = pairs.filter(p => isCnbcIndex(p.symbol));

  const [ksMap, overviewMap, usMap, investResults, yahooResults] = await Promise.all([
    ksItems.length > 0
      ? fetchTossPrices(ksItems.map(p => ksRegex.exec(p.symbol)![1]))
          .then(prices => {
            const out = new Map<string, UsIndex>();
            const metaByCode = new Map(
              ksItems.map(p => [ksRegex.exec(p.symbol)![1], p])
            );
            for (const tp of prices) {
              const m = metaByCode.get(tp.ticker);
              if (!m) continue;
              const diff = tp.price - tp.base;
              const pct = tp.base > 0 ? (diff / tp.base) * 100 : 0;
              out.set(m.symbol, {
                symbol: m.symbol, name: m.name,
                price: tp.price, prev: tp.base, prevClose: tp.prevClose,
                diff, pct, currency: "KRW",
                tradeDate: tp.trade_date, freshTime: isoToUnixSec(tp.trade_dt),
                marketState: "",
              });
            }
            return out;
          })
          .catch(() => new Map<string, UsIndex>())
      : Promise.resolve(new Map<string, UsIndex>()),
    // 토스 overview 1콜 — 지수/환율/금리/원자재/BTC 일괄 (기존 인덱스 14콜 + FX 대체)
    fetchTossOverview(),
    fetchTossUsIndexMap(tossUsItems),
    Promise.all(investItems.map(p => fetchCnbcIndexPrice(p.symbol, p.name))),
    // 모든 심볼 Yahoo 베이스 — v7 배치(~2콜). marketState/prevClose + 토스 실패 시 fallback
    fetchYahooBatchQuote(pairs),
  ]);

  // 1) Yahoo 결과를 베이스로
  const merged = new Map<string, UsIndex>();
  for (const r of yahooResults) {
    if (r) merged.set(r.symbol, r);
  }

  // 2) 토스 현재가로 price/pct 덮어쓰되 Yahoo 의 regularPrice/regularPct 는 유지 (마감 책갈피용)
  const applyToss = (sym: string, t: UsIndex) => {
    const y = merged.get(sym);
    if (!y) { merged.set(sym, t); return; }   // Yahoo 없으면 토스 단독
    merged.set(sym, {
      ...y,                        // regularPrice/regularPct/postPrice 유지 (마감 책갈피용)
      price: t.price,              // 현재가 = 토스
      prev: t.prev,
      prevClose: t.prevClose,      // 기준 종가도 토스 base → 변동률이 토스와 동일 (현재가 vs 토스 base)
      diff: t.diff,
      pct: t.pct,
      // 토스가 마감 책갈피값을 주면(미국 종목=원화) Yahoo 달러값 대신 토스값 사용 → 통화 일관.
      //   안 주면(한국 종목 등) Yahoo 정규 종가 유지.
      regularPrice: t.regularPrice ?? y.regularPrice,
      regularPct: t.regularPct ?? y.regularPct,
      postPrice: t.postPrice ?? y.postPrice,
      currency: t.currency ?? y.currency,
      priceUsd: t.priceUsd ?? y.priceUsd,   // 달러 보조표기값 유지
      regularPriceUsd: t.regularPriceUsd ?? y.regularPriceUsd,
      tradeDate: t.tradeDate || y.tradeDate,
      freshTime: t.freshTime ?? y.freshTime,   // 토스가 메인값 → 토스 체결시각이 실제 갱신 기준
      marketState: "",             // 빈값 → 카드가 토스 현재가를 메인으로 표시
      sparkline: t.sparkline ?? y.sparkline,   // 토스 mini-chart 시계열 (^US2Y sparkline 폴백)
    });
  };
  for (const [sym, t] of ksMap) applyToss(sym, t);
  for (const [sym, t] of overviewMap) applyToss(sym, t);   // 지수/환율/금리/원자재/BTC (overview 1콜)
  for (const [sym, t] of usMap) applyToss(sym, t);
  for (const r of investResults) { if (r) applyToss(r.symbol, r); }

  return merged;
}

// 헤더용 핵심 6종 (deprecated: UsMarketTab 으로 통합 가능하지만 헤더 바에서도 사용)
export async function fetchUsIndices(): Promise<UsIndex[]> {
  const list: { symbol: string; name: string }[] = [
    { symbol: "^GSPC", name: "S&P 500" },
    { symbol: "^IXIC", name: "NASDAQ" },
    { symbol: "^DJI",  name: "DOW" },
    { symbol: "^KS11", name: "KOSPI" },
    { symbol: "KRW=X", name: "USD/KRW" },
    { symbol: "^VIX",  name: "VIX" },
  ];
  const map = await fetchYahooBatch(list);
  return Array.from(map.values());
}

// 네이버 금융 HTML 파싱 — 섹터 + 컨센서스 + 기업개요
// 단일 페이지 fetch 후 모두 추출 (네트워크 1회)
export interface NaverInfo {
  sector: string;
  consensus: Consensus | null;
  description?: string[];   // #summary_info p 들 — 사업·제품·전략 짧은 문장 (출처: 에프앤가이드)
}

export async function fetchNaverInfo(ticker: string): Promise<NaverInfo> {
  const target = `https://finance.naver.com/item/main.naver?code=${ticker}`;
  const empty: NaverInfo = { sector: "", consensus: null };
  try {
    const resp = await fetchProxied(target);
    if (!resp.ok) return empty;
    const buf = await resp.arrayBuffer();
    const html = decodeHtmlBuf(buf, resp.headers.get("Content-Type") || "");
    const doc = new DOMParser().parseFromString(html, "text/html");

    // 섹터 — 동일업종 링크 텍스트
    let sector = "";
    const links = doc.querySelectorAll("a[href*='sise_group_detail']");
    if (links.length > 0) sector = links[0].textContent?.trim() || "";

    // 컨센서스 — 목표주가 th 옆 td
    let consensus: Consensus | null = null;
    const ths = doc.querySelectorAll("th");
    let targetTh: Element | null = null;
    ths.forEach(th => {
      if (!targetTh && th.textContent?.includes("목표주가")) targetTh = th;
    });
    if (targetTh) {
      const td = (targetTh as Element).nextElementSibling;
      if (td) {
        // 투자의견 점수 + 텍스트 — span.f_up / f_down 안의 em
        let score: number | undefined;
        let opinion: string | undefined;
        const fSpan = td.querySelector("span[class^='f_']");
        if (fSpan) {
          const scoreEm = fSpan.querySelector("em");
          const scoreText = scoreEm?.textContent?.trim() ?? "";
          const sNum = Number(scoreText);
          if (!Number.isNaN(sNum)) score = sNum;
          opinion = (fSpan.textContent ?? "").replace(scoreText, "").trim();
        }
        // 목표주가: td 안의 em 중 span 외부에 있는 것 (데스크톱 v2 동일)
        let targetPrice: number | undefined;
        const ems = Array.from(td.querySelectorAll("em"));
        for (const em of ems) {
          if (em.closest("span")) continue;  // span 안 (= score em) 제외
          const val = (em.textContent ?? "").trim().replace(/,/g, "");
          if (/^\d+$/.test(val)) {
            const n = Number(val);
            if (n > 0) {
              targetPrice = n;
              break;
            }
          }
        }
        consensus = { target: targetPrice, score, opinion };
      }
    }

    // 기업개요 — #summary_info 안의 <p> 들 (출처: 에프앤가이드)
    let description: string[] | undefined;
    const summaryEl = doc.querySelector("#summary_info");
    if (summaryEl) {
      const ps = Array.from(summaryEl.querySelectorAll("p"))
        .map(p => (p.textContent ?? "").trim())
        .filter(t => t.length > 0);
      if (ps.length > 0) description = ps;
    }

    return { sector, consensus, description };
  } catch {
    return empty;
  }
}

// ─── 종목 뉴스 — 네이버 모바일 증권 (m.stock.naver) ───
export interface NaverNews {
  id: string;
  title: string;
  press: string;        // 언론사
  datetime: string;     // YYYYMMDDHHmm (KST)
  url: string;          // 기사 링크
  image?: string;       // 썸네일
}

// HTML 엔티티(&quot; 등) 디코딩
function decodeHtmlEntities(s: string): string {
  if (!s || !/&/.test(s)) return s;
  try {
    return new DOMParser().parseFromString(s, "text/html").body.textContent || s;
  } catch {
    return s;
  }
}

export async function fetchNaverNews(ticker: string, size = 10): Promise<NaverNews[]> {
  const target = `https://m.stock.naver.com/api/news/stock/${ticker}?pageSize=${size}&page=1`;
  try {
    const resp = await fetchProxied(target);
    if (!resp.ok) return [];
    const groups = await resp.json() as Array<{ items?: Array<{
      officeId?: string; articleId?: string; officeName?: string;
      datetime?: string; title?: string; titleFull?: string;
      imageOriginLink?: string; mobileNewsUrl?: string;
    }> }>;
    const seen = new Set<string>();
    const out: NaverNews[] = [];
    for (const g of groups ?? []) {
      for (const it of g.items ?? []) {
        if (!it.title || !it.officeId || !it.articleId) continue;
        const id = `${it.officeId}-${it.articleId}`;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({
          id,
          title: decodeHtmlEntities(it.titleFull || it.title),
          press: it.officeName ?? "",
          datetime: it.datetime ?? "",
          url: it.mobileNewsUrl
            || `https://n.news.naver.com/mnews/article/${it.officeId}/${it.articleId}`,
          image: it.imageOriginLink,
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

// ─── 종목 검색 — 네이버 자동완성 (KOR 6자리만) ───
export interface SearchResult {
  ticker: string;
  name: string;
  market: string;          // KOSPI / KOSDAQ
}

interface NaverACItem {
  code?: string;
  name?: string;
  typeCode?: string;
  nationCode?: string;
  category?: string;
}
interface NaverACResp {
  result?: { items?: NaverACItem[] };
}

// ─── 토스 자동완성 — 자음 검색 + 부분 매칭 지원 (네이버보다 유연) ─────────
// 응답 구조가 토스 내부 변경에 민감하므로 다양한 shape 를 방어적으로 파싱.
interface TossACProduct {
  productCode?: string;            // "A005930"
  ticker?: string;                 // 일부 응답에서 직접 노출
  code?: string;
  symbol?: string;
  productName?: string;            // "삼성전자" (토스 실제 응답)
  name?: string;
  korName?: string;
  fullName?: string;
  keyword?: string;                // autocomplete 추천 키워드
  type?: string;                   // "DOMESTIC_STOCK" 등
  productType?: string;
  exchange?: string;               // KOSPI / KOSDAQ
  marketType?: string;
  market?: string;                 // "KSP" | "KSQ" 등 (토스 단축 표기)
  nationCode?: string;             // "KOR"
  countryCode?: string;
}

// 토스 단축 market 코드 → 표준 라벨
const TOSS_MARKET_LABEL: Record<string, string> = {
  KSP: "KOSPI", KSQ: "KOSDAQ", KNX: "KONEX",
  NYS: "NYSE", NSQ: "NASDAQ", NAS: "NASDAQ", AMX: "AMEX", AMS: "AMEX",
};
const KR_MARKETS = new Set(["KSP", "KSQ", "KNX", "KOSPI", "KOSDAQ", "KONEX"]);
const US_MARKETS = new Set(["NYS", "NSQ", "NAS", "AMX", "AMS", "NYSE", "NASDAQ", "AMEX"]);
// 응답을 재귀 탐색해 종목 정보를 가진 객체들을 평탄화 수집.
// 토스 실제 응답: result[].data.items[] 안에 productCode/productName/symbol/market(KSP|KSQ).
function extractTossProducts(node: unknown, acc: TossACProduct[] = []): TossACProduct[] {
  if (!node || typeof node !== "object") return acc;
  if (Array.isArray(node)) {
    for (const v of node) extractTossProducts(v, acc);
    return acc;
  }
  const o = node as Record<string, unknown>;
  // 종목 객체 인식 — productCode 또는 symbol 이 있고 productName 또는 name 있음
  const hasCode = ["productCode", "code", "ticker", "symbol"].some(k => typeof o[k] === "string");
  const hasName = ["productName", "name", "korName", "fullName", "keyword"].some(k => typeof o[k] === "string");
  if (hasCode && hasName) {
    acc.push(o as TossACProduct);
    return acc;  // 종목 객체 내부엔 더 들어갈 필요 X (중복 방지)
  }
  // 하위 객체도 탐색 (result/data/items/sections 등)
  for (const v of Object.values(o)) extractTossProducts(v, acc);
  return acc;
}

export async function searchTossAutoComplete(
  query: string, limit = 30
): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  // 토스 검색 endpoint (실제 토스 웹 사용 형식 그대로)
  const url = "https://wts-info-api.tossinvest.com/api/v3/search-all/wts-auto-complete";
  const body = JSON.stringify({
    query: q,
    sections: [
      { type: "PRODUCT", option: { addIntegratedSearchResult: true } },
    ],
  });
  try {
    const resp = await fetchProxied(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (!resp.ok) return [];
    const json = await resp.json() as unknown;
    const products = extractTossProducts(json);
    const out: SearchResult[] = [];
    const seen = new Set<string>();
    for (const it of products) {
      const productCode = (it.productCode ?? "").trim();   // KR: A005930 / US: US20100629001
      const symbol = (it.symbol ?? it.ticker ?? it.code ?? "").trim();
      const rawMarket = (it.market ?? it.exchange ?? it.marketType ?? "").toString();
      const name = (it.productName ?? it.korName ?? it.name ?? it.fullName ?? it.keyword ?? "").trim();
      let ticker = "";
      const isKr = KR_MARKETS.has(rawMarket) || (!rawMarket && /^A?[\dA-Za-z]{6}$/.test(productCode || symbol));
      if (isKr) {
        // 한국 종목·ETF — A005930 → 005930 (신형 영숫자 코드 "0192L0" 포함)
        ticker = (productCode.replace(/^A/, "") || symbol).trim();
        if (!/^[\dA-Za-z]{6}$/.test(ticker)) continue;
      } else if (US_MARKETS.has(rawMarket) || /^(US|NAS|NSQ|NYS|AMX)/.test(productCode)) {
        // 미국 등 해외 — symbol 이 ticker. 토스 내부코드(productCode) 기억 → 링크용.
        ticker = symbol;
        if (!/^[A-Za-z][A-Za-z.]{0,9}$/.test(ticker)) continue;   // 알파벳 티커만 (TSLA, BRK.B)
        // 한글 정식명이 없으면 토스가 티커를 이름으로 줌(예: VNQ) — 그대로 노출(이름=티커도 허용).
        //  (예전엔 name===ticker 를 레버리지 ETF로 보고 제외했으나 VNQ 같은 정상 ETF까지 누락돼 제거)
        if (productCode) rememberTossCode(ticker, productCode);
      } else {
        continue;   // 알 수 없는 시장 제외
      }
      if (!name || seen.has(ticker)) continue;
      seen.add(ticker);
      out.push({
        ticker, name,
        market: TOSS_MARKET_LABEL[rawMarket] ?? rawMarket ?? "",
      });
      if (out.length >= limit) break;
    }
    return out;
  } catch {
    return [];
  }
}

export async function searchNaverAutoComplete(
  query: string, limit = 20
): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const url = `https://m.stock.naver.com/front-api/search/autoComplete`
            + `?query=${encodeURIComponent(q)}&target=stock`;
  try {
    const resp = await fetchProxied(url);
    if (!resp.ok) return [];
    const json = (await resp.json()) as NaverACResp;
    const items = json.result?.items ?? [];
    const out: SearchResult[] = [];
    for (const it of items) {
      const code = (it.code ?? "").trim();
      // 한국 종목·ETF — 6자리 숫자 또는 영숫자(신형 KRX 코드).
      if (!/^[\dA-Za-z]{6}$/.test(code)) continue;
      if (it.nationCode && it.nationCode !== "KOR") continue;
      out.push({
        ticker: code,
        name: it.name ?? code,
        market: it.typeCode || "KOSPI",
      });
      if (out.length >= limit) break;
    }
    return out;
  } catch {
    return [];
  }
}

// ─── 네이버 금융 테마 검색 ─────────────────────────────
// 키워드(예: "mlcc") → 매칭되는 테마(예: "MLCC(적층세라믹콘덴서)") → 구성 종목 리스트.
// 토스 카테고리 API 는 인증 필수라 정적 앱에서 못 씀. 네이버 테마 페이지는 공개 + 프록시 화이트리스트 포함.

export interface NaverTheme { no: number; name: string }
export interface NaverThemeMatch { theme: NaverTheme; stocks: SearchResult[] }

const THEME_LIST_CACHE_KEY = "naver_theme_list_v1";
const THEME_LIST_TS_KEY = "naver_theme_list_ts";
const THEME_LIST_TTL_MS = 24 * 60 * 60 * 1000;   // 24h

// HTML charset 견고 디코드 — 일부 공용 프록시가 Content-Type charset 을 누락하므로
// ①Content-Type → ②HTML <meta charset> 스니핑 → ③기본 UTF-8 순으로 결정.
// (네이버 금융이 EUC-KR→UTF-8 전환 → 프록시가 charset 누락 시 euc-kr 폴백하면 깨짐)
export function decodeHtmlBuf(buf: ArrayBuffer, contentType: string): string {
  let charset = /charset=([\w-]+)/i.exec(contentType)?.[1]?.toLowerCase() || "";
  if (!charset) {
    const head = new TextDecoder("latin1").decode(buf.slice(0, 2048));
    charset = /charset=["']?([\w-]+)/i.exec(head)?.[1]?.toLowerCase() || "utf-8";
  }
  try { return new TextDecoder(charset).decode(buf); }
  catch { return new TextDecoder("utf-8").decode(buf); }
}

// 네이버 금융 공통 — Response → HTML 문자열
async function decodeNaverHtml(resp: Response): Promise<string> {
  const buf = await resp.arrayBuffer();
  return decodeHtmlBuf(buf, resp.headers.get("Content-Type") || "");
}

// 전체 테마 목록 — 첫 로드 시 스크랩, 24h 캐시
async function loadNaverThemeList(): Promise<NaverTheme[]> {
  try {
    const ts = Number(localStorage.getItem(THEME_LIST_TS_KEY) ?? "0");
    if (Date.now() - ts < THEME_LIST_TTL_MS) {
      const raw = localStorage.getItem(THEME_LIST_CACHE_KEY);
      if (raw) {
        const cached = JSON.parse(raw) as NaverTheme[];
        if (cached.length > 0) return cached;
      }
    }
  } catch { /* noop */ }
  // 네이버 테마 목록은 여러 페이지(보통 1~3p). 모두 fetch.
  const themes: NaverTheme[] = [];
  const seen = new Set<number>();
  for (let page = 1; page <= 3; page++) {
    try {
      const url = `https://finance.naver.com/sise/sise_group.naver?type=theme&page=${page}`;
      const resp = await fetchProxied(url);
      if (!resp.ok) break;
      const html = await decodeNaverHtml(resp);
      const re = /href="\/sise\/sise_group_detail\.naver\?type=theme&(?:amp;)?no=(\d+)">([^<]+)/g;
      let m: RegExpExecArray | null;
      let added = 0;
      while ((m = re.exec(html)) !== null) {
        const no = Number(m[1]);
        if (seen.has(no)) continue;
        seen.add(no);
        themes.push({ no, name: m[2].trim() });
        added++;
      }
      if (added === 0) break;   // 더 이상 새 테마 없음 → 페이지 끝
    } catch { break; }
  }
  if (themes.length > 0) {
    try {
      localStorage.setItem(THEME_LIST_CACHE_KEY, JSON.stringify(themes));
      localStorage.setItem(THEME_LIST_TS_KEY, String(Date.now()));
    } catch { /* noop */ }
  }
  return themes;
}

// 특정 테마의 구성 종목 — HTML 스크랩
export async function fetchNaverThemeStocks(no: number): Promise<SearchResult[]> {
  const url = `https://finance.naver.com/sise/sise_group_detail.naver?type=theme&no=${no}`;
  try {
    const resp = await fetchProxied(url);
    if (!resp.ok) return [];
    const html = await decodeNaverHtml(resp);
    const re = /href="\/item\/main\.naver\?code=(\d{6})">([^<]+)/g;
    const seen = new Set<string>();
    const out: SearchResult[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const code = m[1];
      if (seen.has(code)) continue;
      seen.add(code);
      out.push({ ticker: code, name: m[2].trim(), market: "KOSPI" });
    }
    return out;
  } catch {
    return [];
  }
}

// 키워드로 테마 검색 — 매칭 테마(상위 limit개) + 각 구성 종목.
// 대소문자/공백 무시, 부분 매칭.
export async function searchNaverThemes(
  query: string, limit = 3,
): Promise<NaverThemeMatch[]> {
  const q = query.trim();
  if (!q) return [];
  const all = await loadNaverThemeList();
  if (all.length === 0) return [];
  const qLower = q.toLowerCase().replace(/\s+/g, "");
  const matched = all
    .map(t => ({ t, n: t.name.toLowerCase().replace(/\s+/g, "") }))
    .filter(({ n }) => n.includes(qLower))
    // 시작 매칭 우선 → 그 외 부분 매칭
    .sort((a, b) => {
      const aStart = a.n.startsWith(qLower) ? 0 : 1;
      const bStart = b.n.startsWith(qLower) ? 0 : 1;
      if (aStart !== bStart) return aStart - bStart;
      return a.t.name.length - b.t.name.length;
    })
    .slice(0, limit)
    .map(x => x.t);
  if (matched.length === 0) return [];
  const results = await Promise.all(matched.map(async theme => ({
    theme,
    stocks: await fetchNaverThemeStocks(theme.no),
  })));
  return results.filter(r => r.stocks.length > 0);
}

// 종목별 최근 애널리스트 리포트 목록 (네이버 리서치) — "컨센서스 이유" 표시용.
// 같은 날 여러 리포트가 올라올 수 있어 다건 반환 (최신순).
export interface ResearchReport { title: string; broker: string; date: string; url?: string }
export async function fetchRecentReports(ticker: string, limit = 8): Promise<ResearchReport[]> {
  if (!/^\d{6}$/.test(ticker)) return [];
  const target = `https://finance.naver.com/research/company_list.naver?searchType=itemCode&itemCode=${ticker}`;
  try {
    const resp = await fetchProxied(target);
    if (!resp.ok) return [];
    const buf = await resp.arrayBuffer();
    const html = decodeHtmlBuf(buf, resp.headers.get("Content-Type") || "");
    const doc = new DOMParser().parseFromString(html, "text/html");
    const out: ResearchReport[] = [];
    const links = Array.from(doc.querySelectorAll("a[href*='company_read']"));
    for (const link of links) {
      const title = (link.textContent ?? "").trim();
      if (!title) continue;
      let url = link.getAttribute("href") ?? "";
      if (url && !/^https?:/.test(url)) {
        url = url.startsWith("/") ? `https://finance.naver.com${url}`
                                  : `https://finance.naver.com/research/${url}`;
      }
      const row = link.closest("tr");
      let broker = "", date = "";
      if (row) {
        const tds = Array.from(row.querySelectorAll("td"));
        const dateTd = tds.find(td => /\d{2}\.\d{2}\.\d{2}/.test(td.textContent ?? ""));
        date = dateTd ? (dateTd.textContent ?? "").trim() : "";
        const brokerTd = tds.find(td =>
          td !== dateTd && !td.querySelector("a") && !td.querySelector("img")
          && (td.textContent ?? "").trim().length > 0
        );
        broker = brokerTd ? (brokerTd.textContent ?? "").trim() : "";
      }
      out.push({ title, broker, date, url: url || undefined });
      if (out.length >= limit) break;
    }
    return out;
  } catch {
    return [];
  }
}

// 6자리 코드 → 이름 단건 조회 (네이버 메인 title)
export async function fetchStockName(ticker: string): Promise<string | null> {
  if (!/^[\dA-Za-z]{6}$/.test(ticker)) return null;
  try {
    const resp = await fetchProxied(
      `https://finance.naver.com/item/main.naver?code=${ticker}`);
    if (!resp.ok) return null;
    const buf = await resp.arrayBuffer();
    const html = decodeHtmlBuf(buf, resp.headers.get("Content-Type") || "");
    const doc = new DOMParser().parseFromString(html, "text/html");
    const t = doc.querySelector("div.wrap_company h2 a");
    const name = (t?.textContent ?? "").trim();
    return name || null;
  } catch {
    return null;
  }
}

