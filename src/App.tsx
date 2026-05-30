import { useEffect, useMemo, useRef, useState } from "react";
import { QueryClient, QueryClientProvider, useQueries, useQuery } from "@tanstack/react-query";
import {
  fetchTossPrices, fetchInvestorHistory, pickTodayInvestor, fetchKrRegularPrices, verifyKrMarkets,
  fetchWarning, fetchNaverInfo, fetchKrPriceHistory,
  fetchInvestorHistorySafe, fetchNaverPrices,
} from "./lib/api";
import { loadHoldings, loadMemos, removeHolding, renameGroup, deleteGroup, cleanupReservedAccounts, migrateEmptyAccountToHolding } from "./lib/db";
import { StockCard } from "./components/StockCard";
import { MemoDialog } from "./components/MemoDialog";
import { Tabs, buildTabs, filterByTab, US_MARKET_TAB_KEY, SEMI_CHECK_TAB_KEY, SECTOR_RANK_TAB_KEY, MY_STOCKS_TAB_KEY, CONSENSUS_TAB_KEY, ETF_REVERSE_TAB_KEY } from "./components/Tabs";
import { EtfReverseTab } from "./components/EtfReverseTab";
import { ConsensusTab, type ConsensusItem } from "./components/ConsensusTab";
import { SimpleViewModal } from "./components/SimpleViewModal";
import { SectorRankingTab } from "./components/SectorRankingTab";
import { getTabVisibility } from "./lib/tabVisibility";
import { getGroupFolders } from "./lib/groupFolders";
import { TotalRow } from "./components/TotalRow";
import { TodayPnLTable } from "./components/TodayPnLTable";
import { nowKstDateStr } from "./lib/format";
import { WhatIfRow } from "./components/WhatIfRow";
import { SettingsDialog } from "./components/SettingsDialog";
import { FeedbackDialog } from "./components/FeedbackDialog";
import { DonateDialog } from "./components/DonateDialog";
import { EtfCompositionDialog } from "./components/EtfCompositionDialog";
import { EtfReverseDialog } from "./components/EtfReverseDialog";
import { OnboardingDialog } from "./components/OnboardingDialog";
import { SearchDialog } from "./components/SearchDialog";
import { EditHoldingDialog } from "./components/EditHoldingDialog";
import { UsMarketTab } from "./components/UsMarketTab";
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
import { AuxBatchToggle } from "./components/AuxBatchToggle";
import { reportRefresh, useLastRefresh } from "./lib/lastRefresh";
import { getEffectivePollMs, getPersonalProxyUrl } from "./lib/proxyConfig";
import { ValuationModal } from "./components/ValuationModal";
import { MobileSimpleView } from "./components/MobileSimpleView";
import { HelpDialog, markHelpSeen, shouldShowHelpFirstTime } from "./components/HelpDialog";
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
  const [activeTab, setActiveTab] = useState<string>("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInitQuery, setSearchInitQuery] = useState("");
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [etfDialog, setEtfDialog] = useState<{ ticker: string; name: string } | null>(null);
  const [etfReverseDialog, setEtfReverseDialog] = useState<{ ticker: string; name: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [valuationTicker, setValuationTicker] = useState<string | null>(null);
  const [editing, setEditing] = useState<Stock | null>(null);
  const [memoTicker, setMemoTicker] = useState<string | null>(null);
  const [donateOpen, setDonateOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [simpleOpen, setSimpleOpen] = useState(false);
  const [codesCopied, setCodesCopied] = useState(false);

  // 첫 방문 자동 노출 — 1.5초 지연 (다른 모달과 충돌 회피)
  useEffect(() => {
    if (!shouldShowHelpFirstTime()) return;
    const t = setTimeout(() => setHelpOpen(true), 1500);
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
      const [h, m] = await Promise.all([loadHoldings(), loadMemos()]);
      // eslint-disable-next-line no-console
      console.log(`[v3 load] holdings=${h.length}, memos=${m.size}`);
      setHoldings(h);
      setMemos(m);
    })();
  }, [reloadKey]);

  // reloadKey 의존성 — 설정에서 시스템 탭 visibility 변경 시 즉시 반영
  const tabs = useMemo(() => buildTabs(holdings, getTabVisibility()), [holdings, reloadKey]);
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

  // 한국 종목 거래소 자동 검증 — 토스 stock-infos API 사용 (market.code: KSP/KSQ).
  // 결과는 localStorage 캐시 (24시간) — 매번 검증 부담 회피.
  const { data: verifiedMarketMap } = useQuery({
    queryKey: ["kr-markets-verified", krxTickers],
    queryFn: async () => {
      const cacheRaw = localStorage.getItem("kr_markets_verified") ?? "{}";
      const cache = JSON.parse(cacheRaw) as Record<string, "KOSPI" | "KOSDAQ">;
      const cacheTs = Number(localStorage.getItem("kr_markets_verified_ts") ?? "0");
      const isFresh = Date.now() - cacheTs < 24 * 3600 * 1000;
      const known = isFresh ? new Map(Object.entries(cache)) : new Map();
      const toVerify = krxTickers.filter(t => !known.has(t));
      if (toVerify.length === 0) return known;
      const fresh = await verifyKrMarkets(toVerify);
      for (const [t, mkt] of fresh) known.set(t, mkt);
      const obj: Record<string, string> = {};
      for (const [k, v] of known) obj[k] = v;
      localStorage.setItem("kr_markets_verified", JSON.stringify(obj));
      localStorage.setItem("kr_markets_verified_ts", String(Date.now()));
      return known;
    },
    enabled: krxTickers.length > 0,
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

  const priceMap = useMemo(
    () => new Map((prices ?? []).map(p => [p.ticker, p])),
    [prices]
  );

  // 브라우저 탭 제목 — 전체금액 → 전체% → 오늘금액 → 오늘% 순서로 순환 (좁은 탭에서도 안 잘림)
  const titlePartsRef = useRef<string[]>([]);
  useEffect(() => {
    const today = nowKstDateStr();
    let invested = 0, cur = 0, yest = 0;
    for (const s of visible) {
      if (s.shares <= 0) continue;
      const p = priceMap.get(s.ticker);
      if (!p) continue;
      const c = p.price || s.avg_price;
      const base = s.buy_date === today ? s.avg_price : (p.base || c);
      invested += s.avg_price * s.shares;
      cur += c * s.shares;
      yest += base * s.shares;
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
      out.push({ ticker: s.ticker, name: s.name, groups: groupsBy.get(s.ticker) ?? [] });
    }
    return out;
  }, [holdings]);
  // 정렬 적용 — sleeping 은 항상 맨 아래, 그 외엔 sortKey + sortDir 따라
  const sortedVisible = useMemo(() => {
    const sectorMap = new Map<string, string>();
    for (const [t, info] of naverMap.entries()) {
      if (info?.sector) sectorMap.set(t, info.sector);
    }
    return sortHoldings(visible, priceMap, sectorMap, sortKey, sortDir);
  }, [visible, priceMap, naverMap, sortKey, sortDir]);

  const chartMap = useMemo(
    () => new Map(chartQs.map((q, i) =>
      [krxTickers[i], (q.data ?? []).map(p => p.close)]
    )),
    [chartQs, krxTickers]
  );
  // OHLC 포함 원본 — StockCard 가격 박스 호버 툴팁의 1개월 캔들차트용
  const priceHistoryMap = useMemo(
    () => new Map(chartQs.map((q, i) => [krxTickers[i], q.data ?? []])),
    [chartQs, krxTickers]
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
      <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-[1600px] mx-auto flex items-center
                         gap-3 px-6 py-3">
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
              검색/주식추가
            </button>
            <button
              onClick={() => setHelpOpen(true)}
              title="사용법 빠른 시작"
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
              title="개발자 후원하기 (카카오페이)"
              className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200
                         text-gray-700 rounded text-sm">
              후원하기
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

      <main className="max-w-[1600px] mx-auto p-3">
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
               folders={groupFolders} />

        {activeTab === US_MARKET_TAB_KEY ? (
          <UsMarketTab onRequestSearch={(q) => {
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
            </div>
          )
        ) : (
          <>
            {/* 정렬 옵션 + 심플 보기 + 추가지표 일괄 토글 — sticky 로 스크롤 중에도 접근 */}
            <div className="sticky top-14 z-20 bg-white/95 backdrop-blur
                            flex items-center justify-end gap-2 mb-2 py-1.5
                            -mx-3 px-3 border-b border-gray-200">
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
              <AuxBatchToggle />
              <SortSelector sortKey={sortKey} sortDir={sortDir}
                            onChangeKey={sortHandlers.onChangeKey}
                            onToggleDir={sortHandlers.onToggleDir} />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              {sortedVisible
                // 가격이 한 번도 안 들어온 종목(KRX300 처럼 유효하지 않은 코드)은 숨김.
                // 단 ① 첫 로딩(prices 미정) ② 전체 실패(priceMap 비어있음) 시엔 모두 표시.
                .filter(stock =>
                  prices === undefined || priceMap.size === 0 || priceMap.has(stock.ticker)
                )
                .map(stock => {
                // 합산 그룹 row — 실제 holdings 가 아니라 가상으로 합쳐진 항목.
                // 수정/삭제는 실제 그룹 탭에서만 가능 (어느 그룹을 수정할지 모호).
                const isAggregated = activeTab === MY_STOCKS_TAB_KEY;
                return (
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
                  onOpenValuation={setValuationTicker}
                  onEdit={isAggregated ? undefined : (s => setEditing(s))}
                  onDelete={isAggregated ? undefined : (async s => {
                    await removeHolding(s.ticker, s.account || "");
                    setReloadKey(k => k + 1);
                  })}
                  onOpenMemo={t => setMemoTicker(t)}
                  onOpenEtf={(tk, nm) => setEtfDialog({ ticker: tk, name: nm })}
                  onOpenEtfReverse={(tk, nm) => setEtfReverseDialog({ ticker: tk, name: nm })}
                />
                );
              })}
            </div>
            <div className="sticky bottom-0 z-40 mt-3 w-full flex flex-wrap items-start gap-2">
              <TotalRow holdings={visible} prices={priceMap}
                        account={activeTab}
                        aggregated={activeTab === MY_STOCKS_TAB_KEY}
                        onDepositChange={() => setReloadKey(k => k + 1)} />
              <TodayPnLTable holdings={visible} prices={priceMap} />
              <div className="ml-auto">
                <WhatIfRow holdings={visible} prices={priceMap} />
              </div>
            </div>
          </>
        )}
      </main>

      <OnboardingDialog onOpenSettings={() => setSettingsOpen(true)} />

      <HelpDialog
        isOpen={helpOpen}
        onClose={() => { markHelpSeen(); setHelpOpen(false); }}
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
                                setEtfDialog(null);
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
      if (removed > 0 || migrated > 0) {
        // eslint-disable-next-line no-console
        console.log(`[boot] cleaned=${removed}, migrated=${migrated}`);
        await queryClient.invalidateQueries({ queryKey: ["m-holdings"] });
      }
      setReady(true);
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
