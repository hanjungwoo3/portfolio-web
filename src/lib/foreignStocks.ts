// 미국 외 해외 구성종목 — 이름으로 상장 심볼을 찾아 야후에서 시세를 받는다.
//   일본(6857.T)·영국(BA.L)·프랑스(HO.PA)·이탈리아(LDO.MI)·독일(RHM.DE)·스웨덴(SAAB-B.ST) …
//
// 왜 이런 우회가 필요한가:
//   토스 ETF 구성 API 는 **미국 종목만 내부코드(US…/NAS…)를 준다.** 그 외 해외는 stockCode 가
//   null 이다 — 토스증권이 미국 주식만 취급해서 코드가 아예 없고 토스 검색에도 안 잡힌다.
//   그래서 시세를 물어볼 대상이 없어 카드가 전부 '—' 였다.
//
// 해결: 야후 검색(v1/finance/search)으로 이름 → 심볼을 풀고, 한 번 푼 건 localStorage 에
//   영구 보관한다(회사 이름↔상장코드는 변하지 않는다).
//
// ⚠️ 함정 넷
//   1. "TOKYO ELECTRON LTD" 로 검색하면 **다른 회사** TOKYO ELECTRON DEVICE(2760.T) 가 걸린다
//      → 법인 접미사를 떼고 검색 + 결과 이름이 검색어로 시작하는지 확인.
//   2. 한 회사가 여러 거래소에 겹쳐 상장돼 있다(SAAB: ST/MI/IL/FRA/DU + 미국 OTC).
//      **야후가 돌려주는 순서가 곧 관련도**라 그 순서를 유지하고 주요 거래소만 거른다.
//      우리가 우선순위로 다시 정렬하면 SAAB 가 스톡홀름 대신 밀라노(1SAAB.MI)로 간다(실측).
//   3. 런던(LSE)은 **펜스(GBp)** 로 호가한다 — 파운드가 아니다. 100 으로 나눠야 한다.
//   4. 검색이 빈 응답을 줄 때가 있다(연속 호출 시 스로틀). 그걸 '없음'으로 캐시하면
//      멀쩡한 종목이 영영 안 나온다 → 후보가 0건이면 캐시하지 않는다.

import { fetchProxied } from "./api";
import type { Price } from "../types";

// ★ 키에 버전을 붙인다. 해석 규칙을 고쳐도 옛 실패가 캐시에 박혀 있으면 영영 안 풀린다
//   (실제로 'GLOBAL X JP SEMICON ETF' 가 그랬다). 규칙을 바꾸면 이 숫자를 올린다.
const CACHE_KEY = "fx_symbol_by_name_v1";
const MISS = "-";                                  // 못 찾음 표식(재검색 방지)
// 성공은 영구 보관(회사↔상장코드는 안 변한다). **실패만 7일 뒤 다시 시도**한다 —
//   신규 상장이거나 야후 색인이 늦었을 수 있고, 우리 해석 규칙이 좋아졌을 수도 있다.
const MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type SymMap = Record<string, string>;

function loadMap(): SymMap {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}") as SymMap; }
  catch { return {}; }
}
function saveMap(m: SymMap): void {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(m)); } catch { /* noop */ }
}

/** 법인 접미사 제거 + 대문자 정규화 — 검색어와 비교 양쪽에 같은 함수를 쓴다. */
function coreName(s: string): string {
  return (s || "")
    .toUpperCase()
    .replace(/[.,]/g, " ")
    .replace(/[/]/g, " ")
    .replace(/-[A-Z]\b/g, " ")             // 'SAAB AB-B' 의 주식 종류(-B) — 검색엔 방해만 된다
    // 법인 형태는 나라마다 다르다: 한·미·일(CORP/LTD/INC) · 영(PLC) · 프(SA) · 이(SPA)
    //   · 독(AG/SE) · 스웨덴(AB) · 네덜란드(NV) · 노르웨이(ASA) · 핀란드(OYJ)
    .replace(/\b(CO|CORP|CORPORATION|LTD|LIMITED|INC|HOLDINGS|HLDGS|GROUP|PLC|KK|ETF|SA|SPA|AG|SE|AB|NV|ASA|OYJ)\b/g, " ")
    .replace(/\bJP\b/g, "JAPAN")          // 'GLOBAL X JP SEMICON' — 줄임말이면 야후가 0건을 준다
    .replace(/\s+/g, " ")
    .trim();
}

/** 토스가 코드를 안 준 해외 종목일 법한 이름인가 — 라틴문자 회사명만 시도한다. */
export function looksLikeForeignName(name: string): boolean {
  const n = (name || "").trim();
  return n.length >= 3 && /^[A-Za-z0-9&.,'()\- ]+$/.test(n);
}

interface YahooSearchResp {
  quotes?: { symbol?: string; exchange?: string; shortname?: string; longname?: string }[];
}

/** 후보 심볼의 **정식 이름**. 검색 결과의 shortname 은 잘려 나온다
 *  (일본 상장 ETF 는 전부 "GLOBAL X JAPAN CO LTD …" 로 뭉개져 이름 비교가 불가능하다).
 *  chart meta.longName 은 온전해서, 애매할 때 이걸로 확인한다. */
async function longNameOf(sym: string): Promise<string | null> {
  try {
    const resp = await fetchProxied(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1d&interval=1d`);
    if (!resp.ok) return null;
    const d = await resp.json() as { chart?: { result?: { meta?: { longName?: string; shortName?: string } }[] } };
    const m = d.chart?.result?.[0]?.meta;
    return m?.longName ?? m?.shortName ?? null;
  } catch { return null; }
}

// 본 상장 거래소만 — 같은 회사가 여러 곳에 겹쳐 잡힌다(미국 OTC=PNK, 독일 지방거래소
//   HAM/MUN/DUS/STU/BER, 런던 국제호가 IOB, 범유럽 DXE/CXE …). 이런 데서 잡으면
//   호가가 드문드문이라 등락률이 엉뚱해진다.
//   ⚠️ 이 목록으로 **정렬하지 않는다** — 야후가 준 순서가 관련도다. 우리가 다시 줄 세우면
//     SAAB 가 스톡홀름(SAAB-B.ST) 대신 밀라노(1SAAB.MI) 로 간다(실측).
const PRIMARY_EXCHANGES = new Set([
  "JPX",                                                   // 일본
  "LSE", "PAR", "MIL", "GER", "AMS", "BRU", "LIS", "VIE",  // 서유럽
  "STO", "CPH", "HEL", "OSL",                              // 북유럽
  "SWX", "EBS", "MCE",                                     // 스위스·스페인
  "HKG", "TAI", "ASX", "TOR",                              // 아시아·오세아니아·캐나다
]);

/** 이름 하나 → 상장 심볼. 캐시 우선, 없으면 야후 검색 1콜. */
async function resolveOne(name: string, map: SymMap): Promise<string | null> {
  const key = coreName(name);
  const hit = map[key];
  if (hit && !hit.startsWith(MISS)) return hit;
  if (hit) {                                       // "-<저장시각>" — TTL 안이면 재검색 안 함
    const at = Number(hit.slice(MISS.length)) || 0;
    if (Date.now() - at < MISS_TTL_MS) return null;
  }

  const q = encodeURIComponent(key);
  try {
    const resp = await fetchProxied(
      `https://query1.finance.yahoo.com/v1/finance/search?q=${q}&quotesCount=8&newsCount=0`);
    if (!resp.ok) return null;                     // 실패는 캐시하지 않는다(다음에 다시 시도)
    const data = await resp.json() as YahooSearchResp;
    const all = data.quotes ?? [];
    // 후보가 통째로 0건이면 스로틀일 수 있다 → '없음'으로 굳히지 않는다(다음에 재시도).
    if (all.length === 0) return null;
    const jpx = all.filter(x => x.symbol && PRIMARY_EXCHANGES.has(x.exchange ?? ""));
    if (jpx.length === 0) { map[key] = MISS + Date.now(); saveMap(map); return null; }
    // ① 검색 결과 이름이 검색어로 시작하면 그대로 — DEVICE 같은 파생 상호를 걸러낸다.
    const exact = jpx.find(x => coreName(x.shortname || x.longname || "").startsWith(key));
    let symbol = exact?.symbol ?? null;
    // ② 아니면 후보들의 정식 이름을 받아 확인한다(잘린 shortname 때문에 여기로 온다).
    //    검색어로 시작하는 것 중 **가장 짧은** 이름을 고른다 — 덧붙은 말("… Top 10")은
    //    같은 회사의 다른 상품이다. 실측: GLOBAL X JP SEMICON ETF
    //      2644.T "Global X Japan Semiconductor ETF"        ← 정답
    //      282A.T "Global X Japan Semiconductor Top 10 ETF" ← 다른 상품
    if (!symbol) {
      const cands = jpx.slice(0, 3);
      const named = await Promise.all(cands.map(async c => ({
        symbol: c.symbol!, core: coreName((await longNameOf(c.symbol!)) ?? ""),
      })));
      const ok = named.filter(x => x.core && x.core.startsWith(key))
                      .sort((a, b) => a.core.length - b.core.length);
      symbol = ok[0]?.symbol ?? null;
    }
    map[key] = symbol ?? (MISS + Date.now());
    saveMap(map);
    return symbol;
  } catch {
    return null;
  }
}

/** 이름 목록 → { 이름: 심볼 }. 캐시에 있는 건 콜이 안 나간다. */
export async function resolveForeignSymbols(names: string[]): Promise<Map<string, string>> {
  const map = loadMap();
  const out = new Map<string, string>();
  for (const n of names) {
    const sym = await resolveOne(n, map);          // 순차 — 검색은 첫 1회뿐이라 느려도 된다
    if (sym) out.set(n, sym);
  }
  return out;
}

interface YahooChartMeta {
  chart?: {
    result?: {
      meta?: { regularMarketPrice?: number; chartPreviousClose?: number; currency?: string };
      timestamp?: number[];
      indicators?: { quote?: { close?: (number | null)[] }[] };
    }[];
  };
}

// ⚠️ 런던(LSE)은 **펜스(GBp)** 로 호가한다 — 파운드가 아니다. 그대로 환산하면 100배가 된다.
function fxPair(cur: string): { pair: string; div: number } {
  if (cur === "GBp") return { pair: "GBPKRW=X", div: 100 };
  return { pair: `${cur}KRW=X`, div: 1 };
}

/** 통화 → 1단위당 원. 통화 종류만큼만 부른다(유럽 ETF 면 보통 EUR·GBP 둘). */
async function fetchKrwRates(currencies: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  await Promise.all([...new Set(currencies)].map(async cur => {
    if (cur === "KRW") { out.set(cur, 1); return; }
    const { pair, div } = fxPair(cur);
    try {
      const resp = await fetchProxied(
        `https://query1.finance.yahoo.com/v8/finance/chart/${pair}?range=1d&interval=1d`);
      if (!resp.ok) return;
      const d = await resp.json() as YahooChartMeta;
      const v = d.chart?.result?.[0]?.meta?.regularMarketPrice ?? 0;
      if (v > 0) out.set(cur, v / div);
    } catch { /* 이 통화만 환산 생략 */ }
  }));
  return out;
}

export interface ForeignQuotes {
  prices: Price[];                      // ticker = 구성종목 이름
  charts: Record<string, number[]>;     // 이름 → 3개월 종가(현지통화) — 카드 배경 스파크라인용
}

/**
 * 미국 외 해외 구성종목 시세 — 원화 환산 + 현지통화 병기.
 * @returns ticker = 구성종목 **이름**. 코드가 없으니 이름이 곧 키다.
 */
export async function fetchForeignHoldingPrices(names: string[]): Promise<ForeignQuotes> {
  if (names.length === 0) return { prices: [], charts: {} };
  const syms = await resolveForeignSymbols(names);
  if (syms.size === 0) return { prices: [], charts: {} };
  const out: Price[] = [];
  const charts: Record<string, number[]> = {};
  // 1차: 일봉을 받아 현지통화 값을 모은다. 환율은 나온 통화 종류만큼만 2차에서 받는다.
  const raw: { name: string; sym: string; cur: string; px: number; prev: number; date: string }[] = [];
  await Promise.all([...syms].map(async ([name, sym]) => {
    try {
      const resp = await fetchProxied(
        // 3개월로 받는다 — 카드 배경 스파크라인까지 **같은 한 콜**로 해결한다.
        //   (5d 로 받으면 시세는 되는데 선이 안 그려져 카드가 비어 보인다)
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=3mo&interval=1d`);
      if (!resp.ok) return;
      const d = await resp.json() as YahooChartMeta;
      const res = d.chart?.result?.[0];
      // ⚠️ meta.chartPreviousClose 는 '전일 종가'가 아니라 **조회 범위 시작 직전**의 종가다.
      //   range=5d 로 부르면 5거래일 전 값이라 등락률이 통째로 틀린다(실측: +4.28% ↔ 실제 +4.20%).
      //   일봉 배열의 **마지막 두 봉**으로 직접 낸다.
      const ts = res?.timestamp ?? [];
      const closes = (res?.indicators?.quote?.[0]?.close ?? []);
      const bars: { date: string; close: number }[] = [];
      for (let i = 0; i < ts.length; i++) {
        const c = closes[i];
        if (c == null || !(c > 0)) continue;
        bars.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), close: c });
      }
      if (bars.length === 0) return;
      const last = bars[bars.length - 1];
      const prev = bars[bars.length - 2];
      const live = res?.meta?.regularMarketPrice ?? 0;
      // 장중이면 meta 가 마지막 봉보다 최신일 수 있다 — 더 최신 쪽을 현재가로 본다.
      const px = live > 0 ? live : last.close;
      const prevPx = (live > 0 && live !== last.close) ? last.close : (prev?.close ?? 0);
      if (px <= 0 || prevPx <= 0) return;
      charts[name] = bars.map(b => b.close);
      raw.push({ name, sym, cur: res?.meta?.currency ?? "", px, prev: prevPx, date: last.date });
    } catch { /* 한 종목 실패가 나머지를 막지 않는다 */ }
  }));

  const rates = await fetchKrwRates(raw.map(r => r.cur).filter(Boolean));
  for (const r of raw) {
    const k = rates.get(r.cur) ?? 0;
    // 환율을 못 받으면 원화로 속이지 않는다 — 현지 값을 그대로 넣고 currency 로 알린다.
    const mul = k > 0 ? k : 1;
    // 원화는 **정수로 반올림**한다 — 환산이라 소수가 남는데(275,790.25원) 다른 원화 카드는
    //   전부 정수라 눈에 거슬린다. 등락률은 price/base 로 내므로 둘 다 반올림해야 어긋나지 않는다.
    const won = (v: number) => Math.round(v * mul);
    out.push({
      ticker: r.name, price: won(r.px), base: won(r.prev), prevClose: won(r.prev),
      open: 0, volume: 0,
      // 이 값이 **언제 것인지**. 현지 휴장(일본 9/21~23 연휴 등)이면 한국 ETF 와 며칠씩
      //   어긋난다 — 화면이 날짜를 말해주지 않으면 값이 틀린 것처럼 보인다.
      trade_date: r.date,
      priceNative: r.px, nativeCurrency: r.cur, fxSymbol: r.sym,
      currency: k > 0 ? "KRW" : "USD",             // USD 는 '원 아님' 표식으로만 쓴다
    });
  }
  return { prices: out, charts };
}
