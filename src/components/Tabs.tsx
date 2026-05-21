import type { Stock } from "../types";
import { normalizeAccount } from "../lib/account";
import type { TabVisibility } from "../lib/tabVisibility";
import type { GroupFolder } from "../lib/groupFolders";

export interface TabSpec {
  key: string;
  label: string;
  emoji?: string;
  count: number;
}

interface Props {
  tabs: TabSpec[];
  activeKey: string;
  onChange: (key: string) => void;
  onRename?: (oldName: string, newName: string) => void;
  onDelete?: (name: string) => void;
  folders?: GroupFolder[];   // 그룹 폴더 — 담긴 그룹은 드롭다운 하나로 합쳐 표시
}

export function Tabs({ tabs, activeKey, onChange, onRename, onDelete, folders }: Props) {
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
  const folderedGroups = new Set<string>();
  for (const f of folderList) for (const g of f.groups) if (presentGroups.has(g)) folderedGroups.add(g);

  return (
    <nav className="flex flex-wrap gap-1 border-b border-gray-200 mb-3 px-1">
      {tabs.map(t => {
        const active = t.key === activeKey;
        const editable = !RESERVED.has(t.key);
        // 폴더에 담긴 그룹 탭은 개별로 안 그림 (폴더 드롭다운으로 표시)
        if (editable && folderedGroups.has(t.key)) return null;
        return (
          <div key={t.key} className="group relative inline-flex">
            <button
              onClick={() => onChange(t.key)}
              className={`px-3 py-2 text-sm font-medium rounded-t-md
                          border-b-2 transition-colors -mb-px
                          ${active
                            ? "border-blue-500 text-blue-700 bg-white"
                            : "border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100"}`}>
              {t.emoji && <span className="mr-1">{t.emoji}</span>}
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
                    className="text-[10px] leading-none px-0.5">
                    ✏️
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
        const members = folder.groups.filter(g => presentGroups.has(g));
        if (members.length === 0) return null;
        const current = members.includes(activeKey) ? activeKey : members[0];
        const active = members.includes(activeKey);
        return (
          <div key={`__folder__${folder.name}`}
               className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-t-md border-b-2 -mb-px
                           ${active ? "border-blue-500 bg-white" : "border-transparent hover:bg-gray-100"}`}>
            <button onClick={() => onChange(current)}
                    className={`text-sm font-medium ${active ? "text-blue-700" : "text-gray-500 hover:text-gray-700"}`}>
              📁 {folder.name}
            </button>
            <select value={current}
                    onChange={e => onChange(e.target.value)}
                    className={`text-xs bg-transparent border rounded px-1 py-0.5 focus:outline-none
                                ${active ? "border-blue-300 text-blue-700" : "border-gray-300 text-gray-600"}`}>
              {members.map(g => (
                <option key={g} value={g}>
                  {g}{(countByKey.get(g) ?? 0) > 0 ? ` (${countByKey.get(g)})` : ""}
                </option>
              ))}
            </select>
          </div>
        );
      })}
    </nav>
  );
}

export const US_MARKET_TAB_KEY = "__us-market__";
export const SEMI_CHECK_TAB_KEY = "__semi-check__";
// 한국 섹터 순위 — 토스 TICS depth1 기반, 돈의 흐름 시각화
export const SECTOR_RANK_TAB_KEY = "__sector-rank__";
// 가상 합산 그룹 — 모든 그룹의 동일 ticker 를 합쳐 표시 (수량/평단 통합 뷰)
export const MY_STOCKS_TAB_KEY = "__my-stocks__";
// 컨센서스 상승여력 — 내 종목 목표가 대비 현재가 순위
export const CONSENSUS_TAB_KEY = "__consensus__";

// 시스템 reserved — 이름 변경/삭제 불가
const RESERVED = new Set<string>([
  "관심ETF", US_MARKET_TAB_KEY, SEMI_CHECK_TAB_KEY,
  SECTOR_RANK_TAB_KEY, MY_STOCKS_TAB_KEY, CONSENSUS_TAB_KEY,
]);

// 미국증시 → 섹터순위 → 반도체 점검 → 내주식(합산) → 사용자 그룹 알파벳 순.
// "보유"도 일반 사용자 그룹과 동일하게 취급 (별도 분기 없음).
// visibility 미지정 시 시스템 탭 모두 노출 (기본 동작).
export function buildTabs(holdings: Stock[], visibility?: TabVisibility): TabSpec[] {
  const showUs = visibility?.usMarket ?? true;
  const showSemi = visibility?.semiCheck ?? true;
  const showSector = visibility?.sectorRank ?? true;
  const showMy = visibility?.myStocks ?? true;
  const showConsensus = visibility?.consensus ?? true;
  const counts = new Map<string, number>();
  const uniqHeld = new Set<string>();
  for (const s of holdings) {
    const acc = normalizeAccount(s.account);
    counts.set(acc, (counts.get(acc) || 0) + 1);
    if (s.shares > 0 && s.avg_price > 0) uniqHeld.add(s.ticker);
  }
  const tabs: TabSpec[] = [];
  if (showUs) tabs.push({ key: US_MARKET_TAB_KEY, label: "지수", emoji: "📈", count: 0 });
  // 섹터 — 지수와 반도체 사이 위치 (KODEX ETF 기반 4기간 ranking + 토스 핫 테마)
  if (showSector) tabs.push({ key: SECTOR_RANK_TAB_KEY, label: "섹터", emoji: "🏷", count: 0 });
  if (showSemi) tabs.push({ key: SEMI_CHECK_TAB_KEY, label: "반도체", emoji: "🔧", count: 0 });
  // 내주식 (합산) — 보유 수량 있는 모든 ticker 의 가중평균. 종목 1개 이상일 때만 노출.
  if (showMy && uniqHeld.size > 0) {
    tabs.push({ key: MY_STOCKS_TAB_KEY, label: "내주식", emoji: "📦", count: uniqHeld.size });
  }
  // 컨센서스 상승여력 — 내주식 옆. 보유 종목 있을 때만.
  if (showConsensus && uniqHeld.size > 0) {
    tabs.push({ key: CONSENSUS_TAB_KEY, label: "컨센서스", emoji: "📈", count: 0 });
  }
  // 모든 사용자 그룹 — "보유" 포함, account="" 와 "관심ETF" 만 제외, 알파벳 순
  const userGroups = Array.from(counts.keys())
    .filter(k => !["", "관심ETF"].includes(k))
    .sort();
  for (const g of userGroups) {
    tabs.push({ key: g, label: g, emoji: "🏷", count: counts.get(g)! });
  }
  // 관심ETF 는 별도 탭 X — 미국증시 탭의 섹터별 ETF 컬럼에서만 표시
  return tabs;
}

export function filterByTab(holdings: Stock[], tabKey: string): Stock[] {
  if (tabKey === MY_STOCKS_TAB_KEY) return aggregateHoldings(holdings);
  return holdings.filter(s => normalizeAccount(s.account) === tabKey);
}

// 합산 — 같은 ticker 의 shares 합 + 가중평균 avg_price.
// 수량 있는 holdings 만 합산 (관심종목/수량 0 제외).
// buy_date: 가장 이른 매수일. market: 첫 발견 값.
function aggregateHoldings(holdings: Stock[]): Stock[] {
  interface Acc {
    name: string; shares: number; investedSum: number;
    firstDate?: string; market?: string;
  }
  const m = new Map<string, Acc>();
  for (const h of holdings) {
    if (!(h.shares > 0) || !(h.avg_price > 0)) continue;
    const cur = m.get(h.ticker);
    const invested = h.shares * h.avg_price;
    if (!cur) {
      m.set(h.ticker, {
        name: h.name, shares: h.shares, investedSum: invested,
        firstDate: h.buy_date, market: h.market,
      });
    } else {
      cur.shares += h.shares;
      cur.investedSum += invested;
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
    account: MY_STOCKS_TAB_KEY,   // 합산 row 식별자 — UI 분기용
  }));
}
