// 주간/야간 배경 전환 — 헤더 설정 버튼 옆(사용자 요청 2026-10-23). PC·모바일 같은 컴포넌트.
import { setNightBg, useNightBg } from "../lib/nightBg";

export function NightToggle({ className = "" }: { className?: string }) {
  const night = useNightBg();
  return (
    <button onClick={() => setNightBg(!night)}
            title={night ? "주간 배경으로" : "야간 배경으로 (카드 바깥만 어둡게)"}
            aria-label={night ? "주간 배경" : "야간 배경"}
            className={`shrink-0 rounded bg-gray-100 hover:bg-gray-200 border border-gray-200 leading-none ${className}`}>
      {night ? "☀️" : "🌙"}
    </button>
  );
}
