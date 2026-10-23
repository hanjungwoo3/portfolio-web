import { useEffect, useState } from "react";
import { openGoogleAi, STOCK_ANALYSIS_PROMPT, aiNowStamp } from "../lib/googleAi";
import { openStockInfo, canTickPopup } from "../lib/tickPopup";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useMarketAlerts } from "../lib/marketAlerts";
import { IndexWarnTag } from "./IndexWarnTag";
import { fetchYahooBatch, fetchKrFuturesMinute, fetchKrRegularPrices, fetchYahooSparkDay, fetchDashboardChart, fetchYasunNightFutures, fetchTossUsStockCandles, fetchKrBondYieldSeries } from "../lib/api";
import type { UsIndex, MarketIndexKey } from "../lib/api";
import { isSymbolSleeping, isMarketOpen, marketOfSymbol, fmtAgo, isUsExtendedTradingOpen, krFuturesName, krFuturesDesc, isKrNightSession, isQuoteStale, isKrHoldingClosed, isUsRateSymbol, displayPctOf, isFxFuturesWeekendClosed, isKrAfterRegularClose, nowKstDateStr } from "../lib/format";
import { getDimSleepingEnabled, checkPersonalProxyYasunSupport } from "../lib/proxyConfig";
import { useChartRange, pickCardChart } from "../lib/chartRange";
import { ChartRangeToggle } from "./ChartRangeToggle";
import { buildDashboardPage, dashboardGroupNav, dashboardTagTone, dashboardRowLabelTone, dashboardTagCard, leadRowOf, isLastLead, rowLead, sortedRows, loadLeaderSort, saveLeaderSort, type LeaderSort, type DashboardPage } from "../lib/dashboardGroups";
import { RotationTab } from "./RotationTab";
import { requestTab, isTabVisible } from "../lib/tabNav";
import { GroupNavBar } from "./GroupNavBar";
import { US_PAIRS, allYahooSymbols, DAY_SPARK_SYMBOLS } from "../lib/usMarketData";
import { useAdaptiveRefreshMs } from "../lib/proxyStatus";
import { reportRefresh } from "../lib/lastRefresh";
import { handleTossLinkClick, TOSS_SYMBOL_URL } from "../lib/toss";
import { Sparkline } from "./Sparkline";
import { KrDaySparkline } from "./KrDaySparkline";
import { MarketFlowModal } from "./MarketFlowModal";
import { EtfCompositionDialog } from "./EtfCompositionDialog";
import { TicsSectorBoard } from "./TicsSectorBoard";
import { RealRateNote } from "./RealRateNote";
import { EtfTopCards } from "./EtfTopCards";
import { ValueupMiniCard } from "./ValueupCard";
import { HlPerpCard } from "./HlPerpCard";
import { CnnFearGreedTag } from "./CnnFearGreedTag";
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
// 지수 카드에 오르는 한국 개별 종목 코드(정규장 종가 조회용) — 목록은 usMarketData 한 벌
// 24시간 차트용 미국 종목·ETF 심볼(야후 spark) — 지수(^)·선물(=)·가상 심볼·한국은 빼고 대문자 티커만
const US_SPARK_SYMBOLS = DAY_SPARK_SYMBOLS;   // 목록은 lib 한 벌(usMarketData)
const KR_STOCK_CODES = US_PAIRS.filter(p => p.krStock && /^[\dA-Za-z]{6}\.KS$/.test(p.symbol)).map(p => p.symbol.slice(0, 6));

function fmtPrice(symbol: string, price: number): string {
  // 원엔은 한국 관행대로 100엔 기준 표기 (Yahoo 는 1엔당 원 = 8.6원 꼴)
  if (symbol === "JPYKRW=X") return (price * 100).toFixed(2);
  if (symbol.includes("KRW")) return price.toFixed(2);
  if (symbol === "CNNFG") return Math.round(price).toString();   // CNN 공포·탐욕 — 0~100 점수, CNN 표기처럼 정수
  if (symbol === "^TIPS10" || symbol === "^MOVE" || symbol === "^VIX" || symbol === "^TNX" || symbol === "^TYX" || symbol === "^US2Y") return price.toFixed(2);
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

  // 지수 카드의 한국 개별 종목 — 오늘 15:30 정규장 종가(마감 책갈피용). 장 마감 뒤 **한 번만** 받는다(그 뒤로 안 바뀐다).
  //   토스 1콜 + 야후 .KS/.KQ ~9콜(179종목). 정규장 중엔 부르지 않는다.
  const krStockCodes = KR_STOCK_CODES;
  const krAfter = isKrAfterRegularClose();
  const { data: idxKrReg } = useQuery({
    queryKey: ["idx-kr-reg", nowKstDateStr()],
    queryFn: () => fetchKrRegularPrices(krStockCodes),
    enabled: krAfter && krStockCodes.length > 0,
    staleTime: 6 * 60 * 60_000, refetchOnWindowFocus: false,
    // 야후 확인이 빠진 종목이 있으면(일시 실패) 5분 뒤 다시 — 다 채워지면 멈춘다
    refetchInterval: q => (q.state.data && [...q.state.data.values()].filter(v => !v.fromYahoo).length > 3 ? 5 * 60_000 : false),   // 야후에 없는 신규 상장 몇 개는 봐준다
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
      // 빈 차트는 던진다(fetchDashboardChart) — 실패면 5분 뒤 다시(원래 차트가 없는 심볼이 매분 부르지 않게 1번만 재시도)
      retry: 1, refetchInterval: (q: { state: { status: string } }) => (q.state.status === "error" ? 5 * 60_000 : false),
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
  const [leaderSort, setLeaderSort] = useState<LeaderSort>(loadLeaderSort);   // 대장주 줄 정렬(등락률순 기본)
  const chartRange = useChartRange();   // 카드 배경 차트 3개월 | 24시간 — 앱 전체 설정
  // 미국 종목·ETF 24시간 차트 — 야후 spark(20종목 1콜). '24시간' 을 골랐을 때만 받는다(5분마다).
  const { data: usSpark } = useQuery({
    queryKey: ["us-spark-day", US_SPARK_SYMBOLS.length],
    queryFn: () => fetchYahooSparkDay(US_SPARK_SYMBOLS),
    enabled: chartRange === "day",
    refetchInterval: chartRange === "day" ? 5 * 60_000 : false,
    staleTime: 4 * 60_000, refetchOnWindowFocus: false,
  });
  // 코스피200·코스닥150 **주간**선물 — 낮엔 한경 1분봉 어제+오늘(야선은 당일 세션뿐). 야간장(18~05시)엔 야선 그대로.
  const krFutDayOn = chartRange === "day" && !isKrNightSession();
  const krFutDay = useQueries({
    queries: (["kospi200", "kosdaq150"] as const).map(k => ({
      queryKey: ["hk-futures-min", k], queryFn: () => fetchKrFuturesMinute(k),
      enabled: krFutDayOn, refetchInterval: krFutDayOn ? 60_000 : (false as const), staleTime: 30_000, refetchOnWindowFocus: false,
    })),
  });
  const krFutSpark = (sym: string) => {
    if (!krFutDayOn) return undefined;
    const d = (sym === "^KS200N" ? krFutDay[0] : sym === "^KQ150N" ? krFutDay[1] : undefined)?.data;
    return d && d.closes.length > 1 ? { rolling: d.rolling, closes: d.closes, xs: d.xs, openIdx: d.openIdx, closeIdx: d.closeIdx, prevOpenIdx: d.prevOpenIdx, prevCloseIdx: d.prevCloseIdx, prevClose: d.base, breakIdx: d.breakIdx, prevBase: d.prevBase } : undefined;
  };
  const [etfDialog, setEtfDialog] = useState<{ ticker: string; name: string } | null>(null);
  const marketAlerts = useMarketAlerts();   // 종목코드 → 투자주의·경고·위험
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
      {/* 차트 기간(3개월|24시간)은 그룹 칩 줄 끝에 — 스크롤해도 늘 보이는 자리(사용자 결정 2026-10-20) */}
      <GroupNavBar items={navItems} idPrefix="usidx-"
                   stickyTop={navStickyTop} scrollMarginTop={idxScrollMargin}
                   trailing={<ChartRangeToggle />} />
      {/* ─── Tier 0 — 한국시장 영향 관계 기준 그룹 (라벨 헤더 + 한 화면 표시) ─── */}
      {/* 다른 탭과 같은 전체 폭 — 예전엔 lg 에서 75% 로 줄여 PC 에서만 좁아 보였다 */}
      <div className="space-y-4">
        {T0_SECTIONS.map((section) => (
          <div key={section.label} id={`usidx-${section.id}`}
               style={{ scrollMarginTop: idxScrollMargin }}
               className={`relative space-y-2 rounded-xl border border-gray-300 bg-white ${section.render === "rotation" ? "" : section.render ? "pg-box pg-render" : "pg-box"} p-2.5 pt-4 mt-1.5`}>
            {/* 섹터명 책갈피 — 카드 상단에 겹치게 */}
            <span className="pg-title absolute -top-3 left-3 z-10 px-2 py-0.5 rounded-md border border-gray-300 bg-gray-50
                             text-sm font-bold text-gray-700 whitespace-nowrap">
              {section.label}
              {section.link && isTabVisible(section.link.vis) && (
                <button onClick={() => requestTab(section.link!.tab)}
                        className="ml-1.5 text-[11px] font-bold text-indigo-600 hover:underline">
                  자세히 →
                </button>
              )}
              {/* 정렬 버튼은 페이지에 하나 — 첫 정렬 그룹 제목에만(누르면 페이지 전체가 바뀐다) */}
{section.sortable && section.id === T0_SECTIONS.find(x => x.sortable)?.id && (
                <span className="ml-2 inline-flex rounded border border-gray-300 overflow-hidden align-middle text-[11px] font-bold">
                  {(["pct", "value"] as const).map(v => (
                    <button key={v} onClick={() => { setLeaderSort(v); saveLeaderSort(v); }}
                            className={`px-1.5 py-0 ${leaderSort === v ? "bg-indigo-600 text-white" : "bg-white text-gray-500 hover:bg-gray-100"}`}>
                      {v === "pct" ? "등락률순" : "거래대금순"}
                    </button>
                  ))}
                </span>
              )}
            </span>
            {/* 폴백 고정 카드(한국 섹터·반도체 TOP2+·소부장)는 오늘 등락률(%) 내림차순 정렬 (6개씩 줄바꿈) */}
            {/* 한국 섹터 — 토스 TICS 분류. 미국 블록과 **같은 한글 분류**라 이름으로 맞출 수 있다. */}
            {section.render === "etfTop" && (
                  <EtfTopCards onOpenEtf={(code, name) => setEtfDialog({ ticker: code, name })} />
                )}
                {section.note && <div className="text-[11px] text-gray-500 leading-snug">{section.note}</div>}
                {section.id === "krfx" && <RealRateNote usMap={usMap} />}
                {section.render === "rotation" && (
              <RotationTab embedded extrasOnly onOpenValuation={(t, n) => onOpenValuation?.(t, n ?? "")} />
            )}
                {section.render === "sectorFlow" && (
              <TicsSectorBoard onOpenValuation={onOpenValuation}
                                krClosed={page === "night" || page === "rot"} />
            )}
            {(arr => !section.pairRows ? arr : (
              // 짝 줄 — 상자 둘을 좌우로 **붙여서**. 상자 폭은 카드 수에 비례(flex-grow), 남는 자리는 오른쪽 빈칸(한 줄 8장 기준)
              <div className="space-y-0">
                {(() => {
                  // 줄마다 상자 묶음 — boxLines([2,3]) 가 있으면 그대로, 없으면 boxesPerLine(기본 2)씩
                  const per = section.boxesPerLine ?? 2;
                  const sizes = section.boxLines ?? Array.from({ length: Math.ceil(arr.length / per) }, () => per);
                  let at = 0;
                  return sizes.map(n => { const idx = Array.from({ length: n }, (_, j) => at + j).filter(i => i < arr.length); at += n; return idx; });
                })().map((idx, k, lines) => {
                  // 상자 폭 = 카드 n장 + 카드 사이 틈 + 상자 안쪽 여백(왼쪽 책갈피 36 + 오른쪽 8 + 테두리 2).
                  //   카드 한 장 = 전체 폭 8칸 카드((100% - 7×8px)/8)와 같게 맞춘다 — 상자가 몇 개든 카드 크기가 다른 그룹과 같다.
                  //   단, 상자 여백 때문에 한 줄에 다 안 들어가는 줄이 있으면 **그룹 전체** 카드 폭을 그 줄에 맞춰 줄인다
                  //   (줄마다 따로 눌리면 상자가 하나뿐인 줄만 카드가 커 보인다). 줄 하나(C장·B상자) 필요 폭 = C·w + 8C + 46B − 8.
                  const fits = lines.map(l => {
                    const c = l.reduce((s, i) => s + section.rows[i].length, 0);
                    return `(100% - ${8 * c + 46 * l.length - 8}px) / ${c}`;
                  });
                  const card = `min((100% - 56px) / 8, ${fits.join(", ")})`;
                  const boxW = (n: number) => `calc(${n} * ${card} + ${(n - 1) * 8}px + 46px)`;
                  return (
                    <div key={k} className="flex gap-2">
                      {idx.map(i => <div key={i} className="min-w-0" style={{ flex: `0 1 ${boxW(section.rows[i].length)}` }}>{arr[i]}</div>)}
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
              : sortedRows(section, leaderSort, sym => displayPctOf(sym, usMap.get(sym)))
            ).map((group, gi) => (
              // 6열 그리드 — 화면은 전체 폭이지만 카드 줄만 lg 75% 로 묶어 카드 크기는 예전 그대로(왼쪽 정렬)
              <div key={gi} className={section.rowLabels ? `relative ${section.pairRows ? "" : "-mr-[9px]"} rounded-lg border border-gray-200 bg-gray-50/50 pg-row pl-9 pr-2 pb-2 pt-4 mt-2` : ""}>
                {/* 줄 책갈피 — 이 줄이 어느 단계인지(반도체·전공정…). 위에 얹으면 카드 위 가격 띠와 겹쳐
                    안 보여서, 상자 **왼쪽에 세로 띠**로 따로 뺐다(글자는 위→아래로 세워 쓴다). */}
                {section.rowLabels?.[gi] && (
                  <span className={`pg-rowlabel absolute left-0 inset-y-0 w-7 flex items-center justify-center border-0 border-r rounded-l-lg
                                    text-xs font-bold tracking-widest [writing-mode:vertical-rl] [text-orientation:upright]
                                    ${dashboardRowLabelTone(section, section.rowLabels[gi])}`}>
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
              // 한국 종목·ETF(.KS) — **보유 종목 카드와 같은 규칙**(isKrHoldingClosed): 프리(08:00~)·애프터(~20:00)에
              //   실제 체결이 들어오면 열림, 단일가 진행 중이면 열림, ETF·ETN 은 15:30 이후 바로 마감.
              //   (정규장 09:00~15:30 만 보던 때는 08시 NXT 프리장에 시세가 움직이는데도 흐렸다)
              const sleeping = /^[\dA-Za-z]{6}\.KS$/.test(p.symbol)
                ? isKrHoldingClosed(undefined, undefined, q?.singlePrice, q?.freshTime ?? 0, !p.krStock)   // 체결 시각 없으면(개장 전 ETF) 시간외엔 마감
                : isSymbolSleeping(p.symbol);
              // 메인 가격/변동률 — 한국 입장(미국장 마감 후 아침에 확인):
              // · REGULAR: regularPct (어제 종가 대비)
              // · 시간외(PRE/POST/POSTPOST/PREPRE/CLOSED): postPrice + 기준 종가 대비
              //   미국 종목 = 최근 정규장 종가(토스식, 아래 usOffBase) · 그 외 = 어제 종가(prevClose)
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
              // 미국 종목이 정규장 밖(애프터·데이마켓·프리)이면 기준 = **최근 정규장 종가**(토스·내 주식 카드와 같은 규칙).
              //   야후 prevClose 는 다음 날 프리장(04:00 ET)이 열려야 넘어가, 그 사이(정규장 마감~다음 프리) 큰 % 가
              //   이틀치 누적으로 떴다(NVDA 데이마켓 토스 −2.00% ↔ 우리 +0.49%, 사용자 지적 2026-10-22).
              const usOffBase = marketOfSymbol(p.symbol) === "US" && !isMarketOpen("US_INDEX") && q?.regularPrice && q.regularPrice > 0
                ? q.regularPrice : undefined;
              const effBase = usOffBase ?? q?.prevClose;
              const pct = (q?.marketState === "REGULAR" && q.regularPct != null)
                ? q.regularPct
                : (effPrice != null && effBase != null && effBase > 0
                   ? ((effPrice - effBase) / effBase) * 100
                   : null);
              // 개장 전·마감 등 현재 세션 변동이 0(토스 base==close)이면 마지막 정규장 %로 폴백 표시.
              //   한국 지수·ETF 가 개장 전 % 가 비는 문제 — 미국 종목은 마감 후에도 마지막 % 가 노출되므로 동일하게 맞춤.
              const liveFlat = pct == null || Math.abs(pct) < 0.005;
              const showPct = (!usOffBase && sleeping && liveFlat && q?.regularPct != null && Math.abs(q.regularPct) >= 0.005)   // 미국 장 밖은 0% 도 그대로(토스처럼)
                ? q.regularPct : pct;
              // 메인 변동률(본문 큰 %) = showPct. 한국은 어제 종가 대비 누적(정규장 + NXT), 미국 종목은 장 밖이면 최근 정규장 종가 대비.
              //   정규장 마감가·마감 변동%는 상단 노란 책갈피가 담당.
              //   (예전엔 본문에 '애프터 변동분'만 떠서, 시간외 보합이면 0.00% 로 죽던 문제 → 누적으로 환원)
              const mainPct = showPct;
              // direction === "inverse"(공포지수·환율·달러인덱스·금리 등) → 상승=한국 위험 → 색 반전
              // (빨강=좋음 / 파랑=나쁨 기준). SemiCheckTab 과 동일 규칙.
              const isInverse = false;   // 색 반전 없음 — 모든 카드 오르면 빨강·내리면 파랑(사용자 결정 2026-10-21). direction 은 설명용으로만 남긴다
              const effUp = isInverse ? (mainPct != null && mainPct < 0) : (mainPct != null && mainPct > 0);
              const effDn = isInverse ? (mainPct != null && mainPct > 0) : (mainPct != null && mainPct < 0);
              const dayArr = krFutSpark(p.symbol)?.closes ?? nightClosesMap.get(p.symbol) ?? usSpark?.get(p.symbol)?.closes ?? usMap?.get(p.symbol)?.sparkline;   // 야후 어제+오늘이 있으면 그걸 먼저
              const chartArr = pickCardChart(chartRange, t0ChartMap.get(p.symbol) ?? [], dayArr);
              // 24시간 차트가 야후 spark 에서 왔으면 '오늘 정규장 시작' 위치를 표시
              const daySpark = chartRange === "day" ? (krFutSpark(p.symbol) ?? (!nightClosesMap.get(p.symbol) ? usSpark?.get(p.symbol) : undefined)) : undefined;
              const markIdx = daySpark && chartArr === daySpark.closes ? daySpark.openIdx : undefined;
              const closeIdx = daySpark && chartArr === daySpark.closes ? daySpark.closeIdx : undefined;   // 오늘 정규장 종가 세로선
              const prevMarks = daySpark && chartArr === daySpark.closes ? [daySpark.prevOpenIdx, daySpark.prevCloseIdx] : undefined;   // 어제 정규장 시작·종가 세로선
              const breakIdx = daySpark && chartArr === daySpark.closes ? daySpark.breakIdx : undefined;   // 어제·오늘 사이 끊기
              // 24시간 차트의 기준선·색 기준 = 어제 종가(카드 큰 숫자와 같은 기준). 야후 spark 는 달러라 그 응답의 전일 종가를,
              //   토스·야선 당일 봉은 카드 값과 같은 단위라 카드의 전일 종가(prevClose)를 쓴다. 3개월 차트엔 안 쓴다.
              const isDayChart = chartRange === "day" && !!dayArr && chartArr === dayArr;
              // 24시간 차트 끝에 **지금 가격**을 붙인다 — 분봉 이력은 5분마다지만 현재가는 5초마다라, 큰 숫자가 바뀔 때
              //   그래프 끝도 같이 움직이게(추가 호출 0). 단위가 같은 경우만: 미국 종목(달러)·토스 지수·야간선물.
              const liveChart = isDayChart && effPrice != null && effPrice > 0 ? [...chartArr, effPrice] : chartArr;
              // 어제 50%·오늘 50% 시간 축(야후·한경 자료에 xs 가 있을 때) — 끝에 붙인 지금 가격은 마지막 점 바로 뒤
              const dayXs = daySpark?.xs && chartArr === daySpark.closes
                ? (liveChart.length > chartArr.length ? [...daySpark.xs, daySpark.rolling ? 1 : Math.min(1, daySpark.xs[daySpark.xs.length - 1] + 0.002)] : daySpark.xs) : undefined;
              const dayBase = !isDayChart ? undefined
                : daySpark && chartArr === daySpark.closes && marketOfSymbol(p.symbol) === "US" ? daySpark.prevClose   // 미국만 야후 값(달러 단위) — 한국·아시아 지수는 야후 전일 종가가 틀릴 때가 있어(^KQ11 이 그저께 값, 2026-10-21) 카드 값으로
                : (q?.prevClose && q.prevClose > 0 ? q.prevClose : undefined);
              const sparkColor = dimNow ? "#94a3b8"
                : (isInverse && chartArr.length > 1 && dayBase == null)
                  // 거꾸로 칠하는 카드(VIX·환율·금리)의 3개월 차트 — 첫 점 기준 한 색. 24시간이면 아래 Sparkline 이
                  //   어제 종가 선 위·아래를 나눠 칠한다 — 이때는 반전하지 않는다(위=빨강·아래=파랑, 사용자 결정 2026-10-21)
                  ? (chartArr[chartArr.length - 1] > chartArr[0] ? "#2563eb" : "#dc2626")
                  : undefined;
              // 미국 종목·ETF — 달러로만 표시(원화 환산 없음, 사용자 결정 2026-10-21) → 가격에 $ 를 붙인다
              const usDollar = q?.currency === "USD" && /^[A-Z][A-Z.]{0,5}$/.test(p.symbol) && marketOfSymbol(p.symbol) === "US" && p.symbol !== "CNNFG";
              const isFuture = p.symbol.endsWith("=F") || p.symbol === "^KS200N" || p.symbol === "^KQ150N";
              const bg = dimNow
                ? "bg-gray-100 border-transparent"
                : effUp ? "bg-rose-50 border-rose-200"
                : effDn ? "bg-blue-50 border-blue-200"   // 불투명 — 반투명(/70)이면 야간 배경이 비쳐 칙칙했다(사용자 지적 2026-10-23)
                : "bg-white border-gray-200";
              const sign =
                effUp ? "text-rose-600"
                : effDn ? "text-blue-600"
                : "text-gray-900";
              const isKospi  = p.symbol === "^KS11";
              const isKosdaq = p.symbol === "^KQ11";
              const hasFlow  = isKospi || isKosdaq;
              const indexKey = isKospi ? "KOSPI" : isKosdaq ? "KOSDAQ" : null;
              // 정규장 종료(sleeping) 후 항상 마감가 책갈피 표시.
              // 시간외 거래값(regularPrice 별도)이 있으면 그 값을, 없으면 현재가를 마감가로 통일 표시.
              // 미국 개별 종목은 프리장(04:00 ET)부터 '열림' 이라 sleeping 만 보면 프리장에 어제 종가가 사라졌다(2026-10-12).
              //   큰 숫자가 프리·애프터·오버나이트 가격인 동안(= 정규장 09:30~16:00 밖)은 정규장 마감 책갈피를 같이 보인다.
              const usOffRegular = marketOfSymbol(p.symbol) === "US" && !isMarketOpen("US_INDEX");
              // CNN 공포·탐욕은 '정규장 마감가' 개념이 없는 하루 점수라 책갈피를 안 단다
              // 한국 개별 종목은 15:30 뒤 NXT 애프터 중엔 안 흐려진다 — 그때도 **오늘 정규장 종가**(야후 15:30) 책갈피를 단다.
              //   ETF 는 애프터가 없어 이미 흐림(sleeping)으로 뜬다. 값은 krRegIdx(fetchKrRegularPrices)를 우선.
              // 야후로 확인된 값만 — 확인 못 했으면(야후 실패) 토스 meta 는 NXT 현재가라 정규장 종가로 보여주면 안 된다
              const krRegHere = p.krStock ? idxKrReg?.get(p.symbol.slice(0, 6)) : undefined;
              const krAfterTag = !!krRegHere?.fromYahoo && isKrAfterRegularClose();
              const showCloseTag = (sleeping || usOffRegular || krAfterTag) && effPrice != null && p.symbol !== "CNNFG";
              const krRegOk = krRegHere?.fromYahoo ? krRegHere : undefined;
              const closeVal = krRegOk?.regularPrice ?? q?.regularPrice ?? effPrice;
              const regPct = krRegOk?.regularPct ?? q?.regularPct ?? (usOffBase ? null : pct);   // 미국 장 밖이면 pct 는 정규장 종가 대비라 정규장 등락이 아니다 — 모르면 비운다
              const regSign = regPct == null ? "text-gray-700"
                : (isInverse ? regPct < 0 : regPct > 0) ? "text-rose-600"
                : (isInverse ? regPct > 0 : regPct < 0) ? "text-blue-600" : "text-gray-700";
              // 종목명 색 — 정규장 마감 책갈피가 떠 있을 때(큰 숫자 = 애프터·프리장)만 정규장 등락 색(2026-10-09).
              //   그 밖엔 큰 숫자와 같은 색 — 한국 NXT 프리마켓(08~08:50)엔 책갈피 없이 '지난 정규장' 색이 이름에 남아
              //   엘앤에프(이름 파랑·+2.15%)처럼 서로 엇갈렸다(2026-10-12). 선물은 주황 그대로.
              const nameColor = isFuture ? "text-amber-700" : showCloseTag && regPct != null ? regSign : sign;
              // 마감 책갈피는 노란 배경 + 흐림 제외 → dim 은 콘텐츠 자식에만 적용
              const dimCls = dimNow ? "opacity-60" : "";
              return (
                <div key={p.symbol} className={`pg-card relative h-full`}>   {/* pg-card — 야간 배경에서 카드·책갈피·버튼 함께 톤 낮춤 */}
                  {/* 왼쪽 위 책갈피 줄 — [ETF] [투자주의…]. 해당되는 것만, 한 줄로 붙여 겹치지 않게.
                      기업정보는 아이콘 대신 **종목명 클릭**으로 연다(아이콘이 마감 책갈피와 겹쳐 화면을 가렸다 — 사용자 결정 2026-10-21). */}
                  {(() => {
                    const krTk = krEtfTicker(p.symbol);                         // 한국 6자리(.KS) — 종목·ETF 모두
                    const isKrEtf = !!krTk && !p.krStock;
                    const lv = krTk ? marketAlerts.get(krTk) : undefined;
                    if (!krTk || (!isKrEtf && !lv)) return null;
                    const tag = "px-1.5 py-0 rounded text-[10px] font-bold leading-tight border";
                    return (
                      <div className="absolute -top-2 left-1 z-30 flex items-center gap-0.5">   {/* 마감 책갈피(z-20)가 길어도 위로 */}
                        {isKrEtf && (
                          <button onClick={() => setEtfDialog({ ticker: krTk!, name: p.name })}
                                title="ETF 구성 종목 보기"
                                className={`${tag} text-violet-700 bg-violet-50 hover:bg-violet-100 border-violet-300/40`}>
                          ETF
                        </button>
                        )}
                        {lv && <IndexWarnTag inline ticker={krTk!} name={p.name} level={lv} />}
                      </div>
                    );
                  })()}
                  {/* 정규장 마감가 책갈피 — 카드 위로 올림(-top-2). 노란 배경 + 흐림 제외(z-20) */}
                  {showCloseTag && closeVal != null && (
                    <div className="absolute -top-2 right-1 z-20 px-1.5 py-0
                                    border rounded bg-yellow-50 border-yellow-400/60
                                    text-[10px] font-medium leading-tight whitespace-nowrap">
                      {q?.currency === "KRW" && q?.regularPriceUsd != null && (
                        <span className={`tabular-nums mr-1 text-gray-900 ${dimNow ? "opacity-50" : ""}`}>
                          (${q.regularPriceUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })})
                        </span>
                      )}
                      <span className={`tabular-nums ${regSign}`}>
                        {usDollar ? "$" : ""}{closeVal < 1000 ? closeVal.toFixed(2) : Math.round(closeVal).toLocaleString()}
                      </span>
                      {regPct != null && (
                        <span className={`tabular-nums ml-1 font-bold text-[11px] ${regSign}`}>
                          ({regPct >= 0 ? "+" : ""}{regPct.toFixed(2)}%)
                        </span>
                      )}
                      {/* 정규장 종가 → 지금(아래 큰 숫자) 차이 — 애프터·프리·NXT 에서 얼마나 더 움직였나(사용자 요청 2026-10-20) */}
                      {(() => {
                        if (effPrice == null || !(closeVal > 0)) return null;
                        // 큰 숫자 % 의 기준이 이미 이 정규장 종가면(미국 종목 장 마감 뒤 — 토스식) 같은 값을 두 번 쓰게 된다 → 생략
                        if (effBase != null && effBase > 0 && Math.abs(effBase / closeVal - 1) < 0.0005) return null;
                        const gap = (effPrice / closeVal - 1) * 100;
                        if (!Number.isFinite(gap) || Math.abs(gap) < 0.005) return null;
                        const gapCls = (isInverse ? gap < 0 : gap > 0) ? "bg-rose-600/60" : "bg-blue-600/60";   // 마감 후 변동 — 색 배경·흰 글자 배지로 눈에 띄게(사용자 요청)
                        return (
                          <span className={`tabular-nums ml-1 font-bold text-[11px] text-white px-1 rounded ${gapCls}`}
                                title="정규장 종가 대비 지금(아래 큰 숫자) 차이">
                            {gap > 0 ? "+" : "−"}{Math.abs(gap).toFixed(2)}%
                          </span>
                        );
                      })()}
                    </div>
                  )}
                  <div className={`relative overflow-hidden h-full flex flex-col gap-0.5
                                  rounded-lg border px-3 py-1.5
                                  ${leadRowOf(section, p.symbol) >= 0 ? dashboardTagCard(section.rowLabels?.[leadRowOf(section, p.symbol)]) : bg}`}>
                  {chartRange === "day" && krEtfTicker(p.symbol) ? (

                    // 한국 종목·ETF 24시간 — 토스 10분봉(NXT 포함), 보이는 카드만 받는다

                    <KrDaySparkline code={krEtfTicker(p.symbol)!} fallback={chartArr} live={effPrice ?? undefined} width={400} height={80}

                                    color={sparkColor} dim={dimNow} className={`absolute inset-0 w-full h-full opacity-50
                                        pointer-events-none ${dimCls}`} />

                  ) : (

                  <Sparkline data={liveChart}

                             width={400} height={80}

                             markIndex={markIdx}

                             closeIndex={closeIdx}

                             extraMarks={prevMarks}

                             xs={dayXs}

                             breakIndex={breakIdx}
                             prevBaseline={breakIdx != null ? daySpark?.prevBase : undefined}

                             baseline={dayBase}

                             color={sparkColor}

                             className={`absolute inset-0 w-full h-full opacity-50
                                        pointer-events-none ${dimCls}`} />

                  )}
                  <div className={`relative z-10 flex items-baseline gap-1.5 h-5 overflow-hidden ${dimCls}`}>
                    {sleeping && !inSession && (
                      <span className="text-[11px] text-gray-400">zZ</span>
                    )}
                    {/* 종목명 자체가 외부 링크 (Toss/Yahoo) */}
                    <a href={quoteUrl(p.symbol)}
                       target="_blank" rel="noopener noreferrer"
                       onClick={e => {
                         // 한국 종목·ETF — 종목명 = 앱 기업정보(기업가치) 팝업. 미국 등은 토스 페이지 그대로.
                         const krNameTk = krEtfTicker(p.symbol);
                         if (krNameTk) { e.preventDefault(); onOpenValuation?.(krNameTk, p.name); return; }
                         handleTossLinkClick(e, quoteUrl(p.symbol));
                       }}
                       title={krEtfTicker(p.symbol) ? `${p.name} 기업정보 보기` : `${p.name} 자세히 보기`}
                       className={`text-sm font-bold ${nameColor} hover:underline min-w-0 truncate`}>
                      {p.name}
                    </a>
                    {p.symbol === "CNNFG" && <CnnFearGreedTag />}
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
                      {/* 달러 보조 줄 — 없는 카드도 같은 높이를 비워 둔다(미국 종목 카드만 한 줄 더 높아 그룹마다 카드 높이가 달랐다) */}
                      <span className={`block text-[10px] font-normal leading-tight text-gray-900 ${q?.currency === "KRW" && q?.priceUsd != null ? "" : "invisible"}`}>
                        {q?.currency === "KRW" && q?.priceUsd != null ? `$${q.priceUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "$"}
                      </span>
                      <span className="text-sm">{effPrice != null ? `${usDollar ? "$" : ""}${fmtPrice(p.symbol, effPrice)}` : "—"}</span>
                    </span>
                    <span className={`flex-1 text-right text-xl font-bold tabular-nums ${sign}`}>
                      {/* 직전 틱 대비 화살표 — 주식 카드와 같은 규칙, % 왼쪽 */}
                      <TickArrow value={effPrice} className="mr-1 text-sm" />
                      {p.symbol === "CNNFG" && effPrice != null && effBase != null
                        // 0~100 점수라 % 가 아니라 점수 차(전일 대비). 31→18 이 "−43%" 로 찍히면 과장돼 보인다
                        ? (() => { const d = Math.round(effPrice - effBase); return `${d > 0 ? "+" : d < 0 ? "−" : "±"}${Math.abs(d)}점`; })()
                        : showPct != null && Math.abs(showPct) >= 0.005
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
                  {/* 오른쪽 아래 책갈피 줄 — 역할 태그 · 🗺️ 히트맵 · ⚡체결(국내 종목) · 🔍AI(국내·미국 종목)를 한 줄로(겹치지 않게).
                      카드 **바깥** 아래에 걸친다(카드 안은 overflow-hidden 이라 잘린다). ⚡체결은 AI 옆(사용자 요청 2026-10-22) */}
                  {(() => {
                    const krCode = p.symbol.replace(/\.(KS|KQ)$/, "");   // 지수 탭 국내 종목은 005930.KS 꼴
                    const isKrStock = krCode !== p.symbol && canTickPopup(krCode);
                    const isUsStock = /^[A-Z][A-Z.]{0,5}$/.test(p.symbol) && marketOfSymbol(p.symbol) === "US" && p.symbol !== "CNNFG";
                    const tag = section.tags?.[p.symbol];
                    const pill = "px-1.5 py-0 rounded text-[9px] leading-tight whitespace-nowrap font-bold transition";
                    if (!tag && !CARD_HEATMAP_LINK[p.symbol] && !isKrStock && !isUsStock) return null;
                    return (
                      <div className="absolute -bottom-1 right-1 z-20 flex items-center gap-0.5">
                        {tag && <span className={`${pill} border ${dashboardTagTone(tag)}`}>{tag}</span>}
                        {CARD_HEATMAP_LINK[p.symbol] && (
                          <button onClick={() => requestHeatmap(CARD_HEATMAP_LINK[p.symbol], { sizeMode: "volume" })}
                                  title={`${p.name} 구성종목 히트맵(거래량) 보기`}
                                  className={`${pill} text-emerald-700 bg-emerald-50 border border-emerald-300/70 hover:bg-emerald-100`}>
                            🗺️ 히트맵
                          </button>
                        )}
                        {isKrStock && (
                          <button onClick={() => openStockInfo(krCode, p.name)}
                                  title="종목정보 — 실시간 체결·호가·거래원 / 기업가치 (팝업)"
                                  className={`${pill} text-amber-700 bg-amber-50 border border-amber-300/70 hover:bg-amber-100`}>
                            📊종목정보
                          </button>
                        )}
                        {(isKrStock || isUsStock) && (
                          <button onClick={() => openGoogleAi(`${STOCK_ANALYSIS_PROMPT}\n\n[기준시각] ${aiNowStamp()}\n[분석 대상] ${p.name}(${isKrStock ? krCode : p.symbol}) — ${p.desc}`
                                    + (effPrice != null ? (isKrStock ? `, 현재가 ${Math.round(effPrice).toLocaleString()}원` : `, 현재가 $${effPrice.toFixed(2)}`) : "")
                                    + (mainPct != null ? ` (${mainPct >= 0 ? "+" : ""}${mainPct.toFixed(2)}%)` : ""))}
                                  title="구글 AI에 현재상태 분석 요청 (팝업)"
                                  className={`${pill} text-blue-700 bg-blue-50 border border-blue-300/70 hover:bg-blue-100`}>
                            🔍AI
                          </button>
                        )}
                      </div>
                    );
                  })()}
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
                    {/* 앞 칸이 없는 줄(맞는 ETF 가 없는 섹터)도 한 칸 비워 다른 줄과 자리를 맞춘다 */}
                    {lead.length > 0
                      ? <div className="grid gap-x-2" style={col(lead.length)}>{lead}</div>
                      : <div style={{ flex: "1 1 0" }} />}
                    <div className="w-7 shrink-0" />
                    {/* 한국 쪽은 늘 krMax 칸짜리 보이지 않는 틀 — 카드가 적으면 왼쪽부터 채우고 나머지는 빈칸 */}
                    <div className="grid gap-x-2" style={col(krMax)}>{kr}</div>
                    {ex.length > 0 && (
                      <div className="relative grid gap-x-2 rounded-lg border border-sky-200 bg-sky-50/60 px-1.5 pb-1.5 pt-3 -mt-[13px] -mb-[7px]" style={col(ex.length)}
                           title={`${section.extraTag?.[group[exAt]] ?? "🇺🇸 미국"} ETF — 참고용(통계엔 안 들어간다)`}>
                        {/* 상자 여백(위 12+1·아래 6+1)은 음수 마진으로 **바깥으로** 뺀다 — 상자가 줄 높이를 키우면 같은 줄 카드가
                            전부 늘어나(items-stretch) 순환매 카드만 다른 그룹보다 키가 컸다 */}
                        {ex}
                      </div>
                    )}
                    {8 - Math.max(n, 1) - krMax - ex.length > 0 && <div style={{ flex: `${8 - Math.max(n, 1) - krMax - ex.length} 1 0` }} />}
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
