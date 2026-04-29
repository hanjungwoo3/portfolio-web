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
  onDelete?: (name: string) => void;
}

export function Tabs({ tabs, activeKey, onChange, onRename, onDelete }: Props) {
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

  return (
    <nav className="flex flex-wrap gap-1 border-b border-gray-200 mb-3 px-1">
      {tabs.map(t => {
        const active = t.key === activeKey;
        const editable = !RESERVED.has(t.key);
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
    </nav>
  );
}

export const US_MARKET_TAB_KEY = "__us-market__";

// 시스템 reserved — 이름 변경/삭제 불가 (관심ETF 내부 / 미국증시 시스템 탭)
// "보유" (account="") 도 일반 그룹과 동일 — 사용자가 이름 변경/삭제 가능.
const RESERVED = new Set<string>(["관심ETF", US_MARKET_TAB_KEY]);

// 미국증시 → 보유 → (퇴직연금/애매 등) 사용자 그룹 알파벳 순
// 모든 그룹 동일 아이콘 🏷 — "보유"도 일반 그룹.
export function buildTabs(holdings: Stock[]): TabSpec[] {
  const counts = new Map<string, number>();
  for (const s of holdings) {
    const acc = s.account || "";
    counts.set(acc, (counts.get(acc) || 0) + 1);
  }
  const tabs: TabSpec[] = [
    { key: US_MARKET_TAB_KEY, label: "미국 증시", emoji: "📈", count: 0 },
  ];
  // 1) 보유 (account="") — 일반 그룹과 동일 아이콘
  if (counts.has("")) {
    tabs.push({ key: "", label: "보유", emoji: "🏷", count: counts.get("")! });
  }
  // 2) 그 외 모든 사용자 그룹 — 동일 아이콘, 알파벳 순
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
