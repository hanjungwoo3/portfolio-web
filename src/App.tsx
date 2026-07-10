import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { QueryClient, QueryClientProvider, useQueries, useQuery } from "@tanstack/react-query";
import {
  fetchTossPrices, fetchInvestorHistory, pickTodayInvestor, fetchKrRegularPrices, verifyKrMarkets,
  fetchWarning, fetchNaverInfo, fetchKrPriceHistory, fetchYahooPriceHistory,
  fetchInvestorHistorySafe, fetchNaverPrices, fetchKrStockName, fetchUsHoldingPrices,
} from "./lib/api";
import { loadHoldings, loadMemos, loadAllTrades, removeHolding, renameGroup, deleteGroup, cleanupReservedAccounts, migrateEmptyAccountToHolding, pruneOrphanDeposits, repairBrokenNames, purgeDerivedHoldingFields } from "./lib/db";
import { attachTodayBuys } from "./lib/tradeCalc";
import { getIndependentGroupsMode } from "./lib/groupMode";
import { StockCard } from "./components/StockCard";
import { MemoDialog } from "./components/MemoDialog";
import { Tabs, buildTabs, filterByTab, MARKET_MONEY_TAB_KEY, US_MARKET_TAB_KEY, SEMI_CHECK_TAB_KEY, SECTOR_RANK_TAB_KEY, MY_STOCKS_TAB_KEY, MY_TRADES_TAB_KEY, CONSENSUS_TAB_KEY, ETF_REVERSE_TAB_KEY, ETF_RANKING_TAB_KEY } from "./components/Tabs";
import { MyTradesTab } from "./components/MyTradesTab";
import { EtfReverseTab } from "./components/EtfReverseTab";
import { EtfRankingTab } from "./components/EtfRankingTab";
import { ConsensusTab, type ConsensusItem } from "./components/ConsensusTab";
import { SimpleViewModal } from "./components/SimpleViewModal";
import { SectorRankingTab } from "./components/SectorRankingTab";
import { getTabVisibility, getMarketSplit } from "./lib/tabVisibility";
import { getHeldFirst, setHeldFirst } from "./lib/heldFirst";
import { Menu } from "lucide-react";
import { getGroupFolders } from "./lib/groupFolders";
import { TotalRow } from "./components/TotalRow";
import { TodayPnLTable, TodayRealizedCard } from "./components/TodayPnLTable";
import type { Trade } from "./lib/db";
import { holdingYesterdayBaseSum, signColor, formatSigned } from "./lib/format";
import { splitByMarket, splitHeldAndMarket, type MarketSection } from "./lib/marketSplit";
import { GroupNavBar, type GroupNavItem } from "./components/GroupNavBar";
import { WhatIfRow } from "./components/WhatIfRow";
import { SettingsDialog } from "./components/SettingsDialog";
import { peekPendingSyncAction } from "./lib/syncManager";
import { FeedbackDialog } from "./components/FeedbackDialog";
import { DonateDialog } from "./components/DonateDialog";
import { EtfCompositionDialog } from "./components/EtfCompositionDialog";
import { EtfReverseDialog } from "./components/EtfReverseDialog";
import { OnboardingDialog } from "./components/OnboardingDialog";
import { SearchDialog } from "./components/SearchDialog";
import { EditHoldingDialog } from "./components/EditHoldingDialog";
import { MyStockEditDialog } from "./components/MyStockEditDialog";
import { UsMarketTab } from "./components/UsMarketTab";
import { StockMarketTab } from "./components/StockMarketTab";
import { SemiCheckTab } from "./components/SemiCheckTab";
import { RefreshIndicator } from "./components/RefreshIndicator";
import { forceUpdate } from "./components/VersionBadge";
import { NewVersionToast } from "./components/NewVersionToast";
import { ProxyStatusBadge } from "./components/ProxyStatusBadge";
import { useAdaptiveRefreshMs } from "./lib/proxyStatus";
import { useTossMaintenance, fmtUntil, getTossMaintenance } from "./lib/tossMaintenance";
import {
  sortHoldings, loadSortKey, loadSortDir, saveSortKey, saveSortDir,
  type SortKey, type SortDirection,
} from "./lib/sortHoldings";
import { SortSelector, makeSortHandlers } from "./components/SortSelector";
import { reportRefresh, useLastRefresh } from "./lib/lastRefresh";
import { getEffectivePollMs, getPersonalProxyUrl } from "./lib/proxyConfig";
import { ValuationModal } from "./components/ValuationModal";
import { MobileSimpleView } from "./components/MobileSimpleView";
import { HelpDialog, markHelpSeen, shouldShowHelpFirstTime, HELP_STEP_BY_TAB } from "./components/HelpDialog";
import type { Stock, Memo } from "./types";

// viewport 감지 — 폰 (≤ 640px) 자동 모바일 뷰
function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(max-width: 640px)").matches;
  });
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 640px)");
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return isMobile;
}

// 기본 폴링 — 공개 4-way: 10초 / 전용 프록시 사용 시: localStorage 설정값 (5/10/30/60초)
// 다운 시 자동 증가 (base × (1 + downCount))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      refetchOnWindowFocus: true,
    },
  },
});

function Dashboard() {
  const [holdings, setHoldings] = useState<Stock[]>([]);
  const [memos, setMemos] = useState<Map<string, Memo>>(new Map());
  const [tradeCount, setTradeCount] = useState(0);
  const [allTrades, setAllTrades] = useState<Trade[]>([]);   // 오늘 매도(실현) 집계용 — 무영속, 로드시 갱신
  const [activeTab, setActiveTab] = useState<string>(US_MARKET_TAB_KEY);   // 기본 페이지 = 지수
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInitQuery, setSearchInitQuery] = useState("");
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [etfDialog, setEtfDialog] = useState<{ ticker: string; name: string } | null>(null);
  const [etfReverseDialog, setEtfReverseDialog] = useState<{ ticker: string; name: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [valuationTicker, setValuationTicker] = useState<string | null>(null);
  const [editing, setEditing] = useState<Stock | null>(null);
  const [editAllStock, setEditAllStock] = useState<{ ticker: string; name: string } | null>(null);
  const [memoTicker, setMemoTicker] = useState<string | null>(null);
  const [donateOpen, setDonateOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpStep, setHelpStep] = useState(0);   // 사용법 열 때 시작 단계 (현재 탭 기준)
  // 첫 방문이면 사용법(빠른 시작)을 먼저 보여주고, 닫은 뒤에 프록시 안내를 노출(겹침 방지).
  const [onboardReady, setOnboardReady] = useState(() => !shouldShowHelpFirstTime());
  const [simpleOpen, setSimpleOpen] = useState(false);
  const [codesCopied, setCodesCopied] = useState(false);

  // 첫 방문 자동 노출 — 1.5초 지연 (다른 모달과 충돌 회피)
  useEffect(() => {
    if (!shouldShowHelpFirstTime()) return;
    const t = setTimeout(() => setHelpOpen(true), 1500);
    return () => clearTimeout(t);
  }, []);

  // 로그인 redirect 복귀 — 저장/불러오기 대기 동작이 있으면 설정 자동 오픈 → 자동 재개
  useEffect(() => {
    if (!peekPendingSyncAction()) return;
    const t = setTimeout(() => setSettingsOpen(true), 0);
    return () => clearTimeout(t);
  }, []);

  // 자동 동기화 제거됨 — 백업은 설정의 파일 저장/불러오기 또는 수동 구글 업·다운로드 사용.
  // 설정 변경 시 reloadKey 증가 → BASE_REFRESH_MS / usePersonalProxy 재계산
  const BASE_REFRESH_MS = useMemo(() => getEffectivePollMs(), [reloadKey]);
  // 수동 모드 — 자동 폴링 전면 중단 (버튼/탭 진입 시에만 갱신)
  const manualPoll = BASE_REFRESH_MS === 0;
  const usePersonalProxy = useMemo(() => !!getPersonalProxyUrl(), [reloadKey]);
  const adaptiveRefreshMs = useAdaptiveRefreshMs(BASE_REFRESH_MS);
  // 토스 점검 중 — 네이버 fallback(60초), 워커 미지원 시 5분 백오프
  const tossMaint = useTossMaintenance();
  const REFRESH_MS = tossMaint.active
    ? (tossMaint.needsWorkerUpdate ? 300_000 : 60_000)
    : adaptiveRefreshMs;
  // 토스 점검 해제 시 — 토스 기반 쿼리(투자자/마감/공매도/기업가치 차트) 즉시 갱신
  useEffect(() => {
    if (tossMaint.active) return;
    queryClient.invalidateQueries({ predicate: q => {
      const k = String(q.queryKey[0]);
      return k.startsWith("investor-history") || k === "kr-reg"
          || k === "short-selling-modal" || k === "price-history-modal-with-events";
    }});
  }, [tossMaint.active]);

  // IndexedDB 로드 — 마이그레이션은 AppRoot 에서 1회 완료 후 진입하므로 여기선 단순 로드
  useEffect(() => {
    void (async () => {
      const [h, m, t] = await Promise.all([loadHoldings(), loadMemos(), loadAllTrades()]);
      // eslint-disable-next-line no-console
      console.log(`[v3 load] holdings=${h.length}, memos=${m.size}, trades=${t.length}`);
      // 오늘 매수분 주입 — 추가매수로 buy_date 가 오늘이 돼도 '오늘 손익=전체'로 잡히지 않게.
      setHoldings(attachTodayBuys(h, t, getIndependentGroupsMode()));
      setMemos(m);
      setTradeCount(t.length);
      setAllTrades(t);
    })();
  }, [reloadKey]);

  // reloadKey 의존성 — 설정에서 시스템 탭 visibility 변경 시 즉시 반영
  const tabs = useMemo(() => buildTabs(holdings, getTabVisibility(), tradeCount), [holdings, reloadKey, tradeCount]);
  const groupFolders = useMemo(() => getGroupFolders(), [reloadKey]);
  // 사용자 그룹 이름들 (폴더 관리용) — 빈 계좌·관심ETF 제외
  const userGroups = useMemo(() => {
    const set = new Set<string>();
    for (const h of holdings) {
      const a = h.account || "";
      if (a && a !== "관심ETF") set.add(a);
    }
    return Array.from(set).sort();
  }, [holdings]);
  // ticker→이름 (전체 보유 기준) — 오늘 매도 카드에서 풀매도된 종목명 해석용
  const nameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const h of holdings) if (h.name) m.set(h.ticker, h.name);
    return m;
  }, [holdings]);

  // 데이터 로드 후 첫 탭 자동 선택
  useEffect(() => {
    if (tabs.length > 0 && !tabs.find(t => t.key === activeTab)) {
      setActiveTab(tabs[0].key);
    }
  }, [tabs, activeTab]);

  const visible = useMemo(
    () => filterByTab(holdings, activeTab),
    [holdings, activeTab]
  );

  // 보이는 종목만 KRX 6자리 필터링 (가격 fetch 대상)
  const krxTickers = useMemo(
    () => visible
      .map(s => s.ticker)
      .filter(t => /^[\dA-Za-z]{6}$/.test(t)),
    [visible]
  );
  // 미국 종목(알파벳 티커 1~5자) — 토스US/Yahoo 로 별도 fetch
  const usTickers = useMemo(
    () => Array.from(new Set(visible
      .map(s => s.ticker)
      .filter(t => /^[A-Za-z][A-Za-z.]{0,4}$/.test(t)))),
    [visible]
  );
  // 거래소 분류 대상 — 활성 탭(visible)이 아닌 "전체 보유" KR 6자리.
  //  컨센서스 탭은 visible 이 비어(계좌 그룹 아님) krxTickers=[] → 검증 쿼리가 꺼지면
  //  consensusItems 가 거래소를 분류 못 해 코스닥이 코스피로 흘러간다. 그래서 전체 기준.
  const allKrTickers = useMemo(
    () => Array.from(new Set(holdings
      .map(s => s.ticker)
      .filter(t => /^[\dA-Za-z]{6}$/.test(t)))),
    [holdings]
  );

  // 가격 — 항상 토스 먼저(복구 자동 감지), 점검(490)이면 네이버 fallback
  const { data: prices, dataUpdatedAt: pricesUpdatedAt } = useQuery({
    queryKey: ["prices", krxTickers],
    queryFn: async () => {
      try { return await fetchTossPrices(krxTickers); }
      catch (e) {
        if (getTossMaintenance().active) return await fetchNaverPrices(krxTickers);
        throw e;
      }
    },
    enabled: krxTickers.length > 0,
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: true,   // 탭 비활성(백그라운드)에도 폴링 → 탭 제목 손익 계속 갱신
  });

  // 미국 종목 가격 — 토스US 우선 + Yahoo 폴백 (보유 priceMap 에 병합)
  const { data: usPrices } = useQuery({
    queryKey: ["us-prices", usTickers],
    queryFn: () => fetchUsHoldingPrices(usTickers),
    enabled: usTickers.length > 0,
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: true,
  });

  // 한국 종목 거래소 자동 검증 — 토스 stock-infos API 사용 (market.code: KSP/KSQ).
  // 결과는 localStorage 캐시 (24시간) — 매번 검증 부담 회피.
  const { data: verifiedMarketMap } = useQuery({
    queryKey: ["kr-markets-verified", allKrTickers],
    queryFn: async () => {
      const cacheRaw = localStorage.getItem("kr_markets_verified") ?? "{}";
      const cache = JSON.parse(cacheRaw) as Record<string, "KOSPI" | "KOSDAQ">;
      const cacheTs = Number(localStorage.getItem("kr_markets_verified_ts") ?? "0");
      const isFresh = Date.now() - cacheTs < 24 * 3600 * 1000;
      const known = isFresh ? new Map(Object.entries(cache)) : new Map();
      const toVerify = allKrTickers.filter(t => !known.has(t));
      if (toVerify.length === 0) return known;
      const fresh = await verifyKrMarkets(toVerify);
      for (const [t, mkt] of fresh) known.set(t, mkt);
      const obj: Record<string, string> = {};
      for (const [k, v] of known) obj[k] = v;
      localStorage.setItem("kr_markets_verified", JSON.stringify(obj));
      localStorage.setItem("kr_markets_verified_ts", String(Date.now()));
      return known;
    },
    enabled: allKrTickers.length > 0,
    staleTime: 60 * 60 * 1000,
  });

  // 한국 주식 정규장 종가 — 검증된 거래소 사용 (없으면 Stock.market fallback)
  const krMarketMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of holdings) {
      if (!/^\d{6}$/.test(s.ticker)) continue;
      const v = verifiedMarketMap?.get(s.ticker);
      if (v) m.set(s.ticker, v);
      else if (s.market) m.set(s.ticker, s.market);
    }
    return m;
  }, [holdings, verifiedMarketMap]);
  const { data: krRegMap } = useQuery({
    queryKey: ["kr-reg", krxTickers, Array.from(krMarketMap.entries()).flat().join(",")],
    queryFn: () => fetchKrRegularPrices(krxTickers, krMarketMap),
    enabled: krxTickers.length > 0 && krMarketMap.size > 0,
    refetchInterval: manualPoll ? false : 60_000,
    staleTime: 30_000,
  });


  // 갱신 시각 글로벌 보고
  useEffect(() => {
    if (pricesUpdatedAt > 0) reportRefresh(pricesUpdatedAt);
  }, [pricesUpdatedAt]);

  // 정렬 옵션 state — 7가지 + asc/desc 토글 (localStorage 저장)
  const [sortKey, setSortKey] = useState<SortKey>(loadSortKey);
  const [sortDir, setSortDir] = useState<SortDirection>(loadSortDir);
  const sortHandlers = makeSortHandlers(
    setSortKey, setSortDir, saveSortKey, saveSortDir, sortDir,
  );

  // 종목별 수급 (60일 history) — 5초
  const investorQs = useQueries({
    queries: krxTickers.map(t => ({
      queryKey: ["investor-history", t],
      queryFn: () => fetchInvestorHistory(t, 60),
      refetchInterval: REFRESH_MS,
    })),
  });

  // 종목별 long history (200일) — 카드 hover tooltip 의 5/20/60/120/200일 누적용
  // 1시간 캐시 (느림, 폴링 X)
  const longHistoryQs = useQueries({
    queries: krxTickers.map(t => ({
      queryKey: ["investor-history-long", t],
      queryFn: () => fetchInvestorHistorySafe(t, [200, 120, 60]),
      staleTime: 60 * 60 * 1000,
      refetchOnWindowFocus: false,
    })),
  });

  // 경고 뱃지 — 5초
  const warningQs = useQueries({
    queries: krxTickers.map(t => ({
      queryKey: ["warning", t],
      queryFn: () => fetchWarning(t),
      refetchInterval: REFRESH_MS,
    })),
  });

  // Naver info (섹터 + 컨센서스) — 5초
  const naverQs = useQueries({
    queries: krxTickers.map(t => ({
      queryKey: ["naver", t],
      queryFn: () => fetchNaverInfo(t),
      refetchInterval: REFRESH_MS,
    })),
  });

  // 일봉 차트 (3개월) 항상 fetch — 1시간 캐시, 카드 가격 박스 배경 sparkline
  // 장 중엔 옅게, 비거래일엔 진하게 (CSS opacity)
  const chartQs = useQueries({
    queries: krxTickers.map(t => ({
      queryKey: ["kr-price-history", t, "3mo"],
      queryFn: () => fetchKrPriceHistory(t, "3mo"),
      staleTime: 60 * 60 * 1000,
      refetchOnWindowFocus: false,
    })),
  });
  // 미국 종목 일봉(3개월) — 배경 sparkline + AuxIndicators 기간수익률용. 야후, 1시간 캐시.
  const usChartQs = useQueries({
    queries: usTickers.map(t => ({
      queryKey: ["us-price-history", t, "3mo"],
      queryFn: () => fetchYahooPriceHistory(t, "3mo"),
      staleTime: 60 * 60 * 1000,
      refetchOnWindowFocus: false,
    })),
  });

  const priceMap = useMemo(() => {
    const m = new Map((prices ?? []).map(p => [p.ticker, p]));
    for (const p of usPrices ?? []) m.set(p.ticker, p);   // 미국 종목 가격 병합
    return m;
  }, [prices, usPrices]);

  // 브라우저 탭 제목 — 전체금액 → 전체% → 오늘금액 → 오늘% 순서로 순환 (좁은 탭에서도 안 잘림)
  const titlePartsRef = useRef<string[]>([]);
  useEffect(() => {
    let invested = 0, cur = 0, yest = 0;
    for (const s of visible) {
      if (s.shares <= 0) continue;
      const p = priceMap.get(s.ticker);
      if (!p) continue;
      const c = p.price || s.avg_price;
      invested += s.avg_price * s.shares;
      cur += c * s.shares;
      yest += holdingYesterdayBaseSum(s, p);
    }
    if (cur > 0 && invested > 0 && yest > 0) {
      const won = (n: number) => `${n >= 0 ? "+" : ""}${Math.round(n).toLocaleString()}원`;
      const pc = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
      titlePartsRef.current = [
        `${won(cur - invested)} ${pc(((cur - invested) / invested) * 100)} (전체)`,
        `${won(cur - yest)} ${pc(((cur - yest) / yest) * 100)} (오늘)`,
      ];
    } else {
      titlePartsRef.current = [];
    }
  }, [visible, priceMap]);
  // 조각 순환 — 전체/금액/% → 오늘/금액/% 를 1.2초마다 번갈아 (각 조각이 짧아 안 잘림).
  // 매 조각마다 최신 값을 읽으므로 갱신도 자연스럽게 반영.
  useEffect(() => {
    let i = 0;
    const tick = () => {
      const parts = titlePartsRef.current;
      document.title = parts.length ? parts[i++ % parts.length] : "portfolio-web";
    };
    tick();
    const id = window.setInterval(tick, 2000);
    return () => window.clearInterval(id);
  }, []);
  const investorMap = useMemo(
    () => new Map(investorQs.map((q, i) =>
      [krxTickers[i], q.data ? pickTodayInvestor(q.data) : null]
    )),
    [investorQs, krxTickers]
  );
  const longHistoryMap = useMemo(
    () => new Map(longHistoryQs.map((q, i) => [krxTickers[i], q.data ?? null])),
    [longHistoryQs, krxTickers]
  );
  const investorHistoryMap = useMemo(
    () => new Map(investorQs.map((q, i) => [krxTickers[i], q.data ?? null])),
    [investorQs, krxTickers]
  );
  const warningMap = useMemo(
    () => new Map(warningQs.map((q, i) => [krxTickers[i], q.data ?? ""])),
    [warningQs, krxTickers]
  );
  const naverMap = useMemo(
    () => new Map(naverQs.map((q, i) => [krxTickers[i], q.data])),
    [naverQs, krxTickers]
  );
  // 컨센서스 탭 — 추가 종목 전체(중복 제거, 6자리). 데이터는 탭이 직접 fetch.
  const consensusItems = useMemo<ConsensusItem[]>(() => {
    const groupsBy = new Map<string, string[]>();
    for (const s of holdings) {
      const acc = s.account || "";
      if (!acc) continue;
      const arr = groupsBy.get(s.ticker) ?? [];
      if (!arr.includes(acc)) arr.push(acc);
      groupsBy.set(s.ticker, arr);
    }
    const seen = new Set<string>();
    const out: ConsensusItem[] = [];
    for (const s of holdings) {
      if (!/^\d{6}$/.test(s.ticker) || seen.has(s.ticker)) continue;
      seen.add(s.ticker);
      // 거래소 — 검증맵(토스 market.code) 우선, 없으면 저장된 Stock.market 정규화
      const market = verifiedMarketMap?.get(s.ticker)
        ?? (/코스닥|KOSDAQ/i.test(s.market ?? "") ? "KOSDAQ"
          : /코스피|KOSPI/i.test(s.market ?? "") ? "KOSPI" : undefined);
      out.push({ ticker: s.ticker, name: s.name, groups: groupsBy.get(s.ticker) ?? [], market });
    }
    return out;
  }, [holdings, verifiedMarketMap]);
  // "내꺼먼저" — 켜면 보유(shares>0) 종목을 위로
  const [heldFirst, setHeldFirstState] = useState(getHeldFirst);
  const toggleHeldFirst = () => setHeldFirstState(v => { setHeldFirst(!v); return !v; });

  // 정렬 적용 — sleeping 은 항상 맨 아래, 그 외엔 sortKey + sortDir 따라.
  //  내꺼먼저 ON 이면 보유(shares>0) 를 맨 위로(그 안에서는 기존 정렬 유지).
  const sortedVisible = useMemo(() => {
    const sectorMap = new Map<string, string>();
    for (const [t, info] of naverMap.entries()) {
      if (info?.sector) sectorMap.set(t, info.sector);
    }
    const base = sortHoldings(visible, priceMap, sectorMap, sortKey, sortDir);
    if (!heldFirst) return base;
    return [...base.filter(s => s.shares > 0), ...base.filter(s => !(s.shares > 0))];
  }, [visible, priceMap, naverMap, sortKey, sortDir, heldFirst]);

  const chartMap = useMemo(
    () => {
      const m = new Map(chartQs.map((q, i) =>
        [krxTickers[i], (q.data ?? []).map(p => p.close)]
      ));
      usChartQs.forEach((q, i) => m.set(usTickers[i], (q.data ?? []).map(p => p.close)));
      return m;
    },
    [chartQs, krxTickers, usChartQs, usTickers]
  );
  // OHLC 포함 원본 — StockCard 가격 박스 호버 툴팁의 1개월 캔들차트용
  const priceHistoryMap = useMemo(
    () => {
      const m = new Map(chartQs.map((q, i) => [krxTickers[i], q.data ?? []]));
      usChartQs.forEach((q, i) => m.set(usTickers[i], q.data ?? []));
      return m;
    },
    [chartQs, krxTickers, usChartQs, usTickers]
  );

  // 같은 ticker 가 속한 그룹들 — 카드 상단 알약 표시용
  // Map<ticker, account[]>  ("" 빈 그룹은 "기본" 으로 표시되고 다중그룹 표시 제외 — 메인 카운트 안 됨)
  const tickerGroupsMap = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const h of holdings) {
      const acc = h.account || "";
      if (!acc) continue;            // 그룹 없는(빈) 항목은 다중그룹 표시에서 제외
      const arr = m.get(h.ticker) ?? [];
      if (!arr.includes(acc)) arr.push(acc);
      m.set(h.ticker, arr);
    }
    return m;
  }, [holdings]);
  // 보유수량>0 인 (ticker→그룹) — 그룹 칩 붉은색 표시용
  const tickerHeldGroupsMap = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const h of holdings) {
      const acc = h.account || "";
      if (!acc || !(h.shares > 0)) continue;
      const set = m.get(h.ticker) ?? new Set<string>();
      set.add(acc);
      m.set(h.ticker, set);
    }
    return m;
  }, [holdings]);

  // 상단 헤더 접기/펼치기 (localStorage 지속)
  const [headerCollapsed, setHeaderCollapsed] = useState(() => {
    try { return localStorage.getItem("portfolio_header_collapsed") === "1"; } catch { return false; }
  });
  const toggleHeader = () => setHeaderCollapsed(v => {
    const next = !v;
    try { localStorage.setItem("portfolio_header_collapsed", next ? "1" : "0"); } catch { /* noop */ }
    return next;
  });

  // 종목 목록 보기 모드 — 일괄(전체) / 시장분리(코스피·코스닥·ETF). 정렬 툴바 선택박스.
  // 시장분리(코스피/코스닥/ETF/기타) 보기 — 설정에서 토글, reloadKey 로 재반영
  const marketSplit = useMemo(() => getMarketSplit(), [reloadKey]);
  // 시장분리 섹션 — 점프바·콘텐츠 공용 (가격 들어온 종목 기준)
  const marketSplitData = useMemo(() => {
    if (!marketSplit) return null;
    const shown = sortedVisible.filter(s =>
      prices === undefined || priceMap.size === 0 || priceMap.has(s.ticker));
    return heldFirst
      ? { mode: "held" as const, ...splitHeldAndMarket(shown, krMarketMap) }
      : { mode: "flat" as const, sections: splitByMarket(shown, krMarketMap) };
  }, [marketSplit, heldFirst, sortedVisible, prices, priceMap, krMarketMap]);
  // PC 점프바 칩 — 행 단위 묶음(코스피·코스닥 / ETF·기타). heldFirst 면 그룹 라벨 칩 추가.
  const pcRowItems = (sections: MarketSection[], idp: string) => {
    const mk = (rowName: string, pairs: [string, string][]) => {
      const present = pairs.filter(([k]) => sections.some(s => s.key === k));
      return present.length ? [{ id: `${idp}-${rowName}`, emoji: "", short: present.map(([, l]) => l).join("·") }] : [];
    };
    return [
      ...mk("row1", [["KOSPI", "코스피"], ["KOSDAQ", "코스닥"]]),
      ...mk("row2", [["ETF", "ETF"], ["기타", "기타"]]),
    ];
  };
  const marketNavItems: GroupNavItem[] = !marketSplitData ? []
    : marketSplitData.mode === "flat"
      ? pcRowItems(marketSplitData.sections, "m")
      : [
          ...(marketSplitData.held.length ? [{ id: "lbl-held", emoji: "", short: "내꺼", label: true }, ...pcRowItems(marketSplitData.held, "held")] : []),
          ...(marketSplitData.notHeld.length ? [{ id: "lbl-nh", emoji: "", short: "내꺼아님", label: true }, ...pcRowItems(marketSplitData.notHeld, "nh")] : []),
        ];

  // 헤더/탭 높이를 측정해 sticky top 을 동적 계산 (헤더 접힘·탭 wrap 대응).
  const headerRef = useRef<HTMLElement>(null);
  const [headerH, setHeaderH] = useState(56);
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const update = () => setHeaderH(el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [headerCollapsed]);

  const tabsStickyRef = useRef<HTMLDivElement>(null);
  const [tabsH, setTabsH] = useState(0);
  useLayoutEffect(() => {
    const el = tabsStickyRef.current;
    if (!el) return;
    const update = () => setTabsH(el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tabs.length]);

  return (
    <div className="min-h-screen bg-gray-50">
      <NewVersionToast />
      {tossMaint.active && (
        <div className="bg-amber-100 border-b border-amber-300 text-amber-900 text-xs
                        px-4 py-1.5 text-center">
          {tossMaint.needsWorkerUpdate ? (
            <>🚧 토스 점검 중 — 네이버 시세 우회는 워커 업데이트가 필요합니다.{" "}
              <a href="https://github.com/hanjungwoo3/portfolio-web/blob/main/workers/proxy/UPDATE-POST-SUPPORT.md"
                 target="_blank" rel="noopener noreferrer" className="underline font-bold">워커 업데이트 안내 ↗</a>
            </>
          ) : tossMaint.naverWorking ? (
            <>🚧 토스 점검 중{tossMaint.until ? ` (~${fmtUntil(tossMaint.until)})` : ""} — 네이버 시세로 표시 중 (정밀도 일부 낮을 수 있음)</>
          ) : (
            <>🚧 토스증권 점검 중{tossMaint.until ? ` (~${fmtUntil(tossMaint.until)})` : ""} — 종목 시세는 네이버로 우회됩니다</>
          )}
        </div>
      )}
      {!headerCollapsed && (
      <header ref={headerRef} className="bg-white border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-[1600px] mx-auto flex items-center gap-3 px-6 py-3">
          <button onClick={toggleHeader} title="헤더 접기 (포트폴리오~설정 숨김)"
                  className="shrink-0 p-1 rounded text-gray-500
                             hover:text-gray-800 hover:bg-gray-100 transition">
            <Menu size={18} />
          </button>
          <h1 className="text-xl font-bold text-gray-900 shrink-0">
            📈 포트폴리오
          </h1>
          <RefreshIndicatorGlobal refetchIntervalMs={REFRESH_MS} />
          <ProxyStatusBadge baseRefreshMs={BASE_REFRESH_MS}
                            usePersonalProxy={usePersonalProxy}
                            onOpenSettings={() => setSettingsOpen(true)} />
          <div className="flex items-center gap-3 ml-auto">
            <button
              onClick={() => void forceUpdate()}
              title={`최신 버전 적용 (캐시 초기화 + 새로고침)\ncommit: ${__COMMIT_HASH__}`}
              className="px-2 py-1.5 rounded text-sm
                         text-gray-500 hover:text-blue-600
                         hover:bg-gray-100 transition">
              ✨
            </button>
            {/* 모바일 헤더와 통일 — 아이콘 제거, 짧은 한글 라벨 */}
            <button
              onClick={() => setSearchOpen(true)}
              title="종목 검색 / 추가 — 검색 결과에서 수량·평단 입력 시 보유로 등록"
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700
                         text-white rounded text-sm">
              검색
            </button>
            <button
              onClick={() => { setHelpStep(HELP_STEP_BY_TAB[activeTab] ?? 0); setHelpOpen(true); }}
              title="사용법 빠른 시작 — 현재 탭 설명으로 바로 이동"
              className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200
                         text-gray-700 rounded text-sm">
              사용법
            </button>
            <button
              onClick={() => setFeedbackOpen(true)}
              title="기능 요청 / 버그 신고 / 의견 (가입 없이 익명 작성)"
              className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100
                         text-emerald-700 rounded text-sm border border-emerald-200">
              질문하기
            </button>
            <button
              onClick={() => setDonateOpen(true)}
              title="개발지원 (카카오페이)"
              className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200
                         text-gray-700 rounded text-sm">
              개발지원
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              title="설정"
              className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200
                         text-gray-700 rounded text-sm">
              설정
            </button>
          </div>
        </div>
      </header>
      )}

      <main className="max-w-[1600px] mx-auto p-3">
        <div ref={tabsStickyRef}
             style={{ top: headerCollapsed ? 0 : headerH }}
             className="sticky z-40 bg-white/95 backdrop-blur -mx-3 px-3 pt-1 mb-3 [&>nav]:!mb-0">
          <Tabs tabs={tabs} activeKey={activeTab} onChange={setActiveTab}
                 onRename={async (oldName, newName) => {
                   await renameGroup(oldName, newName);
                   if (activeTab === oldName) setActiveTab(newName);
                   setReloadKey(k => k + 1);
                 }}
                 onDelete={async name => {
                   await deleteGroup(name);
                   if (activeTab === name) setActiveTab("");
                   setReloadKey(k => k + 1);
                 }}
                 folders={groupFolders}
                 leading={headerCollapsed ? (
                   <button onClick={toggleHeader}
                           title="헤더 펼치기 (포트폴리오~설정 보이기)"
                           className="p-1 rounded text-gray-500
                                      hover:text-gray-800 hover:bg-gray-100 transition">
                     <Menu size={18} />
                   </button>
                 ) : undefined} />
        </div>

        {activeTab === MARKET_MONEY_TAB_KEY ? (
          <StockMarketTab />
        ) : activeTab === US_MARKET_TAB_KEY ? (
          <UsMarketTab navStickyTop={(headerCollapsed ? 0 : headerH) + tabsH}
            onRequestSearch={(q) => {
            setSearchInitQuery(q);
            setSearchOpen(true);
          }} />
        ) : activeTab === SECTOR_RANK_TAB_KEY ? (
          <SectorRankingTab onRequestSearch={(q) => {
            setSearchInitQuery(q);
            setSearchOpen(true);
          }} />
        ) : activeTab === SEMI_CHECK_TAB_KEY ? (
          <SemiCheckTab />
        ) : activeTab === MY_TRADES_TAB_KEY ? (
          <MyTradesTab holdings={holdings} pc prices={priceMap} onOpenValuation={setValuationTicker} />
        ) : activeTab === CONSENSUS_TAB_KEY ? (
          <ConsensusTab items={consensusItems} onOpenValuation={setValuationTicker}
                        onSelectGroup={setActiveTab}
                        onEdit={(ticker) => {
                          const s = holdings.find(h => h.ticker === ticker);
                          if (s) setEditing(s);
                        }} />
        ) : activeTab === ETF_REVERSE_TAB_KEY ? (
          <EtfReverseTab holdings={holdings}
                         onOpenEtfComposition={(code, n) => setEtfDialog({ ticker: code, name: n })}
                         onRequestAdd={q => { setSearchInitQuery(q); setSearchOpen(true); }} />
        ) : activeTab === ETF_RANKING_TAB_KEY ? (
          <EtfRankingTab onOpenEtfComposition={(code, n) => setEtfDialog({ ticker: code, name: n })} />
        ) : visible.length === 0 ? (
          holdings.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <div className="text-4xl mb-3">📥</div>
              <p className="mb-4">
                아직 등록된 종목이 없습니다.<br />
                상단 [⚙️ 설정]에서 JSON 붙여넣기로 가져오세요.
              </p>
              <button
                onClick={() => setSettingsOpen(true)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700
                           text-white rounded text-sm font-medium">
                ⚙️ 설정 열기
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-center py-8 text-gray-500">
                이 탭에는 종목이 없습니다.
              </div>
              {/* 종목 없어도 예수금은 입력/수정 가능 (그룹 탭) */}
              <TotalRow holdings={visible} prices={priceMap}
                        account={activeTab}
                        aggregated={activeTab === MY_STOCKS_TAB_KEY}
                        onDepositChange={() => setReloadKey(k => k + 1)} />
              {/* 오늘 전량 매도해 보유 0이어도 오늘 실현은 보이게 */}
              <TodayRealizedCard trades={allTrades} account={activeTab}
                                 aggregated={activeTab === MY_STOCKS_TAB_KEY}
                                 holdings={visible} prices={priceMap} nameMap={nameMap} />
            </div>
          )
        ) : (
          <>
            {/* 정렬 옵션 + 심플 보기 + 추가지표 일괄 토글 — sticky. 탭 바 바로 아래에 고정
                (탭이 여러 줄로 wrap 되므로 top 을 헤더+탭 높이로 동적 계산) */}
            <div style={{ top: (headerCollapsed ? 0 : headerH) + tabsH }}
                 className="sticky z-30 bg-white/95 backdrop-blur
                            flex items-center justify-end gap-2 mb-2 py-1.5
                            -mx-3 px-3 border-b border-gray-200">
              {/* 시장분리 점프바 (좌측) — 코스피/코스닥/ETF/기타 섹션으로 스크롤. 분리 OFF 면 스페이서만 */}
              {marketSplit && marketNavItems.length > 0 ? (
                <GroupNavBar items={marketNavItems} idPrefix="pcmsplit-" sticky={false}
                             scrollMarginTop={(headerCollapsed ? 0 : headerH) + tabsH + 44}
                             className="mr-auto" />
              ) : <div className="mr-auto" />}
              <button onClick={() => setSimpleOpen(true)}
                      title="심플 보기 — 현재가만 한눈에 (팝업)"
                      className="px-2.5 py-1 rounded text-xs font-bold border transition
                                 bg-white text-gray-600 border-gray-300 hover:bg-gray-50">
                💠 심플 보기
              </button>
              <button onClick={async () => {
                        const codes = krxTickers.join(", ");
                        if (!codes) return;
                        try {
                          await navigator.clipboard.writeText(codes);
                          setCodesCopied(true);
                          setTimeout(() => setCodesCopied(false), 1500);
                        } catch { /* ignore */ }
                      }}
                      title="이 그룹의 모든 종목 코드를 클립보드로 복사"
                      className="px-2.5 py-1 rounded text-xs font-bold border transition
                                 bg-white text-gray-600 border-gray-300 hover:bg-gray-50">
                {codesCopied ? "✓ 복사됨" : "📋 코드 복사"}
              </button>
              <SortSelector sortKey={sortKey} sortDir={sortDir}
                            onChangeKey={sortHandlers.onChangeKey}
                            onToggleDir={sortHandlers.onToggleDir} />
            </div>
            {(() => {
              // 합산 그룹 row — 실제 holdings 가 아니라 가상으로 합쳐진 항목.
              // 수정/삭제는 실제 그룹 탭에서만 가능 (어느 그룹을 수정할지 모호).
              const isAggregated = activeTab === MY_STOCKS_TAB_KEY;
              // 가격이 한 번도 안 들어온 종목(KRX300 처럼 유효하지 않은 코드)은 숨김.
              // 단 ① 첫 로딩(prices 미정) ② 전체 실패(priceMap 비어있음) 시엔 모두 표시.
              const shown = sortedVisible.filter(stock =>
                prices === undefined || priceMap.size === 0 || priceMap.has(stock.ticker));
              const renderCard = (stock: Stock) => (
                <StockCard
                  key={`${stock.ticker}_${stock.account || ""}`}
                  stock={stock}
                  price={priceMap.get(stock.ticker)}
                  krReg={krRegMap?.get(stock.ticker)}
                  investor={investorMap.get(stock.ticker)}
                  investorHistory={investorHistoryMap.get(stock.ticker)}
                  warning={warningMap.get(stock.ticker)}
                  sector={naverMap.get(stock.ticker)?.sector}
                  market={krMarketMap.get(stock.ticker)}
                  consensus={naverMap.get(stock.ticker)?.consensus ?? null}
                  chart={chartMap.get(stock.ticker)}
                  priceHistory={priceHistoryMap.get(stock.ticker)}
                  longHistory={longHistoryMap.get(stock.ticker)}
                  memo={memos.get(stock.ticker)}
                  otherGroups={isAggregated
                    ? (tickerGroupsMap.get(stock.ticker) ?? [])
                    : (tickerGroupsMap.get(stock.ticker) ?? [])
                        .filter(g => g !== (stock.account || ""))}
                  heldGroups={tickerHeldGroupsMap.get(stock.ticker)}
                  onOpenValuation={setValuationTicker}
                  onEdit={isAggregated ? (s => setEditAllStock({ ticker: s.ticker, name: s.name })) : (s => setEditing(s))}
                  onDelete={isAggregated ? undefined : (async s => {
                    await removeHolding(s.ticker, s.account || "");
                    setReloadKey(k => k + 1);
                  })}
                  onOpenMemo={t => setMemoTicker(t)}
                  onOpenEtf={(tk, nm) => setEtfDialog({ ticker: tk, name: nm })}
                  onOpenEtfReverse={(tk, nm) => setEtfReverseDialog({ ticker: tk, name: nm })}
                />
              );
              if (!marketSplit || !marketSplitData) {
                // 시장 분리 OFF. 내꺼먼저 ON 이면 PC 에서 좌(보유)/우(관심) 2단 분할.
                // (모바일은 좁아서 MobileSimpleView 가 세로 스택으로 별도 처리)
                const heldCards = shown.filter(s => s.shares > 0);
                const notHeldCards = shown.filter(s => !(s.shares > 0));
                if (heldFirst && heldCards.length > 0 && notHeldCards.length > 0) {
                  return (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-3 gap-y-2 items-start">
                      <div className="space-y-2">
                        <div className="text-[11px] font-bold text-gray-500 px-0.5">📌 내꺼 (보유) <span className="text-gray-400">{heldCards.length}종목</span></div>
                        <div className="grid grid-cols-1 gap-2">{heldCards.map(renderCard)}</div>
                      </div>
                      <div className="space-y-2">
                        <div className="text-[11px] font-bold text-gray-500 px-0.5">👀 내꺼 아님 (관심) <span className="text-gray-400">{notHeldCards.length}종목</span></div>
                        <div className="grid grid-cols-1 gap-2">{notHeldCards.map(renderCard)}</div>
                      </div>
                    </div>
                  );
                }
                return <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">{shown.map(renderCard)}</div>;
              }
              // 시장 분리 보기 — heldFirst 면 내꺼/내꺼아님 2단, 아니면 시장만.
              const splitScrollMargin = (headerCollapsed ? 0 : headerH) + tabsH + 44;
              const subtotal = (items: Stock[]) => {
                let invested = 0, current = 0, yesterday = 0;
                for (const s of items) {
                  if (!(s.shares > 0)) continue;
                  const p = priceMap.get(s.ticker);
                  const cur = p?.price || s.avg_price;
                  invested += s.shares * s.avg_price;
                  current += cur * s.shares;
                  yesterday += holdingYesterdayBaseSum(s, p ?? { price: s.avg_price, base: 0 });
                }
                const pnl = current - invested;
                const dayDiff = current - yesterday;
                return {
                  invested, current, pnl,
                  pct: invested > 0 ? (pnl / invested) * 100 : 0,
                  dayDiff, dayPct: yesterday > 0 ? (dayDiff / yesterday) * 100 : 0,
                };
              };
              const sectionHead = (label: string, items: Stock[]) => {
                const t = subtotal(items);
                return (
                  <div className="border-b border-gray-300 pb-1 mb-2">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs font-bold text-gray-600">{label}</span>
                      <span className="text-[11px] text-gray-400">{items.length}종목</span>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-[11px] tabular-nums text-gray-500">
                      <span>원금 <b className="text-gray-700">{Math.round(t.invested).toLocaleString()}</b></span>
                      <span>현재 <b className={signColor(t.pnl)}>{Math.round(t.current).toLocaleString()}</b></span>
                      <span>전체 <b className={signColor(t.pnl)}>{formatSigned(Math.round(t.pnl))} ({t.pct >= 0 ? "+" : ""}{t.pct.toFixed(2)}%)</b></span>
                      <span>오늘 <b className={signColor(t.dayDiff)}>{formatSigned(Math.round(t.dayDiff))} ({t.dayPct >= 0 ? "+" : ""}{t.dayPct.toFixed(2)}%)</b></span>
                    </div>
                  </div>
                );
              };
              const block = (sections: MarketSection[], key: string, label: string) => {
                const sec = sections.find(s => s.key === key);
                return sec ? (
                  <div key={key}>
                    {sectionHead(label, sec.stocks)}
                    <div className="grid grid-cols-1 gap-2">{sec.stocks.map(renderCard)}</div>
                  </div>
                ) : null;
              };
              // 행(2단 페어) — 앵커는 행 div 에 (PC 점프바가 행 단위). 둘 다 없으면 생략.
              const rowDiv = (sections: MarketSection[], idp: string, rowName: string, pairs: [string, string][]) => {
                if (!pairs.some(([k]) => sections.some(s => s.key === k))) return null;
                return (
                  <div id={`pcmsplit-${idp}-${rowName}`} style={{ scrollMarginTop: splitScrollMargin }}
                       className="grid grid-cols-1 lg:grid-cols-2 gap-x-3 gap-y-3 items-start">
                    {pairs.map(([k, l]) => block(sections, k, l))}
                  </div>
                );
              };
              const marketGrid = (sections: MarketSection[], idp: string) => (
                <>
                  {rowDiv(sections, idp, "row1", [["KOSPI", "코스피"], ["KOSDAQ", "코스닥"]])}
                  {rowDiv(sections, idp, "row2", [["ETF", "ETF"], ["기타", "기타"]])}
                </>
              );
              const groupHeader = (text: string) => (
                <div className="text-[11px] font-bold text-gray-500 px-0.5">{text}</div>
              );
              if (marketSplitData.mode === "flat") {
                // 내꺼먼저 OFF — 시장만 분리 (보유/관심 섞임)
                return <div className="space-y-3">{marketGrid(marketSplitData.sections, "m")}</div>;
              }
              // 내꺼먼저 ON — 내꺼(보유) / 내꺼아님(관심) 으로 먼저, 각 안에서 시장
              const { held, notHeld } = marketSplitData;
              return (
                <div className="space-y-3">
                  {held.length > 0 && (
                    <div id="pcmsplit-held" className="space-y-3" style={{ scrollMarginTop: splitScrollMargin }}>
                      {groupHeader("📌 내꺼 (보유)")}
                      {marketGrid(held, "held")}
                    </div>
                  )}
                  {notHeld.length > 0 && (
                    <div id="pcmsplit-nh" className="space-y-3 pt-1" style={{ scrollMarginTop: splitScrollMargin }}>
                      {groupHeader("👀 내꺼 아님 (관심)")}
                      {marketGrid(notHeld, "nh")}
                    </div>
                  )}
                </div>
              );
            })()}
            <div className="sticky bottom-0 z-40 mt-3 w-full flex flex-wrap items-start gap-2">
              <TotalRow holdings={visible} prices={priceMap}
                        account={activeTab}
                        aggregated={activeTab === MY_STOCKS_TAB_KEY}
                        heldFirst={heldFirst} onToggleHeldFirst={toggleHeldFirst}
                        onDepositChange={() => setReloadKey(k => k + 1)} />
              <TodayPnLTable holdings={visible} prices={priceMap} />
              <TodayRealizedCard trades={allTrades} account={activeTab}
                                 aggregated={activeTab === MY_STOCKS_TAB_KEY}
                                 holdings={visible} prices={priceMap} nameMap={nameMap} />
              <div className="ml-auto">
                <WhatIfRow holdings={visible} prices={priceMap} />
              </div>
            </div>
          </>
        )}
      </main>

      {onboardReady && (
        <OnboardingDialog onOpenSettings={() => setSettingsOpen(true)} />
      )}

      <HelpDialog
        isOpen={helpOpen}
        initialStep={helpStep}
        onClose={() => { markHelpSeen(); setHelpOpen(false); setOnboardReady(true); }}
      />

      <SettingsDialog
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onChanged={() => setReloadKey(k => k + 1)}
        groups={userGroups}
      />

      <FeedbackDialog
        isOpen={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
      />

      <SearchDialog
        isOpen={searchOpen}
        onClose={() => { setSearchOpen(false); setSearchInitQuery(""); }}
        onAdded={() => setReloadKey(k => k + 1)}
        initialQuery={searchInitQuery}
      />

      <EditHoldingDialog
        isOpen={!!editing}
        onClose={() => setEditing(null)}
        stock={editing}
        curPrice={editing ? priceMap.get(editing.ticker)?.price : undefined}
        onChanged={() => setReloadKey(k => k + 1)}
      />

      {editAllStock && (
        <MyStockEditDialog
          ticker={editAllStock.ticker}
          name={editAllStock.name}
          onClose={() => setEditAllStock(null)}
          onChanged={() => setReloadKey(k => k + 1)}
        />
      )}

      <MemoDialog
        isOpen={!!memoTicker}
        onClose={() => setMemoTicker(null)}
        ticker={memoTicker}
        stockName={memoTicker
          ? (holdings.find(h => h.ticker === memoTicker)?.name)
          : undefined}
        curPrice={memoTicker ? priceMap.get(memoTicker)?.price : undefined}
        avgPrice={memoTicker
          ? (() => {
              const h = holdings.find(s => s.ticker === memoTicker && s.shares > 0);
              return h?.avg_price;
            })()
          : undefined}
        onChanged={() => setReloadKey(k => k + 1)}
      />

      <DonateDialog isOpen={donateOpen} onClose={() => setDonateOpen(false)} />
      <SimpleViewModal isOpen={simpleOpen} onClose={() => setSimpleOpen(false)}
                       title={tabs.find(t => t.key === activeTab)?.label ?? activeTab}
                       stocks={sortedVisible} priceMap={priceMap} chartMap={chartMap}
                       targetMap={new Map(krxTickers.map(t => [t, naverMap.get(t)?.consensus?.target]))} />

      {etfDialog && (
        <EtfCompositionDialog isOpen={true}
                              ticker={etfDialog.ticker} etfName={etfDialog.name}
                              onClose={() => setEtfDialog(null)}
                              onRequestSearch={(q) => {
                                // ETF 구성 창은 닫지 않고 검색만 위에 띄움 (SearchDialog z-[60] > ETF z-50)
                                setSearchInitQuery(q);
                                setSearchOpen(true);
                              }} />
      )}

      {etfReverseDialog && (
        <EtfReverseDialog ticker={etfReverseDialog.ticker} name={etfReverseDialog.name}
                          onClose={() => setEtfReverseDialog(null)}
                          onOpenEtfComposition={(code, n) => {
                            setEtfReverseDialog(null);
                            setEtfDialog({ ticker: code, name: n });
                          }}
                          onRequestAdd={q => {
                            setEtfReverseDialog(null);
                            setSearchInitQuery(q); setSearchOpen(true);
                          }} />
      )}

      {valuationTicker && (() => {
        const s = holdings.find(h => h.ticker === valuationTicker);
        if (!s) return null;
        return (
          <ValuationModal
            isOpen={true}
            onClose={() => setValuationTicker(null)}
            ticker={valuationTicker}
            name={s.name}
            curPrice={priceMap.get(valuationTicker)?.price}
            todayBar={(() => { const p = priceMap.get(valuationTicker); return p ? { open: p.open, high: p.high, low: p.low } : undefined; })()}
            myAvgPrice={s.shares > 0 ? s.avg_price : undefined}
            entryPrice={memos.get(valuationTicker)?.entryPrice}
          />
        );
      })()}
    </div>
  );
}

// 글로벌 lastRefresh 기반 RefreshIndicator — 클릭 시 전체 쿼리 갱신(수동 모드 핵심)
function RefreshIndicatorGlobal({ refetchIntervalMs }: { refetchIntervalMs: number }) {
  const ts = useLastRefresh();
  if (ts === 0) return null;
  return <RefreshIndicator dataUpdatedAt={ts} refetchIntervalMs={refetchIntervalMs}
                           onRefresh={() => void queryClient.invalidateQueries()} />;
}

function AppRoot() {
  const isMobile = useIsMobile();
  const [ready, setReady] = useState(false);

  // PC/모바일 공통 — 부팅 1회: 레거시 데이터 정리 + 마이그레이션
  // 완료 전 children mount 차단 → race condition 방지
  useEffect(() => {
    void (async () => {
      const removed = await cleanupReservedAccounts();
      const migrated = await migrateEmptyAccountToHolding();
      // 고아 예수금 정리 — 삭제/이름변경된 그룹의 잔여 예수금이 '내주식' 총자산에 잡히던 문제
      const prunedDeposits = await pruneOrphanDeposits();
      // 묵은 파생필드(todayShares/todayCost) 1회 정리 — 과거 누수로 '오늘=전체손익' 굳던 값 제거
      const purgedDerived = await purgeDerivedHoldingFields();
      if (removed > 0 || migrated > 0 || prunedDeposits > 0 || purgedDerived > 0) {
        // eslint-disable-next-line no-console
        console.log(`[boot] cleaned=${removed}, migrated=${migrated}, deposits=${prunedDeposits}, purgedDerived=${purgedDerived}`);
        await queryClient.invalidateQueries({ queryKey: ["m-holdings"] });
      }
      setReady(true);
      // 깨진 종목명(인코딩 U+FFFD) 백그라운드 복구 — 정상 출처에서 이름 재취득 후 덮어씀. UI 비차단.
      void repairBrokenNames(fetchKrStockName).then(fixed => {
        if (fixed > 0) {
          // eslint-disable-next-line no-console
          console.log(`[boot] repaired ${fixed} broken name(s)`);
          void queryClient.invalidateQueries();
        }
      }).catch(() => { /* 복구 실패 — 무시 */ });
    })();
  }, []);

  if (!ready) return null;
  return isMobile ? <MobileSimpleView /> : <Dashboard />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppRoot />
    </QueryClientProvider>
  );
}

export default App;
