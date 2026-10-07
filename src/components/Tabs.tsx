import { Settings } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Stock } from "../types";
import { normalizeAccount } from "../lib/account";
import { getIndependentGroupsMode } from "../lib/groupMode";
import { DASHBOARD_PAGES, INDEX_GROUP_KEYS, defaultDashboardPage, type DashboardPage } from "../lib/dashboardGroups";
import type { TabVisibility } from "../lib/tabVisibility";
import type { GroupFolder } from "../lib/groupFolders";
import {
  getGroupFolders, folderAllKey, isFolderAllKey, folderNameOfAllKey, FOLDER_ALL_LABEL,
} from "../lib/groupFolders";

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
  const indexTabs = tabs.filter(t => INDEX_GROUP_KEYS.has(t.key));   // 지수 드롭다운(주간·야간·반도체)
  const marketMoneyTab = tabs.find(t => t.key === MARKET_MONEY_TAB_KEY);
  // 내자산 묶기 — 내주식 + 내거래 드롭다운 하나로
  const myTabs = tabs.filter(t => MY_GROUP_KEYS.has(t.key));

  // 묶음 드롭다운 렌더 (시스템/내자산 공통)
  //
  // menuTitle = 목록 맨 위에 붙는 **선택 불가 제목**(optgroup). 이게 없으면 열었을 때
  //   현재 탭(= 첫 항목)이 커서 바로 아래에 겹쳐서, 누르려던 게 이미 선택된 항목이라
  //   아무 일도 안 일어난다. 제목 한 줄을 끼워 목록을 한 칸 내린다.
  // clickKey = 탭 자체를 눌렀을 때 갈 곳(없으면 지금 보이는 탭). 메뉴는 마우스를 올리면 열린다.
  const renderGroupDropdown = (groupTabs: typeof tabs, fallbackEmoji: string, menuTitle: string, clickKey?: string) => {
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
                              ? "border-blue-500 text-blue-700 bg-blue-50"
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
    return (
      <HoverMenu key={menuTitle} title={menuTitle} on={!!activeOne}
                 onTriggerClick={() => onChange(clickKey && groupTabs.some(t => t.key === clickKey) ? clickKey : current)}
                 trigger={<>
                   {curTab?.icon
                     ? <span className="inline-flex align-middle">{curTab.icon}</span>
                     : <span className="text-sm">{curTab?.emoji ?? fallbackEmoji}</span>}
                   <span>{curTab?.label}</span>
                 </>}
                 items={groupTabs.map(t => ({
                   key: t.key, active: t.key === activeKey,
                   label: <>{t.icon ? <span className="inline-flex align-middle">{t.icon}</span> : <span>{t.emoji ?? fallbackEmoji}</span>}
                            <span>{t.label}</span>
                            {t.count > 0 && <span className="text-xs text-gray-400">{t.count}</span>}</>,
                 }))}
                 onPick={onChange} />
    );
  };

  return (
    <>
    <nav className="flex items-center gap-1 overflow-x-auto overflow-y-hidden whitespace-nowrap
                    border-b border-gray-200 mb-3 px-1 pt-1">
      {leading && <span className="shrink-0">{leading}</span>}
      {/* 섹터~ETF 드롭다운 → 내자산 묶음(내주식·내거래) → 지수 순서 */}
      {/* 투자도구 탭을 누르면 종목찾기(눌림목)로 바로 — 다른 도구는 마우스를 올려 메뉴에서 */}
      {renderGroupDropdown(sysTabs, "📊", "투자도구(분석)", VALUATION_TAB_KEY)}   {/* 맨 위 = 종목찾기(섹터별) — 버튼 이름과 누르면 가는 곳이 같게 */}
      {renderGroupDropdown(myTabs, "📦", "내자산")}
      {/* 증시 — 지수 왼쪽 별도 탭 */}
      {marketMoneyTab && (
        <button onClick={() => onChange(marketMoneyTab.key)}
                className={`shrink-0 px-3 py-2 text-sm font-medium rounded-t-md border-b-2 transition-colors -mb-px
                            ${marketMoneyTab.key === activeKey
                              ? "border-blue-500 text-blue-700 bg-blue-50"
                              : "border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100"}`}>
          <span className="mr-1">{marketMoneyTab.emoji ?? "💰"}</span>{marketMoneyTab.label}
        </button>
      )}
      {/* 지수 — 별도 탭 */}
      {/* 지수 — 주간·야간·반도체 드롭다운(투자도구·내자산과 같은 모양) */}
      {/* 지수 탭을 누르면 시간에 맞는 페이지로 — 한국 낮(07~18시)은 주간, 그 외는 야간 */}
      {renderGroupDropdown(indexTabs, "📈", "지수",
        defaultDashboardPage() === "day" ? US_MARKET_TAB_KEY : INDEX_NIGHT_TAB_KEY)}
      {tabs.map(t => {
        const active = t.key === activeKey;
        const editable = !RESERVED.has(t.key);
        // 시스템·내자산 탭은 위 드롭다운으로만 표시 (개별 탭 숨김)
        if (SYSTEM_TAB_KEYS.has(t.key) || MY_GROUP_KEYS.has(t.key) || INDEX_GROUP_KEYS.has(t.key)) return null;
        // 폴더에 담긴 그룹 탭은 개별로 안 그림 (폴더 드롭다운으로 표시)
        if (editable && folderedGroups.has(t.key)) return null;
        // 폴더 전체보기 가상 탭도 개별로 안 그림 (폴더 sub 링크바의 칩으로만)
        if (isFolderAllKey(t.key)) return null;
        return (
          <div key={t.key} className="group relative inline-flex shrink-0">
            <button
              onClick={() => onChange(t.key)}
              className={`px-3 py-2 text-sm font-medium rounded-t-md
                          border-b-2 transition-colors -mb-px
                          ${active
                            ? "border-blue-500 text-blue-700 bg-blue-50"
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
        // 폴더 진입 기본은 '첫 그룹' — 이미 폴더 안 그룹(또는 전체보기)에 있으면 그대로 유지.
        //  기본을 전체보기로 두면 종목 많은 폴더에서 폴더를 누를 때마다 전 종목을 불러온다.
        //  전체보기는 칩바 맨 끝에서 명시적으로 눌러야 켜진다.
        const allKey = folderAllKey(folder.name);
        const current = (members.includes(activeKey) || activeKey === allKey)
          ? activeKey : members[0];
        const active = members.includes(activeKey) || activeKey === allKey;
        // 멤버 1개 → 폴더명(그룹명) 단일 탭 (드롭다운 없이 바로 클릭)
        if (members.length === 1) {
          const g = members[0];
          const cnt = countByKey.get(g) ?? 0;
          return (
            <button key={`__folder__${folder.name}`}
                    onClick={() => onChange(g)}
                    className={`shrink-0 px-3 py-2 text-sm font-medium rounded-t-md border-b-2 -mb-px transition-colors
                                ${active ? "border-blue-500 text-blue-700 bg-blue-50" : "border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100"}`}>
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
                              ${active ? "border-blue-500 text-blue-700 bg-blue-50"
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
          f.groups.some(g => g === activeKey && presentGroups.has(g))
          || folderAllKey(f.name) === activeKey);
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
            {/* 전체보기 — 폴더 안 모든 그룹의 종목을 한 번에. 실제 그룹이 아니라 이름변경·삭제 없음.
                맨 끝에 두는 이유: 종목이 많은 폴더에서 이게 앞에 있으면 무심코 눌러 매번 전부 불러오게 된다. */}
            {(() => {
              const allKey = folderAllKey(activeFolder.name);
              const on = activeKey === allKey;
              const cnt = countByKey.get(allKey) ?? 0;
              return (
                <button onClick={() => onChange(allKey)}
                        className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition inline-flex items-center gap-1
                                    ${on ? "bg-blue-600 text-white"
                                         : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                  <span>{FOLDER_ALL_LABEL}</span>
                  {cnt > 0 && <span className={on ? "text-blue-100" : "text-gray-400"}>{cnt}</span>}
                </button>
              );
            })()}
          </div>
        );
      })()}
    </>
  );
}

// 증시 — 증시 자금동향(예탁금·신용·펀드) + 코스피/코스닥/코스피200 실시간 차트. 지수 왼쪽 별도 탭.
export const MARKET_MONEY_TAB_KEY = "__market-money__";
export const US_MARKET_TAB_KEY = "__us-market__";   // 지수(주간) — 옛 '지수' 키를 그대로 써서 저장된 탭·설정이 이어진다
// 지수(야간)·지수(대장주) — 메뉴의 '📈 지수' 드롭다운에 주간과 같이 묶인다
export const INDEX_NIGHT_TAB_KEY = "__idx-night__";
export const INDEX_SEMI_TAB_KEY = "__idx-semi__";   // 폐지 — 야간에 합침(2026-10-07). 옛 저장값 이동용으로만 남긴다
export const INDEX_LEADERS_TAB_KEY = "__idx-leaders__";   // 지수(대장주) — 섹터 ETF ➜ 대장주
// 묶음·페이지 매핑(INDEX_GROUP_KEYS·indexPageOf)은 lib/dashboardGroups — 컴포넌트 파일에서 Set·함수를
//   export 하면 HMR(fast refresh)이 이 파일을 통째로 다시 그린다.
export const SEMI_CHECK_TAB_KEY = "__semi-check__";
// 한국 섹터 순위 — 토스 TICS depth1 기반, 돈의 흐름 시각화
export const SECTOR_RANK_TAB_KEY = "__sector-rank__";
// 가상 합산 그룹 — 모든 그룹의 동일 ticker 를 합쳐 표시 (수량/평단 통합 뷰)
export const MY_STOCKS_TAB_KEY = "__my-stocks__";
// 내거래 — 모든 종목의 거래 기록(trades) 모아보기. 내주식과 한 묶음.
export const MY_TRADES_TAB_KEY = "__my-trades__";
// 컨센서스 — 증권사 목표주가·연기금·변동폭·등락률 sub탭 (관심종목을 줄 세우는 화면들)
export const CONSENSUS_TAB_KEY = "__consensus__";
// 눌림목 — RSI·볼린저·200일선·흑자·유동성 조건으로 코스피·코스닥 전 종목 스크리닝 (+ 백테스트)
export const SCREENER_TAB_KEY = "__screener__";
// 종가배팅 — 오늘 종가에 사서 다음 날 시가에 파는 후보(lib/closeBet)
export const CLOSE_BET_TAB_KEY = "__close-bet__";
// 수급 매집 — 외국인·기관·연기금 누적 순매수(크롤러 JSON, lib/investorFlows)
export const ACCUM_TAB_KEY = "__accum__";
// ETF 역검색 — 다중 종목으로 ETF 찾기
export const ETF_REVERSE_TAB_KEY = "__etf-reverse__";
// ETF 랭킹 — 전체 ETF 등락률 순위 (새로고침 눌러야 조회, 6콜)
export const ETF_RANKING_TAB_KEY = "__etf-ranking__";
// ETF 비교 — 같은 기초지수(SCHD/QQQ 등) 추종 국내 ETF 운용사·보수·배당·수익률 비교
export const ETF_COMPARE_TAB_KEY = "__etf-compare__";
// 히트맵 — KOSPI/KOSDAQ 종목 트리맵 (TradingView scanner)
export const HEATMAP_TAB_KEY = "__heatmap__";
// 성적표 — 관심종목 전체의 기업가치 지표(시총·PER·ROE 등)를 한 표로, 열별 정렬
export const VALUATION_TAB_KEY = "__valuation__";
export const ASSET_TREND_TAB_KEY = "__asset-trend__";

// 시스템 reserved — 이름 변경/삭제 불가
const RESERVED = new Set<string>([
  "관심ETF", MARKET_MONEY_TAB_KEY, US_MARKET_TAB_KEY, INDEX_NIGHT_TAB_KEY, INDEX_SEMI_TAB_KEY, INDEX_LEADERS_TAB_KEY, SEMI_CHECK_TAB_KEY,
  SECTOR_RANK_TAB_KEY, MY_STOCKS_TAB_KEY, MY_TRADES_TAB_KEY, CONSENSUS_TAB_KEY,
  ETF_REVERSE_TAB_KEY, ETF_RANKING_TAB_KEY, ETF_COMPARE_TAB_KEY, HEATMAP_TAB_KEY,
  SCREENER_TAB_KEY, CLOSE_BET_TAB_KEY, ACCUM_TAB_KEY, VALUATION_TAB_KEY,
]);

// 묶기 대상 시스템 탭 — 드롭다운 하나로 합침. (증시·지수는 자주 써서 별도 고정 탭)
export const SYSTEM_TAB_KEYS = new Set<string>([
  MARKET_MONEY_TAB_KEY, US_MARKET_TAB_KEY, SECTOR_RANK_TAB_KEY, SEMI_CHECK_TAB_KEY,
  CONSENSUS_TAB_KEY, ETF_REVERSE_TAB_KEY, ETF_RANKING_TAB_KEY, ETF_COMPARE_TAB_KEY, HEATMAP_TAB_KEY,
  SCREENER_TAB_KEY, CLOSE_BET_TAB_KEY, ACCUM_TAB_KEY, VALUATION_TAB_KEY,
]);

// 내자산 묶음 — 내주식 + 내거래를 별도 드롭다운 하나로 (지수 묶음과 동일 방식).
export const MY_GROUP_KEYS = new Set<string>([
  MY_STOCKS_TAB_KEY, MY_TRADES_TAB_KEY, ASSET_TREND_TAB_KEY,
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
  // 지수 — 주간·야간·대장주 세 탭(메뉴의 '📈 지수' 드롭다운). 라벨은 lib 한 벌(DASHBOARD_PAGES).
  if (showUs) {
    const keyOf: Record<DashboardPage, string> = { day: US_MARKET_TAB_KEY, night: INDEX_NIGHT_TAB_KEY, leaders: INDEX_LEADERS_TAB_KEY };
    for (const p of DASHBOARD_PAGES) tabs.push({ key: keyOf[p.key], label: p.tab, emoji: p.emoji, count: 0 });
  }
  // 종목찾기(섹터별) — 섹터를 골라 그 안의 종목을 한 표로(옛 '성적표'). 종목찾기 묶음 맨 위.
  if (visibility?.valuation ?? true) {
    tabs.push({ key: VALUATION_TAB_KEY, label: "종목찾기(섹터별)", emoji: "📊", count: 0 });
  }
  // 눌림목 — 시스템 묶음의 첫 자리(섹터 위). 전 종목 스크리닝이라 관심종목과 무관하게 항상 노출.
  if (visibility?.screener ?? true) {
    tabs.push({ key: SCREENER_TAB_KEY, label: "종목찾기(눌림목)", emoji: "🔎", count: 0 });
  }
  if (visibility?.closeBet ?? true) {
    tabs.push({ key: CLOSE_BET_TAB_KEY, label: "종가배팅", emoji: "🌙", count: 0 });
  }
  if (visibility?.accum ?? true) {
    tabs.push({ key: ACCUM_TAB_KEY, label: "수급 매집", emoji: "🧲", count: 0 });
  }
  // 섹터 (KODEX ETF 기반 4기간 ranking + 토스 핫 테마). 반도체는 지수 대시보드 그룹으로 통합됨.
  if (showSector) tabs.push({ key: SECTOR_RANK_TAB_KEY, label: "섹터별등락", emoji: "🧩", count: 0 });
  // 내주식 (합산) — 보유 수량 있는 모든 ticker 의 가중평균. 종목 1개 이상일 때만 노출.
  if (showMy && uniqHeld.size > 0) {
    tabs.push({ key: MY_STOCKS_TAB_KEY, label: "내주식", emoji: "📦", count: uniqHeld.size });
  }
  // 내거래 — 내주식 바로 옆(한 묶음). 거래 기록이 있거나 보유 종목이 있을 때 노출.
  if (showMyTrades && (tradeCount > 0 || uniqHeld.size > 0)) {
    tabs.push({ key: MY_TRADES_TAB_KEY, label: "내거래", emoji: "🧾", count: tradeCount });
  }
  // 자산추이 — 내자산 묶음(내주식·내거래)의 세 번째. 거래 기록이 있어야 역산이 되므로 그때만.
  if ((visibility?.assetTrend ?? true) && tradeCount > 0) {
    tabs.push({ key: ASSET_TREND_TAB_KEY, label: "자산추이", emoji: "📈", count: 0 });
  }
  // 컨센서스 — 목표주가·연기금·변동폭·등락률. 설정 ON 이면 항상 노출(종목 없으면 빈 안내).
  if (showConsensus) {
    tabs.push({ key: CONSENSUS_TAB_KEY, label: "컨센서스(목표주가)", emoji: "🎯", count: 0 });
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
  // 히트맵 — KOSPI/KOSDAQ 트리맵
  if (visibility?.heatmap ?? true) {
    tabs.push({ key: HEATMAP_TAB_KEY, label: "히트맵", emoji: "🗺️", count: 0 });
  }
  // 모든 사용자 그룹 — "보유" 포함, account="" 와 "관심ETF" 만 제외, 알파벳 순
  const userGroups = Array.from(counts.keys())
    .filter(k => !["", "관심ETF"].includes(k))
    .sort();
  for (const g of userGroups) {
    tabs.push({ key: g, label: g, emoji: "📁", count: counts.get(g)! });
  }
  // 폴더 전체보기 — 폴더(멤버 2개 이상)마다 가상 탭 하나.
  //   탭 바에는 안 그리고 폴더 sub 링크바의 칩으로만 노출하지만,
  //   App 의 'activeTab 이 탭 목록에 없으면 첫 탭으로 되돌리기' 가드를 통과하려면
  //   목록에는 반드시 들어 있어야 한다. count 는 중복 제거한 종목 수.
  for (const f of getGroupFolders()) {
    if (f.groups.filter(g => counts.has(g)).length < 2) continue;
    const inFolder = new Set(f.groups);
    const uniq = new Set<string>();
    for (const s of holdings) if (inFolder.has(normalizeAccount(s.account))) uniq.add(s.ticker);
    tabs.push({ key: folderAllKey(f.name), label: FOLDER_ALL_LABEL, count: uniq.size });
  }
  // 관심ETF 는 별도 탭 X — 미국증시 탭의 섹터별 ETF 컬럼에서만 표시
  return tabs;
}

export function filterByTab(holdings: Stock[], tabKey: string): Stock[] {
  if (tabKey === MY_STOCKS_TAB_KEY) return aggregateHoldings(holdings);
  const folderName = folderNameOfAllKey(tabKey);
  if (folderName != null) return folderAllHoldings(holdings, folderName);
  return holdings.filter(s => normalizeAccount(s.account) === tabKey);
}

// 폴더 전체보기 — 폴더 안 모든 그룹의 종목을 ticker 기준으로 합쳐 한 번씩만 보여준다.
//  ⚠️ 내주식 합산(aggregateHoldings)과 달리 0주 관심종목도 남긴다 —
//     관심종목 위주 폴더가 전체보기에서 통째로 비어버리는 걸 막기 위함.
//  독립 보유 ON  → 그룹마다 실제 보유가 다르므로 수량·매수금액 합산 후 평단 재계산.
//  독립 보유 OFF → 모든 그룹이 같은 값(동기화)이라 합치면 부풀려짐 → 첫 발견만 채택.
const investedOf = (s: Stock) => s.invested || s.shares * s.avg_price;
function folderAllHoldings(holdings: Stock[], folderName: string): Stock[] {
  const folder = getGroupFolders().find(f => f.name === folderName);
  if (!folder) return [];
  const members = new Set(folder.groups);
  const independent = getIndependentGroupsMode();
  const key = folderAllKey(folderName);
  const out = new Map<string, Stock>();
  for (const h of holdings) {
    if (!members.has(normalizeAccount(h.account))) continue;
    const prev = out.get(h.ticker);
    if (!prev) { out.set(h.ticker, { ...h, account: key }); continue; }   // 사본 — 원본 불변
    if (h.buy_date && (!prev.buy_date || h.buy_date < prev.buy_date)) prev.buy_date = h.buy_date;
    if (!prev.name && h.name) prev.name = h.name;
    if (!prev.market && h.market) prev.market = h.market;
    if (independent) {
      const shares = prev.shares + h.shares;
      const invested = investedOf(prev) + investedOf(h);
      prev.shares = shares;
      prev.invested = Math.round(invested);
      prev.avg_price = shares > 0 ? invested / shares : 0;
      prev.todayShares = (prev.todayShares ?? 0) + (h.todayShares ?? 0);
      prev.todayCost = (prev.todayCost ?? 0) + (h.todayCost ?? 0);
    } else if (!(prev.shares > 0) && h.shares > 0) {
      // 0주 행이 먼저 잡혔으면 보유 있는 행으로 교체 (매수일은 이른 쪽 유지)
      out.set(h.ticker, { ...h, account: key, buy_date: prev.buy_date ?? h.buy_date });
    }
  }
  return Array.from(out.values());
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

// 상단 묶음 탭(투자도구·내자산·지수) — **마우스를 올리면 펼쳐지는** 메뉴.
//   기본 <select> 는 호버로 못 연다. 탭 줄(nav)이 overflow-x-auto 라 absolute 메뉴는 잘리므로
//   body 에 포털로 띄우고 탭 위치(getBoundingClientRect)에 fixed 로 붙인다.
//   탭 자체를 누르면 메뉴 대신 바로 이동한다(지수 = 시간에 맞는 페이지).
function HoverMenu({ title, on, trigger, items, onPick, onTriggerClick }: {
  title: string;
  on: boolean;
  trigger: ReactNode;
  items: { key: string; label: ReactNode; active: boolean }[];
  onPick: (key: string) => void;
  onTriggerClick: () => void;   // 탭 자체를 누르면 — 메뉴를 여닫지 않고 바로 이동
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const closeTimer = useRef<number | null>(null);
  const cancelClose = () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; } };
  const open = () => {
    cancelClose();
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ left: r.left, top: r.bottom });
  };
  // 탭 → 메뉴로 마우스를 옮기는 사이 틈에서 닫히지 않게 조금 늦게 닫는다
  const closeSoon = () => { cancelClose(); closeTimer.current = window.setTimeout(() => setPos(null), 150); };
  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => { window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, [pos]);
  useEffect(() => cancelClose, []);
  return (
    <>
      <button ref={btnRef}
              onMouseEnter={open} onMouseLeave={closeSoon}
              onClick={() => { setPos(null); onTriggerClick(); }}
              className={`shrink-0 inline-flex items-center gap-1 pl-2 pr-1.5 py-2 text-sm font-medium rounded-t-md border-b-2 -mb-px
                          ${on ? "border-blue-500 bg-blue-50 text-blue-700" : "border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100"}`}>
        {trigger}
        <span className={`text-[10px] ${on ? "text-blue-400" : "text-gray-400"}`}>▾</span>
      </button>
      {pos && createPortal(
        <div onMouseEnter={cancelClose} onMouseLeave={closeSoon}
             className="fixed z-[1000] min-w-[10rem] rounded-lg border border-gray-200 bg-white shadow-lg py-1"
             style={{ left: pos.left, top: pos.top }}>
          <div className="px-3 pt-1 pb-1 text-[11px] font-bold text-gray-400">{title}</div>
          {items.map(it => (
            <button key={it.key}
                    onClick={() => { onPick(it.key); setPos(null); }}
                    className={`w-full flex items-center gap-1.5 px-3 py-1.5 text-sm text-left whitespace-nowrap
                                ${it.active ? "bg-blue-50 text-blue-700 font-bold" : "text-gray-700 hover:bg-gray-100"}`}>
              {it.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
