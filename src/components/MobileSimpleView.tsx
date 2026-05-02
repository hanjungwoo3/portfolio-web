import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchYahooBatch, fetchTossPrices, fetchNaverInfo, fetchWarning,
  fetchYahooChart, fetchKrPriceHistory,
} from "../lib/api";
import {
  US_PAIRS, SECTOR_EMOJI, SECTOR_ORDER,
} from "../lib/usMarketData";
import { signColor, isSymbolSleeping } from "../lib/format";
import {
  getPersonalProxyUrl, setPersonalProxyUrl,
  getEffectivePollMs, getPersonalPollMs, setPersonalPollMs, POLL_OPTIONS,
  getDimSleepingEnabled, setDimSleepingEnabled,
} from "../lib/proxyConfig";
import { useAdaptiveRefreshMs } from "../lib/proxyStatus";
import { RefreshIndicator } from "./RefreshIndicator";
import { OnboardingDialog } from "./OnboardingDialog";
import {
  exportAll, replaceAllHoldings, replaceAllPeaks, loadHoldings, loadPeaks,
  deleteAllRowsForTicker, renameGroup, deleteGroup,
} from "../lib/db";
import { detectPortfolioJson } from "../lib/portfolioImport";
import { MobileStockCard } from "./MobileStockCard";
import { TotalRow } from "./TotalRow";
import { SearchDialog } from "./SearchDialog";
import { EditHoldingDialog } from "./EditHoldingDialog";
import { HelpDialog, markHelpSeen, shouldShowHelpFirstTime } from "./HelpDialog";
import { Sparkline } from "./Sparkline";
import type { Stock } from "../types";

const US_KEY = "__us__";  // 미국 증시 탭 키
const TAB_KEY = "portfolio-mobile-active-tab";  // 마지막 활성 탭 기억
const KAKAOPAY_URL = "https://qr.kakaopay.com/FCscirjeF";

// 모바일 전용 단순 뷰 (v2 데스크톱 미국증시 표 형식 그대로 이식)
// 자동 갱신 X — 새로고침 버튼만. 자기 주식/그룹/검색 등 모든 추가 기능 없음.

function fmtPrice(symbol: string, price: number): string {
  if (symbol === "^TNX" || symbol === "^VIX") return price.toFixed(2);
  if (symbol.includes("KRW")) return price.toFixed(2);
  if (price >= 1000) return Math.round(price).toLocaleString();
  return price.toFixed(2);
}

interface QuoteRow {
  kind: "spot" | "future";
  symbol: string;
  name: string;
  desc?: string;
  price?: number;
  pct?: number;
  diff?: number;
  sleeping: boolean;
}

export function MobileSimpleView() {
  const queryClient = useQueryClient();
  const [proxyUrl, setProxyUrl] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [editing, setEditing] = useState<Stock | null>(null);
  const [savedMsg, setSavedMsg] = useState("");
  // 그룹 탭 길게 누르기 → 액션 시트 (이름 변경 / 삭제)
  const [tabMenu, setTabMenu] = useState<{ key: string; label: string } | null>(null);
  const longPressTimer = useRef<number | null>(null);

  // 첫 방문 자동 노출 (1.5초 지연)
  useEffect(() => {
    if (!shouldShowHelpFirstTime()) return;
    const t = setTimeout(() => setHelpOpen(true), 1500);
    return () => clearTimeout(t);
  }, []);
  const [activeTab, setActiveTab] = useState<string>(() => {
    if (typeof localStorage === "undefined") return US_KEY;
    return localStorage.getItem(TAB_KEY) ?? US_KEY;
  });
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

  // 그룹 목록 (account 별 카운트) — 미국증시 + 보유 + 사용자 그룹들
  const groupTabs = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of holdings) {
      const acc = s.account || "";
      counts.set(acc, (counts.get(acc) || 0) + 1);
    }
    const tabs: { key: string; label: string; count: number }[] = [
      { key: US_KEY, label: "미국증시", count: 0 },
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

  // 저장된 탭이 더이상 없으면 (그룹 삭제 등) 미국증시로 fallback
  useEffect(() => {
    if (groupTabs.length === 0) return;
    if (!groupTabs.some(t => t.key === activeTab)) {
      setActiveTab(US_KEY);
    }
  }, [groupTabs, activeTab]);

  // 선택된 그룹 종목들 (활성 탭이 그룹일 때만)
  const groupHoldingsUnsorted = useMemo(() => {
    if (activeTab === US_KEY) return [];
    return holdings.filter(s => (s.account || "") === activeTab);
  }, [holdings, activeTab]);

  // 그룹 종목들의 KR 가격 fetch (수동 갱신만)
  const groupTickers = groupHoldingsUnsorted
    .filter(s => /^\d{6}$/.test(s.ticker))
    .map(s => s.ticker);
  const { data: groupPrices, dataUpdatedAt: groupAt } = useQuery({
    queryKey: ["m-group-prices", activeTab, groupTickers.join(",")],
    queryFn: () => fetchTossPrices(groupTickers),
    enabled: activeTab !== US_KEY && groupTickers.length > 0,
    refetchInterval: REFRESH_MS,
  });
  const groupPriceMap = new Map((groupPrices ?? []).map(p => [p.ticker, p]));

  // 비거래일 감지 (PC 와 동일) — 첫 종목 high 없으면 비거래일
  const groupNonTrading = (groupPrices?.length ?? 0) > 0 && !groupPrices?.[0]?.high;
  // 비거래일에만 일봉 차트 fetch — 카드 가격 박스 sparkline (PC 와 캐시 키 공유)
  const groupChartQs = useQueries({
    queries: groupTickers.map(t => ({
      queryKey: ["kr-price-history", t, "3mo"],
      queryFn: () => fetchKrPriceHistory(t, "3mo"),
      staleTime: 60 * 60 * 1000,
      refetchOnWindowFocus: false,
      enabled: activeTab !== US_KEY && groupNonTrading,
    })),
  });
  const groupChartMap = new Map(
    groupChartQs.map((q, i) =>
      [groupTickers[i], (q.data ?? []).map(p => p.close)]
    )
  );

  // 어제보다 % 내림차순 정렬 — sleeping (거래 안 됨, base = price) 은 항상 맨 아래
  const groupHoldings = useMemo(() => {
    return [...groupHoldingsUnsorted].sort((a, b) => {
      const pa = groupPriceMap.get(a.ticker);
      const pb = groupPriceMap.get(b.ticker);
      const aSleep = !pa || pa.base <= 0 || pa.price === pa.base;
      const bSleep = !pb || pb.base <= 0 || pb.price === pb.base;
      if (aSleep !== bSleep) return aSleep ? 1 : -1;
      const pctA = pa && pa.base > 0 ? (pa.price - pa.base) / pa.base : 0;
      const pctB = pb && pb.base > 0 ? (pb.price - pb.base) / pb.base : 0;
      return pctB - pctA;
    });
  }, [groupHoldingsUnsorted, groupPriceMap]);

  // 종목별 위험 뱃지 (위험/관리/정지/경고/과열/환기/주의)
  const warningQs = useQueries({
    queries: groupTickers.map(t => ({
      queryKey: ["m-warning", t],
      queryFn: () => fetchWarning(t),
      enabled: activeTab !== US_KEY,
      refetchInterval: REFRESH_MS,
    })),
  });
  const warningMap = new Map(
    groupTickers.map((t, i) => [t, warningQs[i]?.data ?? ""])
  );

  // 종목별 sector (Naver) — 그룹 탭에서만 fetch (캐시)
  const naverInfos = useQuery({
    queryKey: ["m-naver-info", groupTickers.join(",")],
    queryFn: async () => {
      const map = new Map<string, { sector?: string }>();
      await Promise.all(groupTickers.map(async t => {
        try {
          const info = await fetchNaverInfo(t);
          if (info) map.set(t, info);
        } catch { /* ignore */ }
      }));
      return map;
    },
    enabled: activeTab !== US_KEY && groupTickers.length > 0,
    refetchOnWindowFocus: false,
  });

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
  const lastAt = activeTab === US_KEY ? usAt : (groupAt ?? 0);

  const handleRefresh = () => location.reload();

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
  const t0ChartMap = new Map(
    tier0.map((p, i) => [p.symbol, t0ChartQs[i]?.data ?? []])
  );

  // ─── 섹터별 행 묶음 (현물 + 선물만, ETF 제외) ───
  function buildRowsForSector(sector: string): QuoteRow[] {
    const rows: QuoteRow[] = [];
    const sectorPairs = US_PAIRS.filter(p => p.tier !== "T0" && p.sector === sector);

    // 1) 현물
    for (const p of sectorPairs) {
      const q = usMap?.get(p.symbol);
      rows.push({
        kind: "spot", symbol: p.symbol, name: p.name, desc: p.desc,
        price: q?.price, pct: q?.pct, diff: q?.diff,
        sleeping: isSymbolSleeping(p.symbol),
      });
    }
    // 2) 선물 (현물들 다음에 모아서, 옅은 노랑 배경)
    for (const p of sectorPairs) {
      if (!p.future) continue;
      const fq = usMap?.get(p.future);
      rows.push({
        kind: "future", symbol: p.future, name: `${p.name} 선물`,
        desc: `${p.name} 선물 — 정규장 외 흐름 체크`,
        price: fq?.price, pct: fq?.pct, diff: fq?.diff,
        sleeping: isSymbolSleeping(p.future),
      });
    }
    return rows;
  }

  // 장 마감 시 흐리게 표시 여부 (설정값)
  const dimEnabled = getDimSleepingEnabled();

  return (
    <div className="min-h-screen bg-gray-50"
         onTouchStart={handleTouchStart}
         onTouchEnd={handleTouchEnd}>
      <header className="sticky top-0 z-10 bg-white border-b border-gray-200
                          px-3 py-2 flex items-center gap-1">
        <h1 className="text-sm font-bold text-gray-800 shrink-0">📈</h1>
        <RefreshIndicator dataUpdatedAt={lastAt}
                          refetchIntervalMs={REFRESH_MS} />
        <button onClick={handleRefresh}
                disabled={isFetching}
                title="새로고침 (페이지 reload)"
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
      <nav className="sticky top-[44px] z-10 bg-white border-b border-gray-200
                       px-2 py-1 flex gap-1 overflow-x-auto whitespace-nowrap">
        {groupTabs.map(t => {
          const active = t.key === activeTab;
          // 시스템 탭(미국 증시)은 길게 누르기 무시
          const editable = t.key !== US_KEY;
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

      {/* ─── 그룹 컨텐츠 (US_KEY 외) ─── */}
      {activeTab !== US_KEY && (
        <>
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
                               onEdit={st => setEditing(st)}
                               onDelete={async st => {
                                 if (!confirm(
                                   `"${st.name}" 을(를) 삭제할까요?\n`
                                   + `(모든 그룹에서 제거됩니다)`
                                 )) return;
                                 await deleteAllRowsForTicker(st.ticker);
                                 void queryClient.invalidateQueries({ queryKey: ["m-holdings"] });
                                 void queryClient.invalidateQueries({ queryKey: ["m-peaks"] });
                                 void queryClient.invalidateQueries({ queryKey: ["m-group-prices"] });
                               }} />
            ))}
          </div>
          {/* 합계 — 화면 하단 fixed (항상 보임) */}
          {groupHoldings.length > 0 && (
            <div className="fixed bottom-0 left-0 right-0 z-20
                             bg-white/95 backdrop-blur
                             border-t border-gray-300 shadow-lg
                             px-3 py-2 flex justify-center">
              <TotalRow holdings={groupHoldings} prices={groupPriceMap} />
            </div>
          )}
        </>
      )}

      {/* ─── 미국 증시 (default) ─── */}
      {activeTab === US_KEY && (<>

      {/* ─── Tier 0 핵심 대시보드 (2 columns 카드) ─── */}
      <div className="px-3 py-2 grid grid-cols-2 gap-2">
        {tier0.map(p => {
          const q = usMap?.get(p.symbol);
          const sleeping = isSymbolSleeping(p.symbol);
          // 표와 동일한 +/- 행 배경 + 색상
          const bg =
            q && q.diff > 0 ? "bg-rose-50 border-rose-200"
            : q && q.diff < 0 ? "bg-blue-50/70 border-blue-200"
            : "bg-white border-gray-200";
          const sign = q ? signColor(q.diff) : "text-gray-400";
          return (
            <div key={p.symbol}
                 className={`relative overflow-hidden flex flex-col gap-0.5
                              rounded-lg border px-3 py-2 min-h-[110px]
                              ${bg} ${sleeping && dimEnabled ? "opacity-60" : ""}`}>
              {/* 60일 추이 — 카드 전체 배경 워터마크 */}
              <Sparkline data={t0ChartMap.get(p.symbol) ?? []}
                         color={q && q.diff > 0 ? "#dc2626"
                                : q && q.diff < 0 ? "#2563eb"
                                : "#94a3b8"}
                         width={300} height={110}
                         className="absolute inset-0 w-full h-full opacity-50
                                    pointer-events-none" />
              <div className="relative z-10 flex items-baseline gap-1.5">
                {sleeping && (
                  <span className="text-[11px] text-gray-400">zZ</span>
                )}
                <span className="text-base font-bold text-gray-900">
                  {p.name}
                </span>
              </div>
              <div className="relative z-10 text-[11px] text-gray-500 truncate">
                {p.desc}
              </div>
              <div className="relative z-10 flex items-baseline mt-auto pt-3">
                <span className="flex-1 text-left text-sm tabular-nums text-gray-700">
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
      </div>

      {/* ─── 섹터별 표 카드 ─── */}
      <div className="px-3 pb-2 space-y-2">
        {SECTOR_ORDER.map(sector => {
          const rows = buildRowsForSector(sector);
          if (rows.length === 0) return null;
          return (
            <table key={sector}
                   className="w-full table-fixed bg-white rounded-lg border border-gray-200
                               overflow-hidden text-sm">
              <colgroup>
                <col style={{ width: "64px" }} />
                <col />
                <col style={{ width: "70px" }} />
                <col style={{ width: "80px" }} />
              </colgroup>
              <tbody>
                {rows.map((r, idx) => {
                  const isFirst = idx === 0;
                  const sign = r.diff !== undefined ? signColor(r.diff) : "text-gray-400";
                  const rowBg =
                    r.diff !== undefined && r.diff > 0 ? "bg-rose-50"
                    : r.diff !== undefined && r.diff < 0 ? "bg-blue-50/70"
                    : "";
                  return (
                    <tr key={`${sector}-${r.symbol}`}
                        className={`${idx < rows.length - 1 ? "border-b border-gray-100" : ""}
                                     ${rowBg}
                                     ${r.sleeping && dimEnabled ? "opacity-60" : ""}`}>
                      {isFirst ? (
                        <td className="px-2 py-2 font-bold text-gray-800 align-middle
                                        bg-slate-200 border-r border-gray-300 w-16"
                            rowSpan={rows.length}>
                          <div className="flex flex-col items-center gap-0.5">
                            <span className="text-2xl">{SECTOR_EMOJI[sector] ?? "📊"}</span>
                            <span className="text-xs font-bold">{sector}</span>
                          </div>
                        </td>
                      ) : null}
                      <td className="px-2 py-2">
                        <div className="flex items-baseline gap-1">
                          {r.sleeping && (
                            <span className="text-[10px] text-gray-400">zZ</span>
                          )}
                          <span className={`text-base font-bold
                                            ${r.kind === "future" ? "text-amber-700"
                                              : "text-gray-900"}`}>
                            {r.name}
                          </span>
                        </div>
                        {r.desc && (
                          <div className="text-[11px] text-gray-500 truncate
                                            max-w-[180px] mt-0.5">
                            {r.desc}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-gray-900 font-medium">
                        {r.price !== undefined ? fmtPrice(r.symbol, r.price) : "—"}
                      </td>
                      <td className={`px-2 py-2 text-right tabular-nums text-base font-bold w-24 ${sign}`}>
                        {r.pct !== undefined && Math.abs(r.pct) >= 0.005
                          ? `${r.pct >= 0 ? "+" : ""}${r.pct.toFixed(2)}%`
                          : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          );
        })}
        <div className="text-[10px] text-gray-400 text-center mt-3 mb-2">
          {Math.round(REFRESH_MS / 1000)}초마다 자동 갱신
        </div>
      </div>
      </>)}

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
        }} />

      {/* 첫 접속 안내 팝업 — 전용 프록시 미설정 시 자동 표시 */}
      <OnboardingDialog onOpenSettings={() => setSettingsOpen(true)} />

      <HelpDialog
        isOpen={helpOpen}
        onClose={() => { markHelpSeen(); setHelpOpen(false); }}
        variant="mobile"
      />

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
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [dataMsg, setDataMsg] = useState("");
  const [pollMs, setPollMs] = useState(getPersonalPollMs());

  // 모달 열릴 때 현재 데이터 export 해서 textarea 채움
  useEffect(() => {
    void (async () => {
      const data = await exportAll();
      setRaw(JSON.stringify(data, null, 2));
      setDataMsg(`현재: 종목 ${data.holdings.length}건 / 피크 ${Object.keys(data.peaks).length}건`);
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
      <div className="bg-white rounded-lg shadow-xl w-full max-w-sm
                       max-h-[90vh] flex flex-col">
        <header className="px-4 py-3 border-b bg-gray-50 flex items-center">
          <h2 className="text-base font-bold">⚙️ 설정</h2>
          <button onClick={onClose}
                  className="ml-auto text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </header>
        <div className="px-4 py-3 space-y-4 overflow-y-auto flex-1">

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
