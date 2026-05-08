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
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      stop = true;
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
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
    <div className="fixed top-2 left-1/2 -translate-x-1/2 z-50
                    flex items-center gap-2
                    bg-blue-600 text-white text-xs
                    px-3 py-1.5 rounded-full shadow-lg
                    animate-[fadeIn_0.3s_ease-out]">
      <span>🆕 새 버전이 있어요</span>
      <button onClick={() => void refresh()}
              className="bg-white/20 hover:bg-white/30
                         px-2 py-0.5 rounded font-medium transition">
        새로고침
      </button>
      <button onClick={dismiss}
              title="이번엔 넘기기"
              className="text-white/70 hover:text-white px-1">
        ✕
      </button>
    </div>
  );
}
