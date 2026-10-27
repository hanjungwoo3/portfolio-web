// 설정 창 상단 탭 줄 — PC·모바일 공용. 좁으면 가로 스크롤(줄바꿈 X).
import { SETTINGS_TABS, type SettingsTabKey } from "../lib/settingsTabs";

export function SettingsTabBar({ tab, onChange, compact = false }: {
  tab: SettingsTabKey; onChange: (t: SettingsTabKey) => void; compact?: boolean;
}) {
  return (
    <div role="tablist" aria-label="설정 종류"
         className="flex gap-1 px-3 pt-2 pb-0 border-b bg-gray-50 overflow-x-auto shrink-0">
      {SETTINGS_TABS.map(t => {
        const active = t.key === tab;
        return (
          <button key={t.key} type="button" role="tab" aria-selected={active}
                  onClick={() => onChange(t.key)}
                  className={`shrink-0 whitespace-nowrap px-3 py-1.5 text-xs font-medium rounded-t border border-b-0 -mb-px transition
                              ${active
                                ? "bg-white text-blue-700 border-gray-200 border-b-white font-bold"
                                : "bg-transparent text-gray-500 border-transparent hover:text-gray-800 hover:bg-gray-100"}`}>
            {compact ? t.short : t.label}
          </button>
        );
      })}
    </div>
  );
}
