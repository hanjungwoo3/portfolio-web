import { useEffect, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider, useQueries, useQuery } from "@tanstack/react-query";
import {
  fetchTossPrices, fetchInvestorHistory, pickTodayInvestor,
  fetchWarning, fetchNaverInfo, fetchKrPriceHistory,
  fetchInvestorHistorySafe,
} from "./lib/api";
import { loadHoldings, loadPeaks, updatePeaksForward, removeHolding, renameGroup, deleteGroup, cleanupReservedAccounts } from "./lib/db";
import { StockCard } from "./components/StockCard";
import { Tabs, buildTabs, filterByTab, US_MARKET_TAB_KEY } from "./components/Tabs";
import { TotalRow } from "./components/TotalRow";
import { SettingsDialog } from "./components/SettingsDialog";
import { OnboardingDialog } from "./components/OnboardingDialog";
import { SearchDialog } from "./components/SearchDialog";
import { EditHoldingDialog } from "./components/EditHoldingDialog";
import { UsMarketTab } from "./components/UsMarketTab";
import { RefreshIndicator } from "./components/RefreshIndicator";
import { VersionBadge } from "./components/VersionBadge";
import { ProxyStatusBadge } from "./components/ProxyStatusBadge";
import { useAdaptiveRefreshMs } from "./lib/proxyStatus";
import { reportRefresh, useLastRefresh } from "./lib/lastRefresh";
import { getEffectivePollMs, getPersonalProxyUrl } from "./lib/proxyConfig";
import { ValuationModal } from "./components/ValuationModal";
import { MobileSimpleView } from "./components/MobileSimpleView";
import { HelpDialog, markHelpSeen, shouldShowHelpFirstTime } from "./components/HelpDialog";
import { TALLY_URL, isFeedbackEnabled } from "./lib/feedbackConfig";
import type { Stock } from "./types";

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

// 카카오페이 송금받기 링크 (모바일/카카오톡 deep link)
const KAKAOPAY_URL = "https://qr.kakaopay.com/FCscirjeF";
const QR_IMG_URL = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(KAKAOPAY_URL)}`;

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
  const [peaks, setPeaks] = useState<Map<string, number>>(new Map());
  const [activeTab, setActiveTab] = useState<string>("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [valuationTicker, setValuationTicker] = useState<string | null>(null);
  const [editing, setEditing] = useState<Stock | null>(null);
  const [donateOpen, setDonateOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  // 첫 방문 자동 노출 — 1.5초 지연 (다른 모달과 충돌 회피)
  useEffect(() => {
    if (!shouldShowHelpFirstTime()) return;
    const t = setTimeout(() => setHelpOpen(true), 1500);
    return () => clearTimeout(t);
  }, []);
  // 설정 변경 시 reloadKey 증가 → BASE_REFRESH_MS / usePersonalProxy 재계산
  const BASE_REFRESH_MS = useMemo(() => getEffectivePollMs(), [reloadKey]);
  const usePersonalProxy = useMemo(() => !!getPersonalProxyUrl(), [reloadKey]);
  const REFRESH_MS = useAdaptiveRefreshMs(BASE_REFRESH_MS);

  // IndexedDB 로드
  useEffect(() => {
    void (async () => {
      // 잔여 관심ETF 항목 청소 (web v3는 섹터 매핑을 코드 상수로 사용)
      const removed = await cleanupReservedAccounts();
      const [h, p] = await Promise.all([loadHoldings(), loadPeaks()]);
      // eslint-disable-next-line no-console
      console.log(`[v3 load] holdings=${h.length}, peaks=${p.size}, cleaned=${removed}`);
      setHoldings(h);
      setPeaks(p);
    })();
  }, [reloadKey]);

  const tabs = useMemo(() => buildTabs(holdings), [holdings]);

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
      .filter(t => /^\d{6}$/.test(t)),
    [visible]
  );

  // 가격 — 5초 polling
  const { data: prices, dataUpdatedAt: pricesUpdatedAt } = useQuery({
    queryKey: ["prices", krxTickers],
    queryFn: () => fetchTossPrices(krxTickers),
    enabled: krxTickers.length > 0,
    refetchInterval: REFRESH_MS,
  });

  // 가격 갱신 시 피크가 forward-only 업데이트 (저장된 피크 < 현재가면 갱신)
  useEffect(() => {
    if (!prices || prices.length === 0) return;
    const priceMap = new Map(prices.map(p => [p.ticker, p.price]));
    void updatePeaksForward(priceMap).then(updated => {
      if (updated > 0) {
        // peaks 갱신됐으면 메모리 상 peaks 도 동기화
        void loadPeaks().then(setPeaks);
      }
    });
  }, [prices]);

  // 갱신 시각 글로벌 보고
  useEffect(() => {
    if (pricesUpdatedAt > 0) reportRefresh(pricesUpdatedAt);
  }, [pricesUpdatedAt]);

  // 어제대비 % 내림차순 정렬 — sleeping (거래 안 된 종목) 은 항상 맨 아래
  // (base === price 인 경우 = 새 거래일 시작 전 / 거래 정지 등 → -% 종목보다 아래로)
  const sortedVisible = useMemo(() => {
    const map = new Map((prices ?? []).map(p => [p.ticker, p]));
    return [...visible].sort((a, b) => {
      const pa = map.get(a.ticker);
      const pb = map.get(b.ticker);
      const aSleep = !pa || pa.base <= 0 || pa.price === pa.base;
      const bSleep = !pb || pb.base <= 0 || pb.price === pb.base;
      if (aSleep !== bSleep) return aSleep ? 1 : -1;  // sleeping 맨 아래
      const pctA = pa && pa.base > 0 ? (pa.price - pa.base) / pa.base : 0;
      const pctB = pb && pb.base > 0 ? (pb.price - pb.base) / pb.base : 0;
      return pctB - pctA;
    });
  }, [visible, prices]);

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

  // 비거래일 감지 — 첫 종목 가격에 high 가 없으면 거래일 아님 (fetchTossPrices 가 undefined 처리)
  const isNonTradingDay = (prices?.length ?? 0) > 0 && !prices?.[0]?.high;
  // 비거래일에만 일봉 차트 fetch (3개월) — 1시간 캐시, 카드 가격 박스에 작은 sparkline
  const chartQs = useQueries({
    queries: krxTickers.map(t => ({
      queryKey: ["kr-price-history", t, "3mo"],
      queryFn: () => fetchKrPriceHistory(t, "3mo"),
      staleTime: 60 * 60 * 1000,
      refetchOnWindowFocus: false,
      enabled: isNonTradingDay,
    })),
  });

  const priceMap = useMemo(
    () => new Map((prices ?? []).map(p => [p.ticker, p])),
    [prices]
  );
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
  const chartMap = useMemo(
    () => new Map(chartQs.map((q, i) =>
      [krxTickers[i], (q.data ?? []).map(p => p.close)]
    )),
    [chartQs, krxTickers]
  );

  return (
    <div className="min-h-screen bg-gray-50">
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
            <VersionBadge />
            <button
              onClick={() => setSearchOpen(true)}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700
                         text-white rounded text-sm">
              🔍 검색
            </button>
            <button
              onClick={() => setHelpOpen(true)}
              title="사용법 빠른 시작"
              className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200
                         text-gray-700 rounded text-sm">
              ❓ 사용법
            </button>
            {isFeedbackEnabled() && (
              <a href={TALLY_URL} target="_blank" rel="noopener noreferrer"
                 title="피드백 보내기 (버그/제안/질문)"
                 className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100
                            text-emerald-700 rounded text-sm border border-emerald-200">
                💬 피드백
              </a>
            )}
            <button
              onClick={() => setDonateOpen(true)}
              title="개발자 후원하기 (카카오페이)"
              className="px-2 py-1 rounded text-xs flex items-center gap-1
                         text-gray-400 opacity-60 hover:opacity-100
                         hover:text-gray-600 transition">
              <span className="opacity-50">☕</span>
              <span className="hidden sm:inline">개발자 후원하기</span>
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200
                         text-gray-700 rounded text-sm">
              ⚙️ 설정
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
               }} />

        {activeTab === US_MARKET_TAB_KEY ? (
          <UsMarketTab />
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
            <div className="text-center py-10 text-gray-500">
              이 탭에는 종목이 없습니다.
            </div>
          )
        ) : (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              {sortedVisible.map(stock => (
                <StockCard
                  key={`${stock.ticker}_${stock.account || ""}`}
                  stock={stock}
                  price={priceMap.get(stock.ticker)}
                  investor={investorMap.get(stock.ticker)}
                  investorHistory={investorHistoryMap.get(stock.ticker)}
                  warning={warningMap.get(stock.ticker)}
                  sector={naverMap.get(stock.ticker)?.sector}
                  consensus={naverMap.get(stock.ticker)?.consensus ?? null}
                  peak={peaks.get(stock.ticker)}
                  chart={chartMap.get(stock.ticker)}
                  longHistory={longHistoryMap.get(stock.ticker)}
                  onOpenValuation={setValuationTicker}
                  onEdit={s => setEditing(s)}
                  onDelete={async s => {
                    await removeHolding(s.ticker, s.account || "");
                    setReloadKey(k => k + 1);
                  }}
                />
              ))}
            </div>
            <TotalRow holdings={visible} prices={priceMap} />
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
      />

      <SearchDialog
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        onAdded={() => setReloadKey(k => k + 1)}
      />

      <EditHoldingDialog
        isOpen={!!editing}
        onClose={() => setEditing(null)}
        stock={editing}
        curPrice={editing ? priceMap.get(editing.ticker)?.price : undefined}
        onChanged={() => setReloadKey(k => k + 1)}
      />

      {donateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center
                         bg-black/40 p-4"
             onClick={() => setDonateOpen(false)}>
          <div className="bg-white rounded-lg shadow-xl max-w-sm w-full p-6
                           text-center"
               onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-1">☕ 후원해주셔서 감사합니다</h2>
            <p className="text-xs text-gray-500 mb-4">
              Cloudflare Worker 비용에 보태집니다
            </p>
            <div className="bg-[#FEE500] rounded-lg p-4 inline-block mb-3">
              <img src={QR_IMG_URL} alt="카카오페이 QR" width={200} height={200}
                   className="block mx-auto" />
            </div>
            <p className="text-xs text-gray-600 mb-1">
              📱 <strong>카카오톡 앱</strong>의 QR 스캔이 가장 빠릅니다
            </p>
            <p className="text-[11px] text-gray-400 mb-3">
              카메라/토스로 스캔 시 카카오톡으로 자동 이동
            </p>
            <a href={KAKAOPAY_URL}
               target="_blank" rel="noopener noreferrer"
               className="block px-4 py-2 rounded font-bold text-[#191919]
                          hover:brightness-95"
               style={{ backgroundColor: "#FEE500" }}>
              모바일에서 직접 열기
            </a>
            <button onClick={() => setDonateOpen(false)}
                    className="mt-3 text-sm text-gray-500 hover:text-gray-700">
              닫기
            </button>
          </div>
        </div>
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
          />
        );
      })()}
    </div>
  );
}

// 글로벌 lastRefresh 기반 RefreshIndicator
function RefreshIndicatorGlobal({ refetchIntervalMs }: { refetchIntervalMs: number }) {
  const ts = useLastRefresh();
  if (ts === 0) return null;
  return <RefreshIndicator dataUpdatedAt={ts} refetchIntervalMs={refetchIntervalMs} />;
}

function AppRoot() {
  const isMobile = useIsMobile();
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
