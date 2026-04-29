import { useEffect, useState } from "react";
import { subscribeProxyStatus, type ProxyState } from "../lib/proxyStatus";

export function ProxyStatusBadge() {
  const [state, setState] = useState<ProxyState>(
    { health: "ok", total: 0, downHosts: [] }
  );
  const [showAlert, setShowAlert] = useState(false);

  useEffect(() => {
    const unsub = subscribeProxyStatus(s => {
      setState(s);
      // degraded/down 으로 전환 시 1회 alert
      if (s.health !== "ok") setShowAlert(true);
    });
    return unsub;
  }, []);

  if (state.health === "ok") {
    // 모든 proxy 정상이면 표시 X (UI 깨끗하게 유지)
    return null;
  }

  const cfg = state.health === "down"
    ? { bg: "bg-rose-100 border-rose-300 text-rose-800",
        emoji: "❌", label: "프록시 모두 다운" }
    : { bg: "bg-amber-100 border-amber-300 text-amber-800",
        emoji: "⚠️", label: `프록시 일부 지연 (${state.downHosts.length}/${state.total})` };

  const tooltip = `다운: ${state.downHosts.join(", ") || "없음"}`;

  return (
    <>
      <button
        type="button"
        onClick={() => setShowAlert(true)}
        title={tooltip}
        className={`flex items-center gap-1 px-2 py-1 rounded border
                    text-xs font-bold ${cfg.bg}`}>
        <span>{cfg.emoji}</span>
        <span className="hidden sm:inline">{cfg.label}</span>
      </button>

      {showAlert && (
        <div className="fixed top-16 right-4 z-50 max-w-xs
                        bg-white border border-gray-300 rounded-lg shadow-lg
                        p-3 text-sm">
          <div className="flex items-start gap-2">
            <span className="text-lg">{cfg.emoji}</span>
            <div className="flex-1">
              <div className="font-bold text-gray-800 mb-1">
                {state.health === "down"
                  ? "모든 데이터 서버 연결 실패"
                  : "일부 데이터 서버 응답 지연"}
              </div>
              <div className="text-xs text-gray-600 mb-2">
                {state.downHosts.length}/{state.total} 다운: {state.downHosts.join(", ")}
              </div>
              <div className="text-[11px] text-gray-500">
                {state.health === "down"
                  ? "잠시 후 자동 재시도됩니다. 지속 시 새로고침 (🔄) 후 재시도."
                  : "정상 서버로 자동 fallback 중 — 사용엔 영향 적음."}
              </div>
            </div>
            <button onClick={() => setShowAlert(false)}
                    className="text-gray-400 hover:text-gray-600 text-sm">
              ✕
            </button>
          </div>
        </div>
      )}
    </>
  );
}
