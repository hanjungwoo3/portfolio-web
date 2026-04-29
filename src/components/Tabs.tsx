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
}

export function Tabs({ tabs, activeKey, onChange }: Props) {
  return (
    <nav className="flex flex-wrap gap-1 border-b border-gray-200 mb-3 px-1">
      {tabs.map(t => {
        const active = t.key === activeKey;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            className={`px-3 py-2 text-sm font-medium rounded-t-md
                        border-b-2 transition-colors -mb-px
                        ${active
                          ? "border-blue-500 text-blue-700 bg-white"
                          : "border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100"}`}
          >
            {t.emoji && <span className="mr-1">{t.emoji}</span>}
            {t.label}
            {t.count > 0 && (
              <span className={`ml-1.5 text-xs ${active ? "text-blue-500" : "text-gray-400"}`}>
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

export const US_MARKET_TAB_KEY = "__us-market__";

// 데스크톱 v2 와 동일한 분류 규칙 — 첫 탭은 항상 미국증시
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
  // 2) 퇴직연금
  if (counts.has("퇴직연금")) {
    tabs.push({ key: "퇴직연금", label: "퇴직연금", emoji: "🏦",
                count: counts.get("퇴직연금")! });
  }
  // 3) 관심
  if (counts.has("관심")) {
    tabs.push({ key: "관심", label: "관심", emoji: "⭐", count: counts.get("관심")! });
  }
  // 4) 사용자 정의 그룹 (그 외) — 알파벳 순
  const userGroups = Array.from(counts.keys())
    .filter(k => !["", "퇴직연금", "관심", "관심ETF"].includes(k))
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
