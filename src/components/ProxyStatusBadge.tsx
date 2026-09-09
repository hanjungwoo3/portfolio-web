import { useEffect, useState } from "react";
import { subscribeProxyStatus, type ProxyState } from "../lib/proxyStatus";
import { useExtensionProxyReady } from "../lib/extensionProxy";
import { isNativeApp } from "../lib/nativeProxy";

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
  // 확장·앱은 프록시 목록을 아예 통과하지 않는다 → 공용 프록시 상태를 말할 이유가 없다.
  //   (확장 감지는 핸드셰이크라 마운트 뒤에 켜지므로 훅으로 구독한다)
  const extReady = useExtensionProxyReady();
  const direct = isNativeApp() || extReady;

  useEffect(() => subscribeProxyStatus(setState), []);

  const baseSec = Math.round(baseRefreshMs / 1000);

  // 폴링 간격 (adaptive: base + downCount * base)
  const intervalSec = Math.round(
    (baseRefreshMs + state.downHosts.length * baseRefreshMs) / 1000
  );

  // 상태별 경고/안내 메시지 (정상이 아닐 때만)
  //   ★ 직결(확장·앱)을 가장 먼저 본다. 공용 프록시 상태를 먼저 검사하면, 확장을 쓰는데도
  //     "공용 프록시 1/3 사용량 소진 — 갱신 10초로 늦춤" 같은 무관한 경고가 이긴다(실제 제보).
  let statusMsg: { emoji: string; text: string; color: string } | null = null;
  if (direct) {
    statusMsg = {
      emoji: isNativeApp() ? "📱" : "🧩",
      text: `${isNativeApp() ? "앱" : "확장"} 직결 · ${baseSec}초 갱신`,
      color: "text-emerald-700",
    };
  } else if (state.health === "down") {
    statusMsg = {
      emoji: "❌",
      text: `공용 프록시 모두 사용량 소진 (${state.total}/${state.total}) — 갱신 중지`,
      color: "text-rose-700",
    };
  } else if (state.health === "degraded") {
    statusMsg = {
      emoji: "⚠️",
      text: `공용 프록시 ${state.downHosts.length}/${state.total} 사용량 소진 — 갱신 ${intervalSec}초로 늦춤`,
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
        <span title={direct
                ? "프록시를 거치지 않고 직접 받아옵니다 — 호출 한도·공용 프록시 상태와 무관"
                : state.health !== "ok"
                ? `사용량 소진/응답없음: ${state.downHosts.join(", ")} — 정상 서버로 자동 fallback`
                : "공용 프록시 대신 본인 전용 Cloudflare Worker 사용 중"}
              className={`text-[11px] ${statusMsg.color}`}>
          {statusMsg.emoji} {statusMsg.text}
        </span>
      )}
      {!usePersonalProxy && (
        <span title="본인 전용 Cloudflare Worker 무료 배포(카드 불필요, 100k req/일) + 폴링 주기 선택 가능"
              className="text-[11px] text-gray-500">
          💡{" "}
          <button onClick={onOpenSettings}
                  className="text-blue-600 hover:underline font-medium">
            ⚙️ 설정
          </button>
          에서 <b className="text-emerald-600">무료</b> 프록시 추가 시 5초 갱신 가능{" "}
          <a href={GUIDE_URL} target="_blank" rel="noopener noreferrer"
             className="text-blue-600 hover:underline">
            [추가방법]
          </a>
        </span>
      )}
    </span>
  );
}
