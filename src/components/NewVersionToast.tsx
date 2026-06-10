// 새 버전 감지 토스트 — dist/version.json 폴링 → 자기 hash 와 비교
// 상단 작은 카드, "새로고침" 클릭 시 캐시 초기화 + reload

import { useEffect, useState } from "react";

const POLL_MS = 5 * 60_000;     // 5분 주기 폴링
const STORAGE_DISMISS_KEY = "portfolio-version-dismissed-commit";

async function fetchLatestCommit(): Promise<string | null> {
  try {
    // 캐시 버스터 — SW/HTTP 캐시 우회
    const url = `${import.meta.env.BASE_URL}version.json?cb=${Date.now()}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json() as { commit?: string };
    return typeof json.commit === "string" ? json.commit : null;
  } catch {
    return null;
  }
}

async function applyNewVersion() {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch (e) {
    console.warn("[new-version] cleanup error", e);
  }
  const url = new URL(window.location.href);
  url.searchParams.set("__cb", Date.now().toString());
  window.location.replace(url.toString());
}

export function NewVersionToast() {
  const [latestCommit, setLatestCommit] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    const check = async () => {
      const latest = await fetchLatestCommit();
      if (stop) return;
      if (latest && latest !== __COMMIT_HASH__) setLatestCommit(latest);
    };
    void check();
    const id = setInterval(check, POLL_MS);
    // 모바일 재진입 커버 — setInterval 은 백그라운드에서 throttle/정지되므로
    // 다양한 "다시 보임" 이벤트마다 즉시 재검사
    const recheck = () => {
      // 숨김 상태에서 발생한 visibilitychange 는 무시 (보일 때만)
      if (document.visibilityState === "hidden") return;
      void check();
    };
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    // BFCache(뒤로/앞으로·앱 복귀)로 복원될 때는 focus/visibilitychange 가
    // 안 뜨고 pageshow 만 뜸 — 모바일에서 토스트가 안 나오던 핵심 누락 경로
    window.addEventListener("pageshow", recheck);
    // 새 SW 가 페이지를 장악한 순간 = 새 버전 확정 — 폴링 안 기다리고 즉시 확인
    const onControllerChange = () => void check();
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    }
    return () => {
      stop = true;
      clearInterval(id);
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
      window.removeEventListener("pageshow", recheck);
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      }
    };
  }, []);

  if (!latestCommit) return null;
  // 사용자가 같은 commit 에 대해 X 로 닫았으면 다시 띄우지 않음
  if (typeof localStorage !== "undefined"
      && localStorage.getItem(STORAGE_DISMISS_KEY) === latestCommit) {
    return null;
  }

  const dismiss = () => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_DISMISS_KEY, latestCommit);
    }
    setLatestCommit(null);
  };

  const refresh = async () => {
    // 클릭 즉시 토스트 닫고 dismiss 저장 — reload 가 실패해도 같은 hash 다시 안 뜨게
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_DISMISS_KEY, latestCommit);
    }
    setLatestCommit(null);
    await applyNewVersion();
  };

  return (
    <div className="fixed top-2 inset-x-0 mx-auto w-fit max-w-[calc(100vw-1rem)] z-[60]
                    flex items-center gap-2 whitespace-nowrap
                    bg-blue-600 text-white text-xs
                    px-3 py-1.5 rounded-full shadow-lg
                    animate-[fadeIn_0.3s_ease-out]">
      <span className="shrink-0">🆕 새 버전이 있어요</span>
      <button onClick={() => void refresh()}
              className="shrink-0 bg-white/20 hover:bg-white/30
                         px-2 py-0.5 rounded font-medium transition">
        새로고침
      </button>
      <button onClick={dismiss}
              title="이번엔 넘기기"
              className="shrink-0 text-white/70 hover:text-white px-1">
        ✕
      </button>
    </div>
  );
}
