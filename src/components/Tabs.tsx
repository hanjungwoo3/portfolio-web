import type { Stock } from "../types";

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
}

export function Tabs({ tabs, activeKey, onChange, onRename }: Props) {
  const handleRename = (oldName: string) => {
    const next = window.prompt(`"${oldName}" 그룹명 변경 — 새 이름:`, oldName);
    if (next == null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === oldName) return;
    if (RESERVED.has(trimmed)) {
      alert(`"${trimmed}" 은(는) 사용할 수 없는 이름입니다.`);
      return;
    }
    onRename?.(oldName, trimmed);
  };

  return (
    <nav className="flex flex-wrap gap-1 border-b border-gray-200 mb-3 px-1">
      {tabs.map(t => {
        const active = t.key === activeKey;
        const renameable = onRename && !RESERVED.has(t.key);
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
            {renameable && (
              <button
                type="button"
                onClick={e => { e.stopPropagation(); handleRename(t.key); }}
                title="그룹명 변경"
                className="absolute -top-0.5 -right-0.5 text-[10px] leading-none
                           opacity-0 group-hover:opacity-70 hover:!opacity-100
                           bg-white rounded-full px-0.5 transition-opacity">
                ✏️
              </button>
            )}
          </div>
        );
      })}
    </nav>
  );
}

export const US_MARKET_TAB_KEY = "__us-market__";

// 시스템 reserved — 이름 변경 불가 (보유 / 관심ETF 내부 / 미국증시 탭)
const RESERVED = new Set<string>(["", "관심ETF", US_MARKET_TAB_KEY]);

// 미국증시 → 보유 → (퇴직연금/관심 포함) 사용자 그룹 알파벳 순
export function buildTabs(holdings: Stock[]): TabSpec[] {
  const counts = new Map<string, number>();
  for (const s of holdings) {
    const acc = s.account || "";
    counts.set(acc, (counts.get(acc) || 0) + 1);
  }
  const tabs: TabSpec[] = [
    { key: US_MARKET_TAB_KEY, label: "미국 증시", emoji: "📈", count: 0 },
  ];
  // 1) 보유 (account="")
  if (counts.has("")) {
    tabs.push({ key: "", label: "보유", emoji: "💼", count: counts.get("")! });
  }
  // 2) 그 외 모든 사용자 그룹 (퇴직연금/관심 포함) — 동일 아이콘, 알파벳 순
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
  return holdings.filter(s => (s.account || "") === tabKey);
}
