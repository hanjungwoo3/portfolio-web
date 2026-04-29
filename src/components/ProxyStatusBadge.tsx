import { useEffect, useState } from "react";
import { subscribeProxyStatus, type ProxyState } from "../lib/proxyStatus";

// 헤더 인라인 텍스트로 표시 (팝업 없음)
// 메시지에 폴링 간격까지 포함 — 별도 PollingInfo 불필요
interface Props {
  baseRefreshMs: number;       // adaptive 계산용 (5/10/30/60초)
  usePersonalProxy: boolean;   // 전용 프록시 사용 여부 — 정상 시에도 헤더에 안내
  onOpenSettings: () => void;  // 힌트의 ⚙️ 설정 클릭 시 다이얼로그 열기
}

const GUIDE_URL =
  "https://github.com/hanjungwoo3/portfolio-web/blob/main/workers/proxy/DEPLOY-USER.md";

export function ProxyStatusBadge({ baseRefreshMs, usePersonalProxy, onOpenSettings }: Props) {
  const [state, setState] = useState<ProxyState>(
    { health: "ok", total: 0, downHosts: [] }
  );

  useEffect(() => subscribeProxyStatus(setState), []);

  const baseSec = Math.round(baseRefreshMs / 1000);

  // 폴링 간격 (adaptive: base + downCount * base)
  const intervalSec = Math.round(
    (baseRefreshMs + state.downHosts.length * baseRefreshMs) / 1000
  );

  // 상태별 경고/안내 메시지 (정상이 아닐 때만)
  let statusMsg: { emoji: string; text: string; color: string } | null = null;
  if (state.health === "down") {
    statusMsg = {
      emoji: "❌",
      text: `프록시 모두 다운 (${state.total}/${state.total}) — 갱신 중지`,
      color: "text-rose-700",
    };
  } else if (state.health === "degraded") {
    statusMsg = {
      emoji: "⚠️",
      text: `프록시 ${state.downHosts.length}/${state.total} 다운으로 갱신시간을 ${intervalSec}초로 변경합니다`,
      color: "text-amber-700",
    };
  } else if (usePersonalProxy) {
    statusMsg = {
      emoji: "🔧",
      text: `내 전용 프록시 · ${baseSec}초 갱신`,
      color: "text-blue-700",
    };
  }

  // 전용 프록시 미사용 시 힌트는 항상 표시 (정상/저하/다운 무관)
  return (
    <span className="flex items-center gap-2 shrink-0 flex-wrap">
      {statusMsg && (
        <span title={state.health !== "ok"
                ? `다운: ${state.downHosts.join(", ")} — 정상 서버로 자동 fallback`
                : "공개 4-way 대신 본인 전용 Cloudflare Worker 사용 중"}
              className={`text-[11px] ${statusMsg.color}`}>
          {statusMsg.emoji} {statusMsg.text}
        </span>
      )}
      {!usePersonalProxy && (
        <span title="본인 전용 Cloudflare Worker 배포 시 100k req/일 전용 + 폴링 주기 선택 가능"
              className="text-[11px] text-gray-500">
          💡{" "}
          <button onClick={onOpenSettings}
                  className="text-blue-600 hover:underline font-medium">
            ⚙️ 설정
          </button>
          에서 전용 프록시 추가 시 5초 갱신 가능{" "}
          <a href={GUIDE_URL} target="_blank" rel="noopener noreferrer"
             className="text-blue-600 hover:underline">
            [배포 가이드]
          </a>
        </span>
      )}
    </span>
  );
}
