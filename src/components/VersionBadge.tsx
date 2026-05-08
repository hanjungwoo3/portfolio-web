// 빌드 시각 + git hash 표시 + 강제 갱신 (Service Worker + Cache 초기화)
// __BUILD_TIME__ / __COMMIT_HASH__ 는 vite.config.ts 의 define 으로 주입됨.

// 첫 로드 시 1회 콘솔에 버전 출력 (개발자 도구로도 확인 가능)
if (typeof window !== "undefined" && !(window as any).__VERSION_LOGGED__) {
  // eslint-disable-next-line no-console
  console.log(
    `%c portfolio-web %c ${__COMMIT_HASH__} %c ${__BUILD_TIME__} `,
    "background:#1f2937;color:#fff;padding:2px 4px;border-radius:3px 0 0 3px;",
    "background:#3b82f6;color:#fff;padding:2px 4px;",
    "background:#94a3b8;color:#fff;padding:2px 4px;border-radius:0 3px 3px 0;",
  );
  (window as any).__VERSION_LOGGED__ = true;
}

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

// 외부에서도 호출 가능 (헤더 🔄 버튼 등)
export async function forceUpdate(opts?: { silent?: boolean }) {
  if (!opts?.silent && !confirm("최신 버전으로 강제 갱신할까요?\n\n"
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

interface BadgeProps {
  compact?: boolean;   // true: 모바일용 — git hash 만 (시간 X)
}

export function VersionBadge({ compact }: BadgeProps = {}) {
  const ver = formatBuildTime(__BUILD_TIME__);
  const tip = `commit: ${__COMMIT_HASH__}\n빌드: ${__BUILD_TIME__}\n클릭: 캐시 초기화 + 새로고침`;
  return (
    <span className="flex items-center gap-1 text-[10px] text-gray-400 shrink-0">
      {compact ? (
        // 모바일 — hash 만, 클릭으로 강제 갱신 (🔄 버튼 통합)
        <button onClick={() => void forceUpdate()} title={tip}
                className="hover:text-blue-600 transition-colors leading-none">
          v {__COMMIT_HASH__}
        </button>
      ) : (
        <>
          <span title={tip}>v {ver} · {__COMMIT_HASH__}</span>
          <button onClick={() => void forceUpdate()}
                  title="최신 버전 적용 (캐시 초기화 + 새로고침)"
                  className="hover:text-blue-600 transition-colors px-0.5">
            🔄
          </button>
        </>
      )}
    </span>
  );
}
