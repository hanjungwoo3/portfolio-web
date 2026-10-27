// 설정 창 탭 — 종류별로 나눈다(사용자 요청 2026-10-27: "설정에 탭을 넣고 종류별로 분리", 프록시·앱은 5번째 탭).
// 목록은 여기 한 벌 — PC 설정(SettingsDialog)·모바일 설정(MobileSimpleView)이 같은 배열을 쓴다.
// 마지막에 열었던 탭을 기억해 다음에 그 탭으로 연다.
export type SettingsTabKey = "general" | "sync" | "broker" | "folders" | "proxy";

export const SETTINGS_TABS: { key: SettingsTabKey; label: string; short: string }[] = [
  { key: "general", label: "⚙️ 일반",      short: "⚙️ 일반" },
  { key: "sync",    label: "💾 동기화",    short: "💾 동기화" },
  { key: "broker",  label: "🔗 증권사 연결", short: "🔗 증권사" },
  { key: "folders", label: "📁 그룹 폴더",  short: "📁 폴더" },
  { key: "proxy",   label: "🔧 프록시·앱",  short: "🔧 프록시·앱" },
];

const KEY = "portfolio_settings_tab";

export function getLastSettingsTab(): SettingsTabKey {
  try {
    const v = localStorage.getItem(KEY);
    return SETTINGS_TABS.some(t => t.key === v) ? (v as SettingsTabKey) : "general";
  } catch { return "general"; }
}
export function setLastSettingsTab(tab: SettingsTabKey): void {
  try { localStorage.setItem(KEY, tab); } catch { /* noop */ }
}
