// 가상 시뮬레이션 — 각 종목 1주씩 동등 매수 가정.
// 가정: 오늘 시초가(open)에 1주씩 매수
// 두 시나리오:
//   1) "냅뒀으면"      : 시초가 합 vs 현재가 합 → 매수 후 지금까지
//   2) "고가에 팔았으면" : 시초가 합 vs 오늘 고가 합 → 매수 후 당일 고점에 잘 팔았다면
//
// 데이터:
//   - Stock.shares 무관 — 보유/관심 모든 종목 1주씩 가정 (가격 가중)
//   - Price.open (시초가) 없으면 base → cur 로 fallback
//   - Price.high (오늘 고가) 없으면 max(open, cur, base) 로 fallback

import type { Stock, Price } from "../types";
import { formatSigned, signColor } from "../lib/format";

interface Props {
  holdings: Stock[];
  prices: Map<string, Price>;
}

export function WhatIfRow({ holdings, prices }: Props) {
  const seen = new Set<string>();
  let openSum = 0, curSum = 0, highSum = 0;
  let count = 0;

  for (const s of holdings) {
    if (seen.has(s.ticker)) continue;
    const p = prices.get(s.ticker);
    if (!p) continue;
    const cur = p.price || 0;
    const base = p.base || cur;
    const open = p.open > 0 ? p.open : (base > 0 ? base : cur);
    if (cur <= 0 || open <= 0) continue;
    seen.add(s.ticker);
    openSum += open;
    curSum += cur;
    const high = (p.high && p.high > 0) ? p.high : Math.max(open, cur, base);
    highSum += high;
    count += 1;
  }

  if (count === 0) return null;

  const curDiff = curSum - openSum;
  const highDiff = highSum - openSum;
  // 비거래일/시장 종료 후 가격 변동 없으면 레이어 의미 없음 — 숨김
  if (curDiff === 0 && highDiff === 0) return null;

  return (
    <div className="relative w-fit pt-2.5">
      {/* 책갈피 라벨 — 박스 위로 살짝 튀어나오게 */}
      <div className="absolute -top-0.5 left-3 z-10 px-2 py-0.5
                       bg-amber-100 border border-amber-300
                       text-amber-800 text-[10px] font-bold rounded-md shadow-sm">
        📑 샀더라면 ~ 어땠을까?
      </div>
      <div className="bg-white border border-gray-300 rounded-lg shadow-md
                       px-3 pt-3.5 pb-2 text-[11px] text-gray-700 leading-snug whitespace-nowrap
                       grid grid-cols-[auto_auto] gap-x-3 items-baseline tabular-nums">
        <div className="text-gray-500">시작가 {count}종목 구매</div>
        <div className="text-right text-gray-500">{openSum.toLocaleString()}원</div>
        <div>고가에 팔았으면</div>
        <div className={`text-right font-bold ${signColor(highDiff)}`}>
          {formatSigned(highDiff)}원
        </div>
        <div>냅뒀으면</div>
        <div className={`text-right font-bold ${signColor(curDiff)}`}>
          {formatSigned(curDiff)}원
        </div>
      </div>
    </div>
  );
}
