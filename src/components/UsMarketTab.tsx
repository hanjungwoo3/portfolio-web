import { useEffect, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { fetchYahooBatch, fetchDashboardChart, fetchYasunNightFutures, fetchTossUsStockCandles, fetchKrBondYieldSeries } from "../lib/api";
import type { UsIndex, MarketIndexKey } from "../lib/api";
import { isSymbolSleeping, marketOfSymbol, fmtAgo, isUsExtendedTradingOpen, krFuturesName, krFuturesDesc, isKrNightSession, isQuoteStale, isUsRateSymbol, displayPctOf, isFxFuturesWeekendClosed } from "../lib/format";
import { getDimSleepingEnabled, checkPersonalProxyYasunSupport } from "../lib/proxyConfig";
import { buildDashboardPage, dashboardGroupNav, dashboardTagTone, dashboardTagCard, leadRowOf, isLastLead, rowLead, type DashboardPage } from "../lib/dashboardGroups";
import { RotationTab } from "./RotationTab";
import { requestTab, isTabVisible } from "../lib/tabNav";
import { GroupNavBar } from "./GroupNavBar";
import { US_PAIRS, allYahooSymbols } from "../lib/usMarketData";
import { useAdaptiveRefreshMs } from "../lib/proxyStatus";
import { reportRefresh } from "../lib/lastRefresh";
import { handleTossLinkClick, TOSS_SYMBOL_URL } from "../lib/toss";
import { Sparkline } from "./Sparkline";
import { MarketFlowModal } from "./MarketFlowModal";
import { EtfCompositionDialog } from "./EtfCompositionDialog";
import { TicsSectorBoard } from "./TicsSectorBoard";
import { EtfTopCards } from "./EtfTopCards";
import { ValueupMiniCard } from "./ValueupCard";
import { HlPerpCard } from "./HlPerpCard";
import { TickArrow } from "./TickArrow";
import { requestHeatmap, CARD_HEATMAP_LINK } from "../lib/heatmapNav";

// KR ETF Yahoo 심볼 패턴 (예: "091160.KS") — 토스 compositions API 지원 대상
const KR_ETF_SYMBOL_RE = /^([\dA-Za-z]{6})\.K[SQ]$/;

const WORKER_UPDATE_GUIDE_URL = "https://github.com/hanjungwoo3/portfolio-web/blob/main/workers/proxy/UPDATE-POST-SUPPORT.md";
function krEtfTicker(symbol: string): string | null {
  const m = KR_ETF_SYMBOL_RE.exec(symbol);
  return m ? m[1] : null;
}

const BASE_REFRESH_MS = 10_000;

function fmtPrice(symbol: string, price: number): string {
  // 원엔은 한국 관행대로 100엔 기준 표기 (Yahoo 는 1엔당 원 = 8.6원 꼴)
  if (symbol === "JPYKRW=X") return (price * 100).toFixed(2);
  if (symbol.includes("KRW")) return price.toFixed(2);
  if (symbol === "^MOVE" || symbol === "^VIX" || symbol === "^TNX" || symbol === "^TYX" || symbol === "^US2Y") return price.toFixed(2);
  if (price >= 1000) return Math.round(price).toLocaleString();
  return price.toFixed(2);
}

function quoteUrl(symbol: string): string {
  // 야간선물 — yasun.gg
  if (symbol === "^KS200N") return "https://yasun.gg/kospi200";
  if (symbol === "^KQ150N") return "https://yasun.gg/kosdaq150";
  // 명시 매핑 우선 (VKOSPI=investing 등) — krMatch 보다 먼저 (VKOSPI 가 6자리 영숫자라 토스로 오인되던 문제)
  if (TOSS_SYMBOL_URL[symbol]) return TOSS_SYMBOL_URL[symbol];
  // 한국 보유 종목 (6자리) 또는 KODEX/.KS ETF (6자리.KS) — 모두 토스
  const krMatch = /^([\dA-Za-z]{6})(?:\.KS)?$/.exec(symbol);
  if (krMatch) return `https://tossinvest.com/stocks/A${krMatch[1]}`;
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

interface UsMarketTabProps {
  // ETF 구성종목 모달의 "한번에 추가" → 전역 검색창으로 전달
  onRequestSearch?: (q: string) => void;
  // 📊 기업가치 모달 열기 — 섹터 흐름 팝업에서 종목을 누를 때 쓴다.
  //   모달 자체는 App 이 들고 있어서(보유 평단·메모 진입가를 붙여야 한다) 여기선 요청만 올린다.
  onOpenValuation?: (ticker: string, name: string) => void;
  page?: DashboardPage;   // 주간·야간·반도체 — 메뉴의 지수 탭 셋 중 어느 것인지
  // 그룹 색인바 sticky 고정 위치(px) — App 의 헤더+탭바 아래. 미지정 시 0.
  navStickyTop?: number;
}

export function UsMarketTab({ onRequestSearch, onOpenValuation, navStickyTop = 0, page = "day" }: UsMarketTabProps = {}) {
  const yahooSymbols = allYahooSymbols();
  const REFRESH_MS = useAdaptiveRefreshMs(BASE_REFRESH_MS);

  const { data: usMapRaw, dataUpdatedAt: usUpdatedAt } = useQuery({
    queryKey: ["yahoo-batch", yahooSymbols.length],
    queryFn: () => fetchYahooBatch(yahooSymbols),
    refetchInterval: REFRESH_MS,
  });

  // 야간선물(yasun.gg) — 코스피200/코스닥150. Yahoo 와 분리된 별도 fetch.
  const NIGHT_SYMS = ["^KS200N", "^KQ150N"] as const;
  const nightQs = useQueries({
    queries: NIGHT_SYMS.map(sym => ({
      queryKey: ["yasun-night", sym],
      queryFn: () => fetchYasunNightFutures(sym),
      refetchInterval: REFRESH_MS,
      staleTime: 60_000,
    })),
  });
  // Yahoo + 야선 통합 — 카드 렌더는 usMap?.get(symbol) 그대로 사용
  const usMap = new Map(usMapRaw ?? []);
  // 야선 캔들 close 시계열 — 스파크라인용 (^KS200N/^KQ150N)
  const nightClosesMap = new Map<string, number[]>();
  for (let i = 0; i < NIGHT_SYMS.length; i++) {
    const d = nightQs[i]?.data;
    if (d) {
      usMap.set(NIGHT_SYMS[i], d.index);
      nightClosesMap.set(NIGHT_SYMS[i], d.closes);
    }
  }

  useEffect(() => { if (usUpdatedAt > 0) reportRefresh(usUpdatedAt); }, [usUpdatedAt]);

  const tier0 = US_PAIRS.filter(p => p.tier === "T0");
  // 지수 대시보드 그룹 — 데스크톱·모바일 공용 정의(lib/dashboardGroups).
  //   주간·야간·반도체 중 어느 페이지인지는 메뉴 탭이 정한다(page).
  const T0_SECTIONS = buildDashboardPage(page);

  // T0 카드 sparkline — 일부 심볼 (SOX=F) 은 Yahoo 가 historical 안 줌 → 가장 가까운 현물 차트로 폴백
  const SPARKLINE_FALLBACK: Record<string, string> = {
    "SOX=F": "^SOX",   // 필반 선물 → 필반 현물
  };
  // 스파크라인 — **지금 페이지에 있는 카드만** 받는다(예전엔 US_PAIRS 전체를 페이지와 무관하게 받았다).
  //   페이지가 셋으로 나뉘어 한 번에 보이는 건 일부다. 대체 차트(SOX=F → ^SOX)와 선물도 같이.
  const pairBySym = new Map(US_PAIRS.map(p => [p.symbol, p]));
  const chartSet = new Set<string>();
  for (const sec of T0_SECTIONS) {
    if (sec.render) continue;
    for (const sym of sec.rows.flat()) {
      const p = pairBySym.get(sym);
      if (!p) continue;
      chartSet.add(sym);
      if (p.future) chartSet.add(p.future);
      if (SPARKLINE_FALLBACK[sym]) chartSet.add(SPARKLINE_FALLBACK[sym]);
    }
  }
  const allYahooForCharts = [...chartSet];
  const yahooChartQs = useQueries({
    queries: allYahooForCharts.map(sym => ({
      queryKey: ["yahoo-chart", sym, "3mo"],
      queryFn: () => fetchDashboardChart(sym),
      staleTime: 60 * 60 * 1000,
      refetchOnWindowFocus: false,
    })),
  });
  const yahooChartMap = new Map(
    allYahooForCharts.map((sym, i) => [sym, yahooChartQs[i]?.data ?? []])
  );

  // 야후 히스토리가 빈약한 신규 ADR(SKHY 등) — 야후 own 이 비면 토스 자체 일봉(c-chart) 폴백.
  const TOSS_CHART_SYMBOLS = ["SKHY"];
  const tossStockChartQs = useQueries({
    queries: TOSS_CHART_SYMBOLS.map(sym => ({
      queryKey: ["toss-us-candles", sym],
      queryFn: () => fetchTossUsStockCandles(sym),
      staleTime: 60 * 60 * 1000,
      refetchOnWindowFocus: false,
    })),
  });
  const tossStockChartMap = new Map(
    TOSS_CHART_SYMBOLS.map((sym, i) => [sym, tossStockChartQs[i]?.data ?? []])
  );

  // 한국 국고채 스파크라인 — 토스 overview 가 이 셋만 miniChart 를 빈 배열로 준다.
  //   종목 일봉과 같은 c-chart/kr-s 가 국고채 코드도 받아서 그걸로 받는다(3콜, 1시간 캐시).
  const KR_BOND_CODE: Record<string, string> = {
    "^KR2Y": "KR1BENCH0002", "^KR10Y": "KR1BENCH0010", "^KR30Y": "KR1BENCH0030",
  };
  const krBondSyms = Object.keys(KR_BOND_CODE);
  const krBondQs = useQueries({
    queries: krBondSyms.map(sym => ({
      queryKey: ["kr-bond-series", sym],
      queryFn: () => fetchKrBondYieldSeries(KR_BOND_CODE[sym], 60),
      staleTime: 60 * 60 * 1000,
      refetchOnWindowFocus: false,
    })),
  });
  const krBondChartMap = new Map(krBondSyms.map((s, i) => [s, krBondQs[i]?.data ?? []]));

  const t0ChartMap = new Map(
    tier0.map(p => {
      // 야선 — yasun 캔들 close 시계열
      const yasunCloses = nightClosesMap.get(p.symbol);
      if (yasunCloses && yasunCloses.length > 1) return [p.symbol, yasunCloses];
      const own = yahooChartMap.get(p.symbol) ?? [];
      if (own.length > 1) return [p.symbol, own];
      // 야후 심볼 별칭(SOX=F→^SOX 등) — 카드 심볼과 야후 심볼이 다를 때
      const fb = SPARKLINE_FALLBACK[p.symbol];
      if (fb) {
        const fbArr = yahooChartMap.get(fb) ?? [];
        if (fbArr.length > 1) return [p.symbol, fbArr];
      }
      // 토스 자체 일봉(c-chart) — 야후가 아직 안 주는 신규 ADR 의 본인 데이터 폴백
      const tossOwn = tossStockChartMap.get(p.symbol);
      if (tossOwn && tossOwn.length > 1) return [p.symbol, tossOwn];
      // Yahoo 가 차트 안 주는 심볼(^US2Y) — 토스 overview mini-chart 시계열로 폴백
      const tossSpark = usMap?.get(p.symbol)?.sparkline;
      if (tossSpark && tossSpark.length > 1) return [p.symbol, tossSpark];
      // 한국 국고채 — overview miniChart 가 비어 있어 c-chart 일봉으로 따로 받는다
      const krBond = krBondChartMap.get(p.symbol);
      if (krBond && krBond.length > 1) return [p.symbol, krBond];
      return [p.symbol, own];
    })
  );

  const dimEnabled = getDimSleepingEnabled();
  const [marketFlowFor, setMarketFlowFor] = useState<MarketIndexKey | null>(null);
  const [etfDialog, setEtfDialog] = useState<{ ticker: string; name: string } | null>(null);
  // 야간선물(yasun.gg)은 프록시를 타므로 구버전 개인 워커면 값이 빈다 → 그때만 업데이트 안내.
  //   "값이 없다"만으로 워커를 탓하면 업스트림 차단(예: investing.com Cloudflare 챌린지)까지
  //   워커 탓으로 오진한다. 반드시 실제 화이트리스트 검사 결과("outdated")로만 띄운다.
  const [yasunOutdated, setYasunOutdated] = useState(false);
  useEffect(() => {
    void checkPersonalProxyYasunSupport().then(s => setYasunOutdated(s === "outdated"));
  }, []);

  // 그룹 색인 칩바 — 헤더+탭바 아래(navStickyTop)에 고정. 섹션 앵커 = "usidx-" + section.id
  const navItems = dashboardGroupNav(T0_SECTIONS);
  const idxScrollMargin = navStickyTop + 44;

  return (
    <div className="space-y-3">
      <GroupNavBar items={navItems} idPrefix="usidx-"
                   stickyTop={navStickyTop} scrollMarginTop={idxScrollMargin} />
      {/* ─── Tier 0 — 한국시장 영향 관계 기준 그룹 (라벨 헤더 + 한 화면 표시) ─── */}
      {/* 다른 탭과 같은 전체 폭 — 예전엔 lg 에서 75% 로 줄여 PC 에서만 좁아 보였다 */}
      <div className="space-y-4">
        {T0_SECTIONS.map((section) => (
          <div key={section.label} id={`usidx-${section.id}`}
               style={{ scrollMarginTop: idxScrollMargin }}
               className="relative space-y-2 rounded-xl border border-gray-300 bg-white p-2.5 pt-4 mt-1.5">
            {/* 섹터명 책갈피 — 카드 상단에 겹치게 */}
            <span className="absolute -top-3 left-3 z-10 px-2 py-0.5 rounded-md border border-gray-300 bg-gray-50
                             text-sm font-bold text-gray-700 whitespace-nowrap">
              {section.label}
              {section.link && isTabVisible(section.link.vis) && (
                <button onClick={() => requestTab(section.link!.tab)}
                        className="ml-1.5 text-[11px] font-bold text-indigo-600 hover:underline">
                  자세히 →
                </button>
              )}
            </span>
            {/* 폴백 고정 카드(한국 섹터·반도체 TOP2+·소부장)는 오늘 등락률(%) 내림차순 정렬 (6개씩 줄바꿈) */}
            {/* 한국 섹터 — 토스 TICS 분류. 미국 블록과 **같은 한글 분류**라 이름으로 맞출 수 있다. */}
            {section.render === "etfTop" && (
                  <EtfTopCards onOpenEtf={(code, name) => setEtfDialog({ ticker: code, name })} />
                )}
                {section.note && <div className="text-[11px] text-gray-500 leading-snug">{section.note}</div>}
                {section.render === "rotation" && (
              <RotationTab embedded extrasOnly onOpenValuation={(t, n) => onOpenValuation?.(t, n ?? "")} />
            )}
                {section.render === "sectorFlow" && (
              <TicsSectorBoard onOpenValuation={onOpenValuation}
                                krClosed={page === "night"} />
            )}
            {(arr => !section.pairRows ? arr : (
              // 짝 줄 — 상자 둘을 좌우로 **붙여서**. 상자 폭은 카드 수에 비례(flex-grow), 남는 자리는 오른쪽 빈칸(한 줄 8장 기준)
              <div className="space-y-0">
                {Array.from({ length: Math.ceil(arr.length / 2) }, (_, k) => {
                  const idx = [2 * k, 2 * k + 1].filter(i => i < arr.length);
                  const used = idx.reduce((t, i) => t + section.rows[i].length, 0);
                  return (
                    <div key={k} className="flex gap-2">
                      {idx.map(i => <div key={i} className="min-w-0" style={{ flex: `${section.rows[i].length} 1 0` }}>{arr[i]}</div>)}
                      {8 - used > 0 && <div className="hidden lg:block" style={{ flex: `${8 - used} 1 0` }} />}
                    </div>
                  );
                })}
              </div>
            ))((section.render ? []
              : section.id === "sector"
              ? chunk(
                  section.rows.flat().sort((a, b) =>
                    (displayPctOf(b, usMap.get(b)) ?? -Infinity) - (displayPctOf(a, usMap.get(a)) ?? -Infinity)),
                  6)
              : section.rows
            ).map((group, gi) => (
              // 6열 그리드 — 화면은 전체 폭이지만 카드 줄만 lg 75% 로 묶어 카드 크기는 예전 그대로(왼쪽 정렬)
              <div key={gi} className={section.rowLabels ? `relative ${section.pairRows ? "" : "-mr-[9px]"} rounded-lg border border-gray-200 bg-gray-50/50 pl-9 pr-2 pb-2 pt-4 mt-2` : ""}>
                {/* 줄 책갈피 — 이 줄이 어느 단계인지(반도체·전공정…). 위에 얹으면 카드 위 가격 띠와 겹쳐
                    안 보여서, 상자 **왼쪽에 세로 띠**로 따로 뺐다(글자는 위→아래로 세워 쓴다). */}
                {section.rowLabels?.[gi] && (
                  <span className={`absolute left-0 inset-y-0 w-7 flex items-center justify-center border-0 border-r rounded-l-lg
                                    text-xs font-bold tracking-widest [writing-mode:vertical-rl] [text-orientation:upright]
                                    ${dashboardTagTone(section.rowLabels[gi])}`}>
                    {section.rowLabels[gi]}
                  </span>
                )}
              {(() => {
                const cards = group.map(symbol => {
              // 코리아 밸류업 — 네이버 KVALUE 전용 카드(Yahoo 미제공). 다른 지수 카드와 동일 크기 셀.
              if (symbol === "KVALUE") return <ValueupMiniCard key="KVALUE" />;
              if (symbol === "SKHY-PERP") return <HlPerpCard key="SKHY-PERP" coin="SKHY" name="SK하이닉스 24h" />;
              if (symbol === "SMSN-PERP") return <HlPerpCard key="SMSN-PERP" coin="SMSN" name="삼성전자 24h" />;
              const rawP = tier0.find(x => x.symbol === symbol);
              if (!rawP) return null;
              // 한국 선물(^KS200N/^KQ150N)은 현재 KST 세션에 따라 주간/야간선물로 표시명 변경
              const p = marketOfSymbol(rawP.symbol) === "KR_NIGHT"
                ? { ...rawP, name: krFuturesName(rawP.symbol), desc: krFuturesDesc() }
                : rawP;
              const q = usMap?.get(p.symbol);
              const sleeping = isSymbolSleeping(p.symbol);
              // 메인 가격/변동률 — 한국 입장(미국장 마감 후 아침에 확인):
              // · REGULAR: regularPct (어제 종가 대비)
              // · 시간외(PRE/POST/POSTPOST/PREPRE/CLOSED): postPrice + 어제 종가(prevClose) 대비
              //   = 정규장 + 시간외 누적 변동률 (예: -7.75%)
              // 시간외 진입~마감 전체 구간에서 postPrice 일관 사용 → POST↔POSTPOST 전환 시 점프 없음
              const offHoursStates = ["PRE", "POST", "POSTPOST", "PREPRE", "CLOSED"];
              const isOffHours = q?.marketState != null && offHoursStates.includes(q.marketState);
              // dim 처리(흐리게) — 정규장 마감 후 모든 상태 (POST 부터). PRE 는 새 거래일 시작 직전이라 제외.
              // 24h 시장(환율 KRW=X, 달러 인덱스, 선물·암호화폐 등)은 Yahoo가 CLOSED 를 자주 반환하지만 흐림 제외.
              const is24h = marketOfSymbol(p.symbol) === "OTHER";
              const isClosed = !is24h && q?.marketState != null
                && ["POST", "POSTPOST", "PREPRE", "CLOSED"].includes(q.marketState);
              // 거래중('열림')이면 흐림 제외 — 정규/시간외 marketState 또는 미국 개별종목 24h 거래창(토스).
              //   (정규장 마감은 별도 '마감 책갈피'로 표시되므로 흐림과 무관)
              const inSession = !!(q?.marketState
                  && ["REGULAR", "PRE", "POST", "POSTPOST", "PREPRE"].includes(q.marketState))
                || (marketOfSymbol(p.symbol) === "US" && isUsExtendedTradingOpen());
              // 한국 야간선물(KR_NIGHT) — 거래중(REGULAR)이면 inSession 으로 흐림 제외,
              //   개장 대기·마감 구간(marketState CLOSED + sleeping)이면 다른 종목과 동일하게 흐림.
              const isNightFut = marketOfSymbol(p.symbol) === "KR_NIGHT";
              // 갱신 정체(흐림) — 24h 거래(시각창) 중에도 '진짜 멈춘' 종목(VIX·데이터 끊김)을 freshTime 90분+ 정체로 잡음.
              //   미국 종목/ETF 는 토스 실측 체결시각이 24h 갱신돼 통과(밝게), 주말·VIX 마감은 정체/시각창으로 흐림.
              const stale = isQuoteStale(q?.freshTime);
              // 국채 yield(2Y/10Y 등)는 출처(토스·Yahoo)가 섞여도 표현 통일 — 흐림 제외.
              const isRate = isUsRateSymbol(p.symbol);
              // 24h 시장(외환·선물·달러인덱스)의 주말 휴장 — isMarketOpen("OTHER") 이 늘 true 라
              //   sleeping/isClosed 로는 안 잡힌다. 암호화폐는 진짜 24/7 이라 제외된다.
              const weekendClosed = is24h && isFxFuturesWeekendClosed(p.symbol);
              // 미 국채 yield 는 **미국 정규장에만 움직이는 게 아니다** — 아시아·런던 세션에도
              //   거래된다(한국 낮에도 값이 바뀐다, 실측). sleeping(미국 정규장)으로 흐리면
              //   멀쩡히 살아 있는 값을 죽은 것처럼 보여준다.
              //   출처(토스·Yahoo)가 섞여 freshTime·marketState 는 못 믿으니 외환·선물과 같은
              //   **주말 휴장**만 본다 — 셋이 같은 근거라 2Y 만 흐리는 일도 없다.
              const dimNow = dimEnabled && (isRate
                ? isFxFuturesWeekendClosed(p.symbol)
                : (stale || weekendClosed || (!inSession && (sleeping || isClosed))));
              const effPrice = isOffHours && q?.postPrice ? q.postPrice : q?.price;
              const effBase = q?.prevClose;
              const pct = (q?.marketState === "REGULAR" && q.regularPct != null)
                ? q.regularPct
                : (effPrice != null && effBase != null && effBase > 0
                   ? ((effPrice - effBase) / effBase) * 100
                   : null);
              // 개장 전·마감 등 현재 세션 변동이 0(토스 base==close)이면 마지막 정규장 %로 폴백 표시.
              //   한국 지수·ETF 가 개장 전 % 가 비는 문제 — 미국 종목은 마감 후에도 마지막 % 가 노출되므로 동일하게 맞춤.
              const liveFlat = pct == null || Math.abs(pct) < 0.005;
              const showPct = (sleeping && liveFlat && q?.regularPct != null && Math.abs(q.regularPct) >= 0.005)
                ? q.regularPct : pct;
              // 메인 변동률(본문 큰 %) = 어제 종가 대비 누적(정규장 + 시간외) = showPct.
              //   정규장 마감가·마감 변동%는 상단 노란 책갈피가 담당.
              //   (예전엔 본문에 '애프터 변동분'만 떠서, 시간외 보합이면 0.00% 로 죽던 문제 → 누적으로 환원)
              const mainPct = showPct;
              // direction === "inverse"(공포지수·환율·달러인덱스·금리 등) → 상승=한국 위험 → 색 반전
              // (빨강=좋음 / 파랑=나쁨 기준). SemiCheckTab 과 동일 규칙.
              const isInverse = p.direction === "inverse";
              const effUp = isInverse ? (mainPct != null && mainPct < 0) : (mainPct != null && mainPct > 0);
              const effDn = isInverse ? (mainPct != null && mainPct > 0) : (mainPct != null && mainPct < 0);
              const chartArr = t0ChartMap.get(p.symbol) ?? [];
              const sparkColor = dimNow ? "#94a3b8"
                : (isInverse && chartArr.length > 1)
                  ? (chartArr[chartArr.length - 1] > chartArr[0] ? "#2563eb" : "#dc2626")
                  : undefined;
              const isFuture = p.symbol.endsWith("=F") || p.symbol === "^KS200N" || p.symbol === "^KQ150N";
              const bg = dimNow
                ? "bg-gray-100 border-transparent"
                : effUp ? "bg-rose-50 border-rose-200"
                : effDn ? "bg-blue-50/70 border-blue-200"
                : "bg-white border-gray-200";
              const sign =
                effUp ? "text-rose-600"
                : effDn ? "text-blue-600"
                : "text-gray-900";
              const nameColor = isFuture ? "text-amber-700" : "text-gray-900";
              const isKospi  = p.symbol === "^KS11";
              const isKosdaq = p.symbol === "^KQ11";
              const hasFlow  = isKospi || isKosdaq;
              const indexKey = isKospi ? "KOSPI" : isKosdaq ? "KOSDAQ" : null;
              // 정규장 종료(sleeping) 후 항상 마감가 책갈피 표시.
              // 시간외 거래값(regularPrice 별도)이 있으면 그 값을, 없으면 현재가를 마감가로 통일 표시.
              const showCloseTag = sleeping && effPrice != null;
              const closeVal = q?.regularPrice ?? effPrice;
              const regPct = q?.regularPct ?? pct;
              const regSign = regPct == null ? "text-gray-700"
                : (isInverse ? regPct < 0 : regPct > 0) ? "text-rose-600"
                : (isInverse ? regPct > 0 : regPct < 0) ? "text-blue-600" : "text-gray-700";
              // 마감 책갈피는 노란 배경 + 흐림 제외 → dim 은 콘텐츠 자식에만 적용
              const dimCls = dimNow ? "opacity-60" : "";
              return (
                <div key={p.symbol} className={`relative h-full`}>
                  {/* ETF 책갈피 — KR ETF (예: 069500.KS) 만. 왼쪽 위. 클릭 시 구성종목 모달 */}
                  {(() => {
                    const etfTk = p.krStock ? null : krEtfTicker(p.symbol);   // 한국 개별주는 ETF 가 아니다
                    if (!etfTk) return null;
                    return (
                      <button onClick={() => setEtfDialog({ ticker: etfTk, name: p.name })}
                              title="ETF 구성 종목 보기"
                              className="absolute -top-2 left-1 z-20 px-1.5 py-0 rounded
                                         text-[10px] font-bold leading-tight
                                         text-violet-700 bg-violet-100/30 hover:bg-violet-100/60
                                         border border-violet-300/40">
                        ETF
                      </button>
                    );
                  })()}
                  {/* 정규장 마감가 책갈피 — 카드 위로 올림(-top-2). 노란 배경 + 흐림 제외(z-20) */}
                  {showCloseTag && closeVal != null && (
                    <div className="absolute -top-2 right-1 z-20 px-1.5 py-0
                                    border rounded bg-yellow-200/25 border-yellow-400/40
                                    text-[10px] font-medium leading-tight whitespace-nowrap">
                      {q?.currency === "KRW" && q?.regularPriceUsd != null && (
                        <span className={`tabular-nums mr-1 text-gray-900 ${dimNow ? "opacity-50" : ""}`}>
                          (${q.regularPriceUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })})
                        </span>
                      )}
                      <span className={`tabular-nums ${regSign}`}>
                        {closeVal < 1000 ? closeVal.toFixed(2) : Math.round(closeVal).toLocaleString()}
                      </span>
                      {regPct != null && (
                        <span className={`tabular-nums ml-1 font-bold text-[11px] ${regSign}`}>
                          ({regPct >= 0 ? "+" : ""}{regPct.toFixed(2)}%)
                        </span>
                      )}
                    </div>
                  )}
                  <div className={`relative overflow-hidden h-full flex flex-col gap-0.5
                                  rounded-lg border px-3 py-1.5
                                  ${leadRowOf(section, p.symbol) >= 0 ? dashboardTagCard(section.rowLabels?.[leadRowOf(section, p.symbol)]) : bg}`}>
                  <Sparkline data={chartArr}
                             width={400} height={80}
                             color={sparkColor}
                             className={`absolute inset-0 w-full h-full opacity-50
                                        pointer-events-none ${dimCls}`} />
                  <div className={`relative z-10 flex items-baseline gap-1.5 ${dimCls}`}>
                    {sleeping && !inSession && (
                      <span className="text-[11px] text-gray-400">zZ</span>
                    )}
                    {/* 종목명 자체가 외부 링크 (Toss/Yahoo) */}
                    <a href={quoteUrl(p.symbol)}
                       target="_blank" rel="noopener noreferrer"
                       onClick={e => handleTossLinkClick(e, quoteUrl(p.symbol))}
                       title={`${p.name} 자세히 보기`}
                       className={`text-sm font-bold ${nameColor} hover:underline min-w-0 truncate`}>
                      {p.name}
                    </a>
                    {/* 매매동향 모달 버튼 — KOSPI/KOSDAQ 만 */}
                    {hasFlow && indexKey && (
                      <button onClick={() => setMarketFlowFor(indexKey)}
                              title={`${p.name} 투자자별 매매동향`}
                              className="ml-1 px-1 py-0.5 rounded text-[10px] text-gray-500
                                         bg-white/60 hover:bg-white border border-gray-200">
                        📊
                      </button>
                    )}
                    {/* 히트맵 버튼은 카드 오른쪽 아래 책갈피로 내렸다(아래 참조) —
                        이름 줄에 있으면 ml-auto 로 밀려 긴 종목명을 잘라먹었다. */}
                  </div>
                  <div className={`relative z-10 text-[11px] text-gray-500 truncate ${dimCls}`}>
                    {p.desc}
                  </div>
                  {(p.symbol === "^KS200N" || p.symbol === "^KQ150N")
                    && effPrice == null && yasunOutdated ? (
                    /* 개인 워커 구버전 — yasun.gg(야선) 화이트리스트 누락 */
                    <div className="relative z-10 flex items-center mt-auto min-h-[1.75rem]">
                      <a href={WORKER_UPDATE_GUIDE_URL} target="_blank" rel="noopener noreferrer"
                         title={`개인 워커가 구버전이라 ${p.name} 미표시 — 업데이트 가이드`}
                         className="text-[12px] font-bold text-amber-700 underline hover:text-amber-900">
                        ⚠️ 워커 업데이트 ↗
                      </a>
                    </div>
                  ) : (
                  <div className={`relative z-10 flex items-end mt-auto ${dimCls}`}>
                    <span className={`flex-1 text-left tabular-nums ${sign}`}>
                      {q?.currency === "KRW" && q?.priceUsd != null && (
                        <span className="block text-[10px] font-normal leading-tight text-gray-900">
                          ${q.priceUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </span>
                      )}
                      <span className="text-sm">{effPrice != null ? fmtPrice(p.symbol, effPrice) : "—"}</span>
                    </span>
                    <span className={`flex-1 text-right text-xl font-bold tabular-nums ${sign}`}>
                      {/* 직전 틱 대비 화살표 — 주식 카드와 같은 규칙, % 왼쪽 */}
                      <TickArrow value={effPrice} className="mr-1 text-sm" />
                      {showPct != null && Math.abs(showPct) >= 0.005
                        ? `${showPct >= 0 ? "+" : ""}${showPct.toFixed(2)}%`
                        : ""}
                    </span>
                  </div>
                  )}
                  </div>
                  {/* lead — 첫 카드(간밤 미국 대장주)가 '원인'. 카드 사이 틈 가운데에 큰 ➜ (원 없이). 틈은 다른 그룹과 같게 둬 카드 크기를 맞춘다.
                      강조는 테두리가 아니라 **카드 배경색**(그 줄 단계 색) — 오르내림은 글자·차트 색이 알려 준다. */}
                  {isLastLead(section, p.symbol) && (
                    <div className="absolute top-1/2 left-full ml-1 lg:ml-[22px] -translate-x-1/2 -translate-y-1/2 z-30
                                    text-4xl font-black text-gray-400 opacity-20 leading-none pointer-events-none">➜</div>
                  )}
                  {/* 역할 책갈피 — 이 그룹에서 이 종목이 무엇인지(예: 전공정·원자력). 오른쪽 아래가 비어
                      있어 그 자리에 둔다(🗺️ 히트맵은 코덱스200·코스닥150 전용이라 겹치지 않는다). */}
                  {/* 기업가치 — 한국 종목 카드(순환매 줄)만. 히트맵 책갈피와 같은 모양으로 카드 바깥 오른쪽 아래.
                      종목명은 그대로 토스 링크다. */}
                  {p.krStock && (
                    <button
                      onClick={() => onOpenValuation?.(p.symbol.slice(0, 6), p.name)}
                      title={`${p.name} 기업가치 보기`}
                      className="absolute -bottom-1 right-1 z-20 px-1.5 py-0 rounded
                                 text-[9px] leading-tight whitespace-nowrap font-bold
                                 text-indigo-700 bg-indigo-50 border border-indigo-300/70
                                 hover:bg-indigo-100 transition">
                      📊
                    </button>
                  )}
                  {section.tags?.[p.symbol] && (
                    <div className={`absolute -bottom-1 right-1 z-20 px-1.5 py-0 rounded border
                                     text-[9px] leading-tight whitespace-nowrap font-bold
                                     ${dashboardTagTone(section.tags[p.symbol])}`}>
                      {section.tags[p.symbol]}
                    </div>
                  )}
                  {/* 구성종목 히트맵 — 코덱스200·코스닥150 만. '정규장 마감' 책갈피와 같은 모양으로
                      카드 **바깥 오른쪽 아래**에 붙인다(카드 안은 overflow-hidden 이라 잘린다). */}
                  {CARD_HEATMAP_LINK[p.symbol] && (
                    <button
                      onClick={() => requestHeatmap(CARD_HEATMAP_LINK[p.symbol], { sizeMode: "volume" })}
                      title={`${p.name} 구성종목 히트맵(거래량) 보기`}
                      className="absolute -bottom-1 right-1 z-20 px-1.5 py-0 rounded
                                 text-[9px] leading-tight whitespace-nowrap font-bold
                                 text-emerald-700 bg-emerald-50 border border-emerald-300/70
                                 hover:bg-emerald-100 transition">
                      🗺️ 히트맵
                    </button>
                  )}
                  {sleeping && !isRate && fmtAgo(q?.regularMarketTime) && (
                    <div className="absolute -bottom-1 left-1 z-20 px-1.5 py-0 rounded
                                    text-[9px] leading-tight whitespace-nowrap
                                    text-gray-500 bg-gray-100 border border-gray-300/60">
                      {fmtAgo(q?.regularMarketTime, isNightFut ? (isKrNightSession() ? "야간 마감" : "주간 마감") : "정규장 마감")}
                    </div>
                  )}
                </div>
              );
                });
                if (!section.extras) return (
                  <div style={section.pairRows ? { gridTemplateColumns: `repeat(${group.length}, minmax(0, 1fr))` } : undefined}
                       className={`grid grid-cols-3 sm:grid-cols-4 gap-y-4 gap-x-2 ${section.pairRows ? "" : section.wide ? "lg:grid-cols-8" : `lg:max-w-[75%] ${section.lead ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_1.75rem_repeat(4,minmax(0,1fr))]" : "lg:grid-cols-6"}`}`}>
                    {cards}
                  </div>
                );
                // 순환매 줄 — 블록 셋: [미국 대장주] ➜ [한국] [국내 상장 미국 ETF(참고, 따로 상자)].
                //   블록 폭을 카드 수에 비례(flex-grow)하게 주고 나머지는 빈칸으로 채워, 줄마다 카드 크기가 같다(한 줄 8장 기준).
                const n = rowLead(section, gi);
                const exAt = group.findIndex(x => section.extras!.includes(x));
                const krEnd = exAt < 0 ? group.length : exAt;
                const lead = cards.slice(0, n), kr = cards.slice(n, krEnd), ex = exAt < 0 ? [] : cards.slice(exAt);
                // 한국 쪽 최대 장 수(모든 줄 기준) — 한국 틀을 이 칸 수로 고정해 참고 상자가 줄마다 같은 자리에서 시작한다
                const krMax = Math.max(...section.rows.map((r, ri) => r.slice(rowLead(section, ri)).filter(x => !section.extras!.includes(x)).length));
                const col = (k: number) => ({ flex: `${k} 1 0`, gridTemplateColumns: `repeat(${k}, minmax(0, 1fr))` });
                return (
                  <div className="flex items-stretch gap-2">
                    <div className="grid gap-x-2" style={col(lead.length)}>{lead}</div>
                    <div className="w-7 shrink-0" />
                    {/* 한국 쪽은 늘 krMax 칸짜리 보이지 않는 틀 — 카드가 적으면 왼쪽부터 채우고 나머지는 빈칸 */}
                    <div className="grid gap-x-2" style={col(krMax)}>{kr}</div>
                    {ex.length > 0 && (
                      <div className="relative grid gap-x-2 rounded-lg border border-sky-200 bg-sky-50/60 px-1.5 pb-1.5 pt-6 -mt-3.5" style={col(ex.length)}
                           title={`${section.extraTag?.[group[exAt]] ?? "🇺🇸 미국"} ETF — 참고용(통계엔 안 들어간다)`}>
                        {ex}
                      </div>
                    )}
                    {8 - n - krMax - ex.length > 0 && <div style={{ flex: `${8 - n - krMax - ex.length} 1 0` }} />}
                  </div>
                );
              })()}
              </div>
            )))}
          </div>
        ))}
      </div>

      {/* 시장 매매동향 모달 — KOSPI/KOSDAQ 카드 📊 클릭 시 */}
      {marketFlowFor && (
        <MarketFlowModal
          isOpen={true}
          indexKey={marketFlowFor}
          onClose={() => setMarketFlowFor(null)}
        />
      )}

      {/* ETF 구성종목 모달 — KR ETF 카드 ETF 책갈피 클릭 시 */}
      {etfDialog && (
        <EtfCompositionDialog isOpen={true}
                              ticker={etfDialog.ticker} etfName={etfDialog.name}
                              onClose={() => setEtfDialog(null)}
                              onRequestSearch={onRequestSearch} />
      )}
    </div>
  );
}

export type _UnusedUsIndex = UsIndex;
