import { useEffect, useState } from "react";
import { subscribeProxyStatus, type ProxyState } from "../lib/proxyStatus";

// 헤더 인라인 텍스트로 표시 (팝업 없음)
// 메시지에 폴링 간격까지 포함 — 별도 PollingInfo 불필요
interface Props {
  baseRefreshMs: number;  // adaptive 계산용 (10초)
}

export function ProxyStatusBadge({ baseRefreshMs }: Props) {
  const [state, setState] = useState<ProxyState>(
    { health: "ok", total: 0, downHosts: [] }
  );

  useEffect(() => subscribeProxyStatus(setState), []);

  if (state.health === "ok") return null;

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
