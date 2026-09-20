// 토스 TICS 분류의 구성종목 팝업 — **한국 섹터 팝업과 같은 카드**(SimplePriceCard)를 쓴다.
//   한 화면에서 카드 모양이 두 가지면 같은 숫자를 다르게 읽게 된다(ThemeDialog 주석과 같은 이유).
//
// 한국·미국이 같은 구조로 온다는 게 이 소스의 값어치다:
//   · 국내 코드 "A329180" → 앞 A 를 떼면 우리 6자리 티커 그대로 (기업가치·토스 링크가 바로 붙는다)
//   · 해외 코드 "US20211001008" → 토스 내부코드 그대로 (캔들·링크 모두 코드로 조회)
//   그래서 두 시장을 같은 카드로 그릴 수 있다.
//
// ⚠️ 구성종목은 **한 페이지 10종 고정**이다(size 파라미터 무시 — 실측). page 로만 넘긴다.
//   스파크라인은 종목당 1콜이라 화면에 들어온 카드만 받는다(섹터 팝업과 같은 방식).

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  fetchTossTicsStocks, fetchTossKrCandles, fetchTossUsCandleRows, fetchTossMarketSessions,
  fetchTossPrices, fetchTossUsPrices,
  type TicsCategory, type TicsNation, type TicsStock,
} from "../lib/api";
import { signColor } from "../lib/format";
import { getDimSleepingEnabled } from "../lib/proxyConfig";
import { useEscClose } from "../lib/useEscClose";
import { SimplePriceCard } from "./SimplePriceCard";

const PAGE_SIZE = 10;   // 토스 고정 (size 파라미터는 무시된다 — 실측)
// ★ 등락률 정렬은 **서버가 거부한다**(sortBy=FLUCTUATION_RATE → 400, 실측). 시총·거래대금만 받는다.
//   그래서 등락률은 페이지를 받아 우리가 정렬한다.
// 세 정렬 모두 **스크롤 한 판**으로 보여준다 — 정렬마다 조작이 다르면(하나는 스크롤, 둘은 페이징)
//   같은 팝업인데 손이 헷갈린다. 대신 한 번에 받는 양을 끊고 '더 보기' 로 늘린다(1페이지 = 1콜).
const PAGE_STEP = 5;   // 한 번에 5페이지(50종)씩
const SORTS: { key: "MARKET_CAP" | "TRADING_VALUE" | "PCT"; label: string }[] = [
  { key: "PCT", label: "등락률" },          // 기본 — 이 팝업의 목적
  { key: "MARKET_CAP", label: "시총" },
  { key: "TRADING_VALUE", label: "거래대금" },
];

// 애널리스트 투자의견(토스 analystOpinion) — **라벨이지 버튼이 아니다**.
//   영문 pill 로 카드 우상단에 두었더니 'BUY' 가 매수 버튼으로 보였다(실제 지적).
//   그래서 한글로 옮기고, 누르는 자리(우상단 액션)가 아니라 아래 설명 줄로 내렸다.
const OPINION_KR: Record<string, string> = {
  STRONG_BUY: "적극매수", BUY: "매수", OUTPERFORM: "비중확대",
  HOLD: "중립", NEUTRAL: "중립",
  UNDERPERFORM: "비중축소", SELL: "매도", STRONG_SELL: "적극매도",
};

/** 국내 코드(A329180) → 우리 6자리 티커. 해외 코드면 null. */
export function krTickerOf(code: string): string | null {
  return /^A[\dA-Za-z]{6}$/.test(code) ? code.slice(1) : null;
}

// 국내/해외 구분은 코드 모양으로 안다(A + 6자리면 국내) — nation 을 따로 받을 필요가 없다.
// 카드에 그릴 값 — 종목 카드와 **같은 시세 소스**(fetchTossPrices / fetchTossUsPrices)를 쓴다.
//   ★ TICS 구성종목 API 는 시간외·프리마켓을 반영하지 않는다(실측 2026-09-21 08:26 SK가스:
//     TICS close=base=240,500 → 0.00% 인데 실제는 247,500 +2.91%). 카드(랭킹)는 반영하므로
//     그대로 쓰면 "카드 +2.41% 인데 종목은 0.00%" 가 된다.
export interface LiveQuote { price: number; base: number; asOf: string; volume: number }

function TicsStockCell({ s, rank, quote, dimmed, newestDate, staleProp, onAsOf, onOpenValuation }: {
  s: TicsStock; rank: number;
  /** 배치로 받아 온 실시간 시세. 없으면 TICS 값으로 그린다(그때만 옛 값일 수 있다) */
  quote?: LiveQuote;
  /** 그 시장이 닫혀 있는가 — 값이 직전 세션 것이라 흐리게 (기본 종목 카드와 같은 규칙) */
  dimmed?: boolean;
  /** 이 팝업에서 확인된 가장 최신 거래일 — 배지 설명용 */
  newestDate?: string;
  /** 이 종목만 갱신이 늦은가(다이얼로그가 판정) — 흐리게 + 목록 맨 뒤로 */
  staleProp?: boolean;
  onAsOf?: (code: string, date: string) => void;
  onOpenValuation?: (ticker: string, name: string) => void;
}) {
  const [seen, setSeen] = useState(false);
  const ref = useCallback((el: HTMLDivElement | null) => {
    if (!el || seen) return;
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { setSeen(true); io.disconnect(); }
    }, { rootMargin: "120px" });
    io.observe(el);
  }, [seen]);

  const krTicker = krTickerOf(s.code);

  // ★ 국내는 섹터 팝업과 **같은 쿼리키**(60봉)를 쓴다 — 캐시를 공유해 추가 호출이 없다.
  const kr = useQuery({
    queryKey: ["toss-candles", krTicker, "day", 60],
    queryFn: () => fetchTossKrCandles(krTicker as string, "day", 60),
    enabled: seen && !!krTicker,
    staleTime: 60 * 60_000,
    refetchOnWindowFocus: false,
  });
  const us = useQuery({
    queryKey: ["toss-us-candle-rows", s.code, 60],
    queryFn: () => fetchTossUsCandleRows(s.code, 60),
    enabled: seen && !krTicker,
    staleTime: 60 * 60_000,
    refetchOnWindowFocus: false,
  });
  const rows: Array<{ date: string; close: number }> = krTicker
    ? (kr.data ?? []).map(c => ({ date: c.date, close: c.close }))
    : (us.data ?? []);
  const chart = rows.map(r => r.close).filter(v => v > 0);

  // ★ 이 종목 값이 '언제 것' 인가 — TICS 응답에는 시각이 없어 일봉 마지막 날짜로 판단한다.
  //   같은 팝업 안에서도 갱신 시점이 갈린다(실측 2026-09-21 08:02 윤활유: 한국쉘석유만 당일
  //   시간외가 들어오고 나머지 둘은 9/18 종가 그대로였다). 그걸 안 보여주면 카드 등락률과
  //   종목 등락률의 부호가 달라 보이는 이유를 알 수 없다.
  const asOf = quote?.asOf || (rows.length ? rows[rows.length - 1].date : "");
  useEffect(() => { if (asOf) onAsOf?.(s.code, asOf); }, [asOf, s.code, onAsOf]);
  // 옛 값 판정은 팝업 전체를 봐야 한다 → 다이얼로그가 계산해 내려준다.
  const stale = !!staleProp;

  // 카드는 원화로 그린다(한국 카드와 같은 모양). 해외는 토스 환산 원화가 같이 온다.
  const fallbackPrice = krTicker ? s.price : (s.priceKrw || s.price);
  const fallbackBase = krTicker ? s.base : (s.baseKrw || s.base);
  const price = quote?.price || fallbackPrice;
  const base = quote?.base || fallbackBase;

  return (
    <div ref={ref} className="min-w-0">
      <SimplePriceCard
        ticker={krTicker ?? s.code} name={s.name}
        price={price} base={base}
        chart={chart}
        dimmed={dimmed || stale}
        badge={
          <span className="text-[10px] tabular-nums text-gray-400 shrink-0">
            #{rank}
            {/* 해외는 원화가 환산값이라 현지 통화를 같이 보여준다 */}
            {!krTicker && s.price > 0 && <span className="ml-0.5">·${s.price.toLocaleString()}</span>}
          </span>
        }
        // 카드 안쪽 우하단 — 읽는 정보(의견·시그널). 시그널이 길면 잘리고 의견은 남긴다.
        footer={(s.opinion || s.signal || asOf) ? (
          <>
            {asOf && (
              <span className={`shrink-0 tabular-nums ${stale ? "text-amber-600 font-bold" : "text-gray-400"}`}
                    title={stale
                      ? `${asOf} 기준 — 이 팝업의 최신(${newestDate})보다 옛 값이다`
                      : `${asOf} 기준`}>
                {asOf.slice(5).replace("-", "/")}
              </span>
            )}
            {s.signal && (
              <span className="flex-1 min-w-0 truncate text-amber-700" title={s.signal}>{s.signal}</span>
            )}
            {s.opinion && (
              <span className="shrink-0 text-gray-400" title="애널리스트 투자의견 (토스 제공)">
                의견 <span className="text-gray-600">{OPINION_KR[s.opinion] ?? s.opinion}</span>
              </span>
            )}
          </>
        ) : null}
        actions={
          // 기업가치는 국내 전용(네이버·Wisereport) — 해외는 버튼을 내지 않는다.
          //   누를 수 있는 것만 여기 둔다. 의견 같은 라벨을 섞으면 버튼으로 오해한다.
          krTicker && onOpenValuation ? (
            <button onClick={() => onOpenValuation(krTicker, s.name)}
                    title={`${s.name} 기업가치 보기`}
                    className="text-[11px] leading-none opacity-70 hover:opacity-100">📊</button>
          ) : null
        }
      />
    </div>
  );
}

export function TicsStockDialog({ cat, nation, onClose, onOpenValuation }: {
  cat: TicsCategory;
  nation: TicsNation;
  onClose: () => void;
  onOpenValuation?: (ticker: string, name: string) => void;
}) {
  const [pages, setPages] = useState(PAGE_STEP);
  // 셀이 알려준 종목별 기준일 — 그중 최신이 '이 팝업의 기준일' 이고, 그보다 옛 종목은 흐려진다.
  const [asOfMap, setAsOfMap] = useState<Record<string, string>>({});
  const noteAsOf = useCallback((code: string, date: string) => {
    setAsOfMap(m => (m[code] === date ? m : { ...m, [code]: date }));
  }, []);
  // 기본은 등락률 — 이 팝업을 여는 이유가 "이 분류에서 뭐가 갔나" 라서다.
  //   토스가 이 정렬을 지원하지 않아 앞 PCT_MAX_PAGES 페이지를 받아 우리가 정렬한다(아래 주석).
  const [sort, setSort] = useState<"MARKET_CAP" | "TRADING_VALUE" | "PCT">("PCT");
  useEscClose(true, onClose);

  // 장 구간 — 닫혀 있으면 카드를 흐리게(값이 직전 세션 것이다). 보드와 같은 쿼리키라 캐시 공유.
  const { data: sessions } = useQuery({
    queryKey: ["toss-market-sessions"],
    queryFn: fetchTossMarketSessions,
    staleTime: 60_000,
  });
  const session = nation === "KR" ? sessions?.kr : sessions?.us;
  const dimmed = getDimSleepingEnabled() && !!session && !session.open;

  const serverSort = sort === "PCT" ? "MARKET_CAP" : sort;
  const total = cat.stockCount;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const loaded = Math.min(pages, lastPage);   // 지금까지 받아 둘 페이지 수

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["tics-stocks", cat.ticsId, nation, sort, loaded],
    queryFn: async () => {
      const res = await Promise.all(
        Array.from({ length: loaded }, (_, i) =>
          fetchTossTicsStocks(cat.ticsId, nation, i + 1, serverSort)),
      );
      const stocks = res.flatMap(r => r.stocks);
      // 서버 정렬(시총·거래대금)은 페이지 순서가 곧 정렬이라 그대로 이어 붙인다.
      //   ★ 등락률 정렬은 여기서 하지 않는다 — 이 시점엔 실시간 시세가 없어 TICS 의 옛 값으로
      //     줄을 세우게 된다(실측: SK가스 표시 +2.70% 인데 TICS pct 0 → 맨 아래로 갔다).
      //     화면에 그리는 값으로 아래에서 다시 세운다.
      return { total: res[0]?.total ?? total, stocks };
    },
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
  // ★ 시세는 종목 카드와 같은 배치 소스로 따로 받는다(페이지당 KR 1콜 + US 1콜).
  //   TICS 구성종목의 가격은 시간외·프리마켓을 반영하지 않아 카드 등락률과 어긋난다.
  const codes = (data?.stocks ?? []).map(x => x.code);
  const krTickers = codes.map(krTickerOf).filter((v): v is string => !!v);
  const usCodes = codes.filter(c => !krTickerOf(c));
  const krQ = useQuery({
    queryKey: ["tics-quotes-kr", krTickers.join(",")],
    queryFn: () => fetchTossPrices(krTickers),
    enabled: krTickers.length > 0,
    staleTime: 30_000,
  });
  const usQ = useQuery({
    queryKey: ["tics-quotes-us", usCodes.join(",")],
    queryFn: () => fetchTossUsPrices(usCodes),
    enabled: usCodes.length > 0,
    staleTime: 30_000,
  });
  const quotes = useMemo(() => {
    const m = new Map<string, LiveQuote>();
    for (const p of krQ.data ?? []) {
      // Price.base 는 비거래일엔 현재가와 같아진다 → 그땐 직전 거래일 종가(prevClose)를 쓴다.
      const b = p.base && p.base !== p.price ? p.base : (p.prevClose || p.base);
      m.set(`A${p.ticker}`, { price: p.price, base: b, asOf: p.trade_date, volume: p.volume ?? 0 });
    }
    for (const [code, u] of usQ.data ?? new Map()) {
      m.set(code, {
        price: u.closeKrw || u.close,
        base: u.baseKrw || u.base,
        asOf: (u.tradeDateTime || "").slice(0, 10),
        volume: 1,   // 해외 응답엔 거래량이 없다 — 날짜로만 판정한다
      });
    }
    return m;
  }, [krQ.data, usQ.data]);

  // 이 팝업의 '최신 거래일' — 시세의 거래일과 셀이 알려준 일봉 날짜를 모두 본다.
  const newestDate = useMemo(() => {
    let m = Object.values(asOfMap).reduce((a, b) => (b > a ? b : a), "");
    for (const q of quotes.values()) if (q.asOf > m) m = q.asOf;
    return m;
  }, [asOfMap, quotes]);

  // 화면에 그릴 순서 — 실시간 시세가 있으면 그 등락률로, 없으면 TICS 값으로 줄을 세운다.
  const view = useMemo(() => {
    const list = (data?.stocks ?? []).map(st => {
      const q = quotes.get(st.code);
      const pct = q && q.base > 0 ? (q.price / q.base - 1) * 100 : st.pct;
      const asOf = q?.asOf || asOfMap[st.code] || "";
      // 갱신이 늦은 종목 = ① 오늘 한 주도 체결이 없거나(거래량 0) ② 날짜 자체가 옛날.
      //   ★ 날짜만 보면 안 된다 — 시세의 tradeDateTime 은 체결 여부와 무관하게 오늘로 찍힌다.
      //     장 시작 전엔 대부분 종목이 거래량 0 이라 close=base → "+0.00% (0원)" 인데,
      //     날짜 기준으로는 '최신' 이라 선명하게 남아 +와 − 사이에 끼어 있었다(실측).
      const noTrade = !!q && q.volume === 0;
      const stale = noTrade || (!!asOf && !!newestDate && asOf < newestDate);
      return { st, pct, stale };
    });
    // ★ 흐림은 **맨 뒤로**. 0% 로 잡혀 +와 − 사이에 끼면 목록을 훑을 때 걸린다
    //   (한국 섹터 팝업이 미체결을 뒤로 미는 것과 같은 규칙).
    list.sort((a, b) => (a.stale === b.stale ? b.pct - a.pct : a.stale ? 1 : -1));
    return list;
  }, [data, quotes, sort, asOfMap, newestDate]);

  const shownCount = data?.stocks.length ?? 0;
  const hasMore = loaded < lastPage;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full sm:max-w-5xl max-h-[85vh] overflow-hidden flex flex-col
                      rounded-t-xl sm:rounded-xl bg-white shadow-xl">
        <header className="px-4 py-3 border-b bg-gray-50 flex items-baseline gap-2">
          <h2 className="text-base font-bold text-gray-800">{cat.name}</h2>
          <span className="text-[11px] text-gray-500">
            {nation === "KR" ? "🇰🇷 한국" : "🇺🇸 미국"} · {total}종 ·{" "}
            <span className={`font-bold tabular-nums ${signColor(cat.pct)}`}>
              {cat.pct > 0 ? "+" : ""}{cat.pct.toFixed(2)}%
            </span>
            <span className="text-gray-400"> (토스 기준)</span>
          </span>
          <span className="ml-auto flex items-center gap-1">
            {SORTS.map(x => (
              <button key={x.key} onClick={() => { setSort(x.key); setPages(PAGE_STEP); }}
                      title={x.key === "PCT"
                        ? "등락률 순 — 토스가 이 정렬을 지원하지 않아 받아 온 종목을 우리가 정렬합니다"
                        : `${x.label} 순 (토스 정렬)`}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold border transition ${
                        sort === x.key ? "bg-gray-800 text-white border-gray-800"
                                       : "bg-white text-gray-500 border-gray-300 hover:bg-gray-50"}`}>
                {x.label}
              </button>
            ))}
            <button onClick={onClose}
                    className="text-gray-400 hover:text-gray-600 text-xl leading-none ml-1">✕</button>
          </span>
        </header>

        <div className="overflow-y-auto overscroll-contain px-3 py-3">
          {isLoading && !data ? (
            <div className="py-10 text-center text-sm text-gray-400">불러오는 중…</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-2 gap-y-3.5 items-stretch">
              {view.map(({ st: s, stale }, i) => (
                <TicsStockCell key={s.code} s={s} rank={i + 1} quote={quotes.get(s.code)}
                               dimmed={dimmed} newestDate={newestDate} staleProp={stale}
                               onAsOf={noteAsOf}
                               onOpenValuation={onOpenValuation} />
              ))}
            </div>
          )}
        </div>

        <div className="px-3 py-2 border-t flex items-center gap-2 text-[11px]">
          <span className="text-gray-500 tabular-nums">
            {shownCount}종 / 전체 {total}종
          </span>
          {hasMore && (
            <button onClick={() => setPages(p => p + PAGE_STEP)} disabled={isFetching}
                    title={`${PAGE_STEP}페이지(${PAGE_STEP * PAGE_SIZE}종) 더 받습니다 — 1페이지당 1콜`}
                    className="px-2 py-0.5 rounded border border-gray-300 bg-white text-gray-600
                               hover:bg-gray-100 disabled:opacity-40">
              {isFetching ? "불러오는 중…" : "더 보기"}
            </button>
          )}
          <span className="ml-auto text-[10px] text-gray-400 text-right leading-relaxed">
            종목명을 누르면 토스{onOpenValuation ? ", 📊 를 누르면 기업가치" : ""} ·
            배경 차트는 최근 60거래일 종가 · 우하단 날짜는 그 종목 값의 기준일(노랑이면 갱신이 늦은 것)
          </span>
        </div>
      </div>
    </div>
  );
}
