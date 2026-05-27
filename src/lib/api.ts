import type { Price, Investor, Consensus } from "../types";
import { reportProxySuccess, reportProxyFailure, isProxyDown } from "./proxyStatus";
import { getPersonalProxyUrl } from "./proxyConfig";
import { setTossMaintenance, parseTossMaintenance, setNaverFallback, getTossMaintenance } from "./tossMaintenance";

// 공개 라운드 로빈 (Cloudflare + Vercel + Deno + Render + Netlify)
const PUBLIC_PROXY_URLS: string[] = [
  import.meta.env.VITE_PROXY_URL,
  import.meta.env.VITE_PROXY_URL_2,
  import.meta.env.VITE_PROXY_URL_3,
  import.meta.env.VITE_PROXY_URL_4,
  import.meta.env.VITE_PROXY_URL_5,
].filter(Boolean) as string[];
if (PUBLIC_PROXY_URLS.length === 0) PUBLIC_PROXY_URLS.push("http://localhost:8787");

// 런타임 — 사용자 전용 URL 있으면 그것만 사용, 없으면 공개 4-way
export function getProxyUrls(): string[] {
  const personal = getPersonalProxyUrl();
  return personal ? [personal] : PUBLIC_PROXY_URLS;
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
  high52w?: number;
  low52w?: number;
}
interface TossPriceResponse { result: TossPriceItem[]; }

// 토스 미국 종목 가격 — 24시간 ECN Overnight 포함 (Yahoo postMarketPrice 보다 최신).
// 입력: US19890516001 같은 토스 코드. 응답: close(현재가) / base(직전 정규장 종가)
export interface TossUsPrice {
  code: string;
  close: number;
  base: number;        // 직전 정규장 종가
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
      }>;
    };
    for (const item of (data.result ?? [])) {
      if (!item.code || !item.close || !item.base) continue;
      const pct = item.base > 0 ? ((item.close - item.base) / item.base) * 100 : 0;
      out.set(item.code, {
        code: item.code, close: item.close, base: item.base,
        pct, tradeDateTime: item.tradeDateTime,
      });
    }
  } catch { /* network failure — return empty */ }
  return out;
}

// ETF 구성 종목 (PCF, Portfolio Composition File) — 토스 v2 endpoint.
// 응답: { result: { items: [{ name, ratio, stockCode, ... }] } }
export interface EtfComposition {
  stockCode: string;   // A005930 형태
  name: string;
  ratio: number;       // 비중 (%)
}
export async function fetchEtfCompositions(ticker: string): Promise<EtfComposition[]> {
  const target = `https://wts-info-api.tossinvest.com/api/v2/stock-infos/A${ticker}/compositions`;
  try {
    const resp = await fetchProxied(target);
    if (!resp.ok) return [];
    const data = await resp.json() as {
      result?: {
        items?: Array<{
          stockCode?: string;
          name?: string;
          ratio?: number;
        }>;
      };
    };
    const items = data.result?.items ?? [];
    return items
      .map(it => ({
        stockCode: it.stockCode ?? "",   // 선물·"그 외" 는 null → 빈 문자열
        name: it.name ?? "",
        ratio: typeof it.ratio === "number" ? it.ratio : 0,
      }))
      .filter(it => it.name)             // name 만 있으면 표시 (stockCode 없어도 OK)
      .sort((a, b) => b.ratio - a.ratio);
  } catch {
    return [];
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
  { ticker: "445290", name: "로봇",     fullName: "KODEX 로봇" },
  { ticker: "091180", name: "자동차",   fullName: "KODEX 자동차" },
  { ticker: "102970", name: "증권",     fullName: "KODEX 증권" },
  { ticker: "117680", name: "철강",     fullName: "KODEX 철강" },
  { ticker: "117460", name: "에너지화학", fullName: "KODEX 에너지화학" },
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

export async function fetchTossPrices(tickers: string[]): Promise<Price[]> {
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
  const ks = await fetchPriceHistoryFor(`${ticker}.KS`, range);
  if (ks.length > 0) return ks;
  return await fetchPriceHistoryFor(`${ticker}.KQ`, range);
}

// Yahoo 임의 심볼 가격 history (^KS11, ^KQ11 등 인덱스 포함)
export async function fetchYahooPriceHistory(
  symbol: string, range = "1y",
): Promise<PricePoint[]> {
  return await fetchPriceHistoryFor(symbol, range);
}

// 한국 종목 가격 + 배당 + 액면분할 이벤트 통합 fetch
export async function fetchKrPriceHistoryWithEvents(
  ticker: string, range = "1y",
): Promise<{ prices: PricePoint[]; dividends: DividendEvent[]; splits: SplitEvent[] }> {
  const empty = { prices: [] as PricePoint[], dividends: [] as DividendEvent[], splits: [] as SplitEvent[] };
  if (!/^[\dA-Za-z]{6}$/.test(ticker)) return empty;
  const ks = await fetchPriceHistoryWithEventsFor(`${ticker}.KS`, range);
  if (ks.prices.length > 0) return ks;
  return await fetchPriceHistoryWithEventsFor(`${ticker}.KQ`, range);
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
// 비거래일 (마지막 데이터의 KST 날짜 ≠ 오늘) → flow 값들을 0 으로 (외국인비율은 유지).
//   가격 "어제대비 0" 과 일관 처리 — 주말/공휴일에 마지막 거래일 수급이
//   "오늘 수급" 처럼 잘못 보이는 문제 해결.
export function pickTodayInvestor(history: Investor[]): Investor | null {
  if (history.length === 0) return null;
  let item = history[0];
  if (nowKstHour() < 8 && history.length >= 2) {
    const isAllZero =
      item.개인 === 0 && item.외국인 === 0 && item.기관 === 0;
    if (isAllZero) item = history[1];
  }
  // 비거래일 보정 — 데이터 날짜가 오늘과 다르면 flow 0
  if (item.date) {
    const todayKst = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    if (item.date !== todayKst) {
      return {
        ...item,
        개인: 0, 외국인: 0, 기관: 0, 연기금: 0,
        금융투자: 0, 투신: 0, 사모: 0, 보험: 0,
        은행: 0, 기타금융: 0, 기타법인: 0,
        // 외국인비율 유지
      };
    }
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
  tradeDate: string;       // KST 날짜 (YYYY-MM-DD) — 마지막 거래 시각 기준
  regularMarketTime?: number;  // 마지막 거래 시각 (unix sec) — 카드별 "갱신" 표시용
  marketState: string;     // REGULAR / PRE / POST / CLOSED / PREPRE / POSTPOST
  // 시간외 (after-hours) — POST 마켓 상태가 아닌 때도 직전 시간외 가격 보존
  postPrice?: number;
  postPct?: number;        // 정규 종가 대비 시간외 변동률 (%)
  // 정규장 종가 + 변동률 — marketState 무관하게 항상 유지
  regularPrice?: number;
  regularPct?: number;     // (regularPrice - prevClose) / prevClose × 100
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

    return {
      symbol, name, price, prev, prevClose, diff, pct,
      currency: p.currency, tradeDate, regularMarketTime: p.regularMarketTime, marketState: state,
      postPrice, postPct, regularPrice, regularPct,
    };
  } catch {
    return null;
  }
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
  if (!/^\d{6}$/.test(ticker)) return [];
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
  // 미국 국채금리 커브 (yield, %) — 토스 indices
  "^FVX":   "ROB.US5YT-RR",  // 미국 5년 금리 (차트 = Yahoo ^FVX)
  "^TNX":   "ROB.US10YT-RR", // 미국 10년 금리 (차트 = Yahoo ^TNX)
  "^TYX":   "ROB.US30YT-RR", // 미국 30년 금리 (차트 = Yahoo ^TYX)
};

// Yahoo 심볼 → 토스 미국 종목 코드 (현재가만 토스, 없으면 Yahoo fallback).
// 토스 stock-prices/details (US 코드) — 24시간/시간외 거래값 포함.
const TOSS_US_STOCK_CODE: Record<string, string> = {
  // 반도체 개별주
  "MU":   "US19890516001",
  "NVDA": "US19990122001",
  "AMAT": "US19721012001",
  "LRCX": "US19840504001",
  "ASML": "US19950315001",
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
  "BOTZ": "US20160913001",
};

// 토스 US 종목 가격(기존 fetchTossUsPrices) → UsIndex 변환. 현재가 = close, 기준 = base.
async function fetchTossUsIndexMap(
  items: { symbol: string; name: string; code: string }[],
): Promise<Map<string, UsIndex>> {
  const out = new Map<string, UsIndex>();
  if (items.length === 0) return out;
  const priceByCode = await fetchTossUsPrices(items.map(i => i.code));
  for (const it of items) {
    const tp = priceByCode.get(it.code);
    if (!tp) continue;
    const diff = tp.close - tp.base;
    out.set(it.symbol, {
      symbol: it.symbol, name: it.name,
      price: tp.close, prev: tp.base, prevClose: tp.base,
      diff, pct: tp.pct, currency: "USD",
      tradeDate: tp.tradeDateTime ? toKstDateString(tp.tradeDateTime) : "",
      marketState: "",
    });
  }
  return out;
}

// 토스 indices price API → UsIndex 변환
async function fetchTossIndexPrice(
  yahooSymbol: string, name: string,
): Promise<UsIndex | null> {
  const code = TOSS_INDEX_CODE[yahooSymbol];
  if (!code) return null;
  const url = `https://wts-info-api.tossinvest.com/api/v1/index-prices/${code}`;
  try {
    const resp = await fetchProxied(url);
    if (!resp.ok) return null;
    const data = await resp.json() as {
      result?: {
        close?: number;
        base?: number;     // 어제 종가 (% 기준)
        // open/high/low/volume/value/changeType/high52w/low52w/tradeTime 등 있음
      };
    };
    const r = data.result;
    if (!r || typeof r.close !== "number" || typeof r.base !== "number") return null;
    const diff = r.close - r.base;
    const pct = r.base > 0 ? (diff / r.base) * 100 : 0;
    const todayKst = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    return {
      symbol: yahooSymbol, name,
      price: r.close, prev: r.base, prevClose: r.base,
      diff, pct, currency: "KRW",
      tradeDate: todayKst, marketState: "",
    };
  } catch {
    return null;
  }
}

// investing.com financialdata — Yahoo/토스에 없는 지수 (VKOSPI 등).
// 응답: { data: [[ts_ms, open, high, low, close, vol, ...], ...] } 일봉.
const INVESTING_ID: Record<string, number> = {
  "VKOSPI": 956761,   // 코스피200 변동성지수 (한국 공포지수)
};
export function isInvestingIndex(symbol: string): boolean {
  return symbol in INVESTING_ID;
}
function investingUrl(id: number): string {
  return `https://api.investing.com/api/financialdata/${id}/historical/chart/?interval=P1D&pointscount=160`;
}
async function fetchInvestingRows(symbol: string): Promise<number[][]> {
  const id = INVESTING_ID[symbol];
  if (!id) return [];
  try {
    const resp = await fetchProxied(investingUrl(id));
    if (!resp.ok) return [];
    const data = await resp.json() as { data?: number[][] };
    return Array.isArray(data.data) ? data.data : [];
  } catch {
    return [];
  }
}
// 현재가 = 최근 종가, 기준 = 직전 종가 (일변동률)
async function fetchInvestingIndexPrice(symbol: string, name: string): Promise<UsIndex | null> {
  const rows = await fetchInvestingRows(symbol);
  if (rows.length < 2) return null;
  const close = rows[rows.length - 1]?.[4];
  const base = rows[rows.length - 2]?.[4];
  if (typeof close !== "number" || typeof base !== "number") return null;
  const diff = close - base;
  const pct = base > 0 ? (diff / base) * 100 : 0;
  const todayKst = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  return {
    symbol, name, price: close, prev: base, prevClose: base,
    diff, pct, currency: "", tradeDate: todayKst, marketState: "",
  };
}
// 차트(스파크라인)용 종가 시계열
export async function fetchInvestingChart(symbol: string): Promise<number[]> {
  const rows = await fetchInvestingRows(symbol);
  return rows.map(r => r[4]).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
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
  const ksRegex = /^(\d{6})\.KS$/;
  const ksItems = pairs.filter(p => ksRegex.test(p.symbol));
  const tossIdxItems = pairs.filter(p => TOSS_INDEX_CODE[p.symbol]);
  const tossUsItems = pairs
    .filter(p => TOSS_US_STOCK_CODE[p.symbol])
    .map(p => ({ ...p, code: TOSS_US_STOCK_CODE[p.symbol] }));
  const investItems = pairs.filter(p => isInvestingIndex(p.symbol));

  const [ksMap, idxResults, usMap, investResults, yahooResults] = await Promise.all([
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
                tradeDate: tp.trade_date, marketState: "",
              });
            }
            return out;
          })
          .catch(() => new Map<string, UsIndex>())
      : Promise.resolve(new Map<string, UsIndex>()),
    Promise.all(tossIdxItems.map(p => fetchTossIndexPrice(p.symbol, p.name))),
    fetchTossUsIndexMap(tossUsItems),
    Promise.all(investItems.map(p => fetchInvestingIndexPrice(p.symbol, p.name))),
    // 모든 심볼 Yahoo — 베이스(regularPrice/marketState/prevClose) + 토스 실패 시 fallback
    Promise.all(pairs.map(p => fetchYahooQuote(p.symbol, p.name))),
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
      currency: t.currency ?? y.currency,
      tradeDate: t.tradeDate || y.tradeDate,
      marketState: "",             // 빈값 → 카드가 토스 현재가를 메인으로 표시
    });
  };
  for (const [sym, t] of ksMap) applyToss(sym, t);
  for (const r of idxResults) { if (r) applyToss(r.symbol, r); }
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
    // Naver finance 는 EUC-KR 가능 — Content-Type 체크 후 디코딩
    const buf = await resp.arrayBuffer();
    const ct = resp.headers.get("Content-Type") || "";
    const charset = /charset=([\w-]+)/i.exec(ct)?.[1]?.toLowerCase() || "euc-kr";
    let html: string;
    try {
      html = new TextDecoder(charset).decode(buf);
    } catch {
      html = new TextDecoder("euc-kr").decode(buf);
    }
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
  NYS: "NYSE", NAS: "NASDAQ", AMS: "AMEX",
};
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
      // ticker 추출 — productCode "A005930" → "005930", symbol 폴백
      let code = (it.productCode ?? "").replace(/^A/, "")
              || it.symbol || it.ticker || it.code || "";
      code = code.trim();
      if (!/^[\dA-Za-z]{6}$/.test(code)) continue;
      const nation = it.nationCode || it.countryCode;
      if (nation && nation !== "KOR") continue;
      // 한국 ETF/주식만 (market KSP/KSQ/KNX) — 다른 시장은 검색 결과에서 제외
      const rawMarket = (it.market ?? it.exchange ?? it.marketType ?? "").toString();
      if (rawMarket && !["KSP", "KSQ", "KNX", "KOSPI", "KOSDAQ", "KONEX"].includes(rawMarket)) continue;
      if (seen.has(code)) continue;
      seen.add(code);
      out.push({
        ticker: code,
        name: (it.productName ?? it.korName ?? it.name ?? it.fullName ?? it.keyword ?? code).trim(),
        market: TOSS_MARKET_LABEL[rawMarket] ?? rawMarket ?? "KOSPI",
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
    const ct = resp.headers.get("Content-Type") || "";
    const charset = /charset=([\w-]+)/i.exec(ct)?.[1]?.toLowerCase() || "euc-kr";
    let html: string;
    try { html = new TextDecoder(charset).decode(buf); }
    catch { html = new TextDecoder("euc-kr").decode(buf); }
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
    const ct = resp.headers.get("Content-Type") || "";
    const charset = /charset=([\w-]+)/i.exec(ct)?.[1]?.toLowerCase() || "euc-kr";
    let html: string;
    try { html = new TextDecoder(charset).decode(buf); }
    catch { html = new TextDecoder("euc-kr").decode(buf); }
    const doc = new DOMParser().parseFromString(html, "text/html");
    const t = doc.querySelector("div.wrap_company h2 a");
    const name = (t?.textContent ?? "").trim();
    return name || null;
  } catch {
    return null;
  }
}

