import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  sortHoldings, loadSortKey, loadSortDir, saveSortKey, saveSortDir,
  type SortKey, type SortDirection,
} from "../lib/sortHoldings";
import { SortSelector, makeSortHandlers } from "./SortSelector";
import {
  fetchYahooBatch, fetchTossPrices, fetchNaverPrices, fetchNaverInfo, fetchWarning, fetchInvestorHistory, fetchYasunNightFutures,
  fetchKrRegularPrices, verifyKrMarkets,
  fetchYahooChart, fetchKrPriceHistory,
} from "../lib/api";
import {
  US_PAIRS,
} from "../lib/usMarketData";
import { Settings, Cpu, Menu, MoreVertical } from "lucide-react";
import type { ReactNode } from "react";
import { isSymbolSleeping, marketOfSymbol, fmtAgo, isTodayKst, isEtfByName, signColor, formatSigned, holdingYesterdayBaseSum } from "../lib/format";
import { getTodayProxyCalls, getRecentProxyCalls } from "../lib/usageCounter";
import {
  getPersonalProxyUrl, setPersonalProxyUrl,
  getEffectivePollMs, getPersonalPollMs, setPersonalPollMs, POLL_OPTIONS, PUBLIC_MIN_POLL_MS,
  getDimSleepingEnabled, setDimSleepingEnabled,
} from "../lib/proxyConfig";
import { useAdaptiveRefreshMs } from "../lib/proxyStatus";
import { useTossMaintenance, fmtUntil, getTossMaintenance } from "../lib/tossMaintenance";
import { getIndependentGroupsMode } from "../lib/groupMode";
import { normalizeAccount } from "../lib/account";
import type { MarketIndexKey } from "../lib/api";
import { MarketFlowModal } from "./MarketFlowModal";

// PC UsMarketTab과 동일 — Yahoo .KS/.KQ 6자리 ETF 심볼 → 토스 compositions ticker
const KR_ETF_SYMBOL_RE = /^([\dA-Za-z]{6})\.K[SQ]$/;
function krEtfTicker(symbol: string): string | null {
  const m = KR_ETF_SYMBOL_RE.exec(symbol);
  return m ? m[1] : null;
}

// Toss / Yahoo 외부 링크 (UsMarketTab 와 동일 규칙)
function quoteUrl(symbol: string): string {
  // 야간선물 — yasun.gg
  if (symbol === "^KS200N") return "https://yasun.gg/kospi200";
  if (symbol === "^KQ150N") return "https://yasun.gg/kosdaq150";
  // 한국 보유 종목 (6자리) 또는 KODEX/.KS ETF (6자리.KS) — 모두 토스
  const krMatch = /^([\dA-Za-z]{6})(?:\.KS)?$/.exec(symbol);
  if (krMatch) return `https://tossinvest.com/stocks/A${krMatch[1]}`;
  // 지수/환율/미국 ETF 토스 매핑 (lib/toss.ts 공통 맵)
  if (TOSS_SYMBOL_URL[symbol]) return TOSS_SYMBOL_URL[symbol];
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`;
}
import { RefreshIndicator } from "./RefreshIndicator";
import { forceUpdate } from "./VersionBadge";
import { NewVersionToast } from "./NewVersionToast";
import { OnboardingDialog } from "./OnboardingDialog";
import {
  exportAll, replaceAllHoldings, replaceAllPeaks, loadHoldings, loadMemos, loadAllTrades,
  deleteAllRowsForTicker, removeHolding, renameGroup, deleteGroup, applyImportedSettings, replaceAllMemos, replaceAllTrades,
} from "../lib/db";
import { detectPortfolioJson } from "../lib/portfolioImport";
import { handleTossLinkClick, TOSS_SYMBOL_URL } from "../lib/toss";
import { MobileStockCard } from "./MobileStockCard";
import { MemoDialog } from "./MemoDialog";
import { TotalRow } from "./TotalRow";
import { WhatIfRow } from "./WhatIfRow";
import { SemiCheckTab } from "./SemiCheckTab";
import { SectorRankingTab } from "./SectorRankingTab";
import { ConsensusTab, type ConsensusItem } from "./ConsensusTab";
import { CONSENSUS_TAB_KEY as CONSENSUS_KEY, ETF_REVERSE_TAB_KEY as ETF_KEY } from "./Tabs";
import { EtfReverseTab } from "./EtfReverseTab";
import { MyTradesTab } from "./MyTradesTab";
import { EtfCompositionDialog } from "./EtfCompositionDialog";
import { EtfReverseDialog } from "./EtfReverseDialog";
import { MobileTodayPnLLayer } from "./TodayPnLTable";
import { SearchDialog } from "./SearchDialog";
import { FeedbackDialog } from "./FeedbackDialog";
import { DonateDialog } from "./DonateDialog";
import { EditHoldingDialog } from "./EditHoldingDialog";
import { MyStockEditDialog } from "./MyStockEditDialog";
import { HelpDialog, markHelpSeen, shouldShowHelpFirstTime } from "./HelpDialog";
import { Sparkline } from "./Sparkline";
import { ValuationModal } from "./ValuationModal";
import {
  getSyncState, getLastSyncedAt, enableSync, disableSync,
  uploadToDrive, downloadFromDrive,
  tryRestoreSession,
} from "../lib/syncManager";
import { isSignedIn, getAccessToken, wasSignedIn } from "../lib/googleAuth";
import type { Stock } from "../types";
import { getTabVisibility, setTabVisibility, getMarketSplit, setMarketSplit } from "../lib/tabVisibility";
import { getGroupFolders, setGroupFolders, type GroupFolder } from "../lib/groupFolders";

const KR_KEY = "__kr__";  // 한국 (KOSPI/KOSDAQ + 한국 섹터 ETF + 짝 미국 섹터 ETF)
const US_KEY = "__us__";  // 미국 (환율·매크로·원자재·미국지수·미국 대표 ETF)
const SEMI_KEY = "__semi__";  // 반도체 점검 — MU·NVDA·장비주·환율
const SECTOR_KEY = "__sector__";  // 한국 섹터 순위 — 토스 TICS depth1 ranking
const MY_KEY = "__my-stocks__";  // 내주식(가상 합산) — 모든 그룹의 동일 ticker 를 shares 합/가중평균 평단
const MY_TRADES_KEY = "__my-trades__";  // 내거래 — 모든 종목 거래 기록 모아보기 (내주식과 한 묶음)
const TAB_KEY = "portfolio-mobile-active-tab";  // 마지막 활성 탭 기억

// 섹터 탭 — KOSPI/KOSDAQ + EWY/VIX(한국 sentiment) + 섹터 페어
const KR_ORDER: string[] = [
  "^KS200N", "^KS11",          // KOSPI200 야간선물 | KOSPI
  "^KQ150N", "^KQ11",          // KOSDAQ150 야간선물 | KOSDAQ
  "EWY", "069500.KS",          // 외국인 투심(EWY) | KODEX 200
  "^VIX", "VKOSPI",            // 공포(VIX) | V-KOSPI
  "SMH", "091160.KS",     // 반도체 (필반·필반선물은 반도체 탭으로 이동 — 지수에서 제외)
  "PAVE", "117700.KS",    // 건설/인프라
  "LIT", "305720.KS",     // 2차전지
  "XBI", "244580.KS",     // 바이오
  "KBE", "091170.KS",     // 은행
  "ITA", "449450.KS",     // 방산
  "XLV", "266420.KS",     // 헬스케어
  "KOID", "0190C0.KS",    // 피지컬AI (KOID=미국 휴머노이드, RISE=국내)
];

// 매크로 탭 — 환율/금리 → 미국지수+선물 → 미국 대표 ETF → 원자재 (맨 아래)
const US_ORDER: string[] = [
  "KRW=X", "DX-Y.NYB",
  "^FVX", "^TNX", "^TYX",   // 미국 국채금리 커브 5/10/30Y (yield, %)
  "RTY=F",                 // 러셀2000 선물 (미국30Y 다음)
  "^IXIC", "NQ=F",
  "^GSPC", "ES=F",
  "^DJI",
  "SPY", "QQQ",
  "DIA",
  "IWM", "VTI",
  "GC=F", "SI=F",
  "HG=F", "CL=F",
  "NG=F", "BTC-USD",
];

// 모바일 전용 단순 뷰 (v2 데스크톱 미국증시 표 형식 그대로 이식)
// 자동 갱신 X — 새로고침 버튼만. 자기 주식/그룹/검색 등 모든 추가 기능 없음.

function fmtPrice(symbol: string, price: number): string {
  if (symbol === "^TNX" || symbol === "^VIX" || symbol === "VKOSPI") return price.toFixed(2);
  if (symbol.includes("KRW")) return price.toFixed(2);
  if (price >= 1000) return Math.round(price).toLocaleString();
  return price.toFixed(2);
}

export function MobileSimpleView() {
  const queryClient = useQueryClient();
  const [proxyUrl, setProxyUrl] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInitQuery, setSearchInitQuery] = useState("");
  const [etfDialog, setEtfDialog] = useState<{ ticker: string; name: string } | null>(null);
  const [etfReverseDialog, setEtfReverseDialog] = useState<{ ticker: string; name: string } | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  // 상단 헤더 접기/펼치기 (PC 와 동일 키)
  const [headerCollapsed, setHeaderCollapsed] = useState(() => {
    try { return localStorage.getItem("portfolio_header_collapsed") === "1"; } catch { return false; }
  });
  const toggleHeader = () => setHeaderCollapsed(v => {
    const next = !v;
    try { localStorage.setItem("portfolio_header_collapsed", next ? "1" : "0"); } catch { /* noop */ }
    return next;
  });
  const [moreOpen, setMoreOpen] = useState(false);   // 상단 더보기 메뉴(사용법/질문/후원/설정)
  const [marketSplit, setMarketSplitState] = useState(getMarketSplit());   // 일괄 / 시장분리 보기
  const [donateOpen, setDonateOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [editing, setEditing] = useState<Stock | null>(null);
  const [editAllStock, setEditAllStock] = useState<{ ticker: string; name: string } | null>(null);
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
  const isSystemTab = activeTab === KR_KEY || activeTab === US_KEY
    || activeTab === SEMI_KEY || activeTab === SECTOR_KEY || activeTab === CONSENSUS_KEY
    || activeTab === ETF_KEY || activeTab === MY_TRADES_KEY;
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setProxyUrl(getPersonalProxyUrl() ?? "");
  }, []);

  // 활성 탭 변경 시 저장
  useEffect(() => {
    localStorage.setItem(TAB_KEY, activeTab);
  }, [activeTab]);

  // PC 동일 자동 갱신 — 전용 프록시 시 5/10/30/60초 / 공개 기본 60초(30초 선택 가능) + 다운/마감 시 자동 증가
  const BASE_REFRESH_MS = useMemo(() => getEffectivePollMs(), []);
  const adaptiveRefreshMs = useAdaptiveRefreshMs(BASE_REFRESH_MS);
  const tossMaint = useTossMaintenance();   // 토스 점검 — 네이버 fallback(60s) / 워커 미지원 시 5분
  const REFRESH_MS = tossMaint.active
    ? (tossMaint.needsWorkerUpdate ? 300_000 : 60_000)
    : adaptiveRefreshMs;

  // 보유 종목 로드 (그룹 탭 라벨 + 그룹 종목 표시)
  const { data: holdings = [] } = useQuery({
    queryKey: ["m-holdings"],
    queryFn: loadHoldings,
    refetchOnWindowFocus: false,
  });
  const { data: memos } = useQuery({
    queryKey: ["m-memos"],
    queryFn: loadMemos,
    refetchOnWindowFocus: false,
  });
  // 거래 기록 개수 — 내거래 탭 노출/뱃지용
  const { data: allTrades = [] } = useQuery({
    queryKey: ["m-trades"],
    queryFn: loadAllTrades,
    refetchOnWindowFocus: false,
  });
  const tradeCount = allTrades.length;

  // 그룹 목록 (account 별 카운트) — 한국 + 미국 + 보유 + 사용자 그룹들
  const groupTabs = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of holdings) {
      const acc = normalizeAccount(s.account);
      counts.set(acc, (counts.get(acc) || 0) + 1);
    }
    const vis = getTabVisibility();
    const tabs: { key: string; label: string; count: number; icon?: ReactNode }[] = [];
    if (vis.usMarket) {
      tabs.push({ key: KR_KEY, label: "📈지수", count: 0 });   // PC UsMarketTab 과 동일
      tabs.push({ key: US_KEY, label: "매크로", count: 0 });
    }
    if (vis.sectorRank) {
      tabs.push({ key: SECTOR_KEY, label: "🧩섹터", count: 0 });
    }
    if (vis.semiCheck) {
      tabs.push({
        key: SEMI_KEY, label: "반도체", count: 0,
        icon: <Cpu size={12} strokeWidth={2.2} />,
      });
    }
    // 합산 그룹 — 보유 수량 있는 unique ticker 수
    const uniqHeld = new Set<string>();
    for (const s of holdings) {
      if (s.shares > 0 && s.avg_price > 0) uniqHeld.add(s.ticker);
    }
    if (vis.myStocks && uniqHeld.size > 0) {
      tabs.push({ key: MY_KEY, label: "📦내주식", count: uniqHeld.size });
    }
    // 내거래 — 내주식 바로 옆(한 묶음). 거래 기록 있거나 보유 종목 있을 때.
    if (vis.myTrades && (tradeCount > 0 || uniqHeld.size > 0)) {
      tabs.push({ key: MY_TRADES_KEY, label: "🧾내거래", count: tradeCount });
    }
    // 컨센서스 — 설정 ON 이면 항상 노출(종목 없으면 빈 안내 표시)
    if (vis.consensus) {
      tabs.push({ key: CONSENSUS_KEY, label: "🎯컨센서스", count: 0 });
    }
    if (vis.etfReverse) {
      tabs.push({ key: ETF_KEY, label: "🍱ETF", count: 0 });
    }
    // "보유" 도 일반 사용자 그룹과 동일하게 취급 — 별도 분기 없음
    const userGroups = Array.from(counts.keys())
      .filter(k => !["", "관심ETF"].includes(k))
      .sort();
    for (const g of userGroups) {
      tabs.push({ key: g, label: g, count: counts.get(g)! });
    }
    return tabs;
    // settingsOpen 의존 — 설정 모달 닫힐 때 visibility 재평가
  }, [holdings, settingsOpen, tradeCount]);

  // 그룹 폴더 — 폴더에 담긴 그룹은 개별 탭 대신 📁 드롭다운으로 묶음
  const folders = useMemo(() => getGroupFolders(), [settingsOpen, holdings]);
  const folderedGroups = useMemo(
    () => new Set(folders.flatMap(f => f.groups)), [folders]);
  const countByKey = useMemo(
    () => new Map(groupTabs.map(t => [t.key, t.count])), [groupTabs]);
  const presentGroups = useMemo(
    () => new Set(groupTabs.map(t => t.key)), [groupTabs]);
  // 화면에 보이는 탭 순서(스와이프 이동용) — 비폴더 탭들 + 폴더별 멤버(이름순)
  const navKeys = useMemo(() => {
    const keys: string[] = [];
    for (const t of groupTabs) if (!folderedGroups.has(t.key)) keys.push(t.key);
    for (const f of folders) {
      keys.push(...f.groups.filter(g => presentGroups.has(g)).sort((a, b) => a.localeCompare(b, "ko")));
    }
    return keys;
  }, [groupTabs, folderedGroups, folders, presentGroups]);

  // 컨센서스 탭 — 한국 6자리 보유 종목(중복 제거) + 속한 그룹들 (PC와 동일)
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
    if (activeTab === MY_KEY) {
      // 합산 — 모드별:
      //  · 독립 ON(다중 계좌): ticker별 shares 합·가중평균 평단
      //  · 독립 OFF(sync 기본): 같은 종목이 모든 그룹에 동기화돼 있으므로 첫 발견 하나만 채택
      //    (합산하면 그룹 수만큼 부풀려져 표시되던 버그)
      const independent = getIndependentGroupsMode();
      if (!independent) {
        const seen = new Map<string, Stock>();
        const earliest = new Map<string, string>();
        for (const h of holdings) {
          if (!(h.shares > 0) || !(h.avg_price > 0)) continue;
          if (!seen.has(h.ticker)) seen.set(h.ticker, h);
          if (h.buy_date) {
            const prev = earliest.get(h.ticker);
            if (!prev || h.buy_date < prev) earliest.set(h.ticker, h.buy_date);
          }
        }
        return Array.from(seen, ([ticker, h]) => {
          const isToday = isTodayKst(h.buy_date);
          return {
            ticker, name: h.name, shares: h.shares, avg_price: h.avg_price,
            invested: Math.round(h.shares * h.avg_price),
            buy_date: earliest.get(ticker) ?? h.buy_date,
            market: h.market, account: MY_KEY,
            todayShares: isToday ? h.shares : 0,
            todayCost: isToday ? h.shares * h.avg_price : 0,
          } as Stock;
        });
      }
      interface Acc { name: string; shares: number; investedSum: number; firstDate?: string; market?: string; todayShares: number; todayCost: number }
      const m = new Map<string, Acc>();
      for (const h of holdings) {
        if (!(h.shares > 0) || !(h.avg_price > 0)) continue;
        const cur = m.get(h.ticker);
        const invested = h.shares * h.avg_price;
        const isToday = isTodayKst(h.buy_date);
        if (!cur) {
          m.set(h.ticker, {
            name: h.name, shares: h.shares, investedSum: invested, firstDate: h.buy_date, market: h.market,
            todayShares: isToday ? h.shares : 0, todayCost: isToday ? invested : 0,
          });
        } else {
          cur.shares += h.shares;
          cur.investedSum += invested;
          if (isToday) { cur.todayShares += h.shares; cur.todayCost += invested; }
          if (h.buy_date && (!cur.firstDate || h.buy_date < cur.firstDate)) cur.firstDate = h.buy_date;
          if (!cur.market && h.market) cur.market = h.market;
        }
      }
      return Array.from(m, ([ticker, v]) => ({
        ticker, name: v.name, shares: v.shares,
        avg_price: v.investedSum / v.shares,
        invested: Math.round(v.investedSum),
        buy_date: v.firstDate, market: v.market,
        account: MY_KEY,
        todayShares: v.todayShares, todayCost: v.todayCost,
      } as Stock));
    }
    return holdings.filter(s => normalizeAccount(s.account) === activeTab);
  }, [holdings, activeTab, isSystemTab]);

  // 그룹 종목들의 KR 가격 fetch (수동 갱신만)
  const groupTickers = groupHoldingsUnsorted
    .filter(s => /^[\dA-Za-z]{6}$/.test(s.ticker))
    .map(s => s.ticker);
  const { data: groupPrices, dataUpdatedAt: groupAt } = useQuery({
    queryKey: ["m-group-prices", activeTab, groupTickers.join(",")],
    queryFn: async () => {
      try { return await fetchTossPrices(groupTickers); }
      catch (e) {
        if (getTossMaintenance().active) return await fetchNaverPrices(groupTickers);
        throw e;
      }
    },
    enabled: !isSystemTab && groupTickers.length > 0,
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: true,   // 백그라운드에도 폴링 → 탭 제목 손익 계속 갱신
  });
  const groupPriceMap = new Map((groupPrices ?? []).map(p => [p.ticker, p]));

  // 브라우저 탭 제목 — 전체금액 → 전체% → 오늘금액 → 오늘% 순서로 순환
  const titlePartsRef = useRef<string[]>([]);
  useEffect(() => {
    let invested = 0, cur = 0, yest = 0;
    for (const s of groupHoldingsUnsorted) {
      if (s.shares <= 0) continue;
      const p = groupPriceMap.get(s.ticker);
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
    // groupPriceMap 은 매 렌더 새 Map → 의존성은 groupPrices(쿼리 데이터)로
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupHoldingsUnsorted, groupPrices]);
  // 조각 순환 — 전체/금액/% → 오늘/금액/% 1.2초마다 번갈아 (짧아서 안 잘림, 매번 최신값)
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

  // 한국 종목 거래소 자동 검증 — Toss stock-infos API (24h localStorage 캐시) — PC 동일 로직
  const krxOnlyTickers = groupTickers.filter(t => /^\d{6}$/.test(t));
  const { data: verifiedMarketMap } = useQuery({
    queryKey: ["m-kr-markets-verified", krxOnlyTickers],
    queryFn: async () => {
      const cacheRaw = localStorage.getItem("kr_markets_verified") ?? "{}";
      const cache = JSON.parse(cacheRaw) as Record<string, "KOSPI" | "KOSDAQ">;
      const cacheTs = Number(localStorage.getItem("kr_markets_verified_ts") ?? "0");
      const isFresh = Date.now() - cacheTs < 24 * 3600 * 1000;
      const known = isFresh ? new Map(Object.entries(cache)) : new Map();
      const toVerify = krxOnlyTickers.filter(t => !known.has(t));
      if (toVerify.length === 0) return known;
      const fresh = await verifyKrMarkets(toVerify);
      for (const [t, mkt] of fresh) known.set(t, mkt);
      const obj: Record<string, string> = {};
      for (const [k, v] of known) obj[k] = v;
      localStorage.setItem("kr_markets_verified", JSON.stringify(obj));
      localStorage.setItem("kr_markets_verified_ts", String(Date.now()));
      return known;
    },
    enabled: krxOnlyTickers.length > 0,
    staleTime: 60 * 60 * 1000,
  });

  // 검증된 시장(KSP/KSQ) → fetchKrRegularPrices 입력 Map
  const krMarketMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of groupHoldingsUnsorted) {
      if (!/^\d{6}$/.test(s.ticker)) continue;
      const v = verifiedMarketMap?.get(s.ticker);
      if (v) m.set(s.ticker, v);
      else if (s.market) m.set(s.ticker, s.market);
    }
    return m;
  }, [groupHoldingsUnsorted, verifiedMarketMap]);

  // 한국 정규장 종가/변동률 (Yahoo .KS/.KQ batch) — 책갈피 표시용
  const { data: krRegMap } = useQuery({
    queryKey: ["m-kr-reg", krxOnlyTickers, Array.from(krMarketMap.entries()).flat().join(",")],
    queryFn: () => fetchKrRegularPrices(krxOnlyTickers, krMarketMap),
    enabled: krxOnlyTickers.length > 0 && krMarketMap.size > 0,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

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

  // Yahoo: 본물 + 선물 평탄화 (선행지수만 — ETF 제외). 야간선물(^KS200N/^KQ150N)은 yasun 별도.
  const YASUN_VIRTUAL = new Set<string>(["^KS200N", "^KQ150N"]);
  const yahooSymbols = US_PAIRS.flatMap(p => {
    if (YASUN_VIRTUAL.has(p.symbol)) return [];
    return p.future
      ? [{ symbol: p.symbol, name: p.name }, { symbol: p.future, name: `${p.name} 선물` }]
      : [{ symbol: p.symbol, name: p.name }];
  });

  const { data: usMapRaw, isFetching, dataUpdatedAt: usAt } = useQuery({
    queryKey: ["m-yahoo"],
    queryFn: () => fetchYahooBatch(yahooSymbols),
    refetchInterval: REFRESH_MS,
  });

  // 야간선물 (yasun.gg) — 별도 fetch, usMap 에 병합
  const NIGHT_SYMS = ["^KS200N", "^KQ150N"] as const;
  const nightQs = useQueries({
    queries: NIGHT_SYMS.map(sym => ({
      queryKey: ["m-yasun-night", sym],
      queryFn: () => fetchYasunNightFutures(sym),
      refetchInterval: REFRESH_MS,
      staleTime: 60_000,
    })),
  });
  const usMap = new Map(usMapRaw ?? []);
  const nightClosesMap = new Map<string, number[]>();
  for (let i = 0; i < NIGHT_SYMS.length; i++) {
    const d = nightQs[i]?.data;
    if (d) {
      usMap.set(NIGHT_SYMS[i], d.index);
      nightClosesMap.set(NIGHT_SYMS[i], d.closes);
    }
  }

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
    const idx = navKeys.indexOf(activeTab);
    if (idx === -1) return;
    if (dx < 0 && idx < navKeys.length - 1) setActiveTab(navKeys[idx + 1]);
    if (dx > 0 && idx > 0) setActiveTab(navKeys[idx - 1]);
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
  };
  const t0ChartByIndex = new Map(tier0.map((p, i) => [p.symbol, t0ChartQs[i]?.data ?? []]));
  const t0ChartMap = new Map(
    tier0.map(p => {
      // 야간선물 — yasun 캔들 close 시계열
      const yasunCloses = nightClosesMap.get(p.symbol);
      if (yasunCloses && yasunCloses.length > 1) return [p.symbol, yasunCloses];
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
      {tossMaint.active && (
        <div className="bg-amber-100 border-b border-amber-300 text-amber-900 text-[11px]
                        px-3 py-1.5 text-center leading-tight">
          {tossMaint.needsWorkerUpdate
            ? "🚧 토스 점검 중 — 네이버 우회는 워커 업데이트 필요"
            : tossMaint.naverWorking
              ? `🚧 토스 점검 — 네이버 시세 표시 중${tossMaint.until ? ` (~${fmtUntil(tossMaint.until)})` : ""}`
              : `🚧 토스 점검 중${tossMaint.until ? ` (~${fmtUntil(tossMaint.until)})` : ""} — 네이버로 우회`}
        </div>
      )}
      {!headerCollapsed && (
      <header className="sticky top-0 z-50 bg-white border-b border-gray-200
                          px-3 py-2 flex items-center gap-1">
        <button onClick={toggleHeader} title="헤더 접기 (상단 메뉴 숨김)"
                className="shrink-0 p-1 rounded text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition">
          <Menu size={16} />
        </button>
        <h1 className="text-sm font-bold text-gray-800 shrink-0">📈</h1>
        <RefreshIndicator dataUpdatedAt={lastAt}
                          refetchIntervalMs={REFRESH_MS}
                          onRefresh={() => void queryClient.invalidateQueries()} />
        <button onClick={handleRefresh}
                disabled={isFetching}
                title="최신 버전 적용 (캐시 초기화 + 새로고침)"
                className="ml-auto p-1.5 rounded hover:bg-gray-100
                            disabled:opacity-50 transition">
          <span className={`inline-block ${isFetching ? "animate-spin" : ""}`}>✨</span>
        </button>
        {/* 모바일 상단 액션 — PC 와 동일한 색상 체계, 폰트만 작게.
            모든 버튼에 명확한 박스(bg/border)로 클릭 가능 영역 표시 */}
        <button onClick={() => setSearchOpen(true)}
                title="종목 검색 / 추가 — 검색 결과에서 수량·평단 입력 시 보유로 등록"
                className="px-2 py-1 rounded text-[11px] font-medium shrink-0
                           bg-blue-600 hover:bg-blue-700 text-white">
          검색
        </button>
        {/* 더보기 — 사용법/질문하기/후원하기/설정 묶음 (문구는 PC 동일) */}
        <div className="relative shrink-0">
          <button onClick={() => setMoreOpen(o => !o)}
                  title="더보기 — 사용법 / 질문하기 / 후원하기 / 설정"
                  className="px-1.5 py-1 rounded text-gray-600 shrink-0
                             bg-gray-100 hover:bg-gray-200 border border-gray-200">
            <MoreVertical size={15} />
          </button>
          {moreOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMoreOpen(false)} />
              <div className="absolute right-0 top-full mt-1 z-50 min-w-[110px]
                              bg-white border border-gray-200 rounded-md shadow-lg py-1 text-[12px]">
                <button onClick={() => { setHelpOpen(true); setMoreOpen(false); }}
                        className="block w-full text-left px-3 py-1.5 text-gray-700 hover:bg-gray-100">사용법</button>
                <button onClick={() => { setFeedbackOpen(true); setMoreOpen(false); }}
                        className="block w-full text-left px-3 py-1.5 text-emerald-700 hover:bg-emerald-50">질문하기</button>
                <button onClick={() => { setDonateOpen(true); setMoreOpen(false); }}
                        className="block w-full text-left px-3 py-1.5 text-gray-700 hover:bg-gray-100">후원하기</button>
                <button onClick={() => { setSettingsOpen(true); setMoreOpen(false); }}
                        className="block w-full text-left px-3 py-1.5 text-gray-700 hover:bg-gray-100">설정</button>
              </div>
            </>
          )}
        </div>
      </header>
      )}

      {/* ─── 그룹 탭 (가로 스크롤, 작은 폰트) — 길게 누르기 = 액션 시트 ─── */}
      <nav style={{ top: headerCollapsed ? 0 : 44 }}
           className="sticky z-40 bg-white border-b border-gray-200
                       px-2 py-1 flex items-center gap-1 overflow-x-auto whitespace-nowrap">
        {/* 헤더 접힘 시 펼치기(≡) 버튼 — 탭 바 맨 앞 */}
        {headerCollapsed && (
          <button onClick={toggleHeader} title="헤더 펼치기 (상단 메뉴 보이기)"
                  className="shrink-0 p-0.5 rounded text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition">
            <Menu size={16} />
          </button>
        )}
        {/* 시스템 탭 묶음 — 선택된 탭 아이콘 + 선택박스 (지수~ETF) */}
        {(() => {
          const SYS = new Set([KR_KEY, US_KEY, SECTOR_KEY, SEMI_KEY, CONSENSUS_KEY, ETF_KEY]);
          const sys = groupTabs.filter(t => SYS.has(t.key));
          if (sys.length === 0) return null;
          const current = sys.find(t => t.key === activeTab)?.key ?? sys[0].key;
          const curTab = sys.find(t => t.key === current);
          const on = sys.some(t => t.key === activeTab);
          return (
            <span className={`shrink-0 inline-flex items-center rounded-md text-[11px] pl-1.5
                              ${on ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600"}`}>
              {curTab?.icon && <span className="inline-flex align-middle mr-0.5">{curTab.icon}</span>}
              <select value={on ? current : ""}
                      onChange={e => { if (e.target.value) setActiveTab(e.target.value); }}
                      className={`bg-transparent text-[11px] py-1 pl-1 pr-1 rounded-md focus:outline-none
                                  ${on ? "text-white" : "text-gray-700"}`}>
                {/* 비활성 시 placeholder — 첫 항목(지수)도 클릭 선택되게 */}
                {!on && <option value="" disabled hidden className="text-gray-800">{curTab?.label}</option>}
                {sys.map(t => (
                  <option key={t.key} value={t.key} className="text-gray-800">
                    {t.label}{t.count > 0 ? ` (${t.count})` : ""}
                  </option>
                ))}
              </select>
            </span>
          );
        })()}
        {/* 내자산 묶음 — 내주식 + 내거래 드롭다운 하나로 (지수 묶음과 동일) */}
        {(() => {
          const MY = new Set([MY_KEY, MY_TRADES_KEY]);
          const my = groupTabs.filter(t => MY.has(t.key));
          if (my.length === 0) return null;
          const current = my.find(t => t.key === activeTab)?.key ?? my[0].key;
          const curTab = my.find(t => t.key === current);
          const on = my.some(t => t.key === activeTab);
          return (
            <span className={`shrink-0 inline-flex items-center rounded-md text-[11px] pl-1.5
                              ${on ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600"}`}>
              <select value={on ? current : ""}
                      onChange={e => { if (e.target.value) setActiveTab(e.target.value); }}
                      className={`bg-transparent text-[11px] py-1 pl-1 pr-1 rounded-md focus:outline-none
                                  ${on ? "text-white" : "text-gray-700"}`}>
                {!on && <option value="" disabled hidden className="text-gray-800">{curTab?.label}</option>}
                {my.map(t => (
                  <option key={t.key} value={t.key} className="text-gray-800">
                    {t.label}{t.count > 0 ? ` (${t.count})` : ""}
                  </option>
                ))}
              </select>
            </span>
          );
        })()}
        {groupTabs.map(t => {
          // 시스템·내자산 탭은 위 드롭다운으로만 표시 (개별 탭 숨김)
          if ([KR_KEY, US_KEY, SECTOR_KEY, SEMI_KEY, CONSENSUS_KEY, ETF_KEY, MY_KEY, MY_TRADES_KEY].includes(t.key)) return null;
          // 폴더에 담긴 그룹은 개별 탭에서 숨김 (아래 📁 드롭다운으로)
          if (folderedGroups.has(t.key)) return null;
          const active = t.key === activeTab;
          // 시스템 탭(한국/미국)은 길게 누르기 무시
          const editable = t.key !== US_KEY && t.key !== KR_KEY && t.key !== CONSENSUS_KEY;
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
              {t.icon && <span className="mr-0.5 inline-flex align-middle">{t.icon}</span>}
              {t.label}
              {t.count > 0 && (
                <span className={`ml-1 ${active ? "text-blue-100" : "text-gray-400"}`}>
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
        {/* 📁 폴더 드롭다운 — 폴더에 담긴 그룹 묶음 */}
        {folders.map(folder => {
          const members = folder.groups.filter(g => presentGroups.has(g))
                                .sort((a, b) => a.localeCompare(b, "ko"));
          if (members.length === 0) return null;
          const current = members.includes(activeTab) ? activeTab : members[0];
          const folderActive = members.includes(activeTab);
          return (
            <span key={`folder_${folder.name}`}
                  className={`shrink-0 inline-flex items-center rounded-md text-[11px] pl-2
                              ${folderActive ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600"}`}>
              📁{folder.name}
              <select value={current}
                      onChange={e => setActiveTab(e.target.value)}
                      className={`bg-transparent text-[11px] py-1 pl-1 pr-1 rounded-md focus:outline-none
                                  ${folderActive ? "text-white" : "text-gray-700"}`}>
                {members.map(g => (
                  <option key={g} value={g} className="text-gray-800">
                    {g}{(countByKey.get(g) ?? 0) > 0 ? ` (${countByKey.get(g)})` : ""}
                  </option>
                ))}
              </select>
            </span>
          );
        })}
      </nav>

      {/* ─── 그룹 컨텐츠 (시스템 탭 외) ─── */}
      {!isSystemTab && (
        <>
          {/* 정렬 옵션 + 보기 모드 */}
          {groupHoldings.length > 0 && (
            <div className="flex items-center justify-end gap-2 px-2 pt-2">
              {/* 보기 모드 — 일괄 / 코스피·코스닥 분리 (좌측) */}
              <select value={marketSplit ? "split" : "all"}
                      onChange={e => { const v = e.target.value === "split"; setMarketSplitState(v); setMarketSplit(v); }}
                      className="mr-auto text-[11px] font-medium border border-gray-300 rounded px-1 py-1
                                 bg-white text-gray-700 focus:outline-none">
                <option value="all">일괄보기</option>
                <option value="split">코스피/코스닥분리</option>
              </select>
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
            {(() => {
              // 합산 그룹 row — 수정/삭제 비활성 (실제 그룹 탭에서만 수정 가능)
              const isAggregated = activeTab === MY_KEY;
              // 가격이 한 번도 안 들어온 종목(KRX300 처럼 유효하지 않은 코드)은 숨김.
              const shown = groupHoldings.filter(s =>
                groupPrices === undefined || groupPriceMap.size === 0 || groupPriceMap.has(s.ticker));
              const renderCard = (s: Stock) => (
              <MobileStockCard key={s.ticker + (s.account ?? "")}
                               stock={s}
                               price={groupPriceMap.get(s.ticker)}
                               krReg={krRegMap?.get(s.ticker)}
                               sector={naverInfos.data?.get(s.ticker)?.sector}
                               market={krMarketMap.get(s.ticker)}
                               warning={warningMap.get(s.ticker) || undefined}
                               chart={groupChartMap.get(s.ticker)}
                               investorHistory={investorHistoryMap.get(s.ticker)}
                               consensus={naverInfos.data?.get(s.ticker)?.consensus}
                               memo={memos?.get(s.ticker)}
                               otherGroups={isAggregated
                                 ? (tickerGroupsMap.get(s.ticker) ?? [])
                                 : (tickerGroupsMap.get(s.ticker) ?? [])
                                     .filter(g => g !== (s.account || ""))}
                               heldGroups={tickerHeldGroupsMap.get(s.ticker)}
                               onOpenValuation={setValuationTicker}
                               onOpenMemo={t => setMemoTicker(t)}
                               onOpenEtf={(tk, nm) => setEtfDialog({ ticker: tk, name: nm })}
                               onOpenEtfReverse={(tk, nm) => setEtfReverseDialog({ ticker: tk, name: nm })}
                               onEdit={isAggregated ? (st => setEditAllStock({ ticker: st.ticker, name: st.name })) : (st => setEditing(st))}
                               onDelete={isAggregated ? undefined : (async st => {
                                 const indep = getIndependentGroupsMode();
                                 const msg = indep
                                   ? `"${st.name}" 을(를) "${st.account}" 그룹에서 삭제할까요?`
                                   : `"${st.name}" 을(를) 삭제할까요?\n(모든 그룹에서 제거됩니다)`;
                                 if (!confirm(msg)) return;
                                 if (indep) {
                                   await removeHolding(st.ticker, st.account || "");
                                 } else {
                                   await deleteAllRowsForTicker(st.ticker);
                                 }
                                 void queryClient.invalidateQueries({ queryKey: ["m-holdings"] });
                                 void queryClient.invalidateQueries({ queryKey: ["m-group-prices"] });
                               })} />
              );
              if (!marketSplit) return <>{shown.map(renderCard)}</>;
              // 시장 분리 — 코스피 / 코스닥 / ETF / 기타 (모바일 세로 스택), 분류별 합계
              const catOf = (s: Stock): string =>
                isEtfByName(s.name) ? "ETF"
                : krMarketMap.get(s.ticker) === "KOSDAQ" ? "KOSDAQ"
                : krMarketMap.get(s.ticker) === "KOSPI" ? "KOSPI"
                : "기타";
              const byCat: Record<string, Stock[]> = { KOSPI: [], KOSDAQ: [], ETF: [], 기타: [] };
              for (const s of shown) byCat[catOf(s)].push(s);
              const subtotal = (items: Stock[]) => {
                let invested = 0, current = 0, yesterday = 0;
                for (const s of items) {
                  if (!(s.shares > 0)) continue;
                  const p = groupPriceMap.get(s.ticker);
                  const cur = p?.price || s.avg_price;
                  invested += s.shares * s.avg_price; current += cur * s.shares;
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
              const SECTIONS: [string, string][] =
                [["KOSPI", "코스피"], ["KOSDAQ", "코스닥"], ["ETF", "ETF"], ["기타", "기타"]];
              return SECTIONS.map(([key, label]) => {
                const items = byCat[key];
                if (items.length === 0) return null;
                const t = subtotal(items);
                return (
                  <div key={key} className="space-y-1.5">
                    <div className="border-b border-gray-300 pb-0.5 pt-1">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-[11px] font-bold text-gray-600">{label}</span>
                        <span className="text-[10px] text-gray-400">{items.length}종목</span>
                      </div>
                      <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5 text-[10px] tabular-nums text-gray-500">
                        <span>원금 <b className="text-gray-700">{Math.round(t.invested).toLocaleString()}</b></span>
                        <span>현재 <b className={signColor(t.pnl)}>{Math.round(t.current).toLocaleString()}</b></span>
                        <span>전체 <b className={signColor(t.pnl)}>{formatSigned(Math.round(t.pnl))} ({t.pct >= 0 ? "+" : ""}{t.pct.toFixed(2)}%)</b></span>
                        <span>오늘 <b className={signColor(t.dayDiff)}>{formatSigned(Math.round(t.dayDiff))} ({t.dayPct >= 0 ? "+" : ""}{t.dayPct.toFixed(2)}%)</b></span>
                      </div>
                    </div>
                    {items.map(renderCard)}
                  </div>
                );
              });
            })()}
          </div>
          {/* 합계 — 화면 하단 fixed.
              합계 클릭 시 위로 오늘 수익/손해 레이어가 펼쳐짐, 다시 클릭 또는 바깥 탭 시 닫힘.
              관심종목만 있어 보유 0개면 TotalRow 가 null → 토글 불가하므로 WhatIfRow 단독 노출. */}
          {groupHoldings.length > 0 && (() => {
            const hasHoldings = groupHoldings.some(s => s.shares > 0);
            if (!hasHoldings) {
              // 보유 0 — TotalRow(예수금/총자산) 항상, 샀더라면(WhatIfRow)은 클릭 시 (보유 있을 때와 동일)
              return (
                <>
                  {todayPnLOpen && (
                    <div className="fixed inset-0 z-30" onClick={() => setTodayPnLOpen(false)} />
                  )}
                  <div className="fixed bottom-0 left-0 right-0 z-40
                                   pb-2 px-3 flex flex-col items-center gap-2
                                   pointer-events-none">
                    {todayPnLOpen && (
                      <div className="pointer-events-auto cursor-pointer"
                           onClick={() => setTodayPnLOpen(false)}>
                        <WhatIfRow holdings={groupHoldings} prices={groupPriceMap} />
                      </div>
                    )}
                    <div className="pointer-events-auto cursor-pointer"
                         onClick={() => setTodayPnLOpen(o => !o)}
                         title={todayPnLOpen ? "닫기" : "샀더라면 보기"}>
                      <TotalRow holdings={groupHoldings} prices={groupPriceMap}
                                account={activeTab}
                                aggregated={activeTab === MY_KEY}
                                onDepositChange={() => {
                                  void queryClient.invalidateQueries({ queryKey: ["m-holdings"] });
                                }} />
                    </div>
                  </div>
                </>
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
                    <TotalRow holdings={groupHoldings} prices={groupPriceMap}
                              account={activeTab}
                              aggregated={activeTab === MY_KEY}
                              onDepositChange={() => {
                                void queryClient.invalidateQueries({ queryKey: ["m-holdings"] });
                              }} />
                  </div>
                </div>
              </>
            );
          })()}
        </>
      )}

      {/* ─── 한국 / 미국 / 반도체 점검 / 섹터 순위 시스템 탭 ─── */}
      {isSystemTab && (() => {
        if (activeTab === MY_TRADES_KEY) {
          return <div className="px-2 py-2 pb-32"><MyTradesTab holdings={holdings} /></div>;
        }
        if (activeTab === SEMI_KEY) {
          return <div className="px-2 py-2"><SemiCheckTab /></div>;
        }
        if (activeTab === CONSENSUS_KEY) {
          return <div className="px-1 py-2">
            <ConsensusTab items={consensusItems}
                          onOpenValuation={setValuationTicker}
                          onSelectGroup={setActiveTab}
                          onEdit={(ticker) => {
                            const s = holdings.find(h => h.ticker === ticker);
                            if (s) setEditing(s);
                          }} />
          </div>;
        }
        if (activeTab === SECTOR_KEY) {
          return <div className="px-2 py-2">
            <SectorRankingTab onRequestSearch={(q) => {
              setSearchInitQuery(q);
              setSearchOpen(true);
            }} />
          </div>;
        }
        if (activeTab === ETF_KEY) {
          return <div className="px-2 py-2">
            <EtfReverseTab holdings={holdings}
                           onOpenEtfComposition={(code, n) => setEtfDialog({ ticker: code, name: n })}
                           onRequestAdd={q => { setSearchInitQuery(q); setSearchOpen(true); }} />
          </div>;
        }
        const order = activeTab === KR_KEY ? KR_ORDER : US_ORDER;
        // 한국 탭은 KOSPI/KOSDAQ 카드와 짝(미국 ETF/한국 ETF 페어)
        // — Yahoo 티커 또는 KR ETF .KS 지원
        return (
          <div className="px-3 py-2 grid grid-cols-2 gap-x-2 gap-y-4">
            {order.map(symbol => {
              const p = tier0.find(x => x.symbol === symbol);
              if (!p) return null;
              const q = usMap?.get(p.symbol);
              const sleeping = isSymbolSleeping(p.symbol);
              // 메인 가격/변동률 (PC UsMarketTab 동일 로직) — 한국 입장 누적 변동률:
              // REGULAR → regularPct, 시간외 → postPrice + 어제 종가 대비 합산
              const offHoursStates = ["PRE", "POST", "POSTPOST", "PREPRE", "CLOSED"];
              const isOffHours = q?.marketState != null && offHoursStates.includes(q.marketState);
              // dim 처리 — 정규장 마감 후 모든 상태 (POST 부터). PRE 는 새 거래일 시작 직전이라 제외.
              // 24h 시장(환율·금/은·원유·암호화폐 등)은 Yahoo가 CLOSED 를 자주 반환하지만 흐림 제외.
              const is24h = marketOfSymbol(p.symbol) === "OTHER";
              const isClosed = !is24h && q?.marketState != null
                && ["POST", "POSTPOST", "PREPRE", "CLOSED"].includes(q.marketState);
              const effPrice = isOffHours && q?.postPrice ? q.postPrice : q?.price;
              const effBase = q?.prevClose;
              const pct = (q?.marketState === "REGULAR" && q.regularPct != null)
                ? q.regularPct
                : (effPrice != null && effBase != null && effBase > 0
                   ? ((effPrice - effBase) / effBase) * 100
                   : null);
              const cdiff = effPrice != null && effBase != null ? effPrice - effBase : 0;
              const isFuture = p.symbol.endsWith("=F") || p.symbol === "^KS200N" || p.symbol === "^KQ150N";
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
              // 정규장 종료(sleeping) 후 항상 마감가 책갈피. 시간외 거래값 있으면 그 값, 없으면 현재가를 마감가로 통일.
              const showCloseTag = sleeping && effPrice != null;
              const closeVal = q?.regularPrice ?? effPrice;
              const regPct = q?.regularPct ?? pct;
              const regSign = regPct == null ? "text-gray-700"
                : regPct > 0 ? "text-rose-600" : regPct < 0 ? "text-blue-600" : "text-gray-700";
              // 마감 책갈피는 노란 배경(살짝 투명) + 흐림 제외 → dim 은 콘텐츠 자식에만
              const dimCls = dimEnabled && (sleeping || isClosed) ? "opacity-60" : "";
              return (
                <div key={p.symbol} className="relative h-full">
                  {/* ETF 책갈피 — KR ETF (예: 069500.KS) 만. 왼쪽 위. 클릭 시 구성종목 모달 */}
                  {(() => {
                    const etfTk = krEtfTicker(p.symbol);
                    if (!etfTk) return null;
                    return (
                      <button onClick={() => setEtfDialog({ ticker: etfTk, name: p.name })}
                              title="ETF 구성 종목 보기"
                              className="absolute -top-2 left-1 z-20 px-1.5 py-0 rounded
                                         text-[10px] font-bold leading-tight
                                         text-violet-700 bg-violet-100/30 active:bg-violet-100/60
                                         border border-violet-300/40">
                        ETF
                      </button>
                    );
                  })()}
                  {/* 정규장 마감가 책갈피 — 카드 위로 올림(-top-2). 노란 배경(살짝 투명) + 흐림 제외(z-20) */}
                  {showCloseTag && closeVal != null && (
                    <div className="absolute -top-2 right-1 z-20 px-1.5 py-0
                                    border rounded bg-yellow-200/25 border-yellow-400/40
                                    text-[10px] font-medium leading-tight whitespace-nowrap">
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
                                  rounded-lg border px-3 py-1.5 ${bg}`}>
                  <Sparkline data={t0ChartMap.get(p.symbol) ?? []}
                             width={300} height={70}
                             color={sleeping && dimEnabled ? "#94a3b8" : undefined}
                             className={`absolute inset-0 w-full h-full opacity-50
                                        pointer-events-none ${dimCls}`} />
                  <div className={`relative flex items-baseline gap-1.5 ${dimCls}`}>
                    {sleeping && (
                      <span className="text-[11px] text-gray-400">zZ</span>
                    )}
                    <a href={quoteUrl(p.symbol)}
                       target="_blank" rel="noopener noreferrer"
                       onClick={e => handleTossLinkClick(e, quoteUrl(p.symbol))}
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
                  <div className={`relative text-[11px] text-gray-500 truncate ${dimCls}`}>
                    {p.desc}
                  </div>
                  <div className={`relative flex items-baseline mt-auto ${dimCls}`}>
                    <span className={`flex-1 text-left text-sm tabular-nums ${sign}`}>
                      {effPrice != null ? fmtPrice(p.symbol, effPrice) : "—"}
                    </span>
                    <span className={`flex-1 text-right text-base font-bold tabular-nums ${sign}`}>
                      {pct != null && Math.abs(pct) >= 0.005
                        ? `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`
                        : ""}
                    </span>
                  </div>
                  </div>
                  {sleeping && fmtAgo(q?.regularMarketTime) && (
                    <div className="absolute -bottom-1 left-1 z-20 px-1.5 py-0 rounded
                                    text-[9px] leading-tight whitespace-nowrap
                                    text-gray-500 bg-gray-100 border border-gray-300/60">
                      {fmtAgo(q?.regularMarketTime)}
                    </div>
                  )}
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
                       onClose={() => setSettingsOpen(false)}
                       groups={Array.from(new Set(
                         holdings.map(h => normalizeAccount(h.account)).filter(a => a && a !== "관심ETF")
                       )).sort()} />
      )}

      {/* 종목 검색 / 추가 */}
      <SearchDialog
        isOpen={searchOpen}
        onClose={() => { setSearchOpen(false); setSearchInitQuery(""); }}
        initialQuery={searchInitQuery}
        onAdded={() => {
          void queryClient.invalidateQueries({ queryKey: ["m-holdings"] });
          void queryClient.invalidateQueries({ queryKey: ["m-group-prices"] });
        }} />

      {/* 기능 요청 / 건의사항 — Padlet 임베드 */}
      <FeedbackDialog isOpen={feedbackOpen} onClose={() => setFeedbackOpen(false)} />

      {/* 후원 — PC 와 동일한 모달 (설명 + QR + 직접 열기) */}
      <DonateDialog isOpen={donateOpen} onClose={() => setDonateOpen(false)} />

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

      {/* 보유 편집 (매수 / 매도 / 직접수정 / 삭제) */}
      <EditHoldingDialog
        isOpen={!!editing}
        onClose={() => setEditing(null)}
        stock={editing}
        curPrice={editing ? groupPriceMap.get(editing.ticker)?.price : undefined}
        onChanged={() => {
          void queryClient.invalidateQueries({ queryKey: ["m-holdings"] });
          void queryClient.invalidateQueries({ queryKey: ["m-group-prices"] });
        }} />

      {editAllStock && (
        <MyStockEditDialog
          ticker={editAllStock.ticker}
          name={editAllStock.name}
          onClose={() => setEditAllStock(null)}
          onChanged={() => {
            void queryClient.invalidateQueries({ queryKey: ["m-holdings"] });
            void queryClient.invalidateQueries({ queryKey: ["m-group-prices"] });
          }} />
      )}

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
            todayBar={(() => { const p = groupPriceMap.get(valuationTicker); return p ? { open: p.open, high: p.high, low: p.low } : undefined; })()}
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
                📁 {tabMenu.label}
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
              }}
              className="w-full px-4 py-3.5 text-left text-sm
                         hover:bg-gray-50 border-b flex items-center gap-3">
              <Settings size={18} strokeWidth={2.2} className="text-slate-700" />
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
  groups: string[];   // 폴더 관리용 사용자 그룹 목록
}

function SettingsModal({
  proxyUrl, setProxyUrl, savedMsg, setSavedMsg, onClose, groups: mgmtGroups,
}: SettingsModalProps) {
  const downOnBackdropRef = useRef(false);
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [dataMsg, setDataMsg] = useState("");
  const [folderDraft, setFolderDraft] = useState<GroupFolder[]>([]);
  const [newFolderName, setNewFolderName] = useState("");
  const [pollMs, setPollMs] = useState(getPersonalPollMs());
  const [syncStateLocal, setSyncStateLocal] = useState(getSyncState());
  const [syncBusyLocal, setSyncBusyLocal] = useState(false);
  const [syncBusyMsgLocal, setSyncBusyMsgLocal] = useState("");
  const [lastSyncedAtLocal, setLastSyncedAtLocal] = useState<string | null>(getLastSyncedAt());

  // 모달 열릴 때 현재 데이터 export 해서 textarea 채움
  // + 토큰 만료 감지 시 자동 logout
  useEffect(() => {
    void (async () => {
      setFolderDraft(getGroupFolders());
      const data = await exportAll();
      setDataMsg(`현재: 종목 ${data.holdings.length}건`);

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
    setSavedMsg(ms === 0
      ? "✅ 수동 모드 — 자동 갱신 끔 (갱신 버튼/탭 진입 시). 새로고침 후 적용"
      : `✅ 폴링 주기 ${ms / 1000}초 적용 — 새로고침 후 적용`);
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

  // 파일로 저장 — 현재 데이터를 .json 다운로드
  const handleDownloadFile = async () => {
    const data = await exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `portfolio_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setDataMsg("💾 파일로 저장됨");
  };

  // 파일에서 불러오기 — 파싱 → 확인 → 전체 덮어쓰기
  const handleLoadFile = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      let parsed;
      try { parsed = detectPortfolioJson(await f.text()); }
      catch { window.alert("❌ 파일 읽기 실패"); return; }
      if (!parsed || parsed.kind === "error") {
        window.alert(`❌ 불러올 수 없는 파일입니다\n${parsed?.kind === "error" ? parsed.error : ""}`);
        return;
      }
      if (!window.confirm(
        "이 파일로 덮어쓸까요?\n현재 보유·예수금·그룹·폴더·탭 등 모든 데이터/설정이 교체됩니다."
      )) return;
      setBusy(true);
      try {
        if (parsed.kind === "holdings" || parsed.kind === "combined") await replaceAllHoldings(parsed.stocks);
        if (parsed.kind === "peaks" || parsed.kind === "combined") await replaceAllPeaks(parsed.peaks);
        if (parsed.kind === "holdings" || parsed.kind === "combined") {
          applyImportedSettings(parsed.settings);
          if (parsed.memos) await replaceAllMemos(parsed.memos);
          if (parsed.trades) await replaceAllTrades(parsed.trades);
        }
        onClose();
        location.reload();
      } catch (e) {
        window.alert(`❌ 적용 실패: ${e instanceof Error ? e.message : ""}`);
        setBusy(false);
      }
    };
    input.click();
  };

  // 폴더 관리 — 즉시 저장
  const persistFolders = (next: GroupFolder[]) => {
    setFolderDraft(next);
    setGroupFolders(next);
  };
  const addFolder = () => {
    const n = newFolderName.trim();
    if (!n || folderDraft.some(f => f.name === n)) return;
    persistFolders([...folderDraft, { name: n, groups: [] }]);
    setNewFolderName("");
  };
  const toggleGroupInFolder = (folderName: string, group: string, checked: boolean) => {
    persistFolders(folderDraft.map(f => {
      if (f.name === folderName) {
        return { ...f, groups: checked ? Array.from(new Set([...f.groups, group])) : f.groups.filter(g => g !== group) };
      }
      return checked ? { ...f, groups: f.groups.filter(g => g !== group) } : f;
    }));
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
        <header className="px-4 py-3 border-b bg-gray-50 flex items-center gap-2">
          <h2 className="text-base font-bold">⚙️ 설정</h2>
          {/* 개발이력 — GitHub commit 로그 (외부 링크: 새 탭). 헤더 우측 border 박스 */}
          <a href="https://github.com/hanjungwoo3/portfolio-web/commits/main/"
             target="_blank" rel="noopener noreferrer"
             className="ml-auto inline-flex items-center gap-1 px-2 py-1
                        border border-blue-200 rounded
                        text-[10px] text-blue-700 bg-blue-50/50 whitespace-nowrap">
            GitHub 변경/수정 commit 목록 <span className="text-[9px]">↗</span>
          </a>
          <button onClick={onClose}
                  className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </header>
        <div className="px-4 py-3 space-y-4 overflow-y-auto flex-1">

          {/* 0) Google Drive 동기화 */}
          <div className="border border-gray-200 rounded p-3 bg-emerald-50/40 space-y-1.5">
            <div className="text-xs font-bold text-gray-700">
              💾 Google Drive 동기화
            </div>
            <div className="text-[11px] text-gray-500 leading-relaxed">
              내 드라이브에 수동으로 업로드/다운로드해 여러 기기에서 공유합니다.
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
                🔐 Google 로그인
              </button>
            )}
            {(syncStateLocal === "on" || syncStateLocal === "off") && (
              <div className="space-y-1.5">
                {/* 자동 동기화 제거됨 — 수동 업/다운로드만 */}
                {lastSyncedAtLocal && (
                  <div className="text-[11px] text-gray-500">
                    마지막 동기화: {new Date(lastSyncedAtLocal).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </div>
                )}
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

          {/* 파일 백업 — GD 아래 (PC 동일 위치) */}
          <div className="border border-gray-200 rounded p-3 space-y-2">
            <label className="text-xs font-bold text-gray-700 block">📁 파일 백업 (전체 데이터·설정)</label>
            <div className="flex gap-1.5">
              <button onClick={() => void handleDownloadFile()}
                      className="flex-1 px-2 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs rounded">
                💾 파일로 저장
              </button>
              <button onClick={handleLoadFile} disabled={busy}
                      className="flex-1 px-2 py-1.5 bg-gray-100 hover:bg-gray-200 disabled:opacity-40
                                 text-gray-700 text-xs rounded">
                📂 파일 불러오기
              </button>
            </div>
            <p className="text-[10px] text-gray-500">{dataMsg || "보유·예수금·그룹·폴더·탭 등 .json 백업/복원 (불러오기 = 전체 덮어쓰기)"}</p>
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
                const active = pollMs === ms;
                // 수동(0)·공개 허용 주기(30초 이상=30/60초)는 프록시 무관 선택 가능.
                const enabled = ms === 0 || ms >= PUBLIC_MIN_POLL_MS ? true : !!proxyUrl;
                return (
                  <button key={ms}
                          onClick={() => handlePollChange(ms)}
                          disabled={!enabled}
                          className={`px-2 py-0.5 text-[11px] rounded border transition
                                      ${active
                                        ? "bg-blue-600 text-white border-blue-700 font-bold"
                                        : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}
                                      ${!enabled ? "opacity-40 cursor-not-allowed" : ""}`}>
                    {ms === 0 ? "수동" : `${ms / 1000}초`}
                  </button>
                );
              })}
              {!proxyUrl && (
                <span className="text-[10px] text-gray-400 w-full mt-0.5">
                  (공개: 기본 60초 · 30·60·수동 선택 · 5·10초는 전용 프록시)
                </span>
              )}
            </div>

            {/* 이 브라우저 호출량 — 일자별 (cache 히트 제외) */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[11px] text-gray-600">
              <span className="text-gray-500">이 브라우저 호출</span>
              <span className="tabular-nums">
                오늘 <b className="text-gray-800">{getTodayProxyCalls().toLocaleString()}</b>회
              </span>
              <span className="tabular-nums">
                최근 7일 <b className="text-gray-800">{getRecentProxyCalls(7).toLocaleString()}</b>회
              </span>
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

            {/* 시스템 탭 표시/숨김 — 지수/반도체/내주식.
                모달 닫힐 때 groupTabs useMemo 재계산되어 반영됨. */}
            <div className="mt-3 pt-2 border-t border-gray-200">
              <div className="text-[11px] text-gray-700 font-medium mb-1.5">
                상단 탭 표시
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {([
                  { key: "usMarket" as const, label: "📈 지수", icon: null as ReactNode | null, cls: "" },
                  { key: "sectorRank" as const, label: "🧩 섹터", icon: null, cls: "" },
                  { key: "semiCheck" as const, label: "반도체",
                    icon: <Cpu size={12} strokeWidth={2.2} className="text-slate-600" />, cls: "" },
                  { key: "consensus" as const, label: "🎯 컨센서스", icon: null, cls: "" },
                  { key: "etfReverse" as const, label: "🍱 ETF", icon: null, cls: "" },
                  // 내주식 / 내거래 — 묶음에서 빠진 개별 탭이라 구분선 뒤(오른쪽)에 한 묶음
                  { key: "myStocks" as const, label: "📦 내주식", icon: null, cls: "pl-3 ml-1 border-l border-gray-200" },
                  { key: "myTrades" as const, label: "🧾 내거래", icon: null, cls: "" },
                ]).map(({ key, label, icon, cls }) => (
                  <label key={key} className={`flex items-center gap-1.5 cursor-pointer select-none ${cls}`}>
                    <input type="checkbox" defaultChecked={getTabVisibility()[key]}
                           onChange={e => {
                             setTabVisibility({ [key]: e.target.checked });
                             setSavedMsg(`✅ ${label}: ${e.target.checked ? "표시" : "숨김"}`);
                             setTimeout(() => setSavedMsg(""), 2000);
                           }}
                           className="w-4 h-4 accent-blue-600" />
                    <span className="text-[11px] text-gray-700 inline-flex items-center gap-1">
                      {icon}{label}
                    </span>
                  </label>
                ))}
              </div>
              <div className="text-[10px] text-gray-500 mt-1">
                꺼두면 해당 탭이 상단에서 사라집니다 (모달 닫을 때 반영).
              </div>
            </div>
          </div>

          {/* 그룹 폴더 관리 */}
          {mgmtGroups.length > 0 && (
            <div className="border border-gray-200 rounded p-3 space-y-2">
              <label className="text-xs font-bold text-gray-700 block">📁 그룹 폴더</label>
              {folderDraft.map(f => (
                <div key={f.name} className="border border-gray-200 rounded p-2">
                  <div className="flex items-center mb-1">
                    <span className="text-xs font-bold text-gray-800">📁 {f.name}</span>
                    <button onClick={() => persistFolders(folderDraft.filter(x => x.name !== f.name))}
                            className="ml-auto text-[10px] text-rose-500">삭제</button>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {mgmtGroups.map(g => (
                      <label key={g} className="flex items-center gap-1">
                        <input type="checkbox" checked={f.groups.includes(g)}
                               onChange={e => toggleGroupInFolder(f.name, g, e.target.checked)}
                               className="w-3.5 h-3.5 accent-blue-600" />
                        <span className="text-[11px] text-gray-700">{g}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              <div className="flex items-center gap-1.5">
                <input value={newFolderName} onChange={e => setNewFolderName(e.target.value)}
                       placeholder="새 폴더 이름"
                       className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs
                                  focus:outline-none focus:border-blue-400" />
                <button onClick={addFolder}
                        className="px-2.5 py-1 bg-blue-600 text-white rounded text-xs font-medium">추가</button>
              </div>
              <div className="text-[10px] text-gray-500">
                폴더에 담은 그룹은 상단 탭에서 📁 드롭다운으로 묶여 보입니다. (모달 닫을 때 반영)
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
