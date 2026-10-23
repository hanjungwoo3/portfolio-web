// 전용 프록시 목록 안내 — PC 설정·모바일 설정이 같이 쓴다(한 벌만, 엇갈리지 않게).
//   확장·앱이 있으면 전용 프록시는 '확장·앱이 실패할 때만' 쓰이는데, 이걸 몰라 옛 코드 프록시를 켜 둔 채
//   확장 실패 → 프록시도 400 으로 종목이 안 나왔다(사용자 제보 2026-10-23).
import { isProxyDown } from "../lib/proxyStatus";

const DEPLOY_GUIDE = "https://github.com/hanjungwoo3/portfolio-web/blob/main/workers/proxy/DEPLOY-USER.md";

export function ProxyFallbackNote({ via, anyEnabled }: { via: "확장" | "앱"; anyEnabled: boolean }) {
  return (
    <div className="text-[11px] rounded px-2 py-1 border border-emerald-200 bg-emerald-50 text-emerald-800">
      ✅ <b>{via} 사용 중</b> — 시세는 {via}이 직접 받습니다. 아래 프록시는 <b>{via}이 실패할 때만</b> 씁니다.
      {anyEnabled && <span className="text-gray-600"> 오래전에 올린 프록시라면 꺼 두는 게 안전합니다.</span>}
    </div>
  );
}

// 켜진 프록시가 최근 계속 실패하면 — 옛 코드(토스 2026-10-22 변경 전)일 가능성이 크다
export function ProxyDownNote({ url, enabled }: { url: string; enabled: boolean }) {
  if (!enabled || !url || !isProxyDown(url)) return null;
  return (
    <div className="pl-6 text-[10px] text-amber-700">
      ⚠️ 최근 요청이 계속 실패 — 예전 코드라면 <b>최신 코드로 다시 배포</b>하거나 체크를 끄세요.&nbsp;
      <a href={DEPLOY_GUIDE} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">배포 가이드 ↗</a>
    </div>
  );
}
