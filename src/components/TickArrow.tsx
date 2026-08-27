// 직전 틱 대비 화살표 — 값이 바뀔 때마다 위/아래를 표시한다.
//   StockCard 의 오래된 규칙과 동일: 첫 전환은 속빈(▵▽), 같은 방향이 이어지면 속찬(▲▼).
//   색은 한국 관행 그대로 상승=빨강 / 하락=파랑 — 지수 카드의 역방향(공포지수·환율) 색 반전과는
//   무관하게 "값이 올랐다/내렸다"만 말한다.
//
// 값이 안 바뀌면 직전 화살표를 그대로 유지한다(폴링마다 깜빡이지 않게).

import { useState } from "react";

type TickDir = "up" | "down" | undefined;
interface TickState { last?: number; dir: TickDir; arrow: string }
const INIT: TickState = { dir: undefined, arrow: "" };

interface Props {
  value?: number | null;
  className?: string;    // 크기 조절용 (기본은 부모 글자 크기)
}

export function TickArrow({ value, className = "" }: Props) {
  // 값이 바뀐 그 렌더에서 바로 갱신 — React 가 권하는 '렌더 중 상태 조정' 패턴.
  //   value 를 반영하고 나면 조건이 거짓이 되므로 루프에 빠지지 않는다.
  const [tick, setTick] = useState<TickState>(INIT);
  if (value != null && value > 0 && value !== tick.last) {
    setTick(
      tick.last === undefined
        ? { last: value, dir: undefined, arrow: "" }              // 첫 값 — 비교 대상 없음
        : value > tick.last
          ? { last: value, dir: "up",   arrow: tick.dir === "up"   ? "▲" : "▵" }
          : { last: value, dir: "down", arrow: tick.dir === "down" ? "▼" : "▽" },
    );
  }

  if (!tick.arrow) return null;
  return (
    <span className={`${tick.dir === "up" ? "text-rose-600" : "text-blue-600"} ${className}`}
          title={`직전 갱신 대비 ${tick.dir === "up" ? "상승" : "하락"}`}>
      {tick.arrow}
    </span>
  );
}
