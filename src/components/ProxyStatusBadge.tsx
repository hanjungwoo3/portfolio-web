import { useEffect, useState } from "react";
import { subscribeProxyStatus, type ProxyState } from "../lib/proxyStatus";

// 헤더 인라인 텍스트로 표시 (팝업 없음)
// 메시지에 폴링 간격까지 포함 — 별도 PollingInfo 불필요
interface Props {
  baseRefreshMs: number;       // adaptive 계산용 (5/10/30/60초)
  usePersonalProxy: boolean;   // 전용 프록시 사용 여부 — 정상 시에도 헤더에 안내
}

export function ProxyStatusBadge({ baseRefreshMs, usePersonalProxy }: Props) {
  const [state, setState] = useState<ProxyState>(
    { health: "ok", total: 0, downHosts: [] }
  );

  useEffect(() => subscribeProxyStatus(setState), []);

  // 정상 상태 — 전용 프록시 사용 중이면 강조 / 아니면 안내 힌트
  if (state.health === "ok") {
    const baseSec = Math.round(baseRefreshMs / 1000);
    if (usePersonalProxy) {
      return (
        <span title="공개 4-way 대신 본인 전용 Cloudflare Worker 사용 중"
              className="text-[11px] text-blue-700 shrink-0">
          🔧 내 전용 프록시 · {baseSec}초 갱신
        </span>
      );
    }
    return (
      <span title="공개 4-way 프록시 (Cloudflare/Vercel/Deno/Render) 사용 중 — 10초 고정"
            className="text-[11px] text-gray-500 shrink-0">
        💡 ⚙️ 설정에서 전용 프록시 추가 시 5초 갱신 가능
      </span>
    );
  }

  // 폴링 간격 (adaptive: base + downCount * base)
  const intervalSec = Math.round(
    (baseRefreshMs + state.downHosts.length * baseRefreshMs) / 1000
  );

  const color = state.health === "down" ? "text-rose-700" : "text-amber-700";
  const emoji = state.health === "down" ? "❌" : "⚠️";
  const msg = state.health === "down"
    ? `프록시 모두 다운 (${state.total}/${state.total}) — 갱신 중지`
    : `프록시 ${state.downHosts.length}/${state.total} 다운으로 갱신시간을 ${intervalSec}초로 변경합니다`;

  return (
    <span title={`다운: ${state.downHosts.join(", ")} — 정상 서버로 자동 fallback`}
          className={`text-[11px] ${color} shrink-0`}>
      {emoji} {msg}
    </span>
  );
}
