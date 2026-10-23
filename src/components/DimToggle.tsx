// 장 마감 종목 흐림 켜기/끄기 — 헤더 주/야간 버튼 옆(사용자 요청 2026-10-23). PC·모바일 같은 컴포넌트.
//   설정의 "장 마감 시 종목 흐리게 표시"와 같은 값이다.
import { useEffect, useState } from "react";
import { getDimSleepingEnabled, setDimSleepingEnabled, DIM_SLEEPING_EVENT } from "../lib/proxyConfig";

// 흐림 설정을 구독 — 바뀌면 이 훅을 쓴 컴포넌트(App·모바일 루트)가 다시 그려져 아래 카드들이 새 값을 읽는다
export function useDimSleeping(): boolean {
  const [on, setOn] = useState(getDimSleepingEnabled);
  useEffect(() => {
    const f = () => setOn(getDimSleepingEnabled());
    window.addEventListener(DIM_SLEEPING_EVENT, f);
    return () => window.removeEventListener(DIM_SLEEPING_EVENT, f);
  }, []);
  return on;
}

export function DimToggle({ className = "" }: { className?: string }) {
  const on = useDimSleeping();
  return (
    <button onClick={() => setDimSleepingEnabled(!on)}
            title={on ? "장 마감 종목 흐림 끄기" : "장 마감 종목 흐리게"}
            aria-label={on ? "종목 흐림 켜짐" : "종목 흐림 꺼짐"}
            className={`shrink-0 rounded border leading-none ${on ? "bg-gray-100 hover:bg-gray-200 border-gray-200" : "bg-white hover:bg-gray-100 border-gray-200 opacity-60"} ${className}`}>
      💤
    </button>
  );
}
