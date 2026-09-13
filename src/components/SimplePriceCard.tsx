// 심플 보기 '현재가 박스' — 심플보기 팝업과 섹터(업종·테마) 팝업이 같이 쓴다.
//   StockCard 가격박스와 같은 폰트·색·배경. 여기서 한 번만 정의해 두 화면이 어긋나지 않게 한다.
//
// 목/고/현재가/저를 **금액 내림차순**으로 쌓는다. 위아래 위치가 곧 가격의 높낮이라
//   숫자를 읽기 전에 현재가가 고가에 붙었는지 저가에 붙었는지가 먼저 보인다.

import type { ReactElement } from "react";
import { formatSigned, signColor } from "../lib/format";
import { openTossStock } from "../lib/toss";
import { Sparkline } from "./Sparkline";

export interface SimplePriceCardProps {
  ticker: string;
  name: string;
  price: number;
  base: number;                 // 오늘 변동 기준 (직전 종가)
  high?: number;
  low?: number;
  target?: number;              // 컨센서스 목표가
  chart?: number[];             // 배경 스파크라인 (없으면 생략)
  dimmed?: boolean;             // 이번 세션 미체결 — 값이 직전 세션 것이다
  badge?: ReactElement | null;   // 순위 같은 화면별 부가 정보 (종목명 책갈피 안)
  actions?: ReactElement | null; // 오른쪽 위 책갈피 (기업가치 등)
}

export function SimplePriceCard({
  ticker, name, price, base, high, low, target, chart, dimmed, badge, actions,
}: SimplePriceCardProps) {
  const cur = price;
  const b = base || cur;
  const dayDiff = cur - b;
  const dayPct = b > 0 ? (dayDiff / b) * 100 : 0;
  const priceColor = signColor(dayDiff);

  const auxRow = (k: string, label: string, labelCls: string, val: number) => {
    const d = val - cur;
    const pct = cur > 0 ? (d / cur) * 100 : 0;
    return {
      price: val,
      el: (
        <div key={k} className="text-xs text-gray-700">
          <span className={`text-[10px] ${labelCls}`}>{label} </span>
          {val.toLocaleString()}원
          <span className={`ml-1 text-[10px] ${signColor(d)}`}>
            ({formatSigned(d)}원, {pct >= 0 ? "+" : ""}{pct.toFixed(2)}%)
          </span>
        </div>
      ) as ReactElement,
    };
  };

  const rows: { price: number; el: ReactElement }[] = [];
  if (high && high > 0) rows.push(auxRow("hi", "고", "text-gray-500", high));
  if (low && low > 0) rows.push(auxRow("lo", "저", "text-gray-500", low));
  if (target && target > 0) rows.push(auxRow("tg", "목", "text-amber-600 font-medium", target));
  rows.push({
    price: cur,
    el: (
      <div key="cur" className="relative z-10">
        {/* 기본 종목 카드(StockCard)의 가격줄과 같게 — 화살표 없이 금액만 크게.
            등락률 줄의 pl-6 들여쓰기도 거기서 온 것이다. */}
        <span className={`text-xl font-bold leading-tight ${priceColor}`}>
          {cur.toLocaleString()}원
        </span>
        <div className={`flex items-baseline gap-1 pl-6 font-bold ${priceColor}`}>
          <span className="text-lg leading-tight bg-yellow-100 rounded px-1">
            {dayPct >= 0 ? "+" : ""}{dayPct.toFixed(2)}%
          </span>
          <span className="text-xs font-normal">({formatSigned(dayDiff)}원)</span>
        </div>
      </div>
    ),
  });
  rows.sort((a, b2) => b2.price - a.price);

  // 종목명은 카드 위에 걸치는 '책갈피' 로 뺀다 — 카드 안에 두면 가격과 세로로 경쟁해서
  //   훑을 때 시선이 이름에 먼저 걸린다. 밖으로 빼면 가격이 카드의 주인공이 되고 이름은
  //   라벨이 된다(앱의 섹션 책갈피와 같은 방식).
  //   바깥은 overflow 를 열어 책갈피가 걸치게 하고, 스파크라인을 자르는 overflow-hidden 은
  //   안쪽 상자에만 건다.
  return (
    // h-full + min-h — 목표가 행이 있는 카드와 없는 카드가 한 줄에 섞이면 높이가 들쭉날쭉하다.
    //   그리드가 같은 행은 늘려 주지만 **행끼리는 안 맞춰 준다** → 최소 높이로 바닥을 깐다.
    //   남는 높이는 위아래로 나눠 내용을 가운데 둔다(기본 종목 카드와 같은 느낌).
    <div className={`relative mt-2.5 h-full ${dimmed ? "opacity-60" : ""}`}>
      <span className="absolute -top-2.5 left-2 z-20 max-w-[calc(100%-1rem)] flex items-baseline gap-1
                       px-1.5 py-0.5 rounded-md border border-gray-300 bg-white shadow-sm">
        <button onClick={() => openTossStock(ticker)}
                className={`text-[13px] font-bold hover:underline truncate text-left ${priceColor}`}>
          {name}
        </button>
        {badge}
      </span>
      {actions && (
        <span className="absolute -top-2.5 right-2 z-20 flex items-center gap-0.5
                         px-1 py-0.5 rounded-md border border-gray-300 bg-white shadow-sm">
          {actions}
        </span>
      )}
      <div className="relative h-full min-h-[104px] flex flex-col justify-center
                      overflow-hidden border border-gray-200 rounded-md
                      bg-gray-50/60 px-2 pt-3 pb-1.5 space-y-0.5">
        {chart && chart.length > 1 && (
          <Sparkline data={chart} width={300} height={90} target={target}
                     className="absolute inset-0 w-full h-full opacity-20 pointer-events-none" />
        )}
        {rows.map(r => r.el)}
      </div>
    </div>
  );
}

export default SimplePriceCard;
