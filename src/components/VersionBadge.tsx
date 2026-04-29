// 빌드 시각 표시 + 강제 갱신 (Service Worker + Cache 초기화)
// __BUILD_TIME__ 은 vite.config.ts 의 define 으로 주입됨 (ISO string).

function formatBuildTime(iso: string): string {
  // KST 기준 "MM-DD HH:mm" 표시
  const ms = new Date(iso).getTime() + 9 * 3600_000;
  const d = new Date(ms);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

async function forceUpdate() {
  if (!confirm("최신 버전으로 강제 갱신할까요?\n\n"
                + "• Service Worker + 캐시 초기화 후 새로고침\n"
                + "• 보유/피크/그룹 등 저장된 설정값은 그대로 유지됩니다 (IndexedDB는 초기화 X)"
              )) return;
  try {
    // 1) 모든 SW 등록 해제
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    // 2) Cache API 모든 키 삭제
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch (e) {
    console.warn("[force-update] cleanup error", e);
  }
  // 3) 강제 새로고침 (URL에 캐시버스터 추가하면 강제 fetch)
  const url = new URL(window.location.href);
  url.searchParams.set("__cb", Date.now().toString());
  window.location.replace(url.toString());
}

export function VersionBadge() {
  const ver = formatBuildTime(__BUILD_TIME__);
  return (
    <span className="flex items-center gap-1 text-[11px] text-gray-400 shrink-0">
      <span title={`빌드 시각: ${__BUILD_TIME__}`}>v {ver}</span>
      <button onClick={() => void forceUpdate()}
              title="최신 버전 적용 (캐시 초기화 + 새로고침)"
              className="hover:text-blue-600 transition-colors px-0.5">
        🔄
      </button>
    </span>
  );
}
