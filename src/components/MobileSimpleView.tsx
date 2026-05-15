import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  sortHoldings, loadSortKey, loadSortDir, saveSortKey, saveSortDir,
  type SortKey, type SortDirection,
} from "../lib/sortHoldings";
import { SortSelector, makeSortHandlers } from "./SortSelector";
import { AuxBatchToggle } from "./AuxBatchToggle";
import {
  fetchYahooBatch, fetchTossPrices, fetchNaverInfo, fetchWarning, fetchInvestorHistory,
  fetchYahooChart, fetchKrPriceHistory,
} from "../lib/api";
import {
  US_PAIRS,
} from "../lib/usMarketData";
import { isSymbolSleeping } from "../lib/format";
import {
  getPersonalProxyUrl, setPersonalProxyUrl,
  getEffectivePollMs, getPersonalPollMs, setPersonalPollMs, POLL_OPTIONS,
  getDimSleepingEnabled, setDimSleepingEnabled,
} from "../lib/proxyConfig";
import { useAdaptiveRefreshMs } from "../lib/proxyStatus";
import { getIndependentGroupsMode } from "../lib/groupMode";
import { normalizeAccount } from "../lib/account";
import type { MarketIndexKey } from "../lib/api";
import { MarketFlowModal } from "./MarketFlowModal";

// Toss / Yahoo 외부 링크 (UsMarketTab 와 동일 규칙)
function quoteUrl(symbol: string): string {
  // 한국 보유 종목 (6자리) 또는 KODEX/.KS ETF (6자리.KS) — 모두 토스
  const krMatch = /^(\d{6})(?:\.KS)?$/.exec(symbol);
  if (krMatch) return `https://tossinvest.com/stocks/A${krMatch[1]}`;
  if (symbol === "^KS11") return "https://www.tossinvest.com/indices/KGG01P";
  if (symbol === "^KQ11") return "https://www.tossinvest.com/indices/QGG01P";
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`;
}
import { RefreshIndicator } from "./RefreshIndicator";
import { forceUpdate } from "./VersionBadge";
import { NewVersionToast } from "./NewVersionToast";
import { OnboardingDialog } from "./OnboardingDialog";
import {
  exportAll, replaceAllHoldings, replaceAllPeaks, loadHoldings, loadPeaks, loadMemos,
  deleteAllRowsForTicker, removeHolding, renameGroup, deleteGroup,
} from "../lib/db";
import { detectPortfolioJson } from "../lib/portfolioImport";
import { MobileStockCard } from "./MobileStockCard";
import { MemoDialog } from "./MemoDialog";
import { TotalRow } from "./TotalRow";
import { WhatIfRow } from "./WhatIfRow";
import { SemiCheckTab } from "./SemiCheckTab";
import { MobileTodayPnLLayer } from "./TodayPnLTable";
import { SearchDialog } from "./SearchDialog";
import { EditHoldingDialog } from "./EditHoldingDialog";
import { HelpDialog, markHelpSeen, shouldShowHelpFirstTime } from "./HelpDialog";
import { Sparkline } from "./Sparkline";
import { ValuationModal } from "./ValuationModal";
import {
  getSyncState, getLastSyncedAt, enableSync, disableSync, pauseSync, resumeSync,
  uploadToDrive, downloadFromDrive, scheduleAutoSync,
  tryRestoreSession,
} from "../lib/syncManager";
import { isSignedIn, getAccessToken, wasSignedIn } from "../lib/googleAuth";
import type { Stock } from "../types";

const KR_KEY = "__kr__";  // 한국 (KOSPI/KOSDAQ + 한국 섹터 ETF + 짝 미국 섹터 ETF)
const US_KEY = "__us__";  // 미국 (환율·매크로·원자재·미국지수·미국 대표 ETF)
const SEMI_KEY = "__semi__";  // 반도체 점검 — MU·NVDA·장비주·환율
const TAB_KEY = "portfolio-mobile-active-tab";  // 마지막 활성 탭 기억
const KAKAOPAY_URL = "https://qr.kakaopay.com/FCscirjeF";

// 섹터 탭 — KOSPI/KOSDAQ + EWY/VIX(한국 sentiment) + 섹터 페어
const KR_ORDER: string[] = [
  "^KS11", "^KS200",
  "^KQ11", "^KQ100",
  "EWY", "^VIX",          // 외국인 투심 + 공포지수
  "SMH", "091160.KS",     // 반도체
  "^SOX", "SOX=F",        // 필반 + 선물 (반도체 섹터 매크로)
  "PAVE", "117700.KS",    // 건설/인프라
  "LIT", "305720.KS",     // 2차전지
  "XBI", "244580.KS",     // 바이오
  "KBE", "091170.KS",     // 은행
  "ITA", "449450.KS",     // 방산
  "XLV", "266420.KS",     // 헬스케어
  "BOTZ", "445290.KS",    // 로봇
];

// 매크로 탭 — 환율/금리 → 미국지수+선물 → 미국 대표 ETF → 원자재 (맨 아래)
const US_ORDER: string[] = [
  "KRW=X", "DX-Y.NYB",
  "JPY=X", "^TNX",
  "^IXIC", "NQ=F",
  "^GSPC", "ES=F",
  "^N225", "SPY",
  "QQQ", "DIA",
  "IWM", "VTI",
  "GC=F", "SI=F",
  "HG=F", "CL=F",
  "NG=F", "BTC-USD",
];

// 모바일 전용 단순 뷰 (v2 데스크톱 미국증시 표 형식 그대로 이식)
// 자동 갱신 X — 새로고침 버튼만. 자기 주식/그룹/검색 등 모든 추가 기능 없음.

function fmtPrice(symbol: string, price: number): string {
  if (symbol === "^TNX" || symbol === "^VIX") return price.toFixed(2);
  if (symbol.includes("KRW")) return price.toFixed(2);
  if (price >= 1000) return Math.round(price).toLocaleString();
  return price.toFixed(2);
}

export function MobileSimpleView() {
  const queryClient = useQueryClient();
  const [proxyUrl, setProxyUrl] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [editing, setEditing] = useState<Stock | null>(null);
  const [memoTicker, setMemoTicker] = useState<string | null>(null);
  const [valuationTicker, setValuationTicker] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState("");
  const [todayPnLOpen, setTodayPnLOpen] = useState(false);
  // 그룹 탭 길게 누르기 → 액션 시트 (이름 변경 / 삭제)
  const [tabMenu, setTabMenu] = useState<{ key: string; label: string } | null>(null);
  const longPressTimer = useRef<number | null>(null);

  // 첫 방문 자동 노출 (1.5초 지연)
  useEffect(() => {
    if (!shouldShowHelpFirstTime()) return;
    const t = setTimeout(() => setHelpOpen(true), 1500);
    return () => clearTimeout(t);
  }, []);

  // 구글 로그인/충돌 체크는 설정 다이얼로그 열 때만 수행 (아래 settings useEffect 내부).
  // 검색/편집/메모 등 일반 이동에선 Drive API 호출 안 함.
  const [activeTab, setActiveTab] = useState<string>(() => {
    if (typeof localStorage === "undefined") return KR_KEY;
    return localStorage.getItem(TAB_KEY) ?? KR_KEY;
  });
  const isSystemTab = activeTab === KR_KEY || activeTab === US_KEY || activeTab === SEMI_KEY;
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setProxyUrl(getPersonalProxyUrl() ?? "");
  }, []);

  // 활성 탭 변경 시 저장
  useEffect(() => {
    localStorage.setItem(TAB_KEY, activeTab);
  }, [activeTab]);

  // PC 동일 자동 갱신 — 전용 프록시 시 5/10/30/60초 / 공개 10초 + 다운 시 자동 증가
  const BASE_REFRESH_MS = useMemo(() => getEffectivePollMs(), []);
  const REFRESH_MS = useAdaptiveRefreshMs(BASE_REFRESH_MS);

  // 보유 종목 로드 (그룹 탭 라벨 + 그룹 종목 표시)
  const { data: holdings = [] } = useQuery({
    queryKey: ["m-holdings"],
    queryFn: loadHoldings,
    refetchOnWindowFocus: false,
  });
  const { data: peaks } = useQuery({
    queryKey: ["m-peaks"],
    queryFn: loadPeaks,
    refetchOnWindowFocus: false,
  });
  const { data: memos } = useQuery({
    queryKey: ["m-memos"],
    queryFn: loadMemos,
    refetchOnWindowFocus: false,
  });

  // 그룹 목록 (account 별 카운트) — 한국 + 미국 + 보유 + 사용자 그룹들
  const groupTabs = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of holdings) {
      const acc = normalizeAccount(s.account);
      counts.set(acc, (counts.get(acc) || 0) + 1);
    }
    const tabs: { key: string; label: string; count: number }[] = [
      { key: KR_KEY, label: "섹터", count: 0 },
      { key: US_KEY, label: "매크로", count: 0 },
      { key: SEMI_KEY, label: "🔧반도체", count: 0 },
    ];
    if (counts.has("")) {
      tabs.push({ key: "", label: "보유", count: counts.get("")! });
    }
    const userGroups = Array.from(counts.keys())
      .filter(k => !["", "관심ETF"].includes(k))
      .sort();
    for (const g of userGroups) {
      tabs.push({ key: g, label: g, count: counts.get(g)! });
    }
    return tabs;
  }, [holdings]);

  // 저장된 탭이 더이상 없으면 (그룹 삭제 등) 한국으로 fallback
  useEffect(() => {
    if (groupTabs.length === 0) return;
    if (!groupTabs.some(t => t.key === activeTab)) {
      setActiveTab(KR_KEY);
    }
  }, [groupTabs, activeTab]);

  // 선택된 그룹 종목들 (활성 탭이 그룹일 때만)
  const groupHoldingsUnsorted = useMemo(() => {
    if (isSystemTab) return [];
    return holdings.filter(s => normalizeAccount(s.account) === activeTab);
  }, [holdings, activeTab, isSystemTab]);

  // 그룹 종목들의 KR 가격 fetch (수동 갱신만)
  const groupTickers = groupHoldingsUnsorted
    .filter(s => /^[\dA-Za-z]{6}$/.test(s.ticker))
    .map(s => s.ticker);
  const { data: groupPrices, dataUpdatedAt: groupAt } = useQuery({
    queryKey: ["m-group-prices", activeTab, groupTickers.join(",")],
    queryFn: () => fetchTossPrices(groupTickers),
    enabled: !isSystemTab && groupTickers.length > 0,
    refetchInterval: REFRESH_MS,
  });
  const groupPriceMap = new Map((groupPrices ?? []).map(p => [p.ticker, p]));

  // 비거래일 감지 (PC 와 동일) — 첫 종목 high 없으면 비거래일
  // 비거래일에만 일봉 차트 fetch — 카드 가격 박스 sparkline (PC 와 캐시 키 공유)
  const groupChartQs = useQueries({
    queries: groupTickers.map(t => ({
      queryKey: ["kr-price-history", t, "3mo"],
      queryFn: () => fetchKrPriceHistory(t, "3mo"),
      staleTime: 60 * 60 * 1000,    // 1시간 캐시 (장중 fetch 부담 최소화)
      refetchOnWindowFocus: false,
      enabled: !isSystemTab,  // 장중에도 fetch — AuxIndicators 의 3개월/변동성 표시
    })),
  });
  const groupChartMap = new Map(
    groupChartQs.map((q, i) =>
      [groupTickers[i], (q.data ?? []).map(p => p.close)]
    )
  );

  // 정렬 옵션 — 7가지 + asc/desc 토글 (PC 와 동일 localStorage 공유)
  const [sortKey, setSortKey] = useState<SortKey>(loadSortKey);
  const [sortDir, setSortDir] = useState<SortDirection>(loadSortDir);
  const sortHandlers = makeSortHandlers(
    setSortKey, setSortDir, saveSortKey, saveSortDir, sortDir,
  );

  // 종목별 위험 뱃지 (위험/관리/정지/경고/과열/환기/주의)
  const warningQs = useQueries({
    queries: groupTickers.map(t => ({
      queryKey: ["m-warning", t],
      queryFn: () => fetchWarning(t),
      enabled: !isSystemTab,
      refetchInterval: REFRESH_MS,
    })),
  });
  const warningMap = new Map(
    groupTickers.map((t, i) => [t, warningQs[i]?.data ?? ""])
  );

  // 종목별 60일 수급 — AuxIndicators (외국인/기관/연기금 60일 누적) 용
  const investorHistoryQs = useQueries({
    queries: groupTickers.map(t => ({
      queryKey: ["m-investor-history", t],
      queryFn: () => fetchInvestorHistory(t, 60),
      enabled: !isSystemTab,
      refetchInterval: REFRESH_MS,
    })),
  });
  const investorHistoryMap = new Map(
    groupTickers.map((t, i) => [t, investorHistoryQs[i]?.data ?? null])
  );

  // 종목별 sector + consensus (Naver) — 그룹 탭에서만 fetch (캐시)
  type NaverInfo = Awaited<ReturnType<typeof fetchNaverInfo>>;
  const naverInfos = useQuery({
    queryKey: ["m-naver-info", groupTickers.join(",")],
    queryFn: async () => {
      const map = new Map<string, NonNullable<NaverInfo>>();
      await Promise.all(groupTickers.map(async t => {
        try {
          const info = await fetchNaverInfo(t);
          if (info) map.set(t, info);
        } catch { /* ignore */ }
      }));
      return map;
    },
    enabled: !isSystemTab && groupTickers.length > 0,
    refetchOnWindowFocus: false,
  });

  // 정렬 적용 — sleeping 항상 맨 아래, 그 외엔 sortKey + sortDir 따라
  const groupHoldings = useMemo(() => {
    const sectorMap = new Map<string, string>();
    if (naverInfos.data) {
      for (const [t, info] of naverInfos.data.entries()) {
        if (info?.sector) sectorMap.set(t, info.sector);
      }
    }
    return sortHoldings(groupHoldingsUnsorted, groupPriceMap, sectorMap, sortKey, sortDir);
  }, [groupHoldingsUnsorted, groupPriceMap, naverInfos.data, sortKey, sortDir]);

  // 같은 ticker 가 속한 그룹들 — 카드 상단 알약 표시용 (전체 holdings 기준)
  const tickerGroupsMap = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const h of holdings) {
      const acc = h.account || "";
      if (!acc) continue;
      const arr = m.get(h.ticker) ?? [];
      if (!arr.includes(acc)) arr.push(acc);
      m.set(h.ticker, arr);
    }
    return m;
  }, [holdings]);

  // Yahoo: 본물 + 선물 평탄화 (선행지수만 — ETF 제외)
  const yahooSymbols = US_PAIRS.flatMap(p =>
    p.future
      ? [{ symbol: p.symbol, name: p.name }, { symbol: p.future, name: `${p.name} 선물` }]
      : [{ symbol: p.symbol, name: p.name }]
  );

  const { data: usMap, isFetching, dataUpdatedAt: usAt } = useQuery({
    queryKey: ["m-yahoo"],
    queryFn: () => fetchYahooBatch(yahooSymbols),
    refetchInterval: REFRESH_MS,
  });

  // 활성 탭에 맞는 마지막 갱신 시각 (RefreshIndicator 사용)
  const lastAt = isSystemTab ? usAt : (groupAt ?? 0);

  // 캐시 + Service Worker 초기화 + 강제 새로고침 (확인 다이얼로그)
  const handleRefresh = () => void forceUpdate();

  // 좌우 스와이프로 그룹 탭 이동 (가로 dx > 세로 dy 일 때만 인정)
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStart.current) return;
    const dx = e.changedTouches[0].clientX - touchStart.current.x;
    const dy = e.changedTouches[0].clientY - touchStart.current.y;
    touchStart.current = null;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy)) return;
    const idx = groupTabs.findIndex(t => t.key === activeTab);
    if (idx === -1) return;
    if (dx < 0 && idx < groupTabs.length - 1) setActiveTab(groupTabs[idx + 1].key);
    if (dx > 0 && idx > 0) setActiveTab(groupTabs[idx - 1].key);
  };

  // ─── Tier 0 (대시보드 4개) ───
  const tier0 = US_PAIRS.filter(p => p.tier === "T0");

  // T0 60일 추이 — 일봉, 1시간 캐시 (PC 와 동일 쿼리키 — 캐시 공유)
  const t0ChartQs = useQueries({
    queries: tier0.map(p => ({
      queryKey: ["yahoo-chart", p.symbol, "3mo"],
      queryFn: () => fetchYahooChart(p.symbol, "3mo"),
      staleTime: 60 * 60 * 1000,
      refetchOnWindowFocus: false,
    })),
  });
  // 일부 심볼 sparkline 은 Yahoo 가 historical 안 줌 → 가까운 현물 차트로 폴백
  const SPARKLINE_FALLBACK: Record<string, string> = {
    "SOX=F": "^SOX",
    "^KQ100": "^KQ11",
  };
  const t0ChartByIndex = new Map(tier0.map((p, i) => [p.symbol, t0ChartQs[i]?.data ?? []]));
  const t0ChartMap = new Map(
    tier0.map(p => {
      const own = t0ChartByIndex.get(p.symbol) ?? [];
      if (own.length > 1) return [p.symbol, own];
      const fb = SPARKLINE_FALLBACK[p.symbol];
      if (fb) return [p.symbol, t0ChartByIndex.get(fb) ?? own];
      return [p.symbol, own];
    })
  );

  // 장 마감 시 흐리게 표시 여부 (설정값)
  const dimEnabled = getDimSleepingEnabled();

  // 시장 매매동향 모달
  const [marketFlowFor, setMarketFlowFor] = useState<MarketIndexKey | null>(null);

  return (
    <div className="min-h-screen bg-gray-50"
         onTouchStart={handleTouchStart}
         onTouchEnd={handleTouchEnd}>
      <NewVersionToast />
      <header className="sticky top-0 z-40 bg-white border-b border-gray-200
                          px-3 py-2 flex items-center gap-1">
        <h1 className="text-sm font-bold text-gray-800 shrink-0">📈</h1>
        <RefreshIndicator dataUpdatedAt={lastAt}
                          refetchIntervalMs={REFRESH_MS} />
        <button onClick={handleRefresh}
                disabled={isFetching}
                title="최신 버전 적용 (캐시 초기화 + 새로고침)"
                className="ml-auto p-1.5 rounded hover:bg-gray-100
                            disabled:opacity-50 transition">
          <span className={`inline-block ${isFetching ? "animate-spin" : ""}`}>🔄</span>
        </button>
        <button onClick={() => setSearchOpen(true)}
                title="종목 검색 / 추가"
                className="p-1.5 rounded hover:bg-gray-100 transition">
          🔍
        </button>
        <button onClick={() => setHelpOpen(true)}
                title="사용법 빠른 시작"
                className="p-1.5 rounded hover:bg-gray-100 transition">
          ❓
        </button>
        <a href="https://github.com/hanjungwoo3/portfolio-web/discussions"
           target="_blank" rel="noopener noreferrer"
           title="기능 요청 / 의견 (GitHub Discussions)"
           className="p-1.5 rounded hover:bg-gray-100 transition shrink-0">
          💡
        </a>
        <a href={KAKAOPAY_URL} target="_blank" rel="noopener noreferrer"
           title="개발자 후원하기 (카카오페이)"
           className="p-1.5 rounded hover:bg-gray-100 transition shrink-0">
          🍵
        </a>
        <button onClick={() => setSettingsOpen(true)}
                title="설정"
                className="p-1.5 rounded hover:bg-gray-100 transition">
          ⚙️
        </button>
      </header>

      {/* ─── 그룹 탭 (가로 스크롤, 작은 폰트) — 길게 누르기 = 액션 시트 ─── */}
      <nav className="sticky top-[44px] z-40 bg-white border-b border-gray-200
                       px-2 py-1 flex gap-1 overflow-x-auto whitespace-nowrap">
        {groupTabs.map(t => {
          const active = t.key === activeTab;
          // 시스템 탭(한국/미국)은 길게 누르기 무시
          const editable = t.key !== US_KEY && t.key !== KR_KEY;
          const startLongPress = () => {
            if (!editable) return;
            longPressTimer.current = window.setTimeout(() => {
              setTabMenu({ key: t.key, label: t.label });
              longPressTimer.current = null;
            }, 500);
          };
          const cancelLongPress = () => {
            if (longPressTimer.current) {
              window.clearTimeout(longPressTimer.current);
              longPressTimer.current = null;
            }
          };
          return (
            <button key={t.key}
                    onClick={() => setActiveTab(t.key)}
                    onTouchStart={e => { e.stopPropagation(); startLongPress(); }}
                    onTouchMove={cancelLongPress}
                    onTouchEnd={cancelLongPress}
                    onTouchCancel={cancelLongPress}
                    onContextMenu={e => {
                      // 데스크톱 우클릭 / 일부 안드로이드 long-press 보조
                      if (editable) { e.preventDefault(); setTabMenu({ key: t.key, label: t.label }); }
                    }}
                    className={`px-2 py-1 text-[11px] rounded-md shrink-0 transition
                                ${active
                                  ? "bg-blue-600 text-white font-bold"
                                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
              {t.label}
              {t.count > 0 && (
                <span className={`ml-1 ${active ? "text-blue-100" : "text-gray-400"}`}>
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* ─── 그룹 컨텐츠 (시스템 탭 외) ─── */}
      {!isSystemTab && (
        <>
          {/* 정렬 옵션 + 추가지표 일괄 토글 */}
          {groupHoldings.length > 0 && (
            <div className="flex items-center justify-end gap-2 px-2 pt-2">
              <AuxBatchToggle short />
              <SortSelector sortKey={sortKey} sortDir={sortDir}
                            onChangeKey={sortHandlers.onChangeKey}
                            onToggleDir={sortHandlers.onToggleDir} />
            </div>
          )}
          <div className="px-2 py-2 space-y-1.5 pb-32">
            {groupHoldings.length === 0 && (
              <div className="text-center text-[11px] text-gray-400 py-8">
                이 그룹에는 종목이 없습니다
              </div>
            )}
            {groupHoldings.map(s => (
              <MobileStockCard key={s.ticker + (s.account ?? "")}
                               stock={s}
                               price={groupPriceMap.get(s.ticker)}
                               peak={peaks?.get(s.ticker)}
                               sector={naverInfos.data?.get(s.ticker)?.sector}
                               warning={warningMap.get(s.ticker) || undefined}
                               chart={groupChartMap.get(s.ticker)}
                               investorHistory={investorHistoryMap.get(s.ticker)}
                               consensus={naverInfos.data?.get(s.ticker)?.consensus}
                               memo={memos?.get(s.ticker)}
                               otherGroups={(tickerGroupsMap.get(s.ticker) ?? [])
                                 .filter(g => g !== (s.account || ""))}
                               onOpenValuation={setValuationTicker}
                               onOpenMemo={t => setMemoTicker(t)}
                               onEdit={st => setEditing(st)}
                               onDelete={async st => {
                                 const indep = getIndependentGroupsMode();
                                 const msg = indep
                                   ? `"${st.name}" 을(를) "${st.account || "보유"}" 그룹에서 삭제할까요?`
                                   : `"${st.name}" 을(를) 삭제할까요?\n(모든 그룹에서 제거됩니다)`;
                                 if (!confirm(msg)) return;
                                 if (indep) {
                                   await removeHolding(st.ticker, st.account || "");
                                 } else {
                                   await deleteAllRowsForTicker(st.ticker);
                                 }
                                 void queryClient.invalidateQueries({ queryKey: ["m-holdings"] });
                                 void queryClient.invalidateQueries({ queryKey: ["m-peaks"] });
                                 void queryClient.invalidateQueries({ queryKey: ["m-group-prices"] });
          scheduleAutoSync();
                               }} />
            ))}
          </div>
          {/* 합계 — 화면 하단 fixed.
              합계 클릭 시 위로 오늘 수익/손해 레이어가 펼쳐짐, 다시 클릭 또는 바깥 탭 시 닫힘.
              관심종목만 있어 보유 0개면 TotalRow 가 null → 토글 불가하므로 WhatIfRow 단독 노출. */}
          {groupHoldings.length > 0 && (() => {
            const hasHoldings = groupHoldings.some(s => s.shares > 0);
            if (!hasHoldings) {
              // 관심종목만 — WhatIfRow 만 단독 노출
              return (
                <div className="fixed bottom-0 left-0 right-0 z-40
                                 pb-2 px-3 flex flex-col items-center gap-2
                                 pointer-events-none">
                  <div className="pointer-events-auto">
                    <WhatIfRow holdings={groupHoldings} prices={groupPriceMap} />
                  </div>
                </div>
              );
            }
            return (
              <>
                {/* 바깥 클릭 닫힘용 backdrop (열렸을 때만) */}
                {todayPnLOpen && (
                  <div className="fixed inset-0 z-30"
                       onClick={() => setTodayPnLOpen(false)} />
                )}
                <div className="fixed bottom-0 left-0 right-0 z-40
                                 pb-2 px-3 flex flex-col items-center gap-2
                                 pointer-events-none">
                  {todayPnLOpen && (
                    <div className="pointer-events-auto cursor-pointer flex flex-col items-center gap-2"
                         onClick={() => setTodayPnLOpen(false)}>
                      <WhatIfRow holdings={groupHoldings} prices={groupPriceMap} />
                      <MobileTodayPnLLayer holdings={groupHoldings} prices={groupPriceMap} />
                    </div>
                  )}
                  <div className="pointer-events-auto cursor-pointer"
                       onClick={() => setTodayPnLOpen(o => !o)}
                       title={todayPnLOpen ? "닫기" : "오늘 수익/손해 보기"}>
                    <TotalRow holdings={groupHoldings} prices={groupPriceMap} />
                  </div>
                </div>
              </>
            );
          })()}
        </>
      )}

      {/* ─── 한국 / 미국 / 반도체 점검 시스템 탭 ─── */}
      {isSystemTab && (() => {
        if (activeTab === SEMI_KEY) {
          return <div className="px-2 py-2"><SemiCheckTab /></div>;
        }
        const order = activeTab === KR_KEY ? KR_ORDER : US_ORDER;
        // 한국 탭은 KOSPI/KOSDAQ 카드와 짝(미국 ETF/한국 ETF 페어)
        // — Yahoo 티커 또는 KR ETF .KS 지원
        return (
          <div className="px-3 py-2 grid grid-cols-2 gap-2">
            {order.map(symbol => {
              const p = tier0.find(x => x.symbol === symbol);
              if (!p) return null;
              const q = usMap?.get(p.symbol);
              const sleeping = isSymbolSleeping(p.symbol);
              const cdiff = q ? q.price - (q.prevClose || q.price) : 0;
              const isFuture = p.symbol.endsWith("=F");
              const bg = sleeping && dimEnabled
                ? "bg-gray-100 border-gray-300"
                : cdiff > 0 ? "bg-rose-50 border-rose-200"
                : cdiff < 0 ? "bg-blue-50/70 border-blue-200"
                : "bg-white border-gray-200";
              const sign =
                cdiff > 0 ? "text-rose-600"
                : cdiff < 0 ? "text-blue-600"
                : "text-gray-900";
              const nameColor = isFuture ? "text-amber-700" : "text-gray-900";
              return (
                <div key={p.symbol}
                     className={`relative overflow-hidden flex flex-col gap-0.5
                                  rounded-lg border px-3 py-1.5
                                  ${bg} ${sleeping && dimEnabled ? "opacity-60" : ""}`}>
                  <Sparkline data={t0ChartMap.get(p.symbol) ?? []}
                             width={300} height={70}
                             color={sleeping && dimEnabled ? "#94a3b8" : undefined}
                             className="absolute inset-0 w-full h-full opacity-50
                                        pointer-events-none" />
                  <div className="relative flex items-baseline gap-1.5">
                    {sleeping && (
                      <span className="text-[11px] text-gray-400">zZ</span>
                    )}
                    <a href={quoteUrl(p.symbol)}
                       target="_blank" rel="noopener noreferrer"
                       title={`${p.name} 자세히 보기`}
                       className={`text-base font-bold ${nameColor} active:underline`}>
                      {p.name}
                    </a>
                    {(p.symbol === "^KS11" || p.symbol === "^KQ11") && (
                      <button onClick={() =>
                                setMarketFlowFor(p.symbol === "^KS11" ? "KOSPI" : "KOSDAQ")}
                              title={`${p.name} 매매동향`}
                              className="ml-1 px-1 py-0.5 rounded text-[10px] text-gray-500
                                         bg-white/60 active:bg-white border border-gray-200">
                        📊
                      </button>
                    )}
                  </div>
                  <div className="relative text-[11px] text-gray-500 truncate">
                    {p.desc}
                  </div>
                  <div className="relative flex items-baseline mt-1">
                    <span className={`flex-1 text-left text-sm tabular-nums ${sign}`}>
                      {q ? fmtPrice(p.symbol, q.price) : "—"}
                    </span>
                    <span className={`flex-1 text-right text-base font-bold tabular-nums ${sign}`}>
                      {q && Math.abs(q.pct) >= 0.005
                        ? `${q.pct >= 0 ? "+" : ""}${q.pct.toFixed(2)}%`
                        : ""}
                    </span>
                  </div>
                </div>
              );
            })}
            <div className="col-span-2 text-[10px] text-gray-400 text-center mt-1 mb-2">
              {Math.round(REFRESH_MS / 1000)}초마다 자동 갱신
            </div>
          </div>
        );
      })()}

      {settingsOpen && (
        <SettingsModal proxyUrl={proxyUrl} setProxyUrl={setProxyUrl}
                       savedMsg={savedMsg} setSavedMsg={setSavedMsg}
                       onClose={() => setSettingsOpen(false)} />
      )}

      {/* 종목 검색 / 추가 */}
      <SearchDialog
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        onAdded={() => {
          void queryClient.invalidateQueries({ queryKey: ["m-holdings"] });
          void queryClient.invalidateQueries({ queryKey: ["m-peaks"] });
          void queryClient.invalidateQueries({ queryKey: ["m-group-prices"] });
          scheduleAutoSync();
        }} />

      {/* 보유 편집 (매수 / 매도 / 직접수정 / 삭제) */}
      <EditHoldingDialog
        isOpen={!!editing}
        onClose={() => setEditing(null)}
        stock={editing}
        curPrice={editing ? groupPriceMap.get(editing.ticker)?.price : undefined}
        onChanged={() => {
          void queryClient.invalidateQueries({ queryKey: ["m-holdings"] });
          void queryClient.invalidateQueries({ queryKey: ["m-peaks"] });
          void queryClient.invalidateQueries({ queryKey: ["m-group-prices"] });
          scheduleAutoSync();
        }} />

      {/* 메모 편집 */}
      <MemoDialog
        isOpen={!!memoTicker}
        onClose={() => setMemoTicker(null)}
        ticker={memoTicker}
        stockName={memoTicker
          ? holdings.find(h => h.ticker === memoTicker)?.name
          : undefined}
        curPrice={memoTicker ? groupPriceMap.get(memoTicker)?.price : undefined}
        avgPrice={memoTicker
          ? (() => {
              const h = holdings.find(s => s.ticker === memoTicker && s.shares > 0);
              return h?.avg_price;
            })()
          : undefined}
        onChanged={() => {
          void queryClient.invalidateQueries({ queryKey: ["m-memos"] });
        }} />

      {/* 첫 접속 안내 팝업 — 전용 프록시 미설정 시 자동 표시 */}
      <OnboardingDialog onOpenSettings={() => setSettingsOpen(true)} />

      {/* 시장 매매동향 모달 — KOSPI/KOSDAQ 카드 📊 클릭 시 */}
      {marketFlowFor && (
        <MarketFlowModal
          isOpen={true}
          indexKey={marketFlowFor}
          onClose={() => setMarketFlowFor(null)}
        />
      )}

      <HelpDialog
        isOpen={helpOpen}
        onClose={() => { markHelpSeen(); setHelpOpen(false); }}
        variant="mobile"
      />

      {/* 기업가치 모달 — 📊 버튼으로 호출 */}
      {valuationTicker && (() => {
        const s = groupHoldingsUnsorted.find(h => h.ticker === valuationTicker);
        if (!s) return null;
        return (
          <ValuationModal
            isOpen={true}
            onClose={() => setValuationTicker(null)}
            ticker={valuationTicker}
            name={s.name}
            curPrice={groupPriceMap.get(valuationTicker)?.price}
            myAvgPrice={s.shares > 0 ? s.avg_price : undefined}
            entryPrice={memos?.get(valuationTicker)?.entryPrice}
          />
        );
      })()}

      {/* 그룹 탭 길게 누르기 — 액션 시트 */}
      {tabMenu && (
        <div className="fixed inset-0 z-40 flex items-end justify-center
                         bg-black/40 animate-fade-in"
             onClick={() => setTabMenu(null)}>
          <div className="bg-white rounded-t-xl w-full max-w-md
                           shadow-xl pb-safe"
               onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b">
              <div className="text-xs text-gray-500">그룹</div>
              <div className="text-base font-bold text-gray-800 truncate">
                🏷 {tabMenu.label}
              </div>
            </div>
            <button
              type="button"
              onClick={async () => {
                const oldKey = tabMenu.key;
                const oldLabel = tabMenu.label;
                setTabMenu(null);
                const next = window.prompt(`"${oldLabel}" → 새 이름:`, oldLabel);
                if (next == null) return;
                const trimmed = next.trim();
                if (!trimmed || trimmed === oldKey) return;
                await renameGroup(oldKey, trimmed);
                if (activeTab === oldKey) setActiveTab(trimmed);
                void queryClient.invalidateQueries({ queryKey: ["m-holdings"] });
                scheduleAutoSync();
              }}
              className="w-full px-4 py-3.5 text-left text-sm
                         hover:bg-gray-50 border-b flex items-center gap-3">
              <span className="text-lg">✏️</span>
              <span>이름 변경</span>
            </button>
            <button
              type="button"
              onClick={async () => {
                const k = tabMenu.key;
                const l = tabMenu.label;
                setTabMenu(null);
                if (!confirm(
                  `"${l}" 그룹의 모든 항목을 삭제할까요?\n(되돌릴 수 없음)`
                )) return;
                await deleteGroup(k);
                if (activeTab === k) setActiveTab(US_KEY);
                void queryClient.invalidateQueries({ queryKey: ["m-holdings"] });
                scheduleAutoSync();
              }}
              className="w-full px-4 py-3.5 text-left text-sm
                         hover:bg-rose-50 text-rose-600 font-medium
                         border-b flex items-center gap-3">
              <span className="text-lg">🗑</span>
              <span>그룹 삭제</span>
            </button>
            <button
              type="button"
              onClick={() => setTabMenu(null)}
              className="w-full px-4 py-3.5 text-center text-sm text-gray-500">
              취소
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface SettingsModalProps {
  proxyUrl: string;
  setProxyUrl: (v: string) => void;
  savedMsg: string;
  setSavedMsg: (v: string) => void;
  onClose: () => void;
}

function SettingsModal({
  proxyUrl, setProxyUrl, savedMsg, setSavedMsg, onClose,
}: SettingsModalProps) {
  const downOnBackdropRef = useRef(false);
  const queryClient = useQueryClient();
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [dataMsg, setDataMsg] = useState("");
  const [pollMs, setPollMs] = useState(getPersonalPollMs());
  const [syncStateLocal, setSyncStateLocal] = useState(getSyncState());
  const [syncBusyLocal, setSyncBusyLocal] = useState(false);
  const [syncBusyMsgLocal, setSyncBusyMsgLocal] = useState("");
  const [lastSyncedAtLocal, setLastSyncedAtLocal] = useState<string | null>(getLastSyncedAt());

  // 모달 열릴 때 현재 데이터 export 해서 textarea 채움
  // + 토큰 만료 감지 시 자동 logout
  useEffect(() => {
    void (async () => {
      const data = await exportAll();
      setRaw(JSON.stringify(data, null, 2));
      setDataMsg(`현재: 종목 ${data.holdings.length}건 / 피크 ${Object.keys(data.peaks).length}건`);

      // 로그인 상태 검증 → 진짜 만료 시 자동 logout (설정 안에서만 표시)
      const initial = getSyncState();
      if (initial === "unconfigured") return;
      if (isSignedIn()) {
        void tryRestoreSession();   // 백그라운드 silent refresh
        return;
      }
      if (!wasSignedIn()) return;
      const token = await getAccessToken();
      if (!token) {
        await disableSync();
        setSyncStateLocal("unconfigured");
        setLastSyncedAtLocal(null);
        setDataMsg("ℹ️ 로그인이 만료되어 자동 로그아웃 — 다시 로그인해 주세요");
      }
    })();
  }, []);

  const handlePollChange = (ms: number) => {
    setPollMs(ms);
    setPersonalPollMs(ms);
    setSavedMsg(`✅ 폴링 주기 ${ms / 1000}초 적용 — 새로고침 후 적용`);
    setTimeout(() => setSavedMsg(""), 2500);
  };

  const saveProxy = () => {
    const v = proxyUrl.trim().replace(/\/+$/, "");
    setPersonalProxyUrl(v || null);
    setProxyUrl(v);
    setSavedMsg(v ? "✅ 전용 프록시 적용" : "✅ 공개 4-way 사용");
    onClose();
    location.reload();
  };

  const result = detectPortfolioJson(raw);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(raw);
      setDataMsg("✅ 클립보드 복사됨");
    } catch {
      setDataMsg("❌ 복사 실패 — textarea 직접 선택해서 복사");
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setRaw(text);
      setDataMsg("📥 클립보드에서 가져옴 — [적용] 누르면 덮어쓰기");
    } catch {
      setDataMsg("❌ 클립보드 읽기 실패 — textarea 에 직접 붙여넣어 주세요");
    }
  };

  const handleApply = async () => {
    if (!result || result.kind === "error") return;
    setBusy(true);
    try {
      if (result.kind === "holdings" || result.kind === "combined") {
        await replaceAllHoldings(result.stocks);
      }
      if (result.kind === "peaks" || result.kind === "combined") {
        await replaceAllPeaks(result.peaks);
      }
      setDataMsg("💾 적용 완료");
      onClose();
      location.reload();
    } catch (e) {
      setDataMsg(`❌ 저장 실패: ${e instanceof Error ? e.message : ""}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center
                     justify-center bg-black/40 p-3"
         onMouseDown={e => { downOnBackdropRef.current = e.target === e.currentTarget; }}
         onClick={e => {
           if (e.target === e.currentTarget && downOnBackdropRef.current) onClose();
         }}>
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-sm
                       max-h-[90vh] flex flex-col">
        {/* 진행 중 오버레이 — 업로드/다운로드/로그인 */}
        {syncBusyLocal && syncBusyMsgLocal && (
          <div className="absolute inset-0 z-10 bg-white/80 backdrop-blur-sm
                          rounded-lg flex items-center justify-center">
            <div className="bg-white border border-gray-200 rounded-lg shadow-lg
                            px-5 py-3 flex items-center gap-3">
              <span className="inline-block w-5 h-5 border-2 border-blue-500
                               border-t-transparent rounded-full animate-spin" />
              <span className="text-sm font-medium text-gray-800">
                {syncBusyMsgLocal}
              </span>
            </div>
          </div>
        )}
        <header className="px-4 py-3 border-b bg-gray-50 flex items-center">
          <h2 className="text-base font-bold">⚙️ 설정</h2>
          <button onClick={onClose}
                  className="ml-auto text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </header>
        <div className="px-4 py-3 space-y-4 overflow-y-auto flex-1">

          {/* 0) Google Drive 동기화 */}
          <div className="border border-gray-200 rounded p-3 bg-emerald-50/40 space-y-1.5">
            <div className="text-xs font-bold text-gray-700">
              💾 Google Drive 동기화 (선택)
            </div>
            <div className="text-[11px] text-gray-500 leading-relaxed">
              내 Google Drive 의 숨김 폴더에 자동 백업하는 기능입니다.<br />
              (여러 기기에서 같은 종목(그룹) 데이터를 사용할 수 있습니다.)<br />
              별도로 사용자의 정보를 서버에 저장하지는 않습니다.
            </div>
            {syncStateLocal === "unconfigured" && (
              <button disabled={syncBusyLocal}
                onClick={async () => {
                  setSyncBusyLocal(true);
                  setSyncBusyMsgLocal("Google 로그인 중...");
                  setDataMsg("Google 로그인 중...");
                  try {
                    await enableSync();
                    setSyncStateLocal("off");
                    setSyncBusyMsgLocal("Drive 데이터 확인 중...");
                    const downloaded = await downloadFromDrive();
                    if (downloaded) {
                      void queryClient.invalidateQueries({ queryKey: ["m-holdings"] });
                      void queryClient.invalidateQueries({ queryKey: ["m-peaks"] });
                      setDataMsg("✅ Drive 가져옴 (자동 sync OFF)");
                    } else {
                      setSyncBusyMsgLocal("첫 업로드 중...");
                      await uploadToDrive();
                      setDataMsg("✅ 첫 업로드 (자동 sync OFF)");
                    }
                    setLastSyncedAtLocal(getLastSyncedAt());
                  } catch (e) {
                    setDataMsg(`⚠️ ${(e as Error).message}`);
                  } finally { setSyncBusyLocal(false); setSyncBusyMsgLocal(""); }
                }}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700
                           disabled:opacity-50 text-white text-xs rounded">
                🔐 Google 로그인 + sync
              </button>
            )}
            {(syncStateLocal === "on" || syncStateLocal === "off") && (
              <div className="space-y-1.5">
                {/* 상태: 자동 동기화 [ON|OFF] 토글 */}
                <div className="text-[11px] text-gray-700 flex items-center gap-2 flex-wrap">
                  <span>상태: 자동 동기화</span>
                  <button onClick={() => {
                    if (syncStateLocal === "on") { pauseSync(); setSyncStateLocal("off"); setDataMsg("자동 OFF"); }
                    else { resumeSync(); setSyncStateLocal("on"); setDataMsg("자동 ON"); }
                  }}
                    className={`px-2 py-0.5 rounded font-bold transition ${
                      syncStateLocal === "on"
                        ? "bg-emerald-600 text-white"
                        : "bg-gray-200 text-gray-600"
                    }`}>
                    {syncStateLocal === "on" ? "ON" : "OFF"}
                  </button>
                  {lastSyncedAtLocal && (
                    <span className="text-gray-500 ml-auto">
                      {new Date(lastSyncedAtLocal).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  )}
                </div>
                <div className="flex gap-1 flex-wrap">
                  <button disabled={syncBusyLocal}
                    onClick={async () => {
                      setSyncBusyLocal(true);
                      setSyncBusyMsgLocal("Drive 에 업로드 중...");
                      try { await uploadToDrive(); setLastSyncedAtLocal(getLastSyncedAt()); setDataMsg("✅ 업로드"); }
                      catch (e) {
                        const msg = (e as Error).message;
                        // 토큰 만료 / 미로그인 — 자동 redirect 없이 로그아웃 상태로
                        if (/Not signed in|401|invalid.?token/i.test(msg)) {
                          await disableSync();
                          setSyncStateLocal("unconfigured");
                          setLastSyncedAtLocal(null);
                          setDataMsg("ℹ️ 로그인이 만료되어 자동 로그아웃 — 다시 로그인해 주세요");
                          return;
                        }
                        setDataMsg(`⚠️ ${msg}`);
                      }
                      finally { setSyncBusyLocal(false); setSyncBusyMsgLocal(""); }
                    }}
                    className="px-2 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs rounded">
                    ↑ 업로드
                  </button>
                  <button disabled={syncBusyLocal}
                    onClick={async () => {
                      if (!confirm("Drive 의 데이터로 덮어쓸까요?")) return;
                      setSyncBusyLocal(true);
                      setSyncBusyMsgLocal("Drive 에서 다운로드 중...");
                      try {
                        const ok = await downloadFromDrive();
                        if (ok) {
                          void queryClient.invalidateQueries({ queryKey: ["m-holdings"] });
                          void queryClient.invalidateQueries({ queryKey: ["m-peaks"] });
                          setLastSyncedAtLocal(getLastSyncedAt());
                          setDataMsg("✅ 다운로드");
                        } else { setDataMsg("⚠️ Drive 데이터 없음"); }
                      } catch (e) {
                        const msg = (e as Error).message;
                        if (/Not signed in|401|invalid.?token/i.test(msg)) {
                          await disableSync();
                          setSyncStateLocal("unconfigured");
                          setLastSyncedAtLocal(null);
                          setDataMsg("ℹ️ 로그인이 만료되어 자동 로그아웃 — 다시 로그인해 주세요");
                          return;
                        }
                        setDataMsg(`⚠️ ${msg}`);
                      }
                      finally { setSyncBusyLocal(false); setSyncBusyMsgLocal(""); }
                    }}
                    className="px-2 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs rounded">
                    ↓ 다운로드
                  </button>
                  <button disabled={syncBusyLocal}
                    onClick={async () => {
                      if (!confirm("로그아웃?")) return;
                      setSyncBusyLocal(true);
                      try { await disableSync(); setSyncStateLocal("unconfigured"); setLastSyncedAtLocal(null); }
                      finally { setSyncBusyLocal(false); }
                    }}
                    className="px-2 py-1 bg-rose-100 text-rose-700 text-xs rounded ml-auto">🚪 로그아웃</button>
                </div>
              </div>
            )}
          </div>

          {/* 1) 전용 프록시 URL */}
          <div className="border border-gray-200 rounded p-3 bg-blue-50/30 space-y-1">
            <label className="text-xs font-bold text-gray-700 block">
              🔧 내 전용 프록시 URL (선택)
            </label>
            <p className="text-[11px] text-gray-500">
              비워두면 공개 4-way 사용. 본인 worker URL 입력 시 본인만 사용.
            </p>
            <a href="https://github.com/hanjungwoo3/portfolio-web/blob/main/workers/proxy/DEPLOY-USER.md"
               target="_blank" rel="noopener noreferrer"
               className="text-[11px] text-blue-600 underline block">
              📖 배포 가이드 보기
            </a>
            <input type="text" value={proxyUrl}
                   onChange={e => setProxyUrl(e.target.value)}
                   placeholder="https://your-proxy.workers.dev"
                   className="w-full border rounded px-2 py-1.5 text-xs font-mono
                              focus:outline-none focus:border-blue-500" />
            <button onClick={saveProxy}
                    className="w-full px-3 py-1.5 bg-blue-600 hover:bg-blue-700
                               text-white text-sm rounded font-medium">
              저장
            </button>
            {savedMsg && (
              <p className="text-[11px] text-emerald-700">{savedMsg}</p>
            )}

            {/* 폴링 주기 — 전용 프록시 활성화 시만 enabled */}
            <div className="flex items-center gap-1 mt-2 flex-wrap">
              <span className={`text-[11px] ${proxyUrl ? "text-gray-700" : "text-gray-400"}`}>
                폴링 주기:
              </span>
              {POLL_OPTIONS.map(ms => {
                const sec = ms / 1000;
                const active = pollMs === ms;
                const enabled = !!proxyUrl;
                return (
                  <button key={ms}
                          onClick={() => handlePollChange(ms)}
                          disabled={!enabled}
                          className={`px-2 py-0.5 text-[11px] rounded border transition
                                      ${active
                                        ? "bg-blue-600 text-white border-blue-700 font-bold"
                                        : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}
                                      ${!enabled ? "opacity-40 cursor-not-allowed" : ""}`}>
                    {sec}초
                  </button>
                );
              })}
              {!proxyUrl && (
                <span className="text-[10px] text-gray-400 w-full mt-0.5">
                  (공개 프록시는 10초 고정)
                </span>
              )}
            </div>

            {/* 장 마감 종목 흐리게 표시 */}
            <label className="flex items-start gap-2 mt-2 cursor-pointer select-none">
              <input type="checkbox" defaultChecked={getDimSleepingEnabled()}
                     onChange={e => {
                       setDimSleepingEnabled(e.target.checked);
                       setSavedMsg(`✅ 장 마감 흐리게: ${e.target.checked ? "ON" : "OFF"}`);
                       setTimeout(() => setSavedMsg(""), 2000);
                     }}
                     className="mt-0.5 w-4 h-4 accent-blue-600 shrink-0" />
              <span className="flex-1">
                <span className="text-[11px] text-gray-700 font-medium block">
                  장 마감 시 종목 흐리게 표시
                </span>
                <span className="text-[10px] text-gray-500">
                  마지막 체결로부터 시간이 지난 종목이나 정규장 외 시간에
                  카드를 60% 투명도로 표시합니다. 끄면 항상 또렷하게 보입니다.
                </span>
              </span>
            </label>
          </div>

          {/* 2) 포트폴리오 데이터 import/export */}
          <div className="border border-gray-200 rounded p-3 space-y-2">
            <label className="text-xs font-bold text-gray-700 block">
              💼 포트폴리오 데이터 (JSON)
            </label>
            <p className="text-[11px] text-gray-500">{dataMsg || "holdings + peaks 통합 JSON"}</p>
            <textarea
              value={raw}
              onChange={e => setRaw(e.target.value)}
              placeholder='{"holdings": [...], "peaks": {...}}'
              spellCheck={false}
              className="w-full h-40 p-2 border border-gray-300 rounded
                         font-mono text-[11px] resize-none
                         focus:outline-none focus:border-blue-400" />

            {/* 미리보기 */}
            {result && result.kind === "error" && (
              <div className="p-2 bg-red-50 border border-red-200 rounded
                              text-[11px] text-red-700">
                ✗ {result.error}
              </div>
            )}
            {result && result.kind === "holdings" && (
              <div className="p-2 bg-blue-50 border border-blue-200 rounded
                              text-[11px] text-blue-800">
                ✓ 종목 {result.stocks.length}건
              </div>
            )}
            {result && result.kind === "peaks" && (
              <div className="p-2 bg-blue-50 border border-blue-200 rounded
                              text-[11px] text-blue-800">
                ✓ 피크 {Object.keys(result.peaks).length}건
              </div>
            )}
            {result && result.kind === "combined" && (
              <div className="p-2 bg-blue-50 border border-blue-200 rounded
                              text-[11px] text-blue-800">
                ✓ 종목 {result.stocks.length}건 + 피크 {Object.keys(result.peaks).length}건
              </div>
            )}

            <div className="flex gap-1.5">
              <button onClick={() => void handleCopy()}
                      className="flex-1 px-2 py-1.5 bg-gray-100 hover:bg-gray-200
                                 text-gray-700 text-xs rounded">
                📋 복사
              </button>
              <button onClick={() => void handlePaste()}
                      className="flex-1 px-2 py-1.5 bg-gray-100 hover:bg-gray-200
                                 text-gray-700 text-xs rounded">
                📥 붙여넣기
              </button>
              <button onClick={() => void handleApply()}
                      disabled={!result || result.kind === "error" || busy}
                      className="flex-1 px-2 py-1.5 bg-rose-600 hover:bg-rose-700
                                 disabled:bg-gray-300
                                 text-white text-xs rounded font-bold">
                {busy ? "..." : "💾 적용"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
