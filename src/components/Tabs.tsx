import { Settings } from "lucide-react";
import type { ReactNode } from "react";
import type { Stock } from "../types";
import { normalizeAccount } from "../lib/account";
import { getIndependentGroupsMode } from "../lib/groupMode";
import type { TabVisibility } from "../lib/tabVisibility";
import type { GroupFolder } from "../lib/groupFolders";

export interface TabSpec {
  key: string;
  label: string;
  emoji?: string;
  icon?: ReactNode;     // SVG 아이콘 (있으면 emoji 보다 우선)
  count: number;
}

interface Props {
  tabs: TabSpec[];
  activeKey: string;
  onChange: (key: string) => void;
  onRename?: (oldName: string, newName: string) => void;
  onDelete?: (name: string) => void;
  folders?: GroupFolder[];   // 그룹 폴더 — 담긴 그룹은 드롭다운 하나로 합쳐 표시
  leading?: ReactNode;       // 탭 바 맨 앞에 끼워넣을 요소 (예: 헤더 펼치기 버튼)
}

export function Tabs({ tabs, activeKey, onChange, onRename, onDelete, folders, leading }: Props) {
  const handleRename = (oldKey: string, displayLabel: string) => {
    const next = window.prompt(`"${displayLabel}" 그룹명 변경 — 새 이름:`, displayLabel);
    if (next == null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === oldKey) return;
    if (RESERVED.has(trimmed)) {
      alert(`"${trimmed}" 은(는) 사용할 수 없는 이름입니다.`);
      return;
    }
    onRename?.(oldKey, trimmed);
  };

  // 폴더 처리 — 담긴 그룹은 개별 탭 숨기고 폴더 드롭다운으로 합침
  const folderList = folders ?? [];
  const countByKey = new Map(tabs.map(t => [t.key, t.count]));
  const presentGroups = new Set(tabs.filter(t => !RESERVED.has(t.key)).map(t => t.key));
  // 폴더에 담긴(표시 가능한) 그룹은 개별 탭에서 숨기고 폴더로 묶어 노출.
  // 멤버 2개 이상 → 폴더명 + 드롭다운 / 1개 → 폴더명 단일 탭(드롭다운 없이 바로 클릭).
  const folderedGroups = new Set<string>();
  for (const f of folderList) for (const g of f.groups) if (presentGroups.has(g)) folderedGroups.add(g);

  // 시스템 탭 묶기 — 섹터~ETF 를 드롭다운 하나로 (증시·지수는 자주 써서 별도 고정 탭으로 분리)
  const sysTabs = tabs.filter(t => SYSTEM_TAB_KEYS.has(t.key)
    && t.key !== US_MARKET_TAB_KEY && t.key !== MARKET_MONEY_TAB_KEY);
  const usMarketTab = tabs.find(t => t.key === US_MARKET_TAB_KEY);
  const marketMoneyTab = tabs.find(t => t.key === MARKET_MONEY_TAB_KEY);
  // 내자산 묶기 — 내주식 + 내거래 드롭다운 하나로
  const myTabs = tabs.filter(t => MY_GROUP_KEYS.has(t.key));

  // 묶음 드롭다운 렌더 (지수/내자산 공통)
  const renderGroupDropdown = (groupTabs: typeof tabs, fallbackEmoji: string) => {
    if (groupTabs.length === 0) return null;
    // 묶을 항목이 1개뿐이면 드롭다운 대신 일반 탭 버튼으로 바로 노출
    if (groupTabs.length === 1) {
      const t = groupTabs[0];
      const active = t.key === activeKey;
      return (
        <button key={t.key}
                onClick={() => onChange(t.key)}
                className={`shrink-0 px-3 py-2 text-sm font-medium rounded-t-md
                            border-b-2 transition-colors -mb-px
                            ${active
                              ? "border-blue-500 text-blue-700 bg-white"
                              : "border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100"}`}>
          {t.icon
            ? <span className="mr-1 inline-flex align-middle">{t.icon}</span>
            : <span className="mr-1">{t.emoji ?? fallbackEmoji}</span>}
          {t.label}
          {t.count > 0 && (
            <span className={`ml-1.5 text-xs ${active ? "text-blue-500" : "text-gray-400"}`}>
              {t.count}
            </span>
          )}
        </button>
      );
    }
    const activeOne = groupTabs.find(t => t.key === activeKey);
    const current = activeOne ? activeKey : groupTabs[0].key;
    const curTab = groupTabs.find(t => t.key === current);
    const on = !!activeOne;
    return (
      <div className={`shrink-0 inline-flex items-center gap-1 pl-2 pr-1 py-1 rounded-t-md border-b-2 -mb-px
                       ${on ? "border-blue-500 bg-white" : "border-transparent hover:bg-gray-100"}`}>
        {curTab?.icon
          ? <span className="inline-flex align-middle">{curTab.icon}</span>
          : <span className="text-sm">{curTab?.emoji ?? fallbackEmoji}</span>}
        <select value={on ? current : ""}
                onChange={e => { if (e.target.value) onChange(e.target.value); }}
                className={`text-sm font-medium bg-transparent border-0 focus:outline-none cursor-pointer
                            ${on ? "text-blue-700" : "text-gray-500 hover:text-gray-700"}`}>
          {!on && <option value="" disabled hidden>{curTab?.label}</option>}
          {groupTabs.map(t => (
            <option key={t.key} value={t.key}>
              {t.label}{t.count > 0 ? ` (${t.count})` : ""}
            </option>
          ))}
        </select>
      </div>
    );
  };

  return (
    <>
    <nav className="flex items-center gap-1 overflow-x-auto overflow-y-hidden whitespace-nowrap
                    border-b border-gray-200 mb-3 px-1 pt-1">
      {leading && <span className="shrink-0">{leading}</span>}
      {/* 섹터~ETF 드롭다운 → 내자산 묶음(내주식·내거래) → 지수 순서 */}
      {renderGroupDropdown(sysTabs, "📊")}
      {renderGroupDropdown(myTabs, "📦")}
      {/* 증시 — 지수 왼쪽 별도 탭 */}
      {marketMoneyTab && (
        <button onClick={() => onChange(marketMoneyTab.key)}
                className={`shrink-0 px-3 py-2 text-sm font-medium rounded-t-md border-b-2 transition-colors -mb-px
                            ${marketMoneyTab.key === activeKey
                              ? "border-blue-500 text-blue-700 bg-white"
                              : "border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100"}`}>
          <span className="mr-1">{marketMoneyTab.emoji ?? "💰"}</span>{marketMoneyTab.label}
        </button>
      )}
      {/* 지수 — 별도 탭 */}
      {usMarketTab && (
        <button onClick={() => onChange(usMarketTab.key)}
                className={`shrink-0 px-3 py-2 text-sm font-medium rounded-t-md border-b-2 transition-colors -mb-px
                            ${usMarketTab.key === activeKey
                              ? "border-blue-500 text-blue-700 bg-white"
                              : "border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100"}`}>
          <span className="mr-1">{usMarketTab.emoji ?? "📈"}</span>{usMarketTab.label}
        </button>
      )}
      {tabs.map(t => {
        const active = t.key === activeKey;
        const editable = !RESERVED.has(t.key);
        // 시스템·내자산 탭은 위 드롭다운으로만 표시 (개별 탭 숨김)
        if (SYSTEM_TAB_KEYS.has(t.key) || MY_GROUP_KEYS.has(t.key)) return null;
        // 폴더에 담긴 그룹 탭은 개별로 안 그림 (폴더 드롭다운으로 표시)
        if (editable && folderedGroups.has(t.key)) return null;
        return (
          <div key={t.key} className="group relative inline-flex shrink-0">
            <button
              onClick={() => onChange(t.key)}
              className={`px-3 py-2 text-sm font-medium rounded-t-md
                          border-b-2 transition-colors -mb-px
                          ${active
                            ? "border-blue-500 text-blue-700 bg-white"
                            : "border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100"}`}>
              {/* 일반 그룹 탭 — 모바일처럼 아이콘/이모지 없이 이름만 */}
              {t.label}
              {t.count > 0 && (
                <span className={`ml-1.5 text-xs ${active ? "text-blue-500" : "text-gray-400"}`}>
                  {t.count}
                </span>
              )}
            </button>
            {editable && (onRename || onDelete) && (
              <div className="absolute -top-0.5 -right-1 flex gap-0.5
                              opacity-0 group-hover:opacity-90 hover:!opacity-100
                              bg-white rounded shadow px-0.5 transition-opacity">
                {onRename && (
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); handleRename(t.key, t.label); }}
                    title="그룹명 변경"
                    className="inline-flex items-center leading-none px-0.5
                               text-slate-500 hover:text-slate-800">
                    <Settings size={12} strokeWidth={2.2} />
                  </button>
                )}
                {onDelete && (
                  <button
                    type="button"
                    onClick={e => {
                      e.stopPropagation();
                      const msg = `"${t.label}" 그룹의 ${t.count}건을 모두 삭제할까요?`
                                + `\n(되돌릴 수 없음)`;
                      if (confirm(msg)) onDelete(t.key);
                    }}
                    title="그룹 삭제"
                    className="text-[10px] leading-none px-0.5
                               hover:text-rose-600">
                    🗑
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* 폴더 — 📁 폴더(선택그룹) 드롭다운 */}
      {folderList.map(folder => {
        const members = folder.groups.filter(g => presentGroups.has(g))
                              .sort((a, b) => a.localeCompare(b, "ko"));   // 이름순
        if (members.length === 0) return null;
        const current = members.includes(activeKey) ? activeKey : members[0];
        const active = members.includes(activeKey);
        // 멤버 1개 → 폴더명(그룹명) 단일 탭 (드롭다운 없이 바로 클릭)
        if (members.length === 1) {
          const g = members[0];
          const cnt = countByKey.get(g) ?? 0;
          return (
            <button key={`__folder__${folder.name}`}
                    onClick={() => onChange(g)}
                    className={`shrink-0 px-3 py-2 text-sm font-medium rounded-t-md border-b-2 -mb-px transition-colors
                                ${active ? "border-blue-500 text-blue-700 bg-white" : "border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100"}`}>
              📁{folder.name}({g})
              {cnt > 0 && (
                <span className={`ml-1.5 text-xs ${active ? "text-blue-500" : "text-gray-400"}`}>{cnt}</span>
              )}
            </button>
          );
        }
        // 폴더명 링크 — 클릭 시 폴더 진입(현재/첫 멤버). 멤버 전환은 아래 폴더 sub 링크바에서.
        return (
          <button key={`__folder__${folder.name}`}
                  onClick={() => onChange(current)}
                  className={`shrink-0 px-3 py-2 text-sm font-medium rounded-t-md border-b-2 -mb-px transition-colors
                              ${active ? "border-blue-500 text-blue-700 bg-white"
                                       : "border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100"}`}>
            📁{folder.name}
          </button>
        );
      })}
      </nav>
      {/* 폴더 sub 링크바 — 폴더 안 그룹에 있을 때, 그 폴더의 그룹들을 칩으로 펼쳐 빠르게 전환.
          Tabs(=tabsStickyRef) 안에 두어 sticky 측정 높이에 포함 → 아래 정렬 툴바가 자동으로 밀려 내려감. */}
      {(() => {
        const activeFolder = folderList.find(f =>
          f.groups.some(g => g === activeKey && presentGroups.has(g)));
        if (!activeFolder) return null;
        const members = activeFolder.groups.filter(g => presentGroups.has(g))
                                    .sort((a, b) => a.localeCompare(b, "ko"));
        if (members.length < 2) return null;
        return (
          <div className="flex items-center gap-1.5 overflow-x-auto whitespace-nowrap
                          px-1 py-1.5 border-b border-gray-200 bg-white">
            {members.map(g => {
              const on = g === activeKey;
              const cnt = countByKey.get(g) ?? 0;
              return (
                <div key={g} className="group relative inline-flex shrink-0">
                  <button onClick={() => onChange(g)}
                          className={`rounded-full px-3 py-1 text-xs font-medium transition inline-flex items-center gap-1
                                      ${on ? "bg-blue-600 text-white"
                                           : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                    <span>{g}</span>
                    {cnt > 0 && <span className={on ? "text-blue-100" : "text-gray-400"}>{cnt}</span>}
                  </button>
                  {/* 수정/삭제 — hover 시 노출 (일반 탭과 동일) */}
                  {(onRename || onDelete) && (
                    <div className="absolute -top-1.5 -right-1 flex gap-0.5
                                    opacity-0 group-hover:opacity-90 hover:!opacity-100
                                    bg-white rounded shadow px-0.5 transition-opacity">
                      {onRename && (
                        <button type="button" title="그룹명 변경"
                                onClick={e => { e.stopPropagation(); handleRename(g, g); }}
                                className="inline-flex items-center leading-none px-0.5 text-slate-500 hover:text-slate-800">
                          <Settings size={11} strokeWidth={2.2} />
                        </button>
                      )}
                      {onDelete && (
                        <button type="button" title="그룹 삭제"
                                onClick={e => {
                                  e.stopPropagation();
                                  if (confirm(`"${g}" 그룹의 ${cnt}건을 모두 삭제할까요?\n(되돌릴 수 없음)`)) onDelete(g);
                                }}
                                className="text-[10px] leading-none px-0.5 hover:text-rose-600">🗑</button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })()}
    </>
  );
}

// 증시 — 증시 자금동향(예탁금·신용·펀드) + 코스피/코스닥/코스피200 실시간 차트. 지수 왼쪽 별도 탭.
export const MARKET_MONEY_TAB_KEY = "__market-money__";
export const US_MARKET_TAB_KEY = "__us-market__";
export const SEMI_CHECK_TAB_KEY = "__semi-check__";
// 한국 섹터 순위 — 토스 TICS depth1 기반, 돈의 흐름 시각화
export const SECTOR_RANK_TAB_KEY = "__sector-rank__";
// 가상 합산 그룹 — 모든 그룹의 동일 ticker 를 합쳐 표시 (수량/평단 통합 뷰)
export const MY_STOCKS_TAB_KEY = "__my-stocks__";
// 내거래 — 모든 종목의 거래 기록(trades) 모아보기. 내주식과 한 묶음.
export const MY_TRADES_TAB_KEY = "__my-trades__";
// 분석 탭 — 컨센서스/연기금/변동성 sub탭 통합
export const CONSENSUS_TAB_KEY = "__consensus__";
// ETF 역검색 — 다중 종목으로 ETF 찾기
export const ETF_REVERSE_TAB_KEY = "__etf-reverse__";
// ETF 랭킹 — 전체 ETF 등락률 순위 (새로고침 눌러야 조회, 17콜)
export const ETF_RANKING_TAB_KEY = "__etf-ranking__";
// ETF 비교 — 같은 기초지수(SCHD/QQQ 등) 추종 국내 ETF 운용사·보수·배당·수익률 비교
export const ETF_COMPARE_TAB_KEY = "__etf-compare__";

// 시스템 reserved — 이름 변경/삭제 불가
const RESERVED = new Set<string>([
  "관심ETF", MARKET_MONEY_TAB_KEY, US_MARKET_TAB_KEY, SEMI_CHECK_TAB_KEY,
  SECTOR_RANK_TAB_KEY, MY_STOCKS_TAB_KEY, MY_TRADES_TAB_KEY, CONSENSUS_TAB_KEY,
  ETF_REVERSE_TAB_KEY, ETF_RANKING_TAB_KEY, ETF_COMPARE_TAB_KEY,
]);

// 묶기 대상 시스템 탭 — 드롭다운 하나로 합침. (증시·지수는 자주 써서 별도 고정 탭)
export const SYSTEM_TAB_KEYS = new Set<string>([
  MARKET_MONEY_TAB_KEY, US_MARKET_TAB_KEY, SECTOR_RANK_TAB_KEY, SEMI_CHECK_TAB_KEY,
  CONSENSUS_TAB_KEY, ETF_REVERSE_TAB_KEY, ETF_RANKING_TAB_KEY, ETF_COMPARE_TAB_KEY,
]);

// 내자산 묶음 — 내주식 + 내거래를 별도 드롭다운 하나로 (지수 묶음과 동일 방식).
export const MY_GROUP_KEYS = new Set<string>([
  MY_STOCKS_TAB_KEY, MY_TRADES_TAB_KEY,
]);

// 미국증시 → 섹터순위 → 반도체 점검 → 내주식(합산) → 사용자 그룹 알파벳 순.
// "보유"도 일반 사용자 그룹과 동일하게 취급 (별도 분기 없음).
// visibility 미지정 시 시스템 탭 모두 노출 (기본 동작).
export function buildTabs(holdings: Stock[], visibility?: TabVisibility, tradeCount = 0): TabSpec[] {
  const showUs = visibility?.usMarket ?? true;
  const showSector = visibility?.sectorRank ?? true;
  const showMy = visibility?.myStocks ?? true;
  const showMyTrades = visibility?.myTrades ?? true;
  const showConsensus = visibility?.consensus ?? true;
  const counts = new Map<string, number>();
  const uniqHeld = new Set<string>();
  for (const s of holdings) {
    const acc = normalizeAccount(s.account);
    counts.set(acc, (counts.get(acc) || 0) + 1);
    if (s.shares > 0 && s.avg_price > 0) uniqHeld.add(s.ticker);
  }
  const tabs: TabSpec[] = [];
  // 증시 — 지수 왼쪽. 증시 자금동향 + 실시간 지수·투자자 차트.
  if (visibility?.stockMarket ?? true) tabs.push({ key: MARKET_MONEY_TAB_KEY, label: "증시", emoji: "💰", count: 0 });
  if (showUs) tabs.push({ key: US_MARKET_TAB_KEY, label: "지수", emoji: "📈", count: 0 });
  // 섹터 (KODEX ETF 기반 4기간 ranking + 토스 핫 테마). 반도체는 지수 대시보드 그룹으로 통합됨.
  if (showSector) tabs.push({ key: SECTOR_RANK_TAB_KEY, label: "섹터", emoji: "🧩", count: 0 });
  // 내주식 (합산) — 보유 수량 있는 모든 ticker 의 가중평균. 종목 1개 이상일 때만 노출.
  if (showMy && uniqHeld.size > 0) {
    tabs.push({ key: MY_STOCKS_TAB_KEY, label: "내주식", emoji: "📦", count: uniqHeld.size });
  }
  // 내거래 — 내주식 바로 옆(한 묶음). 거래 기록이 있거나 보유 종목이 있을 때 노출.
  if (showMyTrades && (tradeCount > 0 || uniqHeld.size > 0)) {
    tabs.push({ key: MY_TRADES_TAB_KEY, label: "내거래", emoji: "🧾", count: tradeCount });
  }
  // 컨센서스 — 내주식 옆. 설정 ON 이면 항상 노출(종목 없으면 빈 안내 표시).
  if (showConsensus) {
    tabs.push({ key: CONSENSUS_TAB_KEY, label: "컨센서스", emoji: "🎯", count: 0 });
  }
  // ETF 역검색 — 다중 종목 교집합/합집합
  if (visibility?.etfReverse ?? true) {
    tabs.push({ key: ETF_REVERSE_TAB_KEY, label: "ETF검색", emoji: "🍱", count: 0 });
  }
  // ETF 랭킹 — 전체 ETF 등락률 순위
  if (visibility?.etfRanking ?? true) {
    tabs.push({ key: ETF_RANKING_TAB_KEY, label: "ETF랭킹", emoji: "🏅", count: 0 });
  }
  // ETF 비교 — 같은 지수 추종 국내 ETF 비교(SCHD/QQQ 등)
  if (visibility?.etfCompare ?? true) {
    tabs.push({ key: ETF_COMPARE_TAB_KEY, label: "ETF미국", emoji: "⚖️", count: 0 });
  }
  // 모든 사용자 그룹 — "보유" 포함, account="" 와 "관심ETF" 만 제외, 알파벳 순
  const userGroups = Array.from(counts.keys())
    .filter(k => !["", "관심ETF"].includes(k))
    .sort();
  for (const g of userGroups) {
    tabs.push({ key: g, label: g, emoji: "📁", count: counts.get(g)! });
  }
  // 관심ETF 는 별도 탭 X — 미국증시 탭의 섹터별 ETF 컬럼에서만 표시
  return tabs;
}

export function filterByTab(holdings: Stock[], tabKey: string): Stock[] {
  if (tabKey === MY_STOCKS_TAB_KEY) return aggregateHoldings(holdings);
  return holdings.filter(s => normalizeAccount(s.account) === tabKey);
}

// 합산 — 모드별 처리:
//  · 독립 보유 ON(다중 계좌): 같은 ticker 가 그룹별로 서로 다른 보유 → shares 합·가중평균 avg_price.
//  · 독립 보유 OFF(sync, 기본): 같은 ticker 는 모든 그룹에서 동일 값(동기화) → 첫 발견 하나만 채택.
//    (모든 그룹에서 같은 값이라 합산하면 그룹 수만큼 부풀려져 나옴 — 버그 원인이었음)
// 수량 있는 holdings 만 (관심종목/수량 0 제외). buy_date: 가장 이른 매수일.
function aggregateHoldings(holdings: Stock[]): Stock[] {
  const independent = getIndependentGroupsMode();
  if (!independent) {
    // sync 모드 — ticker 별 첫 발견만 채택. 매수일은 가장 이른 것으로 보정.
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
    return Array.from(seen, ([ticker, h]) => ({
      ticker, name: h.name, shares: h.shares, avg_price: h.avg_price,
      invested: Math.round(h.shares * h.avg_price),
      buy_date: earliest.get(ticker) ?? h.buy_date,
      market: h.market,
      account: MY_STOCKS_TAB_KEY,
      // 오늘매수분은 거래로그 기반(attachTodayBuys)만 신뢰 — buy_date 재계산 시
      //  '오늘 일부만 산' 보유 전량이 오늘매수로 잡혀 오늘손익 폭증.
      todayShares: h.todayShares ?? 0,
      todayCost: h.todayCost ?? 0,
    }));
  }
  // 독립 보유 모드 — 그룹별 합산
  interface Acc {
    name: string; shares: number; investedSum: number;
    firstDate?: string; market?: string;
    todayShares: number; todayCost: number;
  }
  const m = new Map<string, Acc>();
  // 미러 중복 가산 방지 — sync 모드는 같은 ticker 의 모든 그룹 row 를 동일 값으로 미러한다
  // (syncAllRowsForTicker). 독립모드로 전환하면 그 동일 미러들이 그대로 합산되어 N배가 됨.
  // → (수량·평단·매수일) 시그니처가 동일한 row 는 같은 보유의 미러로 보고 1회만 합산.
  //    값이 다른(진짜 그룹별 별도 보유) row 만 실제로 더해진다.
  const seenSig = new Map<string, Set<string>>();   // ticker → 시그니처 집합
  for (const h of holdings) {
    if (!(h.shares > 0) || !(h.avg_price > 0)) continue;
    const sig = `${h.shares}__${h.avg_price}__${h.buy_date ?? ""}`;
    let sigs = seenSig.get(h.ticker);
    if (!sigs) { sigs = new Set(); seenSig.set(h.ticker, sigs); }
    if (sigs.has(sig)) continue;   // 동일 미러 — 건너뜀
    sigs.add(sig);
    const cur = m.get(h.ticker);
    const invested = h.shares * h.avg_price;
    const tShares = h.todayShares ?? 0;   // 거래로그 기반 — buy_date 재계산 금지
    const tCost = h.todayCost ?? 0;
    if (!cur) {
      m.set(h.ticker, {
        name: h.name, shares: h.shares, investedSum: invested,
        firstDate: h.buy_date, market: h.market,
        todayShares: tShares,
        todayCost: tCost,
      });
    } else {
      cur.shares += h.shares;
      cur.investedSum += invested;
      cur.todayShares += tShares; cur.todayCost += tCost;
      if (h.buy_date && (!cur.firstDate || h.buy_date < cur.firstDate)) {
        cur.firstDate = h.buy_date;
      }
      if (!cur.market && h.market) cur.market = h.market;
    }
  }
  return Array.from(m, ([ticker, v]) => ({
    ticker,
    name: v.name,
    shares: v.shares,
    avg_price: v.investedSum / v.shares,
    invested: Math.round(v.investedSum),
    buy_date: v.firstDate,
    market: v.market,
    account: MY_STOCKS_TAB_KEY,
    todayShares: v.todayShares,
    todayCost: v.todayCost,
  }));
}
